import { z } from 'zod';
import { zWorkEntryDate, zWorkEntryId } from './work-entry';
import {
  zWorklogBegin,
  zWorklogChunk,
  zWorklogItem,
  zWorklogMapping,
  zWorklogReceipt,
  WORKLOG_IMPORT_LIMITS as L,
  type WorklogItem,
} from './worklog-import';
const sha256 = z.string().regex(/^[0-9a-f]{64}$/);
export const zWorklogPackageArtifact = z.strictObject({
  role: z.enum(['rows', 'cells', 'mapping', 'relations']),
  sha256,
  bytes: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
});
export const zWorklogPackageRow = z.strictObject({
  sourceRecordId: z.string().min(1),
  rowId: zWorkEntryId,
  interpretationId: zWorkEntryId,
  sourceTab: z.string().min(1),
  sourceMonth: z.string().min(1),
  section: z.enum(['weeklySummary', 'daily']),
  sourceTitleCell: z.string().min(1),
  originalCategory: z.string(),
  projectCode: z.enum(['GF', 'DC', '고도화', '기타']),
  sourceCompletionState: z.enum(['checked', 'unchecked', 'blank']),
  weekStart: zWorkEntryDate,
  activityDate: zWorkEntryDate.nullable(),
  dueDate: zWorkEntryDate.nullable(),
  interpretationDecisionRef: z.string().min(1),
  entryCandidateId: zWorkEntryId.nullable(),
  materializeCommandId: zWorkEntryId.nullable(),
  mapping: z.null(),
});
/** Browser consumers import only this DTO. Manifest/hash verification remains
 * authoritative in the existing staging/validate API; this parser verifies shape
 * and cross-field consistency and never imports server storage/service modules. */
export const zWorklogImportPackage = z
  .strictObject({
    formatVersion: z.literal(1),
    packageId: zWorkEntryId,
    generator: z.literal('prepare-worklog-import/v1'),
    sourceArtifacts: z.array(zWorklogPackageArtifact).length(4),
    begin: zWorklogBegin,
    chunks: z.array(zWorklogChunk).min(1).max(1500),
    rows: z.array(zWorklogPackageRow).min(1).max(200),
    summary: z.strictObject({
      weeklySummaries: z.number().int().nonnegative(),
      daily: z.number().int().nonnegative(),
      checked: z.number().int().nonnegative(),
      unchecked: z.number().int().nonnegative(),
      blank: z.number().int().nonnegative(),
      dailyBlank: z.number().int().nonnegative(),
    }),
    execution: z.strictObject({
      state: z.literal('not_submitted'),
      companyId: z.null(),
      masterMapping: z.literal('requires_explicit_selection'),
      automaticRequests: z.literal(false),
    }),
  })
  .superRefine((p, ctx) => {
    const issue = (message: string) => ctx.addIssue({ code: 'custom', message });
    if (new Set(p.sourceArtifacts.map((a) => a.role)).size !== 4)
      issue('Source artifact roles must be unique.');
    if (
      worklogCanonical(p.begin.artifact) !==
      worklogCanonical({
        formatVersion: p.formatVersion,
        generator: p.generator,
        sourceArtifacts: p.sourceArtifacts,
      })
    )
      issue('Package provenance differs from staged artifact.');
    const items = p.chunks.flatMap((c) => c.items);
    if (new Set(items.map((i) => i.id)).size !== items.length) issue('Item IDs must be unique.');
    if (new Set(p.chunks.map((c) => c.id)).size !== p.chunks.length)
      issue('Chunk IDs must be unique.');
    for (const [index, c] of p.chunks.entries())
      if (c.expectedRunVersion !== index + 1)
        issue('Chunk versions must start at1 and advance once per chunk.');
    for (const kind of Object.keys(p.begin.counts) as (keyof typeof p.begin.counts)[])
      if (items.filter((i) => i.kind === kind).length !== p.begin.counts[kind])
        issue(`Count mismatch:${kind}`);
    if (
      p.rows.length !== p.begin.counts.row ||
      new Set(p.rows.map((r) => r.rowId)).size !== p.rows.length ||
      new Set(p.rows.map((r) => r.sourceRecordId)).size !== p.rows.length
    )
      issue('Row index mismatch.');
    const byId = new Map(items.map((i) => [i.id, i]));
    const reservedIds = [
      p.packageId,
      p.begin.id,
      ...p.chunks.map((c) => c.id),
      ...items.map((i) => i.id),
      ...p.rows.flatMap((r) =>
        [r.entryCandidateId, r.materializeCommandId].filter((id): id is string => id !== null),
      ),
    ];
    if (new Set(reservedIds).size !== reservedIds.length)
      issue('Reserved IDs must identify separate resources.');
    for (const r of p.rows) {
      const row = byId.get(r.rowId),
        interpretation = byId.get(r.interpretationId);
      if (row?.kind !== 'row' || interpretation?.kind !== 'interpretation') {
        issue('Missing indexed row/interpretation.');
        continue;
      }
      if (
        row.data.sourceRecordId !== r.sourceRecordId ||
        row.data.section !== r.section ||
        row.data.completionState !== r.sourceCompletionState ||
        row.data.rawCategory !== r.originalCategory ||
        interpretation.data.rowId !== r.rowId ||
        interpretation.data.weekStart !== r.weekStart ||
        interpretation.data.activityDate !== r.activityDate ||
        interpretation.data.dueDate !== r.dueDate ||
        interpretation.data.decisionRef !== r.interpretationDecisionRef
      )
        issue('Row index differs from sealed item.');
      const sheet = byId.get(row.data.sheetId);
      if (
        sheet?.kind !== 'sheet' ||
        sheet.data.tabName !== r.sourceTab ||
        sheet.data.sourceMonth !== r.sourceMonth ||
        `${r.sourceTab}!${row.data.titleCell}` !== r.sourceTitleCell
      )
        issue('Source coordinate mismatch.');
      const expectedCode =
        r.originalCategory === '주간보고'
          ? 'GF'
          : r.originalCategory === '제안서'
            ? '기타'
            : r.originalCategory;
      if (r.projectCode !== expectedCode)
        issue('Project code differs from approved category mapping.');
      if (
        r.section === 'weeklySummary' &&
        (r.activityDate !== null || r.entryCandidateId !== null || r.materializeCommandId !== null)
      )
        issue('Weekly summaries never reserve canonical work IDs.');
      if (
        r.section === 'daily' &&
        (r.activityDate === null || r.entryCandidateId === null || r.materializeCommandId === null)
      )
        issue('Daily work requires an approved date and separate candidate IDs.');
    }
    const count = (key: 'section' | 'sourceCompletionState', value: string) =>
      p.rows.filter((r) => r[key] === value).length;
    if (
      p.summary.weeklySummaries !== count('section', 'weeklySummary') ||
      p.summary.daily !== count('section', 'daily') ||
      p.summary.checked !== count('sourceCompletionState', 'checked') ||
      p.summary.unchecked !== count('sourceCompletionState', 'unchecked') ||
      p.summary.blank !== count('sourceCompletionState', 'blank') ||
      p.summary.dailyBlank !==
        p.rows.filter((r) => r.section === 'daily' && r.sourceCompletionState === 'blank').length
    )
      issue('Summary mismatch.');
  });
export type WorklogImportPackage = z.infer<typeof zWorklogImportPackage>;
export type WorklogPackageRow = z.infer<typeof zWorklogPackageRow>;

function packageInvalid(reason: string): never {
  throw new Error(reason);
}
export function worklogCanonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(worklogCanonical).join(',')}]`;
  if (value !== null && typeof value === 'object')
    return `{${Object.entries(value)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([k, v]) => `${JSON.stringify(k)}:${worklogCanonical(v)}`)
      .join(',')}}`;
  return JSON.stringify(value);
}
export async function worklogHash(value: unknown) {
  return [
    ...new Uint8Array(
      await crypto.subtle.digest('SHA-256', new TextEncoder().encode(worklogCanonical(value))),
    ),
  ]
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}
const bytes = (s: string) => new TextEncoder().encode(s).length;
type Ref = { id: string; role: string };
export function worklogItemIdentity(item: WorklogItem): { key: string; refs: Ref[] } {
  switch (item.kind) {
    case 'sheet':
      return { key: item.data.key, refs: [] };
    case 'cell':
      return {
        key: worklogCanonical([item.data.sheetId, item.data.ref]),
        refs: [{ id: item.data.sheetId, role: 'sheet' }],
      };
    case 'row':
      return {
        key: worklogCanonical([item.data.sheetId, item.data.section, item.data.titleCell]),
        refs: [
          { id: item.data.sheetId, role: 'sheet' },
          ...item.data.cellIds.map((id) => ({ id, role: 'cell' })),
        ],
      };
    case 'group':
      return {
        key: worklogCanonical([item.data.sheetId, item.data.key]),
        refs: [{ id: item.data.sheetId, role: 'sheet' }],
      };
    case 'source_membership':
      return {
        key: item.data.rowId,
        refs: [
          { id: item.data.rowId, role: 'row' },
          { id: item.data.groupId, role: 'group' },
        ],
      };
    case 'interpretation':
      return { key: item.data.rowId, refs: [{ id: item.data.rowId, role: 'row' }] };
    case 'iso_membership':
      return {
        key: item.data.rowId,
        refs: [
          { id: item.data.rowId, role: 'row' },
          { id: item.data.interpretationId, role: 'interpretation' },
        ],
      };
    case 'relation':
      return {
        key: worklogCanonical([item.data.weeklyRowId, item.data.dailyRowId]),
        refs: [
          { id: item.data.weeklyRowId, role: 'weeklyRow' },
          { id: item.data.dailyRowId, role: 'dailyRow' },
        ],
      };
  }
}
export async function prepareWorklogPackageItem(
  raw: unknown,
  invalid: (reason: string) => never = packageInvalid,
) {
  const item = zWorklogItem.parse(raw),
    { key, refs } = worklogItemIdentity(item);
  if (new Set(refs.map((r) => `${r.role}:${r.id}`)).size !== refs.length)
    invalid('IMPORT_REFERENCE');
  const payload = worklogCanonical(item.data),
    refJson = worklogCanonical(refs),
    size = bytes(payload) + bytes(refJson);
  if (size > L.itemBytes) invalid('IMPORT_TOO_LARGE');
  return {
    item,
    key,
    refs,
    payload,
    refJson,
    size,
    payloadHash: await worklogHash(item.data),
    refsHash: await worklogHash(refs),
  };
}
export async function worklogPackageManifest(
  items: unknown[],
  invalid: (reason: string) => never = packageInvalid,
) {
  const prepared = await Promise.all(items.map((item) => prepareWorklogPackageItem(item, invalid)));
  const counts = {
    sheet: 0,
    cell: 0,
    row: 0,
    group: 0,
    source_membership: 0,
    interpretation: 0,
    iso_membership: 0,
    relation: 0,
  };
  for (const p of prepared) counts[p.item.kind]++;
  const rows = prepared
    .sort((a, b) => a.item.id.localeCompare(b.item.id))
    .map((p) => [p.item.id, p.item.kind, p.key, p.payloadHash, p.refsHash]);
  return {
    manifestHash: await worklogHash(rows),
    counts,
    expectedBytes: prepared.reduce((n, p) => n + p.size, 0),
  };
}

export const validateWorklogImportPackage = (input: unknown) =>
  zWorklogImportPackage.safeParse(input);
export async function verifyWorklogImportPackage(input: unknown): Promise<WorklogImportPackage> {
  const p = zWorklogImportPackage.parse(input),
    items = p.chunks.flatMap((c) => c.items),
    m = await worklogPackageManifest(items);
  if (
    m.manifestHash !== p.begin.manifestHash ||
    m.expectedBytes !== p.begin.expectedBytes ||
    worklogCanonical(m.counts) !== worklogCanonical(p.begin.counts)
  )
    packageInvalid('PACKAGE_MANIFEST_MISMATCH');
  const size = (v: unknown) => new TextEncoder().encode(JSON.stringify(v)).length;
  if (size(p.begin) > 8192 || p.chunks.some((c) => size(c) > L.chunkBytes))
    packageInvalid('PACKAGE_REQUEST_TOO_LARGE');
  const byId = new Map(items.map((i) => [i.id, i]));
  for (const item of items) {
    for (const ref of worklogItemIdentity(item).refs)
      if (!byId.has(ref.id)) packageInvalid('PACKAGE_MISSING_REFERENCE');
  }
  return p;
}

export function worklogPackageRowPreview(p: WorklogImportPackage, rowId: string) {
  const row = p.rows.find((r) => r.rowId === rowId),
    item = p.chunks.flatMap((c) => c.items).find((i) => i.id === rowId);
  if (!row || item?.kind !== 'row') packageInvalid('PACKAGE_ROW_NOT_FOUND');
  return { ...row, title: item.data.fields.title, content: item.data.fields.content ?? null };
}
export async function worklogPackageReceiptMatches(
  p: WorklogImportPackage,
  rowId: string,
  companyId: string,
  mappingInput: unknown,
  receiptInput: unknown,
): Promise<boolean> {
  const parsedMapping = zWorklogMapping.safeParse(mappingInput),
    parsedReceipt = zWorklogReceipt.safeParse(receiptInput);
  if (!parsedMapping.success || !parsedReceipt.success) return false;
  const m = parsedMapping.data,
    r = parsedReceipt.data,
    row = p.rows.find((i) => i.rowId === rowId);
  if (!row || row.section !== 'daily') return false;
  const preview = worklogPackageRowPreview(p, rowId),
    e = r.originalEntry,
    h = r.originalHistory;
  return (
    r.id === row.materializeCommandId &&
    r.runId === p.begin.id &&
    r.rowId === row.rowId &&
    r.interpretationId === row.interpretationId &&
    r.mappingHash === (await worklogHash(m)) &&
    m.rowId === row.rowId &&
    m.interpretationId === row.interpretationId &&
    m.entryId === row.entryCandidateId &&
    e.id === row.entryCandidateId &&
    e.companyId === companyId &&
    e.kind === m.kind &&
    e.projectId === m.project?.id &&
    worklogCanonical(e.tagIds) === worklogCanonical(m.tags.map((t) => t.id).sort()) &&
    e.status === m.status &&
    e.title === preview.title &&
    e.content === preview.content &&
    e.plannedDate === row.activityDate &&
    e.dueDate === row.dueDate &&
    e.version === 1 &&
    e.createdAt === r.createdAt &&
    e.updatedAt === r.createdAt &&
    h.id === r.id &&
    h.workEntryId === e.id &&
    h.entryVersion === 1 &&
    h.changeType === 'create' &&
    h.schemaVersion === 2 &&
    h.before === null &&
    h.reason === null &&
    h.changedAt === r.createdAt &&
    worklogCanonical(h.after) ===
      worklogCanonical({
        kind: e.kind,
        projectId: e.projectId,
        tagIds: [...e.tagIds].sort(),
        plannedDate: e.plannedDate,
        dueDate: e.dueDate,
        endDate: e.endDate,
        timeMode: e.timeMode,
        startAt: e.startAt,
        endAt: e.endAt,
        allDay: e.allDay,
        status: e.status,
        completedAt: e.completedAt,
        leave: e.leave,
      }) &&
    e.completedAt === null &&
    e.resumeStatus === null &&
    e.endDate === null &&
    e.timeMode === 'date_only' &&
    e.startAt === null &&
    e.endAt === null &&
    e.allDay === true &&
    e.leave === null &&
    e.mustFinishToday === false &&
    e.sortOrder === 0
  );
}
