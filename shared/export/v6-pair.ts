import { canonicalEqual } from './canonical-equal';
import {
  ExportError,
  EXPORT_LIMITS,
  zExportContext,
  type ExportContext,
} from '../schema/export-dataset';
import type { ExportFile } from './pair';
import { canonicalJson, digestExport } from './dataset';
import { prepareExportDatasetV6 } from './v6-dataset';
import {
  buildWorkbookModelV6,
  createExportManifestV6,
  exportPayloadV6,
  reverseWorkbookModelV6,
  type WorkbookModelV6,
  type ExportManifestV6,
} from './v6-workbook';

export type ExportPairV6 = {
  status: 'ready';
  manifest: ExportManifestV6;
  json: ExportFile;
  xlsx: ExportFile;
};
export type ExportPairAdapterV6 = {
  write(model: WorkbookModelV6): Promise<Uint8Array>;
  read(bytes: Uint8Array): Promise<{
    model: WorkbookModelV6;
    formulaCount: number;
    hyperlinkCount: number;
    externalRelationshipCount: number;
    macroCount: number;
  }>;
};
export async function buildExportPairV6(
  input: unknown,
  contextInput: ExportContext,
  options: {
    digest(bytes: Uint8Array): Promise<string>;
    xlsx: ExportPairAdapterV6;
    isCancelled?: () => boolean;
  },
): Promise<ExportPairV6> {
  const checkpoint = () => {
    if (options.isCancelled?.()) throw new ExportError('CANCELLED');
  };
  try {
    checkpoint();
    const context = zExportContext.parse(contextInput),
      p = prepareExportDatasetV6(input);
    if (context.generatedAt < context.requestedAt) throw new ExportError('DATASET_CORRUPT');
    const [digest, baseDigest] = await Promise.all([
      options.digest(new TextEncoder().encode(p.canonicalDataset)),
      digestExport(p.base, options.digest),
    ]);
    if (!/^[a-f0-9]{64}$/.test(digest) || !/^[a-f0-9]{64}$/.test(baseDigest))
      throw new ExportError('DATASET_CORRUPT');
    const manifest = createExportManifestV6(p, context, digest, baseDigest),
      payload = exportPayloadV6(p, manifest);
    const jsonBytes = new TextEncoder().encode(canonicalJson(payload)),
      model = buildWorkbookModelV6(p, manifest);
    if (canonicalJson(reverseWorkbookModelV6(model)) !== canonicalJson(payload))
      throw new ExportError('PAIR_MISMATCH');
    checkpoint();
    const xlsxBytes = (await options.xlsx.write(model)).slice();
    if (!xlsxBytes.byteLength) throw new ExportError('XLSX_BUILD_FAILED');
    if (jsonBytes.byteLength + xlsxBytes.byteLength > EXPORT_LIMITS.pairBytes)
      throw new ExportError('EXPORT_LIMIT_EXCEEDED', 'pairBytes');
    checkpoint();
    const observed = await options.xlsx.read(xlsxBytes.slice());
    if (
      observed.formulaCount ||
      observed.hyperlinkCount ||
      observed.externalRelationshipCount ||
      observed.macroCount ||
      !canonicalEqual(observed.model, model) ||
      canonicalJson(reverseWorkbookModelV6(observed.model)) !== canonicalJson(payload)
    )
      throw new ExportError('PAIR_MISMATCH');
    checkpoint();
    const [jsonHash, xlsxHash] = await Promise.all([
      options.digest(jsonBytes.slice()),
      options.digest(xlsxBytes.slice()),
    ]);
    if (!/^[a-f0-9]{64}$/.test(jsonHash) || !/^[a-f0-9]{64}$/.test(xlsxHash))
      throw new ExportError('DATASET_CORRUPT');
    checkpoint();
    const stem = `worktracker-${context.exportId}-v6`;
    return {
      status: 'ready',
      manifest,
      json: { name: stem + '.json', mime: 'application/json', bytes: jsonBytes, sha256: jsonHash },
      xlsx: {
        name: stem + '.xlsx',
        mime: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        bytes: xlsxBytes,
        sha256: xlsxHash,
      },
    };
  } catch (error) {
    if (error instanceof ExportError) throw error;
    throw new ExportError('XLSX_BUILD_FAILED');
  }
}
