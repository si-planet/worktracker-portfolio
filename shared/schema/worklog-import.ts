import { z } from 'zod';
import {
  zWorkEntryChange,
  zWorkEntryDate,
  zWorkEntryFinal,
  zWorkEntryId,
  zWorkEntryVersion,
} from './work-entry';
export const WORKLOG_IMPORT_LIMITS = {
  chunkItems: 16,
  chunkBytes: 131072,
  itemBytes: 32768,
  runBytes: 16777216,
  pageItems: 64,
} as const;
const id = zWorkEntryId;
const version = zWorkEntryVersion;
const hash = z.string().regex(/^[0-9a-f]{64}$/);
const raw = z.json();
const item = <K extends string, T extends z.ZodType>(kind: K, data: T) =>
  z.strictObject({ id, kind: z.literal(kind), data });
export const zWorklogItem = z.discriminatedUnion('kind', [
  item(
    'sheet',
    z.strictObject({ key: z.string().min(1), tabName: z.string(), sourceMonth: z.string(), raw }),
  ),
  item('cell', z.strictObject({ sheetId: id, ref: z.string().regex(/^[A-Z]+[1-9][0-9]*$/), raw })),
  item(
    'row',
    z.strictObject({
      sheetId: id,
      sourceRecordId: z.string().min(1),
      section: z.enum(['weeklySummary', 'daily']),
      titleCell: z.string().min(1),
      rawCategory: z.string(),
      fields: z.record(z.string(), raw),
      completionState: z.enum(['checked', 'unchecked', 'blank']),
      cellIds: z.array(id).min(1).max(256),
    }),
  ),
  item('group', z.strictObject({ sheetId: id, key: z.string().min(1), raw })),
  item('source_membership', z.strictObject({ rowId: id, groupId: id, basis: raw })),
  item(
    'interpretation',
    z.strictObject({
      rowId: id,
      version: z.literal(1),
      weekStart: zWorkEntryDate.nullable(),
      activityDate: zWorkEntryDate.nullable(),
      dueDate: zWorkEntryDate.nullable(),
      decisionRef: z.string().min(1).nullable(),
      rawEvidence: raw,
    }),
  ),
  item(
    'iso_membership',
    z.strictObject({
      rowId: id,
      interpretationId: id,
      isoYear: z.number().int().min(1).max(9999).nullable(),
      isoWeek: z.number().int().min(1).max(53).nullable(),
    }),
  ),
  item(
    'relation',
    z.strictObject({
      weeklyRowId: id,
      dailyRowId: id,
      state: z.literal('candidate'),
      evidence: raw,
      merge: z.literal(false),
      completionPropagation: z.literal(false),
    }),
  ),
]);
export type WorklogItem = z.infer<typeof zWorklogItem>;
export const zWorklogCounts = z.strictObject({
  sheet: z.number().int().min(1).max(12),
  cell: z.number().int().min(1).max(20000),
  row: z.number().int().min(1).max(200),
  group: z.number().int().min(1).max(52),
  source_membership: z.number().int().min(1).max(200),
  interpretation: z.number().int().min(1).max(200),
  iso_membership: z.number().int().min(1).max(200),
  relation: z.number().int().min(0).max(2000),
});
export const zWorklogBegin = z.strictObject({
  id,
  documentKey: z.string().min(1).max(200),
  sourceSha256: hash,
  sourceBytes: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
  artifact: raw,
  manifestHash: hash,
  counts: zWorklogCounts,
  expectedBytes: z.number().int().positive().max(WORKLOG_IMPORT_LIMITS.runBytes),
});
export const zWorklogChunk = z.strictObject({
  id,
  expectedRunVersion: version,
  items: z.array(zWorklogItem).min(1).max(WORKLOG_IMPORT_LIMITS.chunkItems),
});
export const zWorklogValidate = z.strictObject({ expectedRunVersion: version, manifestHash: hash });
export const zWorklogMapping = z.strictObject({
  rowId: id,
  interpretationId: id,
  interpretationVersion: z.literal(1),
  entryId: id,
  kind: z.enum(['task', 'meeting', 'field', 'etc']),
  project: z.strictObject({ id, version }).nullable(),
  tags: z
    .array(z.strictObject({ id, version }))
    .max(16)
    .refine((a) => new Set(a.map((t) => t.id)).size === a.length),
  status: z.enum(['todo', 'doing', 'planned', 'done', 'canceled']),
  acknowledgedSourceState: z.enum(['checked', 'unchecked', 'blank']),
  decisionRef: z.string().trim().min(1).max(500),
});
export type WorklogMapping = z.infer<typeof zWorklogMapping>;
export const zWorklogDryRun = z
  .strictObject({ mappings: z.array(zWorklogMapping).max(200) })
  .refine((v) => new Set(v.mappings.map((m) => m.rowId)).size === v.mappings.length);
export const zWorklogMaterialize = z.strictObject({
  id,
  expectedRunVersion: version,
  mapping: zWorklogMapping,
});
export const zWorklogRun = z.strictObject({
  id,
  companyId: id,
  documentKey: z.string(),
  sourceSha256: hash,
  state: z.enum(['staging', 'validated']),
  version,
  receivedBytes: z.number().int().nonnegative(),
  manifestHash: hash,
  counts: zWorklogCounts,
});
export const zWorklogReceipt = z.strictObject({
  id,
  runId: id,
  rowId: id,
  interpretationId: id,
  mappingHash: hash,
  runVersionAfter: version,
  createdAt: z.number().int().nonnegative(),
  originalEntry: zWorkEntryFinal,
  originalHistory: zWorkEntryChange,
  current: z.discriminatedUnion('state', [
    z.strictObject({ state: z.literal('deleted'), entry: z.null() }),
    z.strictObject({ state: z.enum(['unchanged', 'edited']), entry: zWorkEntryFinal }),
  ]),
});

export const zWorklogChunkResult = z.strictObject({
  id: zWorkEntryId,
  appliedVersion: zWorkEntryVersion,
  run: zWorklogRun,
});
export const zWorklogChunkObservation = z.strictObject({
  id: zWorkEntryId,
  payloadHash: hash,
  appliedVersion: zWorkEntryVersion,
  itemCount: z.number().int().min(1).max(16),
  run: zWorklogRun,
});
export const zWorklogDryRunResult = z.strictObject({
  runId: zWorkEntryId,
  version: zWorkEntryVersion,
  results: z
    .array(
      z.strictObject({
        rowId: zWorkEntryId,
        state: z.enum(['ready', 'hold', 'summary']),
        reason: z.string().nullable(),
      }),
    )
    .max(200),
});
export const zWorklogSummaries = z.strictObject({
  runId: zWorkEntryId,
  version: zWorkEntryVersion,
  items: z
    .array(
      z.strictObject({
        row: zWorklogItem,
        interpretation: zWorklogItem,
        isoMembership: zWorklogItem,
        sourceMembership: zWorklogItem,
        relations: z.array(zWorklogItem),
      }),
    )
    .max(200),
});
