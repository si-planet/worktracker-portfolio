import { canonicalEqual } from './canonical-equal';
import {
  ExportError,
  EXPORT_LIMITS,
  zExportContext,
  type ExportContext,
} from '../schema/export-dataset';
import { canonicalJson, freezeExport, type PreparedExportDatasetV5 } from './dataset';
import { prepareExportDatasetV6, type PreparedExportDatasetV6 } from './v6-dataset';
import {
  buildWorkbookModelV4,
  buildWorkbookModelV5,
  createExportManifestV4,
  createExportManifestV5,
  reverseWorkbookModelV4,
  reverseWorkbookModelV5,
  splitExportText,
  type ExportSheet,
} from './workbook-model';
import type { PreparedExportDatasetV4 } from './dataset';

function baseManifest(p: PreparedExportDatasetV6, context: ExportContext, digest: string) {
  return p.base.dataset.formatVersion === 4
    ? createExportManifestV4(p.base as PreparedExportDatasetV4, context, digest)
    : createExportManifestV5(p.base as PreparedExportDatasetV5, context, digest);
}
export function createExportManifestV6(
  p: PreparedExportDatasetV6,
  context: ExportContext,
  digest: string,
  baseDigest: string,
) {
  const base = baseManifest(p, context, baseDigest);
  return freezeExport({
    ...base,
    formatVersion: 6 as const,
    projectionVersion: 6 as const,
    baseFormatVersion: base.formatVersion,
    baseDatasetDigest: baseDigest,
    datasetDigest: digest,
    schemaFamilies: p.dataset.schemaFamilies,
    provenanceScope: p.dataset.provenance.scope,
    provenanceCounts: {
      recoveries: p.dataset.provenance.recoveries.length,
      sourceClaims: p.dataset.provenance.sourceClaims.length,
    },
    entityCounts: {
      ...base.entityCounts,
      confirmedRecoveries: p.dataset.provenance.recoveries.length,
      confirmedSourceClaims: p.dataset.provenance.sourceClaims.length,
    },
    sheetCount: base.formatVersion === 4 ? 45 : 46,
    selection: base.formatVersion === 5 ? base.selection : null,
    provenanceConventions: {
      coverage: 'whole-company immutable provenance, including records outside a range base',
      sourceProof:
        'retained source rows verified by owner and payload hash; raw graph remains in separate SQL archive',
      requestHash: 'original owner-bound request hash; actor identity projected as self',
      references: 'historical target pointers; outsideSelectedBase is not a live foreign key',
    },
  });
}
export type ExportManifestV6 = ReturnType<typeof createExportManifestV6>;
export type WorkbookModelV6 = { projectionVersion: 6; sheets: ExportSheet[] };
export function exportPayloadV6(p: PreparedExportDatasetV6, manifest: ExportManifestV6) {
  const context = contextOf(manifest);
  const base = baseManifest(p, context, manifest.baseDatasetDigest);
  return {
    manifest,
    base: {
      manifest: base,
      data: p.base.dataset.data,
      ...(p.base.dataset.formatVersion === 5 ? { selection: p.base.dataset.selection } : {}),
      relationships: p.base.relationships,
    },
    provenance: p.dataset.provenance,
    references: p.references,
  };
}
function contextOf(manifest: ExportManifestV6): ExportContext {
  return zExportContext.parse({
    exportId: manifest.exportId,
    requestedAt: manifest.requestedAt,
    generatedAt: manifest.generatedAt,
    appRevision: manifest.appRevision,
  });
}
const sheetNames = ['V6보관안내', '확인복구원장', '확인원문출처'] as const;
const columns = ['key', 'partIndex', 'partCount', 'canonicalJson'] as const;
function chunkSheet(name: string, rows: { key: string; value: unknown }[]): ExportSheet {
  return {
    name,
    columns: [...columns],
    freezeRows: 1,
    autoFilter: true,
    wrapText: true,
    rows: rows.flatMap(({ key, value }) => {
      const parts = splitExportText(canonicalJson(value));
      return parts.map((part, index) =>
        [key, String(index), String(parts.length), part].map((value) => ({
          type: 'string' as const,
          value,
        })),
      );
    }),
  };
}
function provenanceSheets(p: PreparedExportDatasetV6, manifest: ExportManifestV6): ExportSheet[] {
  return [
    chunkSheet(sheetNames[0], [{ key: 'manifest', value: manifest }]),
    chunkSheet(
      sheetNames[1],
      p.dataset.provenance.recoveries.map((row) => ({ key: row.id, value: row })),
    ),
    chunkSheet(
      sheetNames[2],
      p.dataset.provenance.sourceClaims.map((row) => ({
        key: canonicalJson([row.sourceSha256, row.sourceRecordId]),
        value: row,
      })),
    ),
  ];
}
export function buildWorkbookModelV6(
  p: PreparedExportDatasetV6,
  manifest: ExportManifestV6,
): WorkbookModelV6 {
  const context = contextOf(manifest),
    base = baseManifest(p, context, manifest.baseDatasetDigest);
  const original =
    p.base.dataset.formatVersion === 4
      ? buildWorkbookModelV4(
          p.base as PreparedExportDatasetV4,
          base as ReturnType<typeof createExportManifestV4>,
        )
      : buildWorkbookModelV5(
          p.base as PreparedExportDatasetV5,
          base as ReturnType<typeof createExportManifestV5>,
        );
  const sheets = [...original.sheets, ...provenanceSheets(p, manifest)];
  const count = sheets.reduce((n, s) => n + (s.rows.length + 1) * s.columns.length, 0);
  if (count > EXPORT_LIMITS.physicalCells)
    throw new ExportError('EXPORT_LIMIT_EXCEEDED', 'physicalCells');
  return freezeExport({ projectionVersion: 6, sheets });
}
function readChunks(sheet: ExportSheet) {
  if (canonicalJson(sheet.columns) !== canonicalJson(columns))
    throw new ExportError('PAIR_MISMATCH');
  const groups = new Map<string, { parts: string[]; count: number }>();
  for (const row of sheet.rows) {
    if (row.length !== 4 || row.some((cell) => cell.type !== 'string'))
      throw new ExportError('PAIR_MISMATCH');
    const [key, indexText, countText, part] = row.map((cell) => String(cell.value)) as [
      string,
      string,
      string,
      string,
    ];
    const index = Number(indexText),
      count = Number(countText);
    if (
      !Number.isSafeInteger(index) ||
      !Number.isSafeInteger(count) ||
      index < 0 ||
      count < 1 ||
      count > EXPORT_LIMITS.physicalCells ||
      index >= count ||
      String(index) !== indexText ||
      String(count) !== countText
    )
      throw new ExportError('PAIR_MISMATCH');
    let group = groups.get(key);
    if (!group) {
      group = { parts: [], count };
      groups.set(key, group);
    }
    if (group.count !== count || group.parts[index] !== undefined)
      throw new ExportError('PAIR_MISMATCH');
    group.parts[index] = part;
  }
  return [...groups.entries()].map(([key, group]) => {
    if (
      group.parts.length !== group.count ||
      Array.from({ length: group.count }, (_, i) => group.parts[i]).some(
        (part) => part === undefined,
      )
    )
      throw new ExportError('PAIR_MISMATCH');
    const raw = group.parts.join(''),
      value: unknown = JSON.parse(raw);
    if (canonicalJson(value) !== raw) throw new ExportError('PAIR_MISMATCH');
    return { key, value };
  });
}
export function reverseWorkbookModelV6(model: WorkbookModelV6): ReturnType<typeof exportPayloadV6> {
  try {
    if (model.projectionVersion !== 6 || ![45, 46].includes(model.sheets.length))
      throw new ExportError('PAIR_MISMATCH');
    const count = model.sheets.reduce(
      (n, sheet) => n + (sheet.rows.length + 1) * sheet.columns.length,
      0,
    );
    if (count > EXPORT_LIMITS.physicalCells) throw new ExportError('PAIR_MISMATCH');
    const extra = model.sheets.slice(-3);
    if (extra.some((sheet, i) => sheet.name !== sheetNames[i]))
      throw new ExportError('PAIR_MISMATCH');
    const headers = readChunks(extra[0]!);
    if (headers.length !== 1 || headers[0]!.key !== 'manifest')
      throw new ExportError('PAIR_MISMATCH');
    const manifest = headers[0]!.value as ExportManifestV6;
    if (!manifest || manifest.formatVersion !== 6 || ![4, 5].includes(manifest.baseFormatVersion))
      throw new ExportError('PAIR_MISMATCH');
    const base =
      manifest.baseFormatVersion === 4
        ? reverseWorkbookModelV4({ projectionVersion: 4, sheets: model.sheets.slice(0, -3) })
        : reverseWorkbookModelV5({ projectionVersion: 5, sheets: model.sheets.slice(0, -3) });
    const scope =
      base.manifest.scope.period === 'all'
        ? { companyId: base.manifest.scope.companyId, period: 'all', scopeVersion: 1 }
        : {
            companyId: base.manifest.scope.companyId,
            period: 'range',
            scopeVersion: 2,
            from: base.manifest.scope.from,
            to: base.manifest.scope.to,
            dateBasis: base.manifest.scope.dateBasis,
            includeUndated: base.manifest.scope.includeUndated,
          };
    const prepared = prepareExportDatasetV6({
      formatVersion: 6,
      schemaFamilies: manifest.schemaFamilies,
      base: {
        formatVersion: base.manifest.formatVersion,
        scope,
        snapshotAt: base.manifest.snapshotAt,
        planningCoverageSinceAt: base.manifest.planningCoverageSinceAt,
        schemaFamilies: base.manifest.schemaFamilies,
        data: base.data,
        ...('selection' in base ? { selection: base.selection } : {}),
      },
      provenance: {
        scope: manifest.provenanceScope,
        recoveries: readChunks(extra[1]!).map((row) => row.value),
        sourceClaims: readChunks(extra[2]!).map((row) => row.value),
      },
    });
    if (
      base.manifest.datasetDigest !== manifest.baseDatasetDigest ||
      !canonicalEqual(
        base.manifest,
        baseManifest(prepared, contextOf(manifest), manifest.baseDatasetDigest),
      ) ||
      !/^[a-f0-9]{64}$/.test(manifest.datasetDigest) ||
      canonicalJson(
        createExportManifestV6(
          prepared,
          contextOf(manifest),
          manifest.datasetDigest,
          manifest.baseDatasetDigest,
        ),
      ) !== canonicalJson(manifest) ||
      // reverseWorkbookModelV4/V5 above already rebuilt and checked every base cell.
      // Reuse those validated sheets; only the V6 provenance sheets need rebuilding.
      !canonicalEqual(
        {
          projectionVersion: 6,
          sheets: [...model.sheets.slice(0, -3), ...provenanceSheets(prepared, manifest)],
        },
        model,
      )
    )
      throw new ExportError('PAIR_MISMATCH');
    return exportPayloadV6(prepared, manifest);
  } catch {
    throw new ExportError('PAIR_MISMATCH');
  }
}
