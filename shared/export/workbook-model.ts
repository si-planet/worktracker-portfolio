import { canonicalEqual } from './canonical-equal';
import {
  EXPORT_ENTITIES,
  EXPORT_ENTITIES_V2,
  EXPORT_ENTITIES_V3,
  EXPORT_ENTITIES_V4,
  EXPORT_RANGE_DATE_MEANINGS,
  exportEntitySchemasV4,
  EXPORT_UNSUPPORTED_V4,
  EXPORT_UNSUPPORTED_CALENDAR_V4,
  EXPORT_CALENDAR_RECURRENCE_SUPPORT,
  EXPORT_LEAVE_LEDGER_SUPPORT,
  type ExportEntityV4,
  exportEntitySchemasV3,
  EXPORT_UNSUPPORTED_V3,
  EXPORT_RECURRENCE_SUPPORT,
  exportEntitySchemasV2,
  EXPORT_UNSUPPORTED_V2,
  exportEntitySchemas,
  EXPORT_EXCLUSIONS,
  EXPORT_UNSUPPORTED,
  EXPORT_LIMITS,
  ExportError,
  type ExportEntity,
  type ExportContext,
  zExportContext,
} from '../schema/export-dataset';
import {
  canonicalJson,
  compareCodeUnits,
  freezeExport,
  type PreparedExportDataset,
  type PreparedExportDatasetV2,
  type PreparedExportDatasetV3,
  type PreparedExportDatasetV4,
  prepareExportDatasetV4,
  prepareExportDatasetV5,
  type PreparedExportDatasetV5,
  prepareExportDatasetV3,
  prepareExportDatasetV2,
  prepareExportDataset,
} from './dataset';

export type ExportCell = { type: 'string'; value: string } | { type: 'boolean'; value: boolean };
export type ExportSheet = {
  name: string;
  columns: string[];
  rows: ExportCell[][];
  freezeRows: 1;
  autoFilter: boolean;
  wrapText: true;
};
export type WorkbookModel = { projectionVersion: 1; sheets: ExportSheet[] };
export type WorkbookModelV2 = { projectionVersion: 2; sheets: ExportSheet[] };
export type AnyWorkbookModel = WorkbookModel | WorkbookModelV2;
export type WorkbookModelV3 = { projectionVersion: 3; sheets: ExportSheet[] };
export type AnyWorkbookModelV3 = AnyWorkbookModel | WorkbookModelV3;
export type WorkbookModelV4 = { projectionVersion: 4; sheets: ExportSheet[] };
export type AnyWorkbookModelV4 = AnyWorkbookModelV3 | WorkbookModelV4;
export type WorkbookModelV5 = { projectionVersion: 5; sheets: ExportSheet[] };
export type AnyWorkbookModelV5 = AnyWorkbookModelV4 | WorkbookModelV5;
const names: Record<ExportEntity, string> = {
  companies: '회사',
  companyYearSettings: '회사설정',
  projects: '프로젝트',
  workTags: '업무태그정의',
  noteTags: '노트태그정의',
  projectDefaultTags: '기본태그연결',
  companyDayStates: '날짜기준',
  workEntries: '업무',
  leaveEntries: '휴가',
  workEntryChanges: '업무이력',
  workEntryTags: '업무태그연결',
  weeklyPlanEntries: '주차계획',
  weeklyReports: '자동보고헤더',
  weeklyGoals: '주간목표',
  monthlyFocusItems: '월간메모',
  goalPlacements: '목표배치',
  goalWbsSources: 'WBS출처목표',
  wbsPlans: 'WBS계획',
  wbsItems: 'WBS항목',
  wbsScheduleChanges: 'WBS일정이력',
  wbsWorkLinks: 'WBS연결',
  wbsCompletions: 'WBS수동완료',
  periodDocuments: '작성보고메모',
  importOrigins: '업무등록출처',
};
const suffixes = ['', '__type', '__isNull', '__isAbsent', '__contentRef', '__length'] as const;
const previewPaths = [
  'title',
  'kind',
  'status',
  'resumeStatus',
  'plannedDate',
  'dueDate',
  'endDate',
  'timeMode',
  'startAt',
  'endAt',
  'completedAt',
  'sourceEntryId',
  'sourceVersion',
  'counted',
  'completed',
  'project.id',
  'project.code',
  'plannedStartOn',
  'plannedEndOn',
  'hasRevisedSchedule',
  'revisedStartOn',
  'revisedEndOn',
];
export const exportTableMap = freezeExport(
  EXPORT_ENTITIES.map((entity) => ({
    entity,
    sheet: names[entity],
    key: '__key',
    fields: Object.keys(exportEntitySchemas[entity].shape),
    auxiliarySuffixes: [...suffixes.slice(1)],
    displayFields:
      entity === 'workEntries'
        ? ['currentProjectCode', 'currentTagLabels']
        : entity === 'wbsPlans'
          ? ['currentProjectCode']
          : [],
    nestedPreview:
      entity === 'workEntryChanges' || entity === 'wbsScheduleChanges'
        ? ['before', 'after']
        : entity === 'weeklyPlanEntries'
          ? ['storedSnapshot']
          : entity === 'importOrigins'
            ? ['retainedOriginalEntry', 'retainedOriginalHistory']
            : [],
    previewScalarFields: [...previewPaths],
    chunkSheet: '긴본문조각',
    chunkRule: 'UTF16<=30000; LF<=200; preserve CRLF and surrogate pairs; concat ordered parts',
  })),
);
export const exportTableMapV2 = freezeExport([
  ...exportTableMap,
  ...(['notes', 'noteTagLinks'] as const).map((entity) => ({
    entity,
    sheet: entity === 'notes' ? '업무노트' : '노트태그연결',
    key: '__key',
    fields: Object.keys(exportEntitySchemasV2[entity].shape),
    auxiliarySuffixes: [...suffixes.slice(1)],
    displayFields: [],
    nestedPreview: [],
    previewScalarFields: [...previewPaths],
    chunkSheet: '긴본문조각',
    chunkRule: 'UTF16<=30000; LF<=200; preserve CRLF and surrogate pairs; concat ordered parts',
  })),
]);
const recurrenceSheets = {
  recurrenceRules: '반복규칙',
  recurrenceRuleRevisions: '반복개정',
  recurrenceRuleTags: '반복태그연결',
  recurrenceOccurrences: '반복회차',
  recurrenceGeneratedRanges: '반복생성범위',
  recurrenceCommands: '반복명령',
} as const;
export const exportTableMapV3 = freezeExport([
  ...exportTableMapV2,
  ...(Object.keys(recurrenceSheets) as (keyof typeof recurrenceSheets)[]).map((entity) => ({
    entity,
    sheet: recurrenceSheets[entity],
    key: '__key',
    fields: Object.keys(exportEntitySchemasV3[entity].shape),
    auxiliarySuffixes: [...suffixes.slice(1)],
    displayFields: [],
    nestedPreview: [],
    previewScalarFields: [...previewPaths],
    chunkSheet: '긴본문조각',
    chunkRule: 'UTF16<=30000; LF<=200; preserve CRLF and surrogate pairs; concat ordered parts',
  })),
]);
const ledgerSheets = {
  leaveLedgerStates: '연차장부설정',
  leavePolicies: '연차차감정책',
  leaveGrants: '연차부여',
  leaveLedgerCutovers: '연차전환기록',
  leaveEntryAccounting: '휴가장부연결',
  leaveAllocations: '연차배분',
  leaveLedgerCommands: '연차명령',
} as const;
export const exportTableMapV4 = freezeExport([
  ...exportTableMapV3,
  ...(Object.keys(ledgerSheets) as (keyof typeof ledgerSheets)[]).map((entity) => ({
    entity,
    sheet: ledgerSheets[entity],
    key: '__key',
    fields:
      entity === 'leaveLedgerCommands'
        ? ['id', 'companyId', 'kind', 'request', 'result', 'createdAt']
        : Object.keys(exportEntitySchemasV4[entity].shape),
    auxiliarySuffixes: [...suffixes.slice(1)],
    displayFields: [],
    nestedPreview: [],
    previewScalarFields: [...previewPaths],
    chunkSheet: '긴본문조각',
    chunkRule: 'UTF16<=30000; LF<=200; preserve CRLF and surrogate pairs; concat ordered parts',
  })),
]);
export function assertExcelText(text: string): void {
  // XML 1.0 plus Excel's text restrictions. Do not silently replace invalid input.
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    if ((c < 32 && c !== 9 && c !== 10 && c !== 13) || c === 0xfffe || c === 0xffff)
      throw new ExportError('XLSX_UNREPRESENTABLE_TEXT');
    if (c >= 0xd800 && c <= 0xdbff) {
      const n = text.charCodeAt(++i);
      if (!(n >= 0xdc00 && n <= 0xdfff)) throw new ExportError('XLSX_UNREPRESENTABLE_TEXT');
    } else if (c >= 0xdc00 && c <= 0xdfff) throw new ExportError('XLSX_UNREPRESENTABLE_TEXT');
  }
}
export function splitExportText(text: string): string[] {
  assertExcelText(text);
  const result: string[] = [];
  let start = 0,
    length = 0,
    lines = 0;
  for (let i = 0; i < text.length;) {
    const c = text.charCodeAt(i),
      width = (c >= 0xd800 && c <= 0xdbff) || (c === 13 && text.charCodeAt(i + 1) === 10) ? 2 : 1;
    const lf = text.slice(i, i + width).includes('\n') ? 1 : 0;
    if (length + width > 30000 || lines + lf > 200) {
      result.push(text.slice(start, i));
      start = i;
      length = 0;
      lines = 0;
    }
    i += width;
    length += width;
    lines += lf;
  }
  result.push(text.slice(start));
  return result;
}
export type ExportManifest = ReturnType<typeof createExportManifest>;
export function createExportManifest(
  p: PreparedExportDataset,
  context: ExportContext,
  datasetDigest: string,
) {
  return {
    formatVersion: 1 as const,
    projectionVersion: 1 as const,
    scopeVersion: 1 as const,
    exportId: context.exportId,
    snapshotAt: p.dataset.snapshotAt,
    requestedAt: context.requestedAt,
    generatedAt: context.generatedAt,
    scope: {
      companyId: p.dataset.scope.companyId,
      companyName: p.dataset.data.companies[0]!.name,
      period: 'all' as const,
    },
    timeZone: 'Asia/Seoul' as const,
    weekStartsOn: 1 as const,
    appRevision: context.appRevision,
    schemaFamilies: p.dataset.schemaFamilies,
    planningCoverageSinceAt: p.dataset.planningCoverageSinceAt,
    entityCounts: p.entityCounts,
    relationCounts: p.relationCounts,
    tableMap: exportTableMap,
    exclusions: [...EXPORT_EXCLUSIONS],
    unsupportedFeatures: [...EXPORT_UNSUPPORTED],
    datasetDigest,
    conventions: {
      order: 'entity registry, row logical key, object keys: UTF16 code units',
      integer: 'safe integer; Excel exact text',
      null: 'explicit null; Excel __isNull',
      absent: 'no field; Excel __isAbsent',
      relationships: 'derived auxiliary edges; entity counts separate',
      privacy: 'private personal file; not public portfolio; not application restore',
    },
  };
}
export function createExportManifestV2(
  p: PreparedExportDatasetV2,
  context: ExportContext,
  datasetDigest: string,
) {
  return {
    formatVersion: 2 as const,
    projectionVersion: 2 as const,
    scopeVersion: 1 as const,
    exportId: context.exportId,
    snapshotAt: p.dataset.snapshotAt,
    requestedAt: context.requestedAt,
    generatedAt: context.generatedAt,
    scope: {
      companyId: p.dataset.scope.companyId,
      companyName: p.dataset.data.companies[0]!.name,
      period: 'all' as const,
    },
    timeZone: 'Asia/Seoul' as const,
    weekStartsOn: 1 as const,
    appRevision: context.appRevision,
    schemaFamilies: p.dataset.schemaFamilies,
    planningCoverageSinceAt: p.dataset.planningCoverageSinceAt,
    entityCounts: p.entityCounts,
    relationCounts: p.relationCounts,
    tableMap: exportTableMapV2,
    exclusions: [...EXPORT_EXCLUSIONS],
    unsupportedFeatures: [...EXPORT_UNSUPPORTED_V2],
    datasetDigest,
    conventions: {
      order: 'entity registry, row logical key, object keys: UTF16 code units',
      integer: 'safe integer; Excel exact text',
      null: 'explicit null; Excel __isNull',
      absent: 'no field; Excel __isAbsent',
      relationships: 'derived auxiliary edges; entity counts separate',
      privacy: 'private personal file; not public portfolio; not application restore',
    },
  };
}
export type ExportManifestV2 = ReturnType<typeof createExportManifestV2>;
export function createExportManifestV3(
  p: PreparedExportDatasetV3,
  context: ExportContext,
  datasetDigest: string,
) {
  return {
    formatVersion: 3 as const,
    projectionVersion: 3 as const,
    scopeVersion: 1 as const,
    exportId: context.exportId,
    snapshotAt: p.dataset.snapshotAt,
    requestedAt: context.requestedAt,
    generatedAt: context.generatedAt,
    scope: {
      companyId: p.dataset.scope.companyId,
      companyName: p.dataset.data.companies[0]!.name,
      period: 'all' as const,
    },
    timeZone: 'Asia/Seoul' as const,
    weekStartsOn: 1 as const,
    appRevision: context.appRevision,
    schemaFamilies: p.dataset.schemaFamilies,
    planningCoverageSinceAt: p.dataset.planningCoverageSinceAt,
    entityCounts: p.entityCounts,
    relationCounts: p.relationCounts,
    tableMap: exportTableMapV3,
    exclusions: [...EXPORT_EXCLUSIONS],
    unsupportedFeatures: [...EXPORT_UNSUPPORTED_V3],
    recurrenceSupport: EXPORT_RECURRENCE_SUPPORT,
    datasetDigest,
    conventions: {
      order: 'entity registry, row logical key, object keys: UTF16 code units',
      integer: 'safe integer; Excel exact text',
      null: 'explicit null; Excel __isNull',
      absent: 'no field; Excel __isAbsent',
      relationships: 'derived auxiliary edges; entity counts separate',
      privacy: 'private personal file; not public portfolio; not application restore',
    },
  };
}
export type ExportManifestV3 = ReturnType<typeof createExportManifestV3>;
export function createExportManifestV4(
  p: PreparedExportDatasetV4,
  context: ExportContext,
  datasetDigest: string,
) {
  return {
    formatVersion: 4 as const,
    projectionVersion: 4 as const,
    scopeVersion: 1 as const,
    exportId: context.exportId,
    snapshotAt: p.dataset.snapshotAt,
    requestedAt: context.requestedAt,
    generatedAt: context.generatedAt,
    scope: {
      companyId: p.dataset.scope.companyId,
      companyName: p.dataset.data.companies[0]!.name,
      period: 'all' as const,
    },
    timeZone: 'Asia/Seoul' as const,
    weekStartsOn: 1 as const,
    appRevision: context.appRevision,
    schemaFamilies: p.dataset.schemaFamilies,
    planningCoverageSinceAt: p.dataset.planningCoverageSinceAt,
    entityCounts: p.entityCounts,
    relationCounts: p.relationCounts,
    tableMap: exportTableMapV4,
    exclusions: [...EXPORT_EXCLUSIONS],
    unsupportedFeatures: [
      ...(p.dataset.schemaFamilies.includes('0012')
        ? EXPORT_UNSUPPORTED_CALENDAR_V4
        : EXPORT_UNSUPPORTED_V4),
    ],
    recurrenceSupport: p.dataset.schemaFamilies.includes('0012')
      ? EXPORT_CALENDAR_RECURRENCE_SUPPORT
      : EXPORT_RECURRENCE_SUPPORT,
    leaveLedgerSupport: EXPORT_LEAVE_LEDGER_SUPPORT,
    datasetDigest,
    conventions: {
      order: 'entity registry, row logical key, object keys: UTF16 code units',
      integer: 'safe integer; Excel exact text',
      null: 'explicit null; Excel __isNull',
      absent: 'no field; Excel __isAbsent',
      relationships: 'derived auxiliary edges; entity counts separate',
      privacy: 'private personal file; not public portfolio; not application restore',
    },
  };
}
export type ExportManifestV4 = ReturnType<typeof createExportManifestV4>;
export const exportTableMapV5 = exportTableMapV4;
export function createExportManifestV5(
  p: PreparedExportDatasetV5,
  context: ExportContext,
  datasetDigest: string,
) {
  return {
    formatVersion: 5 as const,
    projectionVersion: 5 as const,
    scopeVersion: 2 as const,
    exportId: context.exportId,
    snapshotAt: p.dataset.snapshotAt,
    requestedAt: context.requestedAt,
    generatedAt: context.generatedAt,
    scope: {
      ...p.dataset.scope,
      companyName: p.dataset.data.companies[0]!.name,
    },
    selection: {
      profileVersion: 1 as const,
      timeZone: 'Asia/Seoul' as const,
      ...p.realizedScope,
      dateMeanings: EXPORT_RANGE_DATE_MEANINGS,
    },
    timeZone: 'Asia/Seoul' as const,
    weekStartsOn: 1 as const,
    appRevision: context.appRevision,
    schemaFamilies: p.dataset.schemaFamilies,
    planningCoverageSinceAt: p.dataset.planningCoverageSinceAt,
    entityCounts: p.entityCounts,
    relationCounts: p.relationCounts,
    tableMap: exportTableMapV5,
    exclusions: [...EXPORT_EXCLUSIONS],
    unsupportedFeatures: [
      ...(p.dataset.schemaFamilies.includes('0012')
        ? EXPORT_UNSUPPORTED_CALENDAR_V4
        : EXPORT_UNSUPPORTED_V4),
    ],
    recurrenceSupport: p.dataset.schemaFamilies.includes('0012')
      ? EXPORT_CALENDAR_RECURRENCE_SUPPORT
      : EXPORT_RECURRENCE_SUPPORT,
    leaveLedgerSupport: EXPORT_LEAVE_LEDGER_SUPPORT,
    datasetDigest,
    conventions: {
      order: 'entity registry, row logical key, object keys: UTF16 code units',
      integer: 'safe integer; Excel exact text',
      null: 'explicit null; Excel __isNull',
      absent: 'no field; Excel __isAbsent',
      relationships: 'derived auxiliary edges; entity counts separate',
      privacy: 'private personal file; not public portfolio; not application restore',
    },
  };
}
export type ExportManifestV5 = ReturnType<typeof createExportManifestV5>;
function str(value: string): ExportCell {
  assertExcelText(value);
  return { type: 'string', value };
}
function bool(value: boolean): ExportCell {
  return { type: 'boolean', value };
}
/** Fixed top-level business fields plus human-readable nested scalar previews. */

function buildModel(
  p:
    | PreparedExportDataset
    | PreparedExportDatasetV2
    | PreparedExportDatasetV3
    | PreparedExportDatasetV4
    | PreparedExportDatasetV5,
  manifest:
    ExportManifest | ExportManifestV2 | ExportManifestV3 | ExportManifestV4 | ExportManifestV5,
): AnyWorkbookModelV5 {
  if (
    p.dataset.formatVersion !== manifest.projectionVersion ||
    manifest.formatVersion !== manifest.projectionVersion
  )
    throw new ExportError('PAIR_MISMATCH');
  const tableMap =
    manifest.projectionVersion >= 4
      ? exportTableMapV4
      : manifest.projectionVersion === 3
        ? exportTableMapV3
        : manifest.projectionVersion === 2
          ? exportTableMapV2
          : exportTableMap;
  const chunks: ExportCell[][] = [];
  let allocatedCells = 0;
  function charge(n: number) {
    allocatedCells += n;
    if (allocatedCells > EXPORT_LIMITS.physicalCells)
      throw new ExportError('EXPORT_LIMIT_EXCEEDED', 'physicalCells');
  }
  function cells(entity: string, key: string, path: string, value: unknown): ExportCell[] {
    charge(6);
    const type =
      value === undefined
        ? 'absent'
        : value === null
          ? 'null'
          : typeof value === 'object'
            ? 'json'
            : typeof value === 'number'
              ? 'integer'
              : typeof value;
    const text =
      value === undefined || value === null
        ? ''
        : typeof value === 'object'
          ? canonicalJson(value)
          : String(value);
    const parts = splitExportText(text);
    const ref = parts.length > 1 ? canonicalJson([entity, key, path]) : '';
    if (ref)
      for (const [i, part] of parts.entries()) {
        charge(7);
        chunks.push([
          str(ref),
          str(entity),
          str(key),
          str(path),
          str(String(i)),
          str(String(parts.length)),
          str(part),
        ]);
      }
    return [
      str(ref ? '' : text),
      str(type),
      bool(value === null),
      bool(value === undefined),
      str(ref),
      str(String(text.length)),
    ];
  }
  const guide: ExportSheet = {
    name: '안내',
    columns: [
      '항목',
      '값',
      '값__type',
      '값__isNull',
      '값__isAbsent',
      '값__contentRef',
      '값__length',
    ],
    rows: Object.keys(manifest)
      .sort(compareCodeUnits)
      .map((k) => [
        str(k),
        ...cells('manifest', 'manifest', k, manifest[k as keyof ExportManifest]),
      ]),
    freezeRows: 1,
    autoFilter: false,
    wrapText: true,
  };
  const sheets: ExportSheet[] = [guide];
  for (const t of tableMap) {
    const fields = [
      ...t.fields,
      ...t.displayFields,
      ...t.nestedPreview.flatMap((n) => previewPaths.map((path) => n + '.' + path)),
    ];
    const rows = (
      (p.dataset.data as PreparedExportDatasetV4['dataset']['data'])[t.entity] as unknown as Record<
        string,
        unknown
      >[]
    ).map((r) => {
      // Keys are computed from the prepared row, never positional identity.
      const key = exportRowKeyForModel(t.entity, r);
      charge(1);
      const row: ExportCell[] = [str(key)];
      for (const field of fields) {
        let value: unknown = r;
        for (const part of field.split('.'))
          value =
            value && typeof value === 'object'
              ? (value as Record<string, unknown>)[part]
              : undefined;
        if (field === 'currentProjectCode')
          value = p.dataset.data.projects.find((p) => p.id === r.projectId)?.code ?? null;
        if (field === 'currentTagLabels')
          value = p.dataset.data.workEntryTags
            .filter((x) => x.workEntryId === r.id)
            .map((x) => ({
              id: x.workTagId,
              label: p.dataset.data.workTags.find((t) => t.id === x.workTagId)!.label,
            }));
        row.push(...cells(t.entity, key, field, value));
      }
      return row;
    });
    sheets.push({
      name: t.sheet,
      columns: ['__key', ...fields.flatMap((f) => suffixes.map((s) => f + s))],
      rows,
      freezeRows: 1,
      autoFilter: true,
      wrapText: true,
    });
  }
  charge(p.relationships.length * 8);
  const relKeys = [
    'key',
    'relationType',
    'fromEntity',
    'fromId',
    'toEntity',
    'toId',
    'presence',
    'provenance',
  ] as const;
  sheets.push({
    name: '관계',
    columns: [...relKeys],
    rows: p.relationships.map((r) => relKeys.map((k) => str(r[k]))),
    freezeRows: 1,
    autoFilter: true,
    wrapText: true,
  });
  sheets.push({
    name: '긴본문조각',
    columns: ['contentRef', 'entity', 'key', 'fieldPath', 'partIndex', 'partCount', 'text'],
    rows: chunks,
    freezeRows: 1,
    autoFilter: true,
    wrapText: true,
  });
  if (manifest.projectionVersion === 5) {
    const range = p as PreparedExportDatasetV5;
    sheets.push({
      name: '범위포함근거',
      columns: ['entity', 'logicalRowKey', 'isPrimary', 'primaryReasons', 'supportReasons'],
      rows: range.dataset.selection.rows.map((r) => [
        str(r.entity),
        str(r.logicalRowKey),
        bool(r.isPrimary),
        str(canonicalJson(r.primaryReasons)),
        str(canonicalJson(r.supportReasons)),
      ]),
      freezeRows: 1,
      autoFilter: true,
      wrapText: true,
    });
  }
  let count = 0;
  for (const sheet of sheets) {
    if (
      sheet.name.length > 31 ||
      /[\\/?*[\]:]/.test(sheet.name) ||
      sheet.columns.length > 16384 ||
      sheet.rows.length + 1 > 1048576
    )
      throw new ExportError('EXPORT_LIMIT_EXCEEDED', 'physicalCells');
    count += (sheet.rows.length + 1) * sheet.columns.length;
    if (sheet.rows.some((r) => r.length !== sheet.columns.length))
      throw new ExportError('PAIR_MISMATCH');
  }
  if (count > EXPORT_LIMITS.physicalCells)
    throw new ExportError('EXPORT_LIMIT_EXCEEDED', 'physicalCells');
  return freezeExport({ projectionVersion: manifest.projectionVersion, sheets });
}
import { exportRowKey as exportRowKeyForModel } from './dataset';
/** Adapter-independent reverse projection: checks chunks, markers, keys, previews and full sheet shape. */
export function buildWorkbookModel(
  p: PreparedExportDataset,
  manifest: ExportManifest,
): WorkbookModel {
  return buildModel(p, manifest) as WorkbookModel;
}
export function buildWorkbookModelV2(
  p: PreparedExportDatasetV2,
  manifest: ExportManifestV2,
): WorkbookModelV2 {
  return buildModel(p, manifest) as WorkbookModelV2;
}
function reverseModel(model: AnyWorkbookModelV5) {
  const v2 = model.projectionVersion >= 2,
    registry =
      model.projectionVersion >= 4
        ? EXPORT_ENTITIES_V4
        : model.projectionVersion === 3
          ? EXPORT_ENTITIES_V3
          : v2
            ? EXPORT_ENTITIES_V2
            : EXPORT_ENTITIES,
    tableMap =
      model.projectionVersion >= 4
        ? exportTableMapV4
        : model.projectionVersion === 3
          ? exportTableMapV3
          : v2
            ? exportTableMapV2
            : exportTableMap;
  try {
    if (
      ![1, 2, 3, 4, 5].includes(model.projectionVersion) ||
      model.sheets.length !== registry.length + (model.projectionVersion === 5 ? 4 : 3)
    )
      throw new ExportError('PAIR_MISMATCH');
    const namesSeen = model.sheets.map((s) => s.name);
    if (new Set(namesSeen).size !== namesSeen.length) throw new ExportError('PAIR_MISMATCH');
    const sheet = (name: string) => {
      const s = model.sheets.find((s) => s.name === name);
      if (!s) throw new ExportError('PAIR_MISMATCH');
      return s;
    };
    const refs = new Map<
      string,
      { entity: string; key: string; field: string; parts: string[]; count: number }
    >();
    for (const row of sheet('긴본문조각').rows) {
      if (row.length !== 7 || row.some((c) => c.type !== 'string'))
        throw new ExportError('PAIR_MISMATCH');
      const [ref, entity, key, field, indexText, countText, part] = row.map((c) =>
        String(c.value),
      ) as [string, string, string, string, string, string, string];
      const index = Number(indexText),
        count = Number(countText);
      if (
        !Number.isSafeInteger(index) ||
        !Number.isSafeInteger(count) ||
        index < 0 ||
        count < 2 ||
        index >= count ||
        String(index) !== indexText ||
        String(count) !== countText ||
        part.length > 30000 ||
        (part.match(/\n/g)?.length ?? 0) > 200
      )
        throw new ExportError('PAIR_MISMATCH');
      assertExcelText(part);
      const group = refs.get(ref) ?? { entity, key, field, parts: [], count };
      if (
        group.entity !== entity ||
        group.key !== key ||
        group.field !== field ||
        group.count !== count ||
        group.parts[index] !== undefined ||
        ref !== canonicalJson([entity, key, field])
      )
        throw new ExportError('PAIR_MISMATCH');
      group.parts[index] = part;
      refs.set(ref, group);
    }
    const consumed = new Set<string>();
    function value(c: ExportCell[], entity: string, key: string, field: string): unknown {
      if (
        c.length !== 6 ||
        c[0]?.type !== 'string' ||
        c[1]?.type !== 'string' ||
        c[2]?.type !== 'boolean' ||
        c[3]?.type !== 'boolean' ||
        c[4]?.type !== 'string' ||
        c[5]?.type !== 'string'
      )
        throw new ExportError('PAIR_MISMATCH');
      let text = c[0].value;
      const type = c[1].value,
        ref = c[4].value;
      if (ref) {
        const g = refs.get(ref);
        if (
          !g ||
          g.entity !== entity ||
          g.key !== key ||
          g.field !== field ||
          g.parts.filter(() => true).length !== g.count ||
          text !== '' ||
          consumed.has(ref)
        )
          throw new ExportError('PAIR_MISMATCH');
        text = g.parts.join('');
        consumed.add(ref);
      }
      if (
        String(text.length) !== c[5].value ||
        c[2].value !== (type === 'null') ||
        c[3].value !== (type === 'absent')
      )
        throw new ExportError('PAIR_MISMATCH');
      if (type === 'null' || type === 'absent') {
        if (text !== '') throw new ExportError('PAIR_MISMATCH');
        return type === 'null' ? null : undefined;
      }
      if (type === 'string') return text;
      if (type === 'boolean') {
        if (text !== 'true' && text !== 'false') throw new ExportError('PAIR_MISMATCH');
        return text === 'true';
      }
      if (type === 'integer') {
        const n = Number(text);
        if (!Number.isSafeInteger(n) || String(n) !== text) throw new ExportError('PAIR_MISMATCH');
        return n;
      }
      if (type === 'json') {
        const v: unknown = JSON.parse(text);
        if (canonicalJson(v) !== text) throw new ExportError('PAIR_MISMATCH');
        return v;
      }
      throw new ExportError('PAIR_MISMATCH');
    }
    const manifest: Record<string, unknown> = {};
    for (const row of sheet('안내').rows) {
      const k = row[0];
      if (k?.type !== 'string' || Object.hasOwn(manifest, k.value))
        throw new ExportError('PAIR_MISMATCH');
      manifest[k.value] = value(row.slice(1), 'manifest', 'manifest', k.value);
    }
    const data = {} as Record<ExportEntityV4, Record<string, unknown>[]>;
    for (const t of tableMap) {
      data[t.entity] = sheet(t.sheet).rows.map((row) => {
        const key = row[0];
        if (key?.type !== 'string') throw new ExportError('PAIR_MISMATCH');
        const r: Record<string, unknown> = {};
        for (const [i, f] of t.fields.entries()) {
          const v = value(row.slice(1 + i * 6, 7 + i * 6), t.entity, key.value, f);
          if (v !== undefined) r[f] = v;
        }
        return r;
      });
    }
    // Preview/chunk rows are checked by rebuilding the exact model in validateWorkbookModel.
    const relationships = sheet('관계').rows.map((row) => {
      const r: Record<string, string> = {};
      for (const [i, k] of [
        'key',
        'relationType',
        'fromEntity',
        'fromId',
        'toEntity',
        'toId',
        'presence',
        'provenance',
      ].entries()) {
        const c = row[i];
        if (c?.type !== 'string') throw new ExportError('PAIR_MISMATCH');
        r[k] = c.value;
      }
      return r;
    });
    const m = manifest as
      ExportManifest | ExportManifestV2 | ExportManifestV3 | ExportManifestV4 | ExportManifestV5;
    const p = (
      model.projectionVersion === 5
        ? prepareExportDatasetV5
        : model.projectionVersion === 4
          ? prepareExportDatasetV4
          : model.projectionVersion === 3
            ? prepareExportDatasetV3
            : v2
              ? prepareExportDatasetV2
              : prepareExportDataset
    )({
      formatVersion: model.projectionVersion,
      scope:
        model.projectionVersion === 5
          ? Object.fromEntries(
              Object.entries((m as ExportManifestV5).scope).filter(
                ([key]) => key !== 'companyName',
              ),
            )
          : { companyId: m.scope.companyId, period: m.scope.period, scopeVersion: 1 },
      snapshotAt: m.snapshotAt,
      planningCoverageSinceAt: m.planningCoverageSinceAt,
      schemaFamilies: m.schemaFamilies,
      ...(model.projectionVersion === 5
        ? {
            selection: {
              profileVersion: 1,
              timeZone: 'Asia/Seoul',
              rows: sheet('범위포함근거').rows.map((row) => {
                if (
                  row.length !== 5 ||
                  row[0]?.type !== 'string' ||
                  row[1]?.type !== 'string' ||
                  row[2]?.type !== 'boolean' ||
                  row[3]?.type !== 'string' ||
                  row[4]?.type !== 'string'
                )
                  throw new ExportError('PAIR_MISMATCH');
                return {
                  entity: row[0].value,
                  logicalRowKey: row[1].value,
                  isPrimary: row[2].value,
                  primaryReasons: JSON.parse(row[3].value),
                  supportReasons: JSON.parse(row[4].value),
                };
              }),
            },
          }
        : {}),
      data,
    });
    const c = zExportContext.parse({
      exportId: m.exportId,
      requestedAt: m.requestedAt,
      generatedAt: m.generatedAt,
      appRevision: m.appRevision,
    });
    if (!/^[a-f0-9]{64}$/.test(m.datasetDigest)) throw new ExportError('PAIR_MISMATCH');
    const expected =
      model.projectionVersion === 5
        ? buildWorkbookModelV5(
            p as PreparedExportDatasetV5,
            createExportManifestV5(p as PreparedExportDatasetV5, c, m.datasetDigest),
          )
        : model.projectionVersion === 4
          ? buildWorkbookModelV4(
              p as PreparedExportDatasetV4,
              createExportManifestV4(p as PreparedExportDatasetV4, c, m.datasetDigest),
            )
          : model.projectionVersion === 3
            ? buildWorkbookModelV3(
                p as PreparedExportDatasetV3,
                createExportManifestV3(p as PreparedExportDatasetV3, c, m.datasetDigest),
              )
            : v2
              ? buildWorkbookModelV2(
                  p as PreparedExportDatasetV2,
                  createExportManifestV2(p as PreparedExportDatasetV2, c, m.datasetDigest),
                )
              : buildWorkbookModel(
                  p as PreparedExportDataset,
                  createExportManifest(p as PreparedExportDataset, c, m.datasetDigest),
                );
    if (!canonicalEqual(expected, model)) throw new ExportError('PAIR_MISMATCH');
    return {
      manifest: m,
      data: p.dataset.data,
      ...(model.projectionVersion === 5
        ? { selection: (p as PreparedExportDatasetV5).dataset.selection }
        : {}),
      relationships: relationships as PreparedExportDatasetV3['relationships'],
    };
  } catch {
    throw new ExportError('PAIR_MISMATCH');
  }
}
export function reverseWorkbookModel(model: WorkbookModel): {
  manifest: ExportManifest;
  data: PreparedExportDataset['dataset']['data'];
  relationships: PreparedExportDataset['relationships'];
} {
  if (model.projectionVersion !== 1) throw new ExportError('PAIR_MISMATCH');
  return reverseModel(model) as {
    manifest: ExportManifest;
    data: PreparedExportDataset['dataset']['data'];
    relationships: PreparedExportDataset['relationships'];
  };
}
export function reverseWorkbookModelV2(model: WorkbookModelV2): {
  manifest: ExportManifestV2;
  data: PreparedExportDatasetV2['dataset']['data'];
  relationships: PreparedExportDatasetV2['relationships'];
} {
  if (model.projectionVersion !== 2) throw new ExportError('PAIR_MISMATCH');
  return reverseModel(model) as {
    manifest: ExportManifestV2;
    data: PreparedExportDatasetV2['dataset']['data'];
    relationships: PreparedExportDatasetV2['relationships'];
  };
}
export function validateWorkbookModel(actual: WorkbookModel, expected: WorkbookModel): void {
  if (!canonicalEqual(actual, expected)) throw new ExportError('PAIR_MISMATCH');
  reverseWorkbookModel(actual);
}

export function validateWorkbookModelV2(actual: WorkbookModelV2, expected: WorkbookModelV2): void {
  if (!canonicalEqual(actual, expected)) throw new ExportError('PAIR_MISMATCH');
  reverseWorkbookModelV2(actual);
}

export function buildWorkbookModelV3(
  p: PreparedExportDatasetV3,
  manifest: ExportManifestV3,
): WorkbookModelV3 {
  return buildModel(p, manifest) as WorkbookModelV3;
}
export function reverseWorkbookModelV3(model: WorkbookModelV3): {
  manifest: ExportManifestV3;
  data: PreparedExportDatasetV3['dataset']['data'];
  relationships: PreparedExportDatasetV3['relationships'];
} {
  if (model.projectionVersion !== 3) throw new ExportError('PAIR_MISMATCH');
  return reverseModel(model) as {
    manifest: ExportManifestV3;
    data: PreparedExportDatasetV3['dataset']['data'];
    relationships: PreparedExportDatasetV3['relationships'];
  };
}
export function validateWorkbookModelV3(actual: WorkbookModelV3, expected: WorkbookModelV3): void {
  if (!canonicalEqual(actual, expected)) throw new ExportError('PAIR_MISMATCH');
  reverseWorkbookModelV3(actual);
}

export function buildWorkbookModelV4(
  p: PreparedExportDatasetV4,
  manifest: ExportManifestV4,
): WorkbookModelV4 {
  return buildModel(p, manifest) as WorkbookModelV4;
}
export function reverseWorkbookModelV4(model: WorkbookModelV4): {
  manifest: ExportManifestV4;
  data: PreparedExportDatasetV4['dataset']['data'];
  relationships: PreparedExportDatasetV4['relationships'];
} {
  if (model.projectionVersion !== 4) throw new ExportError('PAIR_MISMATCH');
  return reverseModel(model) as {
    manifest: ExportManifestV4;
    data: PreparedExportDatasetV4['dataset']['data'];
    relationships: PreparedExportDatasetV4['relationships'];
  };
}
export function validateWorkbookModelV4(actual: WorkbookModelV4, expected: WorkbookModelV4): void {
  if (!canonicalEqual(actual, expected)) throw new ExportError('PAIR_MISMATCH');
  reverseWorkbookModelV4(actual);
}

export function buildWorkbookModelV5(
  p: PreparedExportDatasetV5,
  manifest: ExportManifestV5,
): WorkbookModelV5 {
  return buildModel(p, manifest) as WorkbookModelV5;
}
export function reverseWorkbookModelV5(model: WorkbookModelV5): {
  manifest: ExportManifestV5;
  data: PreparedExportDatasetV5['dataset']['data'];
  selection: PreparedExportDatasetV5['dataset']['selection'];
  relationships: PreparedExportDatasetV5['relationships'];
} {
  if (model.projectionVersion !== 5) throw new ExportError('PAIR_MISMATCH');
  return reverseModel(model) as ReturnType<typeof reverseWorkbookModelV5>;
}
export function validateWorkbookModelV5(actual: WorkbookModelV5, expected: WorkbookModelV5): void {
  reverseWorkbookModelV5(actual);
  if (!canonicalEqual(actual, expected)) throw new ExportError('PAIR_MISMATCH');
}
