import { z } from 'zod';
import {
  leaveLedgerRequestSchemas,
  leaveLedgerResultSchemas,
  zLeaveLedgerState,
  zLeaveGrantList,
  zLeavePolicyList,
  zLeaveAccountingMetadata,
  zLeaveLedgerSummary,
  zLeaveLedgerPreview,
  zLeaveLedgerReceipt,
  zLeaveLedgerWorkPreview,
  zLeaveCutoverPreview,
  LEAVE_LEDGER_REASONS,
  type LeaveLedgerCommandKind,
  type LeaveLedgerPreview,
} from '../shared/schema/leave-ledger';
import { zWorkEntryId, zWorkEntryDate, type WorkEntryFinal } from '../shared/schema/work-entry';
import { zWorkspaceYear } from '../shared/schema/workspace';
import { workApi, workError, WorkFailure } from './work-entry-api';

export const zLedgerCommand = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('setup'), request: leaveLedgerRequestSchemas.setup }),
  z.strictObject({ kind: z.literal('policy_put'), request: leaveLedgerRequestSchemas.policy_put }),
  z.strictObject({
    kind: z.literal('policy_delete'),
    request: leaveLedgerRequestSchemas.policy_delete,
  }),
  z.strictObject({
    kind: z.literal('grant_create'),
    request: leaveLedgerRequestSchemas.grant_create,
  }),
  z.strictObject({
    kind: z.literal('grant_patch'),
    request: leaveLedgerRequestSchemas.grant_patch,
  }),
  z.strictObject({
    kind: z.literal('grant_delete'),
    request: leaveLedgerRequestSchemas.grant_delete,
  }),
  z.strictObject({ kind: z.literal('cutover'), request: leaveLedgerRequestSchemas.cutover }),
  z.strictObject({ kind: z.literal('work'), request: leaveLedgerRequestSchemas.work }),
]);
export type LedgerCommand = z.output<typeof zLedgerCommand>;
export type LedgerReceipt = z.output<typeof zLeaveLedgerReceipt>;
export type LedgerWorkRequest = z.output<typeof zLeaveLedgerWorkPreview>;
export type LedgerWorkOperation = LedgerWorkRequest['work'][number];
const base = (company: string) => `/api/companies/${zWorkEntryId.parse(company)}/leave-ledger`;
const invalid = () => new WorkFailure(0, 'INVALID_RESPONSE');
export const canonicalLedger = (value: unknown): string =>
  JSON.stringify(value, (_key, item: unknown) =>
    item && typeof item === 'object' && !Array.isArray(item)
      ? Object.fromEntries(Object.entries(item).sort(([a], [b]) => a.localeCompare(b)))
      : item,
  );
export function ledgerCommandId(command: LedgerCommand) {
  return 'input' in command.request ? command.request.input.commandId : command.request.commandId;
}
function unique(values: string[]) {
  return new Set(values).size === values.length;
}
function balanceValid(
  value: {
    grantedHours: number;
    unallocatedHours: number;
    availableHours: number;
    expiredUnusedHours: number;
    notYetAvailableHours: number;
  },
  used: number,
  reserved: number,
) {
  return (
    BigInt(value.grantedHours) ===
      BigInt(used) + BigInt(reserved) + BigInt(value.unallocatedHours) &&
    BigInt(value.unallocatedHours) ===
      BigInt(value.availableHours) +
        BigInt(value.expiredUnusedHours) +
        BigInt(value.notYetAvailableHours)
  );
}
function previewValid(value: LeaveLedgerPreview, company: string, commandId: string) {
  return (
    value.companyId === company &&
    value.commandId === commandId &&
    value.sourceVersions.ledgerVersion === value.ledgerVersion &&
    [value.before, value.after].every(
      (impact) =>
        unique(impact.entries.map((e) => e.entryId)) &&
        unique(impact.grants.map((g) => g.grant.id)) &&
        impact.grants.every(
          (g) =>
            g.grant.companyId === company &&
            balanceValid(
              { ...g, grantedHours: g.grant.grantedHours },
              g.usedHours,
              g.reservedHours,
            ),
        ) &&
        balanceValid(impact.totals, impact.totals.accountedUsedHours, impact.totals.reservedHours),
    )
  );
}
export function ledgerState(company: string) {
  return workApi(
    base(company),
    zLeaveLedgerState.refine(
      (s) =>
        s.companyId === company &&
        (s.phase === 'unavailable' || s.phase === 'not_started'
          ? s.ledgerVersion === null &&
            s.setup === null &&
            s.currentCutoverId === null &&
            s.createdAt === null &&
            s.updatedAt === null &&
            s.enabled === (s.phase === 'not_started')
          : s.enabled && s.ledgerVersion !== null && s.setup !== null),
    ),
  );
}
export function ledgerPolicies(company: string, cursorYear?: number) {
  const query = new URLSearchParams({ limit: '50' });
  if (cursorYear !== undefined) query.set('cursorYear', String(zWorkspaceYear.parse(cursorYear)));
  return workApi(
    `${base(company)}/policies?${query}`,
    zLeavePolicyList.refine(
      (v) =>
        v.items.every(
          (p, i) => p.companyId === company && (i === 0 || v.items[i - 1]!.year < p.year),
        ) &&
        (v.nextCursorYear === null ||
          (v.items.length > 0 &&
            v.nextCursorYear === v.items.at(-1)!.year &&
            v.nextCursorYear !== cursorYear)),
    ),
  );
}
export function ledgerGrants(company: string, cursor?: string) {
  const query = new URLSearchParams({ limit: '50' });
  if (cursor) query.set('cursor', zWorkEntryId.parse(cursor));
  return workApi(
    `${base(company)}/grants?${query}`,
    zLeaveGrantList.refine(
      (v) =>
        v.items.every(
          (g, i) => g.companyId === company && (i === 0 || v.items[i - 1]!.id < g.id),
        ) &&
        (v.nextCursor === null ||
          (v.items.length > 0 && v.nextCursor === v.items.at(-1)!.id && v.nextCursor !== cursor)),
    ),
  );
}
export function ledgerSummary(
  company: string,
  valuationDate: string,
  usageYear: number,
  cursor?: string,
) {
  const query = new URLSearchParams({ valuationDate, usageYear: String(usageYear), limit: '50' });
  if (cursor) query.set('cursor', zWorkEntryId.parse(cursor));
  return workApi(
    `${base(company)}/summary?${query}`,
    zLeaveLedgerSummary.refine(
      (s) =>
        s.companyId === company &&
        s.valuationDate === valuationDate &&
        s.usageYear === usageYear &&
        balanceValid(s.totals, s.totals.accountedUsedHours, s.totals.reservedHours) &&
        s.grants.every(
          (g, i) =>
            g.grant.companyId === company &&
            (i === 0 || s.grants[i - 1]!.grant.id < g.grant.id) &&
            balanceValid(
              { ...g, grantedHours: g.grant.grantedHours },
              g.usedHours,
              g.reservedHours,
            ),
        ) &&
        (s.nextGrantCursor === null ||
          (s.grants.length > 0 &&
            s.nextGrantCursor === s.grants.at(-1)!.grant.id &&
            s.nextGrantCursor !== cursor)),
    ),
  );
}
export function ledgerMetadata(company: string, entryId: string, entry?: WorkEntryFinal) {
  return workApi(
    `${base(company)}/entries/${zWorkEntryId.parse(entryId)}`,
    zLeaveAccountingMetadata.refine(
      (m) =>
        m.companyId === company &&
        m.workEntryId === entryId &&
        (!entry ||
          (entry.companyId === company &&
            entry.id === entryId &&
            entry.leave?.id === m.leaveEntryId &&
            entry.version === m.workVersion)),
    ),
  );
}
export async function ledgerPreview(company: string, kind: 'work' | 'cutover', input: unknown) {
  const body =
    kind === 'work' ? zLeaveLedgerWorkPreview.parse(input) : zLeaveCutoverPreview.parse(input);
  return workApi(
    `${base(company)}/${kind === 'work' ? 'work' : 'cutover'}/preview`,
    zLeaveLedgerPreview.refine((p) => p.kind === kind && previewValid(p, company, body.commandId)),
    'POST',
    body,
  );
}
function destination(company: string, c: LedgerCommand) {
  const root = base(company);
  switch (c.kind) {
    case 'setup':
      return { path: `${root}/setup`, method: 'PUT', body: c.request };
    case 'policy_put':
      return { path: `${root}/policies/${c.request.year}`, method: 'PUT', body: c.request.input };
    case 'policy_delete':
      return {
        path: `${root}/policies/${c.request.year}`,
        method: 'DELETE',
        body: c.request.input,
      };
    case 'grant_create':
      return { path: `${root}/grants`, method: 'POST', body: c.request };
    case 'grant_patch':
      return { path: `${root}/grants/${c.request.id}`, method: 'PATCH', body: c.request.input };
    case 'grant_delete':
      return { path: `${root}/grants/${c.request.id}`, method: 'DELETE', body: c.request.input };
    case 'cutover':
      return { path: `${root}/cutover/commit`, method: 'POST', body: c.request };
    case 'work':
      return { path: `${root}/work/command`, method: 'POST', body: c.request };
  }
}
export async function ledgerSubmit(company: string, raw: LedgerCommand) {
  const command = zLedgerCommand.parse(raw),
    target = destination(company, command);
  const result = await workApi(
    target.path,
    leaveLedgerResultSchemas[command.kind],
    target.method,
    target.body,
  );
  return validateResult(company, command, result);
}
function validateResult(company: string, command: LedgerCommand, result: LedgerResult) {
  if ('companyId' in result && result.companyId !== company) throw invalid();
  if ('commandId' in result && result.commandId !== ledgerCommandId(command)) throw invalid();
  if (
    command.kind === 'work' &&
    (!('entries' in result) ||
      command.request.work.some((operation) => {
        const id = operation.intent === 'create' ? operation.input.id : operation.entryId;
        const value = result.entries.find((entry) => entry.entryId === id);
        return (
          !value || (operation.intent === 'delete' ? value.entry !== null : value.entry === null)
        );
      }))
  )
    throw invalid();
  if (
    'entries' in result &&
    (!unique(result.entries.map((x) => x.entryId)) ||
      result.entries.some(
        (x) => x.entry && (x.entry.companyId !== company || x.entry.id !== x.entryId),
      ))
  )
    throw invalid();
  if (
    (command.kind === 'grant_create' && (!('id' in result) || result.id !== command.request.id)) ||
    ((command.kind === 'grant_patch' || command.kind === 'grant_delete') &&
      (!('id' in result) || result.id !== command.request.id)) ||
    ((command.kind === 'policy_put' || command.kind === 'policy_delete') &&
      ('year' in result
        ? result.year !== command.request.year
        : !('id' in result) || result.id !== command.request.year))
  )
    throw invalid();
  return result;
}
export async function ledgerReceipt(company: string, command: LedgerCommand) {
  const receipt = await workApi(
    `${base(company)}/commands/${ledgerCommandId(command)}`,
    zLeaveLedgerReceipt,
  );
  if (
    receipt.companyId !== company ||
    receipt.id !== ledgerCommandId(command) ||
    receipt.kind !== command.kind ||
    canonicalLedger(receipt.request) !== canonicalLedger(command.request)
  )
    throw invalid();
  validateResult(company, command, receipt.result);
  return receipt;
}
export function ledgerFailure(cause: unknown) {
  if (cause instanceof WorkFailure) {
    if (cause.status === 401) return '세션이 만료되었습니다. 초안을 유지했습니다.';
    if (cause.status === 403)
      return '이 회사 또는 휴가에 접근할 수 없습니다. 표시 자료를 숨겼습니다.';
    if (cause.status === 404)
      return '기록 또는 명령 영수증을 찾을 수 없습니다. 성공으로 처리하지 않았습니다.';
    if (cause.status === 409)
      return '장부·휴가·미리보기의 버전이 바뀌었습니다. 입력을 유지했습니다. 다시 조회해 검토하세요.';
    if (cause.reason && (LEAVE_LEDGER_REASONS as readonly string[]).includes(cause.reason))
      return workError(cause);
    if (cause.code === 'OFFLINE') return '오프라인입니다. 초안과 미확인 명령을 유지했습니다.';
  }
  return '연차 장부의 응답을 확인하지 못했습니다. 입력과 명령을 유지했습니다.';
}
export function ledgerReturnTo(value: string, company: string) {
  try {
    zWorkEntryId.parse(company);
    const u = new URL(value, location.origin);
    if (
      !value.startsWith('/') ||
      value.startsWith('//') ||
      value.includes('\\') ||
      u.origin !== location.origin ||
      u.hash ||
      u.pathname !== `/c/${company}/settings/leave`
    )
      return '/';
    const keys = [...u.searchParams.keys()];
    if (!unique(keys) || keys.some((k) => !['year', 'valuationDate'].includes(k))) return '/';
    const year = u.searchParams.get('year'),
      day = u.searchParams.get('valuationDate');
    if (
      year !== null &&
      (!/^\d{1,4}$/.test(year) || !zWorkspaceYear.safeParse(Number(year)).success)
    )
      return '/';
    if (day !== null && !zWorkEntryDate.safeParse(day).success) return '/';
    return u.pathname + u.search;
  } catch {
    return '/';
  }
}
export type LedgerResult = z.output<(typeof leaveLedgerResultSchemas)[LeaveLedgerCommandKind]>;
