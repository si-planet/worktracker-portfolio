import { z } from 'zod';
import { zWorkEntryDuplicate } from './work-duplicate';
import {
  zWorkEntryId as id,
  zWorkEntryDate as date,
  zWorkEntryVersion as version,
  zWorkEntryEpoch as epoch,
  zWorkHoursPerDay,
  zWorkEntryCreate,
  zWorkEntryPatch,
  zWorkEntryStatus,
  zWorkEntryDelete,
  zWorkEntryFinal,
  zWorkEntryKind,
  zWorkEntryStatusValue,
} from './work-entry';

export const LEAVE_LEDGER_SUPPORT = {
  delivery: 'forward-only-explicit-v1',
  historyStrategies: ['forward_only'],
  validityBoundary: 'inclusive_kst_dates',
  carryoverDefinition: 'origin_year_before_usage_year',
  expiredCancellation: 'confirm_original_grant',
  calculationMode: 'current_commitments',
  historicalStateReconstructed: false,
  maxActivationEntries: 128,
  maxWorkMutations: 32,
  maxGrants: 512,
  maxPageSize: 100,
  unsupported: [
    'opening_balance',
    'history_restore',
    'opening-adjustment',
    'statutory-auto-grants',
    'partial-carryover',
    'automatic-yearly-carryover',
    'unlimited-or-unknown-expiry',
    'automatic-existing-allocation-rebalance',
    'export-v4-integration',
  ],
} as const;
export const LEAVE_LEDGER_REASONS = [
  'LEDGER_INPUT',
  'LEDGER_SCOPE',
  'LEDGER_UNAVAILABLE',
  'LEDGER_PARTIAL_SCHEMA',
  'LEDGER_STORED_INVALID',
  'LEDGER_NOT_STARTED',
  'LEDGER_NOT_ACTIVE',
  'LEDGER_ALREADY_ACTIVE',
  'LEDGER_VERSION_CHANGED',
  'LEDGER_COMMAND_CONFLICT',
  'LEDGER_POLICY_REQUIRED',
  'LEDGER_INSUFFICIENT',
  'LEDGER_TARGET_SET_CHANGED',
  'LEDGER_PREVIEW_CHANGED',
  'LEDGER_REVIEW_REQUIRED',
  'LEDGER_SOURCE_CHANGED',
  'LEDGER_SOURCE_KIND',
  'LEDGER_SOURCE_ACCOUNTING',
  'LEDGER_IN_USE',
  'LEDGER_LIMIT',
  'LEDGER_UNSUPPORTED',
  'LEDGER_HOURS_OVERFLOW',
] as const;
export const zLeaveLedgerReason = z.enum(LEAVE_LEDGER_REASONS);
export const zLeaveDeductionOrder = z.enum(['expires_first', 'carryover_first', 'granted_first']);
const hours = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
const positiveHours = hours.refine((v) => v > 0);
const year = z.number().int().min(1).max(9999);
const hash = z.string().regex(/^[a-f0-9]{64}$/);
const note = z.string().max(5000).nullable();
const audit = { version, createdAt: epoch, updatedAt: epoch };
const command = { commandId: id, ledgerVersion: version };
const setupFields = {
  cutoverOn: date,
  historyStrategy: z.literal('forward_only'),
  validityBoundary: z.literal('inclusive_kst_dates'),
  carryoverDefinition: z.literal('origin_year_before_usage_year'),
  expiredCancellation: z.literal('confirm_original_grant'),
};
export const zLeaveLedgerSetupDraft = z.strictObject({
  commandId: id,
  ledgerVersion: version.nullable(),
  ...setupFields,
});
export const zLeaveLedgerState = z.strictObject({
  companyId: id,
  phase: z.enum(['unavailable', 'not_started', 'draft', 'active']),
  enabled: z.boolean(),
  ledgerVersion: version.nullable(),
  currentCutoverId: id.nullable(),
  setup: z.strictObject(setupFields).nullable(),
  createdAt: epoch.nullable(),
  updatedAt: epoch.nullable(),
  support: z.literal(LEAVE_LEDGER_SUPPORT.delivery),
});
export const zLeavePolicyPut = z.strictObject({
  ...command,
  version: version.nullable(),
  deductionOrder: zLeaveDeductionOrder,
});
export const zLeavePolicy = z.strictObject({
  companyId: id,
  year,
  deductionOrder: zLeaveDeductionOrder,
  ...audit,
});
export const zLeavePolicyDelete = z.strictObject({ ...command, version });
const grantFields = {
  originYear: year,
  grantType: z.enum(['base', 'carryover', 'extra', 'opening']),
  grantedHours: positiveHours,
  grantedOn: date,
  validFrom: date,
  expiresOn: date,
  expiryBoundary: z.literal('inclusive_kst_dates'),
  workHoursPerDaySnapshot: zWorkHoursPerDay.nullable(),
  basisNote: note,
  sourceReference: z.string().max(500).nullable(),
  remainingAsOf: date.nullable(),
};
export const zLeaveGrantCreate = z
  .strictObject({ id, ...command, ...grantFields })
  .refine(
    (v) => v.validFrom <= v.expiresOn && (v.grantType === 'opening') === (v.remainingAsOf !== null),
    '사용 가능 기간과 잔액 기준일을 확인하세요.',
  );
export const zLeaveGrant = z
  .strictObject({
    id,
    companyId: id,
    ...grantFields,
    quantityBasis: z.enum(['issued', 'remaining_at_cutover']),
    everAllocated: z.boolean(),
    ...audit,
  })
  .refine(
    (v) =>
      v.validFrom <= v.expiresOn &&
      v.updatedAt >= v.createdAt &&
      (v.grantType === 'opening') === (v.remainingAsOf !== null) &&
      (v.grantType === 'opening') === (v.quantityBasis === 'remaining_at_cutover'),
  );
export const zLeaveGrantPatch = z.strictObject({
  ...command,
  version,
  patch: z
    .strictObject({
      grantedHours: positiveHours.optional(),
      validFrom: date.optional(),
      expiresOn: date.optional(),
      basisNote: note.optional(),
    })
    .refine((v) => Object.keys(v).length > 0),
});
export const zLeaveGrantDelete = z.strictObject({ ...command, version });
export const zLeaveLedgerPageQuery = z.strictObject({
  cursor: id.optional(),
  limit: z.number().int().min(1).max(100).default(50),
  originYear: year.optional(),
});
export const zLeaveAllocation = z.strictObject({ grantId: id, allocatedHours: positiveHours });
const allocations = z
  .array(zLeaveAllocation)
  .max(16)
  .refine((v) => new Set(v.map((x) => x.grantId)).size === v.length);
export const zLeaveGrantBalance = z.strictObject({
  grant: zLeaveGrant,
  usedHours: hours,
  reservedHours: hours,
  unallocatedHours: hours,
  availableHours: hours,
  expiredUnusedHours: hours,
  notYetAvailableHours: hours,
});
export const zLeaveLedgerTotals = z.strictObject({
  grantedHours: hours,
  accountedUsedHours: hours,
  reservedHours: hours,
  unallocatedHours: hours,
  availableHours: hours,
  expiredUnusedHours: hours,
  notYetAvailableHours: hours,
});
export const zLeaveAccountingMetadata = z.strictObject({
  companyId: id,
  workEntryId: id,
  leaveEntryId: id,
  workVersion: version,
  ledgerVersion: version.nullable(),
  ledgerEnabled: z.boolean(),
  managed: z.boolean(),
  accountingState: z.enum(['unmanaged', 'allocated']),
  classificationReason: z.enum([
    'ledger_disabled',
    'before_cutover',
    'explicit_cutover',
    'new_managed_leave',
  ]),
  cutoverId: id.nullable(),
  lastAccountedWorkVersion: version.nullable(),
  usageClass: z.enum(['reserved', 'used', 'canceled', 'unaccounted']),
  pendingAutomaticCompletion: z.boolean(),
  deductibleHours: hours,
  allocations,
  requiresReview: z.boolean(),
  reviewReasons: z.array(zLeaveLedgerReason),
});
const workOperation = z.discriminatedUnion('intent', [
  z.strictObject({ intent: z.literal('create'), input: zWorkEntryCreate }),
  z.strictObject({ intent: z.literal('patch'), entryId: id, input: zWorkEntryPatch }),
  z.strictObject({ intent: z.literal('status'), entryId: id, input: zWorkEntryStatus }),
  z.strictObject({ intent: z.literal('delete'), entryId: id, input: zWorkEntryDelete }),
]);
export const zLeaveWorkOperation = workOperation;
const confirmation = z.strictObject({
  code: z.literal('release_to_original_grant'),
  grantIds: z
    .array(id)
    .min(1)
    .max(512)
    .refine((v) => new Set(v).size === v.length),
});
export const zLeaveLedgerWorkPreview = z
  .strictObject({
    ...command,
    work: z.array(workOperation).min(1).max(32),
    sourceEntryId: id.optional(),
    sourceVersion: version.optional(),
    confirmations: z.array(confirmation).max(1).default([]),
  })
  .refine((v) => {
    const ids = v.work.map((x) => (x.intent === 'create' ? x.input.id : x.entryId));
    return new Set(ids).size === ids.length;
  })
  .superRefine((value, context) => {
    if ((value.sourceEntryId === undefined) !== (value.sourceVersion === undefined)) {
      context.addIssue({
        code: 'custom',
        path: ['sourceEntryId'],
        message: '복제 원본 ID와 버전을 함께 지정하세요.',
      });
      return;
    }
    if (value.sourceEntryId === undefined) return;
    const operation = value.work[0];
    if (value.work.length !== 1 || operation?.intent !== 'create') {
      context.addIssue({
        code: 'custom',
        path: ['work'],
        message: '복제는 새 기록 하나만 생성할 수 있습니다.',
      });
      return;
    }
    if (operation.input.id === value.sourceEntryId)
      context.addIssue({
        code: 'custom',
        path: ['work', 0, 'input', 'id'],
        message: '원본과 다른 새 기록 ID를 지정하세요.',
      });
    if (
      !zWorkEntryDuplicate.safeParse({ sourceVersion: value.sourceVersion, entry: operation.input })
        .success
    )
      context.addIssue({
        code: 'custom',
        path: ['work', 0, 'input'],
        message: '복제한 새 기록의 날짜와 초기 상태를 확인하세요.',
      });
  });
export const zLeaveLedgerWorkCommand = zLeaveLedgerWorkPreview.safeExtend({
  previewFingerprint: hash,
  evaluationDate: date,
});
export const zLeaveCutoverPreview = z.strictObject({
  ...command,
  activate: z.literal(true),
});
export const zLeaveCutoverCommit = zLeaveCutoverPreview.extend({
  previewFingerprint: hash,
  evaluationDate: date,
});
export const zLeaveSourceVersions = z.strictObject({
  ledgerVersion: version,
  setupFingerprint: hash,
  sourceSetFingerprint: hash,
  workEntries: z.array(z.strictObject({ entryId: id, version, fingerprint: hash })),
  policies: z.array(z.strictObject({ year, version })),
  grants: z.array(z.strictObject({ id, version, allocationFingerprint: hash })),
  days: z.array(
    z.strictObject({
      date,
      dayVersion: version.nullable(),
      settingsVersion: version.nullable(),
      workHoursPerDay: zWorkHoursPerDay,
    }),
  ),
});
export const zLeaveEntryImpact = z.strictObject({
  entryId: id,
  leaveEntryId: id.nullable(),
  exists: z.boolean(),
  workVersion: version.nullable(),
  kind: zWorkEntryKind.nullable(),
  status: zWorkEntryStatusValue.nullable(),
  plannedDate: date.nullable(),
  deductibleHours: hours,
  managed: z.boolean(),
  allocations,
  automatic: z.boolean(),
});
const impact = z.strictObject({
  entries: z.array(zLeaveEntryImpact),
  totals: zLeaveLedgerTotals,
  grants: z.array(zLeaveGrantBalance).max(512),
});
export const zLeaveLedgerPreview = z.strictObject({
  kind: z.enum(['cutover', 'work']),
  commandId: id,
  companyId: id,
  ledgerVersion: version,
  evaluatedAt: epoch,
  evaluationDate: date,
  previewFingerprint: hash,
  sourceVersions: zLeaveSourceVersions,
  before: impact,
  after: impact,
  insufficientHours: hours,
  requiredConfirmations: z.array(confirmation).max(1),
  warnings: z.array(zLeaveLedgerReason),
  excludedAutomaticSourceIds: z.array(id),
  support: z.literal(LEAVE_LEDGER_SUPPORT.delivery),
});
export const zLeaveLedgerSummaryQuery = z.strictObject({
  valuationDate: date,
  usageYear: year,
  cursor: id.optional(),
  limit: z.number().int().min(1).max(100).default(50),
});
export const zLeaveLedgerSummary = z.strictObject({
  companyId: id,
  ledgerVersion: version,
  observedAt: epoch,
  valuationDate: date,
  usageYear: year,
  calculationMode: z.literal('current_commitments'),
  historicalStateReconstructed: z.literal(false),
  totals: zLeaveLedgerTotals,
  grants: z.array(zLeaveGrantBalance).max(100),
  nextGrantCursor: id.nullable(),
  usage: z.strictObject({ usedHours: hours, reservedHours: hours }),
  coverage: z.strictObject({
    cutoverOn: date,
    historyStrategy: z.literal('forward_only'),
    unmanagedCount: hours,
    pendingAutomaticCompletionCount: hours,
    complete: z.boolean(),
  }),
  warnings: z.array(zLeaveLedgerReason),
});
const changed = z.strictObject({ entryId: id, entry: zWorkEntryFinal.nullable() });
export const zLeaveWorkResult = z.strictObject({
  commandId: id,
  companyId: id,
  ledgerVersion: version,
  entries: z.array(changed),
  automaticCompleted: hours,
  unmanagedEntryIds: z.array(id),
});
export const zLeaveCutoverResult = z.strictObject({
  commandId: id,
  companyId: id,
  ledgerVersion: version,
  cutoverId: id,
  active: z.literal(true),
  appliedEntryIds: z.array(id).max(128),
});
const deletion = z.strictObject({ id: z.union([id, year]), deleted: z.literal(true) });
export const leaveLedgerRequestSchemas = {
  setup: zLeaveLedgerSetupDraft,
  policy_put: z.strictObject({ year, input: zLeavePolicyPut }),
  policy_delete: z.strictObject({ year, input: zLeavePolicyDelete }),
  grant_create: zLeaveGrantCreate,
  grant_patch: z.strictObject({ id, input: zLeaveGrantPatch }),
  grant_delete: z.strictObject({ id, input: zLeaveGrantDelete }),
  cutover: zLeaveCutoverCommit,
  work: zLeaveLedgerWorkCommand,
} as const;
export const leaveLedgerResultSchemas = {
  setup: zLeaveLedgerState,
  policy_put: zLeavePolicy,
  policy_delete: deletion,
  grant_create: zLeaveGrant,
  grant_patch: zLeaveGrant,
  grant_delete: deletion,
  cutover: zLeaveCutoverResult,
  work: zLeaveWorkResult,
} as const;
export type LeaveLedgerCommandKind = keyof typeof leaveLedgerRequestSchemas;
export const zLeaveLedgerReceipt = z.discriminatedUnion('kind', [
  z.strictObject({
    id,
    companyId: id,
    kind: z.literal('setup'),
    request: leaveLedgerRequestSchemas.setup,
    result: leaveLedgerResultSchemas.setup,
    createdAt: epoch,
  }),
  z.strictObject({
    id,
    companyId: id,
    kind: z.literal('policy_put'),
    request: leaveLedgerRequestSchemas.policy_put,
    result: leaveLedgerResultSchemas.policy_put,
    createdAt: epoch,
  }),
  z.strictObject({
    id,
    companyId: id,
    kind: z.literal('policy_delete'),
    request: leaveLedgerRequestSchemas.policy_delete,
    result: leaveLedgerResultSchemas.policy_delete,
    createdAt: epoch,
  }),
  z.strictObject({
    id,
    companyId: id,
    kind: z.literal('grant_create'),
    request: leaveLedgerRequestSchemas.grant_create,
    result: leaveLedgerResultSchemas.grant_create,
    createdAt: epoch,
  }),
  z.strictObject({
    id,
    companyId: id,
    kind: z.literal('grant_patch'),
    request: leaveLedgerRequestSchemas.grant_patch,
    result: leaveLedgerResultSchemas.grant_patch,
    createdAt: epoch,
  }),
  z.strictObject({
    id,
    companyId: id,
    kind: z.literal('grant_delete'),
    request: leaveLedgerRequestSchemas.grant_delete,
    result: leaveLedgerResultSchemas.grant_delete,
    createdAt: epoch,
  }),
  z.strictObject({
    id,
    companyId: id,
    kind: z.literal('cutover'),
    request: leaveLedgerRequestSchemas.cutover,
    result: leaveLedgerResultSchemas.cutover,
    createdAt: epoch,
  }),
  z.strictObject({
    id,
    companyId: id,
    kind: z.literal('work'),
    request: leaveLedgerRequestSchemas.work,
    result: leaveLedgerResultSchemas.work,
    createdAt: epoch,
  }),
]);
export type LeaveLedgerState = z.output<typeof zLeaveLedgerState>;
export type LeaveGrant = z.output<typeof zLeaveGrant>;
export type LeavePolicy = z.output<typeof zLeavePolicy>;
export type LeaveAllocation = z.output<typeof zLeaveAllocation>;
export type LeaveGrantBalance = z.output<typeof zLeaveGrantBalance>;
export type LeaveLedgerTotals = z.output<typeof zLeaveLedgerTotals>;
export type LeaveAccountingMetadata = z.output<typeof zLeaveAccountingMetadata>;
export type LeaveLedgerPreview = z.output<typeof zLeaveLedgerPreview>;
export type LeaveEntryImpact = z.output<typeof zLeaveEntryImpact>;
export type LeaveSourceVersions = z.output<typeof zLeaveSourceVersions>;
export type LeaveWorkOperation = z.output<typeof zLeaveWorkOperation>;
export type LeaveWorkRequest = z.output<typeof zLeaveLedgerWorkPreview>;
export type LeaveLedgerReason = z.output<typeof zLeaveLedgerReason>;

export const zLeaveGrantList = z.strictObject({
  items: z.array(zLeaveGrant).max(100),
  nextCursor: id.nullable(),
});
export const zLeavePolicyPageQuery = z.strictObject({
  cursorYear: year.optional(),
  limit: z.number().int().min(1).max(100).default(50),
});
export const zLeavePolicyList = z.strictObject({
  items: z.array(zLeavePolicy).max(100),
  nextCursorYear: year.nullable(),
});
