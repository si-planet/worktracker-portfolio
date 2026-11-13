import {
  LEAVE_LEDGER_SUPPORT,
  zLeaveLedgerState,
  zLeaveGrant,
  zLeavePolicy,
  zLeaveSourceVersions,
  zLeaveLedgerReceipt,
} from './leave-ledger';
import { z } from 'zod';
import {
  zWorkEntryId as id,
  zWorkEntryDate as date,
  zWorkEntryEpoch as epoch,
  zWorkEntryVersion as version,
  zWorkEntryFinal,
  zWorkEntryChange,
  zWorkEntrySnapshotV1,
  zWorkEntrySnapshotV2,
  zWorkEntrySnapshotV3,
  zWorkHoursPerDay,
} from './work-entry';
import { zPlanReportItem } from './plan-report';
import { zWbsScheduleSnapshot } from './wbs';
import { zConfirmedRecoveryApply } from './confirmed-worklog-recovery';
import { zWbsCompletionTuple } from './wbs-completion';
import { zPeriodDocumentScope } from './period-document';
import { zGoalWeek } from './weekly-goal';
import {
  RECURRENCE_SUPPORT,
  RECURRENCE_WEEKLY_SUPPORT,
  zRecurrenceSpec,
  zRecurrenceCreate,
  zRecurrenceGenerate,
  zRecurrencePatch,
  zRecurrenceStop,
} from './recurrence';
import { zWeeklyRecurrenceWeek } from './weekly-recurrence-candidates';

const integer = z.number().int().min(-Number.MAX_SAFE_INTEGER).max(Number.MAX_SAFE_INTEGER);
const year = z.number().int().min(1).max(9999);
const text = z.string();
const audit = { createdAt: epoch, updatedAt: epoch, version };
const scopeCompany = { companyId: id };
const presence = z.enum(['present', 'absentHistorical']);
const historyState = z.union([zWorkEntrySnapshotV1, zWorkEntrySnapshotV2, zWorkEntrySnapshotV3]);
export const zExportWorkHistory = z
  .strictObject({
    id,
    companyId: id,
    workEntryId: id,
    entryVersion: version,
    changeType: z.enum([
      'create',
      'edit',
      'status',
      'cancel',
      'restore',
      'auto_complete',
      'pause',
      'resume',
    ]),
    schemaVersion: z.union([z.literal(1), z.literal(2), z.literal(3)]),
    before: historyState.nullable(),
    after: historyState,
    reason: text.nullable(),
    changedAt: epoch,
  })
  .refine(
    (v) =>
      zWorkEntryChange.safeParse({
        id: v.id,
        workEntryId: v.workEntryId,
        entryVersion: v.entryVersion,
        changeType: v.changeType,
        schemaVersion: v.schemaVersion,
        before: v.before,
        after: v.after,
        reason: v.reason,
        changedAt: v.changedAt,
      }).success,
  );
const workShape = zWorkEntryFinal.shape;
export const zExportWorkRow = z.strictObject({
  id,
  companyId: id,
  projectId: workShape.projectId,
  kind: workShape.kind,
  plannedDate: workShape.plannedDate,
  status: workShape.status,
  resumeStatus: z.enum(['todo', 'doing']).nullable(),
  title: workShape.title,
  content: workShape.content,
  dueDate: workShape.dueDate,
  endDate: workShape.endDate,
  timeMode: workShape.timeMode,
  startAt: workShape.startAt,
  endAt: workShape.endAt,
  allDay: workShape.allDay,
  completedAt: epoch.nullable(),
  ...audit,
  mustFinishToday: workShape.mustFinishToday,
  sortOrder: integer,
});
const week = { isoYear: year, isoWeek: z.number().int().min(1).max(53) };
const tag = {
  id,
  companyId: id.nullable(),
  label: text.min(1).max(40),
  isActive: z.boolean(),
  sortOrder: integer,
  ...audit,
  scopeKind: z.enum(['company', 'referencedCommon']),
};
const schedule = zWbsScheduleSnapshot.shape;
const history = zExportWorkHistory;
export const exportEntitySchemas = {
  companies: z.strictObject({
    id,
    name: text.min(1).max(100),
    startedOn: date.nullable(),
    endedOn: date.nullable(),
    isCurrent: z.boolean(),
    sortOrder: integer,
    ...audit,
  }),
  companyYearSettings: z.strictObject({
    id,
    ...scopeCompany,
    year,
    workHoursPerDay: zWorkHoursPerDay,
    wbsKpiRatio: z.number().int().min(0).max(100).nullable(),
    ...audit,
  }),
  projects: z.strictObject({
    id,
    ...scopeCompany,
    code: text.min(1).max(60),
    description: text.max(500).nullable(),
    startedOn: date.nullable(),
    endedOn: date.nullable(),
    isActive: z.boolean(),
    color: text.nullable(),
    ...audit,
  }),
  workTags: z.strictObject({ ...tag, isCore: z.boolean() }),
  noteTags: z.strictObject({ ...tag }),
  projectDefaultTags: z.strictObject({ projectId: id, workTagId: id }),
  companyDayStates: z.strictObject({
    ...scopeCompany,
    date,
    workHoursPerDay: zWorkHoursPerDay.nullable(),
    allowTaskInput: z.boolean(),
    ...audit,
  }),
  workEntries: zExportWorkRow,
  leaveEntries: z.strictObject({
    id,
    ...scopeCompany,
    workEntryId: id,
    leaveType: z.enum([
      'full',
      'am_half',
      'pm_half',
      'am_quarter',
      'pm_quarter',
      'hourly',
      'other',
    ]),
    workHoursPerDaySnapshot: zWorkHoursPerDay,
    unavailableHours: epoch,
    deductibleHours: epoch,
  }),
  workEntryChanges: history,
  workEntryTags: z.strictObject({ workEntryId: id, workTagId: id }),
  weeklyPlanEntries: z.strictObject({
    ...scopeCompany,
    sourceEntryId: id,
    ...week,
    weekStart: date,
    weekEndAt: epoch,
    sourceVersion: version,
    storedSnapshot: zPlanReportItem,
    sourcePresenceAtExport: presence,
    isCarriedOver: z.boolean(),
    finalizedAt: epoch.nullable(),
    asOf: epoch.nullable(),
  }),
  weeklyReports: z.strictObject({
    ...scopeCompany,
    ...week,
    asOf: epoch,
    finalizedAt: epoch,
    coverage: z.enum(['complete', 'partial', 'unknown']),
  }),
  weeklyGoals: z.strictObject({
    id,
    ...scopeCompany,
    ...week,
    title: text.min(1).max(200),
    detail: text.max(5000).nullable(),
    sourceEntryId: id.nullable(),
    sortOrder: integer,
    ...audit,
  }),
  monthlyFocusItems: z.strictObject({
    id,
    ...scopeCompany,
    year,
    month: z.number().int().min(1).max(12),
    title: text.min(1).max(200),
    detail: text.max(5000).nullable(),
    sortOrder: integer,
    ...audit,
  }),
  goalPlacements: z.strictObject({
    id,
    ...scopeCompany,
    goalId: id,
    goalVersion: version,
    intent: z.enum(['continue', 'new']),
    sourceEntryId: id.nullable(),
    sourceVersion: version.nullable(),
    workEntryId: id,
    workEntryVersion: version,
    targetDate: date,
    createdAt: epoch,
  }),
  goalWbsSources: z.strictObject({
    goalId: id,
    ...scopeCompany,
    originalItemId: id,
    originalPlanId: id,
    sourceItemVersion: version,
    sourcePlanVersion: version,
    liveItemId: id.nullable(),
  }),
  wbsPlans: z.strictObject({
    id,
    ...scopeCompany,
    projectId: id,
    year,
    note: text.max(5000).nullable(),
    ...audit,
  }),
  wbsItems: z
    .strictObject({
      id,
      ...scopeCompany,
      wbsPlanId: id,
      title: text.min(1).max(200),
      description: text.max(5000).nullable(),
      ...schedule,
      sortOrder: integer,
      ...audit,
    })
    .refine(
      (v) =>
        zWbsScheduleSnapshot.safeParse({
          plannedStartOn: v.plannedStartOn,
          plannedEndOn: v.plannedEndOn,
          hasRevisedSchedule: v.hasRevisedSchedule,
          revisedStartOn: v.revisedStartOn,
          revisedEndOn: v.revisedEndOn,
        }).success,
    ),
  wbsScheduleChanges: z
    .strictObject({
      id,
      ...scopeCompany,
      wbsItemId: id,
      itemVersion: version,
      schemaVersion: z.literal(1),
      changeType: z.enum(['create', 'revise']),
      before: zWbsScheduleSnapshot.nullable(),
      after: zWbsScheduleSnapshot,
      reason: text.nullable(),
      changedAt: epoch,
    })
    .refine((v) =>
      v.changeType === 'create'
        ? v.itemVersion === 1 && v.before === null
        : v.itemVersion > 1 && v.before !== null,
    ),
  wbsWorkLinks: z.strictObject({ id, ...scopeCompany, workEntryId: id, wbsItemId: id, ...audit }),
  wbsCompletions: z
    .strictObject({
      id,
      ...scopeCompany,
      wbsItemId: id,
      wbsPlanId: id,
      actor: z.literal('self'),
      schemaVersion: z.literal(1),
      changeType: z.literal('complete'),
      beforeItemVersion: version,
      itemVersion: version,
      beforePlanVersion: version,
      planVersion: version,
      completedAt: epoch,
      total: epoch,
      todo: epoch,
      doing: epoch,
      paused: epoch,
      done: epoch,
      canceled: epoch,
      stateToken: z.string().regex(/^[0-9a-f]{64}$/),
      linkedState: z.array(zWbsCompletionTuple.refine((v) => v[4] !== 'done' || v[6] !== null)),
    })
    .refine(
      (v) =>
        v.itemVersion === v.beforeItemVersion + 1 &&
        v.planVersion === v.beforePlanVersion + 1 &&
        v.total === v.todo + v.doing + v.paused + v.done + v.canceled &&
        v.linkedState.length === v.total,
    ),
  periodDocuments: z
    .strictObject({
      ...zPeriodDocumentScope.shape,
      body: text.max(5000),
      version,
      createdAt: epoch,
      updatedAt: epoch,
      updatedActor: z.literal('self'),
      confirmedAt: epoch.nullable(),
      confirmedActor: z.literal('self').nullable(),
      confirmationId: id.nullable(),
    })
    .refine(
      (v) =>
        zPeriodDocumentScope.safeParse({
          companyId: v.companyId,
          kind: v.kind,
          periodStart: v.periodStart,
        }).success &&
        ((v.confirmedAt === null && v.confirmedActor === null && v.confirmationId === null) ||
          (v.kind === 'weekly_report' &&
            v.confirmedAt !== null &&
            v.confirmedActor === 'self' &&
            v.confirmationId !== null &&
            v.body.trim().length > 0)),
    ),
  importOrigins: z.strictObject({
    type: z.literal('worklog_import'),
    receiptId: id,
    ...scopeCompany,
    entryId: id,
    createdAt: epoch,
    retainedOriginalEntry: zWorkEntryFinal,
    retainedOriginalHistory: history,
    currentEntryPresence: presence,
  }),
} as const;
export type ExportEntity = keyof typeof exportEntitySchemas;
export const EXPORT_ENTITIES = Object.keys(exportEntitySchemas) as ExportEntity[];
export const EXPORT_SCHEMA_FAMILIES = [
  '0001a',
  '0001b',
  '0002',
  '0003a',
  '0003b',
  '0003c',
  '0004',
  '0004a',
  '0004b',
  '0004c',
  '0005',
  '0006',
  '0007',
] as const;
export const EXPORT_EXCLUSIONS = [
  'account-settings',
  'authentication-and-security',
  'raw-actor-identifiers',
  'import-staging-and-upload-originals',
  'runtime-resource-identifiers-and-logs',
] as const;
export const EXPORT_UNSUPPORTED = [
  'recurrence-engine',
  'leave-balance-ledger',
  'task-notes',
  'kpi',
  'application-restore',
] as const;
export const zExportScope = z.strictObject({
  companyId: id,
  period: z.literal('all'),
  scopeVersion: z.literal(1),
});
const dataShape = Object.fromEntries(
  EXPORT_ENTITIES.map((k) => [k, z.array(exportEntitySchemas[k])]),
) as {
  [K in ExportEntity]: z.ZodArray<(typeof exportEntitySchemas)[K]>;
};
export const zExportDatasetV1 = z
  .strictObject({
    formatVersion: z.literal(1),
    scope: zExportScope,
    snapshotAt: epoch,
    planningCoverageSinceAt: epoch,
    schemaFamilies: z.array(z.enum(EXPORT_SCHEMA_FAMILIES)),
    data: z.strictObject(dataShape),
  })
  .superRefine((v, ctx) => {
    for (const row of [...v.data.weeklyPlanEntries, ...v.data.weeklyReports, ...v.data.weeklyGoals])
      if (!zGoalWeek.safeParse({ isoYear: row.isoYear, isoWeek: row.isoWeek }).success)
        ctx.addIssue({ code: 'custom', message: 'INVALID_WEEK' });
  });
export type ExportDatasetV1 = z.output<typeof zExportDatasetV1>;
export type ExportData = ExportDatasetV1['data'];
export const zExportContext = z.strictObject({
  exportId: id,
  requestedAt: epoch,
  generatedAt: epoch,
  appRevision: z
    .string()
    .regex(/^[a-f0-9]{7,64}$/)
    .nullable(),
});
export type ExportContext = z.output<typeof zExportContext>;
export type ExportRelationship = {
  key: string;
  relationType: 'live' | 'historical';
  fromEntity: ExportEntity;
  fromId: string;
  toEntity: ExportEntity;
  toId: string;
  presence: 'present' | 'absentHistorical';
  provenance: 'scope-verified' | 'historical-unverified';
};
export const EXPORT_LIMITS = {
  datasetBytes: 5 * 1024 * 1024,
  logicalRows: 20000,
  // Bounded workbook budget, including headers and reversible cell metadata.
  // Six reversible cells per field plus history previews need growth headroom.
  // Export writer/readback only; import, dataset, ZIP/XML and pair byte caps are unchanged.
  physicalCells: 393216,
  pairBytes: 20 * 1024 * 1024,
} as const;
export class ExportError extends Error {
  constructor(
    readonly code:
      | 'INVALID_SCOPE'
      | 'UNSUPPORTED_SCHEMA'
      | 'UNSUPPORTED_HISTORY_VERSION'
      | 'UNSUPPORTED_ACTOR'
      | 'RELATION_INVALID'
      | 'DATASET_CORRUPT'
      | 'EXPORT_LIMIT_EXCEEDED'
      | 'XLSX_UNREPRESENTABLE_TEXT'
      | 'XLSX_BUILD_FAILED'
      | 'PAIR_MISMATCH'
      | 'CANCELLED',
    readonly limit?: keyof typeof EXPORT_LIMITS,
  ) {
    super(code);
    this.name = 'ExportError';
  }
}

/** Projection 2 adds live work notes; projection 1 registries remain frozen. */
export const exportEntitySchemasV2 = {
  ...exportEntitySchemas,
  notes: z.strictObject({
    id,
    companyId: id,
    workEntryId: id,
    body: text.min(1).max(5000),
    ...audit,
  }),
  noteTagLinks: z.strictObject({ noteId: id, noteTagId: id }),
} as const;
export type ExportEntityV2 = keyof typeof exportEntitySchemasV2;
export const EXPORT_ENTITIES_V2 = Object.keys(exportEntitySchemasV2) as ExportEntityV2[];
export const EXPORT_SCHEMA_FAMILIES_V2 = [...EXPORT_SCHEMA_FAMILIES, '0008'] as const;
export const EXPORT_UNSUPPORTED_V2 = EXPORT_UNSUPPORTED.filter((value) => value !== 'task-notes');
const dataShapeV2 = Object.fromEntries(
  EXPORT_ENTITIES_V2.map((k) => [k, z.array(exportEntitySchemasV2[k])]),
) as { [K in ExportEntityV2]: z.ZodArray<(typeof exportEntitySchemasV2)[K]> };
export const zExportDatasetV2 = z
  .strictObject({
    formatVersion: z.literal(2),
    scope: zExportScope,
    snapshotAt: epoch,
    planningCoverageSinceAt: epoch,
    schemaFamilies: z.array(z.enum(EXPORT_SCHEMA_FAMILIES_V2)),
    data: z.strictObject(dataShapeV2),
  })
  .superRefine((v, ctx) => {
    for (const row of [...v.data.weeklyPlanEntries, ...v.data.weeklyReports, ...v.data.weeklyGoals])
      if (!zGoalWeek.safeParse({ isoYear: row.isoYear, isoWeek: row.isoWeek }).success)
        ctx.addIssue({ code: 'custom', message: 'INVALID_WEEK' });
  });
export type ExportDatasetV2 = z.output<typeof zExportDatasetV2>;
export type ExportDataV2 = ExportDatasetV2['data'];
export type ExportRelationshipV2 = Omit<ExportRelationship, 'fromEntity' | 'toEntity'> & {
  fromEntity: ExportEntityV2;
  toEntity: ExportEntityV2;
};

/** Projection 3 preserves the explicit weekly recurrence ledger and command receipts. */
export const EXPORT_RECURRENCE_SUPPORT = RECURRENCE_WEEKLY_SUPPORT;
export const EXPORT_CALENDAR_RECURRENCE_SUPPORT = RECURRENCE_SUPPORT;
function hasCalendarRecurrence(value: unknown): boolean {
  if (!value || typeof value !== 'object') return false;
  if (Array.isArray(value)) return value.some(hasCalendarRecurrence);
  const row = value as Record<string, unknown>;
  return (
    row.freq === 'daily' ||
    row.freq === 'monthly' ||
    row.intervalAnchor === 'initial_start_day' ||
    row.intervalAnchor === 'initial_start_month' ||
    Object.values(row).some(hasCalendarRecurrence)
  );
}
function checkLegacyRecurrenceData(
  value: { data: { recurrenceRuleRevisions: unknown[]; recurrenceCommands: unknown[] } },
  ctx: z.RefinementCtx,
) {
  if (
    hasCalendarRecurrence(value.data.recurrenceRuleRevisions) ||
    hasCalendarRecurrence(value.data.recurrenceCommands)
  )
    ctx.addIssue({ code: 'custom', message: 'CALENDAR_RECURRENCE_REQUIRES_0012' });
}
const recurrenceMetadataShape = {
  ruleId: id,
  occurrenceDate: date,
  originalWorkEntryId: id,
  liveWorkEntryId: id.nullable(),
  appliedRevision: version,
  engineEntryVersion: version.nullable(),
  disposition: z.enum(['generated', 'skipped']),
  engineCanceled: z.boolean(),
};
export const zExportRecurrenceMetadata = z
  .strictObject(recurrenceMetadataShape)
  .refine(
    (v) =>
      (v.liveWorkEntryId === null || v.liveWorkEntryId === v.originalWorkEntryId) &&
      (v.disposition === 'skipped'
        ? v.liveWorkEntryId === null && v.engineEntryVersion === null && !v.engineCanceled
        : v.engineEntryVersion !== null),
  );
export const zExportRecurrenceRuleResult = z
  .strictObject({
    id,
    companyId: id,
    version,
    revision: version,
    effectiveFrom: date,
    spec: zRecurrenceSpec,
    createdAt: epoch,
    updatedAt: epoch,
  })
  .refine((v) => v.version === v.revision && v.updatedAt >= v.createdAt);
const outputWeeks = z
  .array(zWeeklyRecurrenceWeek)
  .refine((v) =>
    v.every(
      (w, i) =>
        i === 0 ||
        v[i - 1]!.isoYear < w.isoYear ||
        (v[i - 1]!.isoYear === w.isoYear && v[i - 1]!.isoWeek < w.isoWeek),
    ),
  );
export const zExportRecurrenceGenerationResult = z
  .strictObject({
    commandId: id,
    ruleId: id,
    ruleVersion: version,
    created: epoch,
    updated: epoch,
    canceled: epoch,
    restored: epoch,
    preserved: epoch,
    skipped: epoch,
    unchanged: epoch,
    occurrences: z.array(zExportRecurrenceMetadata).max(182),
    pendingWeeks: outputWeeks,
  })
  .refine(
    (v) =>
      new Set(v.occurrences.map((o) => o.occurrenceDate)).size === v.occurrences.length &&
      v.occurrences.every((o) => o.ruleId === v.ruleId),
  );
const recurrenceChangeResult = z
  .strictObject({
    rule: zExportRecurrenceRuleResult,
    generation: zExportRecurrenceGenerationResult,
  })
  .refine((v) => v.rule.id === v.generation.ruleId && v.rule.version === v.generation.ruleVersion);
export const exportRecurrenceRequestSchemas = {
  create: zRecurrenceCreate,
  generate: zRecurrenceGenerate,
  revise: zRecurrencePatch,
  stop: zRecurrenceStop,
} as const;
export const exportRecurrenceResultSchemas = {
  create: zExportRecurrenceRuleResult,
  generate: zExportRecurrenceGenerationResult,
  revise: recurrenceChangeResult,
  stop: recurrenceChangeResult,
} as const;
const recurrenceCommand = z
  .strictObject({
    id,
    companyId: id,
    ruleId: id,
    kind: z.enum(['create', 'generate', 'revise', 'stop']),
    createdAt: epoch,
    request: z.union([zRecurrenceCreate, zRecurrenceGenerate, zRecurrencePatch, zRecurrenceStop]),
    result: z.union([
      zExportRecurrenceRuleResult,
      zExportRecurrenceGenerationResult,
      recurrenceChangeResult,
    ]),
  })
  .superRefine((value, ctx) => {
    if (
      !exportRecurrenceRequestSchemas[value.kind].safeParse(value.request).success ||
      !exportRecurrenceResultSchemas[value.kind].safeParse(value.result).success
    )
      ctx.addIssue({ code: 'custom', message: 'RECURRENCE_COMMAND_KIND' });
  });
export const exportEntitySchemasV3 = {
  ...exportEntitySchemasV2,
  recurrenceRules: z
    .strictObject({
      id,
      companyId: id,
      version,
      currentRevision: version,
      createdAt: epoch,
      updatedAt: epoch,
    })
    .refine((v) => v.version === v.currentRevision && v.updatedAt >= v.createdAt),
  recurrenceRuleRevisions: z
    .strictObject({
      ruleId: id,
      revision: version,
      companyId: id,
      commandId: id,
      effectiveFrom: date,
      projectId: id.nullable(),
      spec: zRecurrenceSpec,
      existingPolicy: z.enum(['reconcile', 'preserve']),
      createdAt: epoch,
    })
    .refine((v) => v.projectId === v.spec.projectId),
  recurrenceRuleTags: z.strictObject({ ruleId: id, revision: version, workTagId: id }),
  recurrenceOccurrences: z
    .strictObject({ ...recurrenceMetadataShape, companyId: id, createdAt: epoch, updatedAt: epoch })
    .refine(
      (v) =>
        zExportRecurrenceMetadata.safeParse(
          Object.fromEntries(
            Object.keys(recurrenceMetadataShape).map((k) => [k, v[k as keyof typeof v]]),
          ),
        ).success && v.updatedAt >= v.createdAt,
    ),
  recurrenceGeneratedRanges: z
    .strictObject({
      ruleId: id,
      revision: version,
      isoYear: year,
      isoWeek: z.number().int().min(1).max(53),
      generatedAt: epoch,
    })
    .refine(
      (v) => zWeeklyRecurrenceWeek.safeParse({ isoYear: v.isoYear, isoWeek: v.isoWeek }).success,
    ),
  recurrenceCommands: recurrenceCommand,
} as const;
export type ExportEntityV3 = keyof typeof exportEntitySchemasV3;
export const EXPORT_ENTITIES_V3 = Object.keys(exportEntitySchemasV3) as ExportEntityV3[];
export const EXPORT_SCHEMA_FAMILIES_V3 = [...EXPORT_SCHEMA_FAMILIES_V2, '0009'] as const;
export const EXPORT_UNSUPPORTED_V3 = [
  ...EXPORT_UNSUPPORTED_V2.filter((value) => value !== 'recurrence-engine'),
  ...EXPORT_RECURRENCE_SUPPORT.unsupported.map((value) => 'recurrence-' + value),
];
const dataShapeV3 = Object.fromEntries(
  EXPORT_ENTITIES_V3.map((k) => [k, z.array(exportEntitySchemasV3[k])]),
) as { [K in ExportEntityV3]: z.ZodArray<(typeof exportEntitySchemasV3)[K]> };
export const zExportDatasetV3 = z
  .strictObject({
    formatVersion: z.literal(3),
    scope: zExportScope,
    snapshotAt: epoch,
    planningCoverageSinceAt: epoch,
    schemaFamilies: z.array(z.enum(EXPORT_SCHEMA_FAMILIES_V3)),
    data: z.strictObject(dataShapeV3),
  })
  .superRefine((v, ctx) => {
    checkLegacyRecurrenceData(v, ctx);
    for (const row of [...v.data.weeklyPlanEntries, ...v.data.weeklyReports, ...v.data.weeklyGoals])
      if (!zGoalWeek.safeParse({ isoYear: row.isoYear, isoWeek: row.isoWeek }).success)
        ctx.addIssue({ code: 'custom', message: 'INVALID_WEEK' });
  });
export type ExportDatasetV3 = z.output<typeof zExportDatasetV3>;
export type ExportDataV3 = ExportDatasetV3['data'];
export type ExportRelationshipV3 = Omit<ExportRelationship, 'fromEntity' | 'toEntity'> & {
  fromEntity: ExportEntityV3;
  toEntity: ExportEntityV3;
};

export const zExportDataset = z.discriminatedUnion('formatVersion', [
  zExportDatasetV1,
  zExportDatasetV2,
]);
export type ExportDataset = z.output<typeof zExportDataset>;

export const zExportDatasetAny = z.discriminatedUnion('formatVersion', [
  zExportDatasetV1,
  zExportDatasetV2,
  zExportDatasetV3,
]);
export type ExportDatasetAny = z.output<typeof zExportDatasetAny>;

/** Projection 4 preserves stored forward-only leave accounting; no balance reconstruction. */
export const EXPORT_LEAVE_LEDGER_SUPPORT = {
  ...LEAVE_LEDGER_SUPPORT,
  unsupported: LEAVE_LEDGER_SUPPORT.unsupported.filter((v) => v !== 'export-v4-integration'),
} as const;
export const exportEntitySchemasV4 = {
  ...exportEntitySchemasV3,
  wbsCompletions: exportEntitySchemas.wbsCompletions.safeExtend({
    linkedState: z.array(zWbsCompletionTuple),
  }),
  leaveLedgerStates: z
    .strictObject({
      companyId: id,
      phase: z.enum(['draft', 'active']),
      version,
      setup: zLeaveLedgerState.shape.setup.unwrap(),
      currentCutoverId: id.nullable(),
      createdAt: epoch,
      updatedAt: epoch,
    })
    .refine(
      (v) => v.updatedAt >= v.createdAt && (v.phase === 'active') === (v.currentCutoverId !== null),
    ),
  leavePolicies: zLeavePolicy,
  leaveGrants: zLeaveGrant,
  leaveLedgerCutovers: z
    .strictObject({
      id,
      companyId: id,
      commandId: id,
      manifest: zLeaveSourceVersions.shape.workEntries.max(128),
      createdAt: epoch,
    })
    .refine(
      (v) =>
        v.id === v.commandId &&
        new Set(v.manifest.map((x) => x.entryId)).size === v.manifest.length,
    ),
  leaveEntryAccounting: z
    .strictObject({
      companyId: id,
      leaveEntryId: id,
      cutoverId: id.nullable(),
      state: z.enum(['unmanaged', 'allocated']),
      classificationReason: z.enum(['before_cutover', 'explicit_cutover', 'new_managed_leave']),
      lastWorkVersion: version,
      createdAt: epoch,
      updatedAt: epoch,
    })
    .refine((v) => v.updatedAt >= v.createdAt),
  leaveAllocations: z.strictObject({
    id,
    companyId: id,
    leaveEntryId: id,
    grantId: id,
    allocatedHours: epoch.refine((v) => v > 0),
    policyYear: year,
    policyVersion: version,
    createdAt: epoch,
  }),
  leaveLedgerCommands: zLeaveLedgerReceipt,
} as const;
export type ExportEntityV4 = keyof typeof exportEntitySchemasV4;
export const EXPORT_ENTITIES_V4 = Object.keys(exportEntitySchemasV4) as ExportEntityV4[];
export const EXPORT_SCHEMA_FAMILIES_V4 = [...EXPORT_SCHEMA_FAMILIES_V3, '0010'] as const;
export const EXPORT_SCHEMA_FAMILIES_V4_UNKNOWN_COMPLETION = [
  ...EXPORT_SCHEMA_FAMILIES_V4,
  '0011',
] as const;
export const EXPORT_SCHEMA_FAMILIES_V4_CALENDAR_RECURRENCE = [
  ...EXPORT_SCHEMA_FAMILIES_V4_UNKNOWN_COMPLETION,
  '0012',
] as const;
function checkUnknownCompletionFamily(
  value: {
    schemaFamilies: readonly string[];
    data: {
      wbsCompletions: { linkedState: z.output<typeof zWbsCompletionTuple>[] }[];
      recurrenceRuleRevisions: unknown[];
      recurrenceCommands: unknown[];
    };
  },
  ctx: z.RefinementCtx,
) {
  const families = value.schemaFamilies.includes('0012')
    ? EXPORT_SCHEMA_FAMILIES_V4_CALENDAR_RECURRENCE
    : value.schemaFamilies.includes('0011')
      ? EXPORT_SCHEMA_FAMILIES_V4_UNKNOWN_COMPLETION
      : EXPORT_SCHEMA_FAMILIES_V4;
  if (!value.schemaFamilies.includes('0012')) checkLegacyRecurrenceData(value, ctx);
  if (
    value.schemaFamilies.length !== families.length ||
    new Set(value.schemaFamilies).size !== families.length ||
    families.some((family) => !value.schemaFamilies.includes(family))
  )
    ctx.addIssue({
      code: 'custom',
      message: 'UNSUPPORTED_SCHEMA',
      path: ['schemaFamilies'],
    });
  if (
    !value.schemaFamilies.includes('0011') &&
    value.data.wbsCompletions.some((event) =>
      event.linkedState.some((tuple) => tuple[4] === 'done' && tuple[6] === null),
    )
  )
    ctx.addIssue({
      code: 'custom',
      message: 'UNKNOWN_COMPLETION_REQUIRES_0011',
      path: ['data', 'wbsCompletions'],
    });
}
export const EXPORT_UNSUPPORTED_V4 = [
  ...EXPORT_UNSUPPORTED_V3.filter((v) => v !== 'leave-balance-ledger'),
  ...EXPORT_LEAVE_LEDGER_SUPPORT.unsupported.map((v) => 'leave-ledger-' + v),
];
export const EXPORT_UNSUPPORTED_CALENDAR_V4 = [
  ...EXPORT_UNSUPPORTED_V4.filter((value) => !value.startsWith('recurrence-')),
  ...EXPORT_CALENDAR_RECURRENCE_SUPPORT.unsupported.map((value) => 'recurrence-' + value),
];
const dataShapeV4 = Object.fromEntries(
  EXPORT_ENTITIES_V4.map((k) => [k, z.array(exportEntitySchemasV4[k])]),
) as {
  [K in ExportEntityV4]: z.ZodArray<(typeof exportEntitySchemasV4)[K]>;
};
export const zExportDatasetV4 = z
  .strictObject({
    formatVersion: z.literal(4),
    scope: zExportScope,
    snapshotAt: epoch,
    planningCoverageSinceAt: epoch,
    schemaFamilies: z.array(z.enum(EXPORT_SCHEMA_FAMILIES_V4_CALENDAR_RECURRENCE)),
    data: z.strictObject(dataShapeV4),
  })
  .superRefine((v, ctx) => {
    checkUnknownCompletionFamily(v, ctx);
    for (const row of [...v.data.weeklyPlanEntries, ...v.data.weeklyReports, ...v.data.weeklyGoals])
      if (!zGoalWeek.safeParse({ isoYear: row.isoYear, isoWeek: row.isoWeek }).success)
        ctx.addIssue({ code: 'custom', message: 'INVALID_WEEK' });
  });
export type ExportDatasetV4 = z.output<typeof zExportDatasetV4>;
export type ExportDataV4 = ExportDatasetV4['data'];
export type ExportRelationshipV4 = Omit<ExportRelationship, 'fromEntity' | 'toEntity'> & {
  fromEntity: ExportEntityV4;
  toEntity: ExportEntityV4;
};
export const zExportDatasetAnyV4 = z.discriminatedUnion('formatVersion', [
  zExportDatasetV1,
  zExportDatasetV2,
  zExportDatasetV3,
  zExportDatasetV4,
]);
export type ExportDatasetAnyV4 = z.output<typeof zExportDatasetAnyV4>;
/** Typed historical paths shared by the pure projector and exact SQL byte accounting. */
export const EXPORT_LEAVE_HISTORY_PATHS = [
  { entity: 'leaveLedgerCutovers', path: 'manifest.*.entryId', target: 'workEntries', kinds: [] },
  {
    entity: 'leaveLedgerCommands',
    path: 'request.year',
    target: 'leavePolicies',
    kinds: ['policy_put', 'policy_delete'],
  },
  {
    entity: 'leaveLedgerCommands',
    path: 'request.id',
    target: 'leaveGrants',
    kinds: ['grant_create', 'grant_patch', 'grant_delete'],
  },
  {
    entity: 'leaveLedgerCommands',
    path: 'result.id',
    target: 'leaveGrants',
    kinds: ['grant_create', 'grant_patch', 'grant_delete'],
  },
  {
    entity: 'leaveLedgerCommands',
    path: 'result.year',
    target: 'leavePolicies',
    kinds: ['policy_put'],
  },
  {
    entity: 'leaveLedgerCommands',
    path: 'result.id',
    target: 'leavePolicies',
    kinds: ['policy_delete'],
  },
  {
    entity: 'leaveLedgerCommands',
    path: 'result.appliedEntryIds.*',
    target: 'workEntries',
    kinds: ['cutover'],
  },
  {
    entity: 'leaveLedgerCommands',
    path: 'request.confirmations.*.grantIds.*',
    target: 'leaveGrants',
    kinds: ['work'],
  },
  {
    entity: 'leaveLedgerCommands',
    path: 'request.work.*.entryId',
    target: 'workEntries',
    kinds: ['work'],
  },
  {
    entity: 'leaveLedgerCommands',
    path: 'request.work.*.input.id',
    target: 'workEntries',
    kinds: ['work'],
  },
  {
    entity: 'leaveLedgerCommands',
    path: 'request.work.*.input.projectId',
    target: 'projects',
    kinds: ['work'],
  },
  {
    entity: 'leaveLedgerCommands',
    path: 'request.work.*.input.tagIds.*',
    target: 'workTags',
    kinds: ['work'],
  },
  {
    entity: 'leaveLedgerCommands',
    path: 'result.entries.*.entryId',
    target: 'workEntries',
    kinds: ['work'],
  },
  {
    entity: 'leaveLedgerCommands',
    path: 'result.entries.*.entry.id',
    target: 'workEntries',
    kinds: ['work'],
  },
  {
    entity: 'leaveLedgerCommands',
    path: 'result.entries.*.entry.leave.id',
    target: 'leaveEntries',
    kinds: ['work'],
  },
  {
    entity: 'leaveLedgerCommands',
    path: 'result.entries.*.entry.projectId',
    target: 'projects',
    kinds: ['work'],
  },
  {
    entity: 'leaveLedgerCommands',
    path: 'result.entries.*.entry.tagIds.*',
    target: 'workTags',
    kinds: ['work'],
  },
  {
    entity: 'leaveLedgerCommands',
    path: 'result.unmanagedEntryIds.*',
    target: 'workEntries',
    kinds: ['work'],
  },
] as const;

/** Range export is a current observation, never a reconstruction of past state. */
export const zExportRangeScope = z
  .strictObject({
    companyId: id,
    period: z.literal('range'),
    from: date,
    to: date,
    dateBasis: z.literal('scheduled_overlap'),
    includeUndated: z.boolean(),
    scopeVersion: z.literal(2),
  })
  .refine((v) => v.from <= v.to, { message: 'INVALID_RANGE' });
export type ExportRangeScope = z.output<typeof zExportRangeScope>;
export const EXPORT_ENTITIES_V5 = EXPORT_ENTITIES_V4;
export type ExportEntityV5 = ExportEntityV4;
export const exportEntitySchemasV5 = exportEntitySchemasV4;
export const EXPORT_SCHEMA_FAMILIES_V5 = EXPORT_SCHEMA_FAMILIES_V4;
export const EXPORT_PRIMARY_REASONS = [
  'company',
  'scheduled_overlap',
  'undated',
  'day',
  'note_created',
  'week_overlap',
  'month_overlap',
  'period_overlap',
  'occurrence_date',
  'primary_work_occurrence',
] as const;
export const EXPORT_SUPPORT_REASONS = [
  'relation',
  'work_sidecar',
  'note_tags',
  'project_defaults',
  'goal_provenance',
  'wbs_context',
  'recurrence_cluster',
  'leave_ledger_cluster',
  'year_settings',
] as const;
export const zExportRangeRow = z.strictObject({
  entity: z.enum(EXPORT_ENTITIES_V4 as [ExportEntityV4, ...ExportEntityV4[]]),
  logicalRowKey: z.string().min(1),
  isPrimary: z.boolean(),
  primaryReasons: z.array(z.enum(EXPORT_PRIMARY_REASONS)),
  supportReasons: z.array(z.enum(EXPORT_SUPPORT_REASONS)),
});
export type ExportRangeRow = z.output<typeof zExportRangeRow>;
/** Every business key has exactly one proof. Counts are derived, not caller supplied. */
export const zExportSelectionV5 = z.strictObject({
  profileVersion: z.literal(1),
  timeZone: z.literal('Asia/Seoul'),
  rows: z.array(zExportRangeRow),
});
export const EXPORT_RANGE_DATE_MEANINGS = {
  workEntries:
    'scheduled_overlap; exact intervals are half open; dueDate/completedAt are not placement',
  notes: 'KST createdAt; body/updatedAt are current at snapshotAt',
  companyDayStates: 'stored date; no missing day is synthesized',
  weeklyPlanEntries: 'whole stored ISO week and membership',
  weeklyReports: 'whole stored ISO week, denominator/asOf/coverage unchanged',
  weeklyGoals: 'whole stored ISO week',
  monthlyFocusItems: 'whole stored calendar month',
  periodDocuments: 'stored daily date or whole stored week; no new seal',
  recurrenceOccurrences:
    'stored occurrenceDate or directly selected work; full related rule cluster',
  wbs: 'related context only; stored schedules and completion tuples',
  leaveLedger: 'related full current commitments/audit; no historical balance reconstruction',
  other:
    'required owned live/historical references and retained sidecars; support is not a new date seed',
} as const;
export const zExportDatasetV5 = z
  .strictObject({
    formatVersion: z.literal(5),
    scope: zExportRangeScope,
    snapshotAt: epoch,
    planningCoverageSinceAt: epoch,
    schemaFamilies: z.array(z.enum(EXPORT_SCHEMA_FAMILIES_V4_CALENDAR_RECURRENCE)),
    data: z.strictObject(dataShapeV4),
    selection: zExportSelectionV5,
  })
  .superRefine(checkUnknownCompletionFamily);
export type ExportDatasetV5 = z.output<typeof zExportDatasetV5>;
export type ExportDataV5 = ExportDataV4;
export type ExportRelationshipV5 = ExportRelationshipV4;
export const zExportDatasetAnyV5 = z.discriminatedUnion('formatVersion', [
  zExportDatasetV1,
  zExportDatasetV2,
  zExportDatasetV3,
  zExportDatasetV4,
  zExportDatasetV5,
]);
export type ExportDatasetAnyV5 = z.output<typeof zExportDatasetAnyV5>;

/** V5 closes optional historical duplication provenance; old V4 canonical edges stay frozen. */
export const EXPORT_LEAVE_HISTORY_PATHS_V5 = [
  ...EXPORT_LEAVE_HISTORY_PATHS,
  {
    entity: 'leaveLedgerCommands',
    path: 'request.sourceEntryId',
    target: 'workEntries',
    kinds: ['work'],
  },
] as const;

/** V6 wraps an unchanged V4/V5 projection and the company's whole immutable recovery ledger. */
export const zExportProvenanceScopeV6 = z.strictObject({
  companyId: id,
  period: z.literal('all'),
  profileVersion: z.literal(1),
  sourceProof: z.literal('retained-external-raw-source'),
  rawSourceArchive: z.literal('separate-sql-backup-required'),
});
export const zExportRecoveryV6 = z.strictObject({
  id,
  companyId: id,
  actor: z.literal('self'),
  sourceSha256: z.string().regex(/^[a-f0-9]{64}$/),
  decisionKey: z.string().min(1).max(150),
  requestHash: z.string().regex(/^[a-f0-9]{64}$/),
  action: zConfirmedRecoveryApply.shape.action,
  entryId: id.nullable(),
  before: zWorkEntryFinal.nullable(),
  after: zWorkEntryFinal.nullable(),
  performedDates: zConfirmedRecoveryApply.shape.performedDates,
  decision: zConfirmedRecoveryApply,
  createdAt: epoch,
  currentEntryPresence: z.enum(['present', 'absentHistorical', 'notApplicable']),
});
export const zExportSourceClaimV6 = z.strictObject({
  companyId: id,
  sourceSha256: z.string().regex(/^[a-f0-9]{64}$/),
  sourceRecordId: z.string().min(1).max(500),
  recoveryId: id,
  runId: id,
  rowId: id,
  payloadHash: z.string().regex(/^[a-f0-9]{64}$/),
  sourceProof: z.literal('retained-external-raw-source'),
  actor: z.literal('self'),
});
export const zExportDatasetV6 = z.strictObject({
  formatVersion: z.literal(6),
  base: z.discriminatedUnion('formatVersion', [zExportDatasetV4, zExportDatasetV5]),
  schemaFamilies: z.array(z.enum([...EXPORT_SCHEMA_FAMILIES_V4_CALENDAR_RECURRENCE, '0013'])),
  provenance: z.strictObject({
    scope: zExportProvenanceScopeV6,
    recoveries: z.array(zExportRecoveryV6).max(EXPORT_LIMITS.logicalRows),
    sourceClaims: z.array(zExportSourceClaimV6).max(EXPORT_LIMITS.logicalRows),
  }),
});
export type ExportDatasetV6 = z.output<typeof zExportDatasetV6>;
export const zExportScopeV6 = z.union([zExportScope, zExportRangeScope]);
