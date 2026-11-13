import type { WorkEntryFinal } from './schema/work-entry';
import type {
  LeaveGrant,
  LeavePolicy,
  LeaveAllocation,
  LeaveGrantBalance,
  LeaveLedgerTotals,
  LeaveLedgerReason,
} from './schema/leave-ledger';

export class LeaveLedgerError extends Error {
  constructor(
    readonly reason: LeaveLedgerReason,
    readonly status: 400 | 403 | 404 | 409 | 422 | 503 = 422,
  ) {
    super(reason);
    this.name = 'LeaveLedgerError';
  }
}
export function ledgerFail(
  reason: LeaveLedgerReason,
  status?: 400 | 403 | 404 | 409 | 422 | 503,
): never {
  throw new LeaveLedgerError(reason, status);
}
export function canonicalLeaveJson(value: unknown): string {
  if (Array.isArray(value)) return '[' + value.map(canonicalLeaveJson).join(',') + ']';
  if (value !== null && typeof value === 'object')
    return (
      '{' +
      Object.entries(value)
        .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
        .map(([k, v]) => JSON.stringify(k) + ':' + canonicalLeaveJson(v))
        .join(',') +
      '}'
    );
  return JSON.stringify(value);
}
export function leaveSafeSum(values: Iterable<number>): number {
  let total = 0;
  for (const value of values) {
    if (!Number.isSafeInteger(value) || value < 0) return ledgerFail('LEDGER_HOURS_OVERFLOW');
    total += value;
    if (!Number.isSafeInteger(total)) return ledgerFail('LEDGER_HOURS_OVERFLOW');
  }
  return total;
}
export type LeaveLedgerOverlay = {
  grants: Map<string, LeaveGrant>;
  policies: Map<number, LeavePolicy>;
  entries: Map<string, WorkEntryFinal>;
  allocations: Map<string, LeaveAllocation[]>;
  managed: Set<string>;
};
export function createLeaveLedgerOverlay(input: {
  grants: readonly LeaveGrant[];
  policies: readonly LeavePolicy[];
  entries: readonly WorkEntryFinal[];
  allocations: ReadonlyMap<string, readonly LeaveAllocation[]>;
  managed: ReadonlySet<string>;
}): LeaveLedgerOverlay {
  return {
    grants: new Map(input.grants.map((g) => [g.id, { ...g }])),
    policies: new Map(input.policies.map((p) => [p.year, { ...p }])),
    entries: new Map(input.entries.map((e) => [e.id, e])),
    allocations: new Map([...input.allocations].map(([id, a]) => [id, a.map((x) => ({ ...x }))])),
    managed: new Set(input.managed),
  };
}
export function leaveGrantBalances(
  overlay: LeaveLedgerOverlay,
  valuationDate: string,
): LeaveGrantBalance[] {
  const used = new Map<string, number[]>(),
    reserved = new Map<string, number[]>();
  for (const [entryId, list] of overlay.allocations) {
    const source = overlay.entries.get(entryId);
    if (!source || source.kind !== 'leave' || source.status === 'canceled') {
      if (list.length) return ledgerFail('LEDGER_STORED_INVALID', 503);
      continue;
    }
    const bucket = source.status === 'done' ? used : reserved;
    for (const allocation of list) {
      if (!overlay.grants.has(allocation.grantId)) return ledgerFail('LEDGER_STORED_INVALID', 503);
      const amounts = bucket.get(allocation.grantId) ?? [];
      amounts.push(allocation.allocatedHours);
      bucket.set(allocation.grantId, amounts);
    }
  }
  return [...overlay.grants.values()]
    .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
    .map((grant) => {
      const usedHours = leaveSafeSum(used.get(grant.id) ?? []),
        reservedHours = leaveSafeSum(reserved.get(grant.id) ?? []);
      const committed = leaveSafeSum([usedHours, reservedHours]);
      if (committed > grant.grantedHours) return ledgerFail('LEDGER_STORED_INVALID', 503);
      const unallocatedHours = grant.grantedHours - committed;
      return {
        grant,
        usedHours,
        reservedHours,
        unallocatedHours,
        availableHours:
          grant.validFrom <= valuationDate && valuationDate <= grant.expiresOn
            ? unallocatedHours
            : 0,
        expiredUnusedHours: grant.expiresOn < valuationDate ? unallocatedHours : 0,
        notYetAvailableHours: valuationDate < grant.validFrom ? unallocatedHours : 0,
      };
    });
}
export function leaveLedgerTotals(balances: readonly LeaveGrantBalance[]): LeaveLedgerTotals {
  const sum = (select: (b: LeaveGrantBalance) => number) => leaveSafeSum(balances.map(select));
  return {
    grantedHours: sum((b) => b.grant.grantedHours),
    accountedUsedHours: sum((b) => b.usedHours),
    reservedHours: sum((b) => b.reservedHours),
    unallocatedHours: sum((b) => b.unallocatedHours),
    availableHours: sum((b) => b.availableHours),
    expiredUnusedHours: sum((b) => b.expiredUnusedHours),
    notYetAvailableHours: sum((b) => b.notYetAvailableHours),
  };
}
export function planLeaveAllocation(
  overlay: LeaveLedgerOverlay,
  previous: WorkEntryFinal | null,
  next: WorkEntryFinal | null,
  cutoverOn: string,
  evaluationDate: string,
) {
  const entryId = next?.id ?? previous?.id;
  if (!entryId) return ledgerFail('LEDGER_SOURCE_KIND');
  if (
    previous &&
    next &&
    previous.kind !== next.kind &&
    (previous.kind === 'leave' || next.kind === 'leave')
  )
    return ledgerFail('LEDGER_SOURCE_KIND');
  if ((previous && previous.kind !== 'leave') || (next && next.kind !== 'leave'))
    return ledgerFail('LEDGER_SOURCE_KIND');
  const before = overlay.allocations.get(entryId) ?? [];
  const managed = !!next && next.plannedDate !== null && next.plannedDate >= cutoverOn;
  const unchanged =
    !!previous &&
    !!next &&
    managed &&
    overlay.managed.has(entryId) &&
    previous.status !== 'canceled' &&
    next.status !== 'canceled' &&
    previous.plannedDate === next.plannedDate &&
    previous.leave?.deductibleHours === next.leave?.deductibleHours;
  overlay.allocations.delete(entryId);
  const after: LeaveAllocation[] = [];
  let insufficientHours = 0;
  if (managed && next && next.status !== 'canceled') {
    if (!next.leave || next.plannedDate === null)
      return ledgerFail('LEDGER_SOURCE_ACCOUNTING', 503);
    if (unchanged) after.push(...before.map((a) => ({ ...a })));
    else {
      const policy = overlay.policies.get(Number(next.plannedDate.slice(0, 4)));
      if (!policy) return ledgerFail('LEDGER_POLICY_REQUIRED');
      let remaining = next.leave.deductibleHours;
      const available = new Map(
        leaveGrantBalances(overlay, next.plannedDate).map((b) => [b.grant.id, b.unallocatedHours]),
      );
      const eligible = [...overlay.grants.values()].filter(
        (g) => g.validFrom <= next.plannedDate! && next.plannedDate! <= g.expiresOn,
      );
      const compare = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
      const usageYear = Number(next.plannedDate.slice(0, 4));
      eligible.sort((a, b) => {
        if (policy.deductionOrder === 'carryover_first') {
          const difference = Number(b.originYear < usageYear) - Number(a.originYear < usageYear);
          if (difference) return difference;
        }
        return policy.deductionOrder === 'granted_first'
          ? compare(a.grantedOn, b.grantedOn) ||
              compare(a.expiresOn, b.expiresOn) ||
              compare(a.id, b.id)
          : compare(a.expiresOn, b.expiresOn) ||
              compare(a.grantedOn, b.grantedOn) ||
              compare(a.id, b.id);
      });
      for (const grant of eligible) {
        const amount = Math.min(remaining, available.get(grant.id) ?? 0);
        if (amount > 0) {
          after.push({ grantId: grant.id, allocatedHours: amount });
          remaining -= amount;
        }
        if (remaining === 0) break;
      }
      insufficientHours = remaining;
      if (after.length > 16) ledgerFail('LEDGER_LIMIT');
    }
  }
  const releasedExpiredGrantIds = before
    .filter(
      (old) =>
        (after.find((a) => a.grantId === old.grantId)?.allocatedHours ?? 0) < old.allocatedHours &&
        (overlay.grants.get(old.grantId)?.expiresOn ?? evaluationDate) < evaluationDate,
    )
    .map((a) => a.grantId)
    .sort();
  if (next) overlay.entries.set(entryId, next);
  else overlay.entries.delete(entryId);
  if (managed) overlay.managed.add(entryId);
  else overlay.managed.delete(entryId);
  if (after.length) overlay.allocations.set(entryId, after);
  for (const a of after) {
    const g = overlay.grants.get(a.grantId)!;
    overlay.grants.set(g.id, { ...g, everAllocated: true });
  }
  return { entryId, before, after, managed, insufficientHours, releasedExpiredGrantIds };
}
