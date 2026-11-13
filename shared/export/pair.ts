import {
  EXPORT_LIMITS,
  ExportError,
  zExportContext,
  type ExportContext,
} from '../schema/export-dataset';
import {
  canonicalJson,
  digestExport,
  freezeExport,
  prepareExportDataset,
  prepareExportDatasetV2,
  prepareExportDatasetV3,
  prepareExportDatasetV4,
  prepareExportDatasetV5,
  type ExportDigest,
} from './dataset';
import {
  buildWorkbookModel,
  createExportManifest,
  reverseWorkbookModel,
  validateWorkbookModel,
  type ExportManifest,
  type WorkbookModel,
  type WorkbookModelV2,
  type WorkbookModelV3,
  type ExportManifestV3,
  type WorkbookModelV4,
  type WorkbookModelV5,
  type ExportManifestV5,
  buildWorkbookModelV5,
  createExportManifestV5,
  reverseWorkbookModelV5,
  validateWorkbookModelV5,
  type ExportManifestV4,
  buildWorkbookModelV4,
  createExportManifestV4,
  reverseWorkbookModelV4,
  validateWorkbookModelV4,
  buildWorkbookModelV3,
  createExportManifestV3,
  reverseWorkbookModelV3,
  validateWorkbookModelV3,
  type ExportManifestV2,
  buildWorkbookModelV2,
  createExportManifestV2,
  reverseWorkbookModelV2,
  validateWorkbookModelV2,
} from './workbook-model';
export type ExportPairAdapter = {
  write(model: WorkbookModel): Promise<Uint8Array>;
  /** Must independently read actual OOXML cells/types and reject unsupported nodes. */
  read(bytes: Uint8Array): Promise<{
    model: WorkbookModel;
    formulaCount: number;
    hyperlinkCount: number;
    externalRelationshipCount: number;
    macroCount: number;
  }>;
};
export type ExportPairOptions = {
  digest: ExportDigest;
  xlsx: ExportPairAdapter;
  isCancelled?: () => boolean;
};
export type ExportFile = { name: string; mime: string; bytes: Uint8Array; sha256: string };
export type ExportPair = {
  status: 'ready';
  manifest: ExportManifest;
  json: ExportFile;
  xlsx: ExportFile;
};
export async function buildExportPair(
  input: unknown,
  contextInput: ExportContext,
  options: ExportPairOptions,
): Promise<ExportPair> {
  function checkpoint() {
    if (options.isCancelled?.()) throw new ExportError('CANCELLED');
  }
  try {
    checkpoint();
    const c = zExportContext.safeParse(contextInput);
    if (!c.success) throw new ExportError('DATASET_CORRUPT');
    const context = freezeExport(c.data),
      prepared = prepareExportDataset(input);
    if (context.generatedAt < context.requestedAt) throw new ExportError('DATASET_CORRUPT');
    const digest = await digestExport(prepared, options.digest);
    checkpoint();
    const manifest = freezeExport(createExportManifest(prepared, context, digest));
    const payload = {
      manifest,
      data: prepared.dataset.data,
      relationships: prepared.relationships,
    };
    const jsonBytes = new TextEncoder().encode(canonicalJson(payload));
    const model = buildWorkbookModel(prepared, manifest);
    const reversed = reverseWorkbookModel(model);
    if (canonicalJson(reversed) !== canonicalJson(payload)) throw new ExportError('PAIR_MISMATCH');
    checkpoint();
    let xlsxBytes: Uint8Array;
    try {
      const bytes = await options.xlsx.write(model);
      if (!(bytes instanceof Uint8Array) || bytes.byteLength === 0)
        throw new ExportError('XLSX_BUILD_FAILED');
      xlsxBytes = bytes.slice();
    } catch (error) {
      if (error instanceof ExportError) throw error;
      throw new ExportError('XLSX_BUILD_FAILED');
    }
    checkpoint();
    if (jsonBytes.byteLength + xlsxBytes.byteLength > EXPORT_LIMITS.pairBytes)
      throw new ExportError('EXPORT_LIMIT_EXCEEDED', 'pairBytes');
    try {
      const observed = await options.xlsx.read(xlsxBytes.slice());
      if (
        observed.formulaCount !== 0 ||
        observed.hyperlinkCount !== 0 ||
        observed.externalRelationshipCount !== 0 ||
        observed.macroCount !== 0
      )
        throw new ExportError('PAIR_MISMATCH');
      validateWorkbookModel(observed.model, model);
      if (canonicalJson(reverseWorkbookModel(observed.model)) !== canonicalJson(payload))
        throw new ExportError('PAIR_MISMATCH');
    } catch {
      throw new ExportError('PAIR_MISMATCH');
    }
    checkpoint();
    const jsonHash = await options.digest(jsonBytes.slice()),
      xlsxHash = await options.digest(xlsxBytes.slice());
    if (!/^[a-f0-9]{64}$/.test(jsonHash) || !/^[a-f0-9]{64}$/.test(xlsxHash))
      throw new ExportError('DATASET_CORRUPT');
    checkpoint();
    const stem = `worktracker-${context.exportId}`;
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
    throw new ExportError('DATASET_CORRUPT');
  }
}

export type ExportPairAdapterV2 = {
  write(model: WorkbookModelV2): Promise<Uint8Array>;
  /** Must independently read actual OOXML cells/types and reject unsupported nodes. */
  read(bytes: Uint8Array): Promise<{
    model: WorkbookModelV2;
    formulaCount: number;
    hyperlinkCount: number;
    externalRelationshipCount: number;
    macroCount: number;
  }>;
};
export type ExportPairOptionsV2 = {
  digest: ExportDigest;
  xlsx: ExportPairAdapterV2;
  isCancelled?: () => boolean;
};
export type ExportPairV2 = {
  status: 'ready';
  manifest: ExportManifestV2;
  json: ExportFile;
  xlsx: ExportFile;
};
export async function buildExportPairV2(
  input: unknown,
  contextInput: ExportContext,
  options: ExportPairOptionsV2,
): Promise<ExportPairV2> {
  function checkpoint() {
    if (options.isCancelled?.()) throw new ExportError('CANCELLED');
  }
  try {
    checkpoint();
    const c = zExportContext.safeParse(contextInput);
    if (!c.success) throw new ExportError('DATASET_CORRUPT');
    const context = freezeExport(c.data),
      prepared = prepareExportDatasetV2(input);
    if (context.generatedAt < context.requestedAt) throw new ExportError('DATASET_CORRUPT');
    const digest = await digestExport(prepared, options.digest);
    checkpoint();
    const manifest = freezeExport(createExportManifestV2(prepared, context, digest));
    const payload = {
      manifest,
      data: prepared.dataset.data,
      relationships: prepared.relationships,
    };
    const jsonBytes = new TextEncoder().encode(canonicalJson(payload));
    const model = buildWorkbookModelV2(prepared, manifest);
    const reversed = reverseWorkbookModelV2(model);
    if (canonicalJson(reversed) !== canonicalJson(payload)) throw new ExportError('PAIR_MISMATCH');
    checkpoint();
    let xlsxBytes: Uint8Array;
    try {
      const bytes = await options.xlsx.write(model);
      if (!(bytes instanceof Uint8Array) || bytes.byteLength === 0)
        throw new ExportError('XLSX_BUILD_FAILED');
      xlsxBytes = bytes.slice();
    } catch (error) {
      if (error instanceof ExportError) throw error;
      throw new ExportError('XLSX_BUILD_FAILED');
    }
    checkpoint();
    if (jsonBytes.byteLength + xlsxBytes.byteLength > EXPORT_LIMITS.pairBytes)
      throw new ExportError('EXPORT_LIMIT_EXCEEDED', 'pairBytes');
    try {
      const observed = await options.xlsx.read(xlsxBytes.slice());
      if (
        observed.formulaCount !== 0 ||
        observed.hyperlinkCount !== 0 ||
        observed.externalRelationshipCount !== 0 ||
        observed.macroCount !== 0
      )
        throw new ExportError('PAIR_MISMATCH');
      validateWorkbookModelV2(observed.model, model);
      if (canonicalJson(reverseWorkbookModelV2(observed.model)) !== canonicalJson(payload))
        throw new ExportError('PAIR_MISMATCH');
    } catch {
      throw new ExportError('PAIR_MISMATCH');
    }
    checkpoint();
    const jsonHash = await options.digest(jsonBytes.slice()),
      xlsxHash = await options.digest(xlsxBytes.slice());
    if (!/^[a-f0-9]{64}$/.test(jsonHash) || !/^[a-f0-9]{64}$/.test(xlsxHash))
      throw new ExportError('DATASET_CORRUPT');
    checkpoint();
    const stem = `worktracker-${context.exportId}`;
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
    throw new ExportError('DATASET_CORRUPT');
  }
}

export type ExportPairAdapterV3 = {
  write(model: WorkbookModelV3): Promise<Uint8Array>;
  /** Must independently read actual OOXML cells/types and reject unsupported nodes. */
  read(bytes: Uint8Array): Promise<{
    model: WorkbookModelV3;
    formulaCount: number;
    hyperlinkCount: number;
    externalRelationshipCount: number;
    macroCount: number;
  }>;
};
export type ExportPairOptionsV3 = {
  digest: ExportDigest;
  xlsx: ExportPairAdapterV3;
  isCancelled?: () => boolean;
};
export type ExportPairV3 = {
  status: 'ready';
  manifest: ExportManifestV3;
  json: ExportFile;
  xlsx: ExportFile;
};
export async function buildExportPairV3(
  input: unknown,
  contextInput: ExportContext,
  options: ExportPairOptionsV3,
): Promise<ExportPairV3> {
  function checkpoint() {
    if (options.isCancelled?.()) throw new ExportError('CANCELLED');
  }
  try {
    checkpoint();
    const c = zExportContext.safeParse(contextInput);
    if (!c.success) throw new ExportError('DATASET_CORRUPT');
    const context = freezeExport(c.data),
      prepared = prepareExportDatasetV3(input);
    if (context.generatedAt < context.requestedAt) throw new ExportError('DATASET_CORRUPT');
    const digest = await digestExport(prepared, options.digest);
    checkpoint();
    const manifest = freezeExport(createExportManifestV3(prepared, context, digest));
    const payload = {
      manifest,
      data: prepared.dataset.data,
      relationships: prepared.relationships,
    };
    const jsonBytes = new TextEncoder().encode(canonicalJson(payload));
    const model = buildWorkbookModelV3(prepared, manifest);
    const reversed = reverseWorkbookModelV3(model);
    if (canonicalJson(reversed) !== canonicalJson(payload)) throw new ExportError('PAIR_MISMATCH');
    checkpoint();
    let xlsxBytes: Uint8Array;
    try {
      const bytes = await options.xlsx.write(model);
      if (!(bytes instanceof Uint8Array) || bytes.byteLength === 0)
        throw new ExportError('XLSX_BUILD_FAILED');
      xlsxBytes = bytes.slice();
    } catch (error) {
      if (error instanceof ExportError) throw error;
      throw new ExportError('XLSX_BUILD_FAILED');
    }
    checkpoint();
    if (jsonBytes.byteLength + xlsxBytes.byteLength > EXPORT_LIMITS.pairBytes)
      throw new ExportError('EXPORT_LIMIT_EXCEEDED', 'pairBytes');
    try {
      const observed = await options.xlsx.read(xlsxBytes.slice());
      if (
        observed.formulaCount !== 0 ||
        observed.hyperlinkCount !== 0 ||
        observed.externalRelationshipCount !== 0 ||
        observed.macroCount !== 0
      )
        throw new ExportError('PAIR_MISMATCH');
      validateWorkbookModelV3(observed.model, model);
      if (canonicalJson(reverseWorkbookModelV3(observed.model)) !== canonicalJson(payload))
        throw new ExportError('PAIR_MISMATCH');
    } catch {
      throw new ExportError('PAIR_MISMATCH');
    }
    checkpoint();
    const jsonHash = await options.digest(jsonBytes.slice()),
      xlsxHash = await options.digest(xlsxBytes.slice());
    if (!/^[a-f0-9]{64}$/.test(jsonHash) || !/^[a-f0-9]{64}$/.test(xlsxHash))
      throw new ExportError('DATASET_CORRUPT');
    checkpoint();
    const stem = `worktracker-${context.exportId}`;
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
    throw new ExportError('DATASET_CORRUPT');
  }
}

export type ExportPairAdapterV4 = {
  write(model: WorkbookModelV4): Promise<Uint8Array>;
  /** Must independently read actual OOXML cells/types and reject unsupported nodes. */
  read(bytes: Uint8Array): Promise<{
    model: WorkbookModelV4;
    formulaCount: number;
    hyperlinkCount: number;
    externalRelationshipCount: number;
    macroCount: number;
  }>;
};
export type ExportPairOptionsV4 = {
  digest: ExportDigest;
  xlsx: ExportPairAdapterV4;
  isCancelled?: () => boolean;
};
export type ExportPairV4 = {
  status: 'ready';
  manifest: ExportManifestV4;
  json: ExportFile;
  xlsx: ExportFile;
};
export async function buildExportPairV4(
  input: unknown,
  contextInput: ExportContext,
  options: ExportPairOptionsV4,
): Promise<ExportPairV4> {
  function checkpoint() {
    if (options.isCancelled?.()) throw new ExportError('CANCELLED');
  }
  try {
    checkpoint();
    const c = zExportContext.safeParse(contextInput);
    if (!c.success) throw new ExportError('DATASET_CORRUPT');
    const context = freezeExport(c.data),
      prepared = prepareExportDatasetV4(input);
    if (context.generatedAt < context.requestedAt) throw new ExportError('DATASET_CORRUPT');
    const digest = await digestExport(prepared, options.digest);
    checkpoint();
    const manifest = freezeExport(createExportManifestV4(prepared, context, digest));
    const payload = {
      manifest,
      data: prepared.dataset.data,
      relationships: prepared.relationships,
    };
    const jsonBytes = new TextEncoder().encode(canonicalJson(payload));
    const model = buildWorkbookModelV4(prepared, manifest);
    const reversed = reverseWorkbookModelV4(model);
    if (canonicalJson(reversed) !== canonicalJson(payload)) throw new ExportError('PAIR_MISMATCH');
    checkpoint();
    let xlsxBytes: Uint8Array;
    try {
      const bytes = await options.xlsx.write(model);
      if (!(bytes instanceof Uint8Array) || bytes.byteLength === 0)
        throw new ExportError('XLSX_BUILD_FAILED');
      xlsxBytes = bytes.slice();
    } catch (error) {
      if (error instanceof ExportError) throw error;
      throw new ExportError('XLSX_BUILD_FAILED');
    }
    checkpoint();
    if (jsonBytes.byteLength + xlsxBytes.byteLength > EXPORT_LIMITS.pairBytes)
      throw new ExportError('EXPORT_LIMIT_EXCEEDED', 'pairBytes');
    try {
      const observed = await options.xlsx.read(xlsxBytes.slice());
      if (
        observed.formulaCount !== 0 ||
        observed.hyperlinkCount !== 0 ||
        observed.externalRelationshipCount !== 0 ||
        observed.macroCount !== 0
      )
        throw new ExportError('PAIR_MISMATCH');
      validateWorkbookModelV4(observed.model, model);
      if (canonicalJson(reverseWorkbookModelV4(observed.model)) !== canonicalJson(payload))
        throw new ExportError('PAIR_MISMATCH');
    } catch {
      throw new ExportError('PAIR_MISMATCH');
    }
    checkpoint();
    const jsonHash = await options.digest(jsonBytes.slice()),
      xlsxHash = await options.digest(xlsxBytes.slice());
    if (!/^[a-f0-9]{64}$/.test(jsonHash) || !/^[a-f0-9]{64}$/.test(xlsxHash))
      throw new ExportError('DATASET_CORRUPT');
    checkpoint();
    const stem = `worktracker-${context.exportId}`;
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
    throw new ExportError('DATASET_CORRUPT');
  }
}

export type ExportPairAdapterV5 = {
  write(model: WorkbookModelV5): Promise<Uint8Array>;
  /** Must independently read actual OOXML cells/types and reject unsupported nodes. */
  read(bytes: Uint8Array): Promise<{
    model: WorkbookModelV5;
    formulaCount: number;
    hyperlinkCount: number;
    externalRelationshipCount: number;
    macroCount: number;
  }>;
};
export type ExportPairOptionsV5 = {
  digest: ExportDigest;
  xlsx: ExportPairAdapterV5;
  isCancelled?: () => boolean;
};
export type ExportPairV5 = {
  status: 'ready';
  manifest: ExportManifestV5;
  json: ExportFile;
  xlsx: ExportFile;
};
export async function buildExportPairV5(
  input: unknown,
  contextInput: ExportContext,
  options: ExportPairOptionsV5,
): Promise<ExportPairV5> {
  function checkpoint() {
    if (options.isCancelled?.()) throw new ExportError('CANCELLED');
  }
  try {
    checkpoint();
    const c = zExportContext.safeParse(contextInput);
    if (!c.success) throw new ExportError('DATASET_CORRUPT');
    const context = freezeExport(c.data),
      prepared = prepareExportDatasetV5(input);
    if (context.generatedAt < context.requestedAt) throw new ExportError('DATASET_CORRUPT');
    const digest = await digestExport(prepared, options.digest);
    checkpoint();
    const manifest = freezeExport(createExportManifestV5(prepared, context, digest));
    const payload = {
      manifest,
      data: prepared.dataset.data,
      selection: prepared.dataset.selection,
      relationships: prepared.relationships,
    };
    const jsonBytes = new TextEncoder().encode(canonicalJson(payload));
    const model = buildWorkbookModelV5(prepared, manifest);
    const reversed = reverseWorkbookModelV5(model);
    if (canonicalJson(reversed) !== canonicalJson(payload)) throw new ExportError('PAIR_MISMATCH');
    checkpoint();
    let xlsxBytes: Uint8Array;
    try {
      const bytes = await options.xlsx.write(model);
      if (!(bytes instanceof Uint8Array) || bytes.byteLength === 0)
        throw new ExportError('XLSX_BUILD_FAILED');
      xlsxBytes = bytes.slice();
    } catch (error) {
      if (error instanceof ExportError) throw error;
      throw new ExportError('XLSX_BUILD_FAILED');
    }
    checkpoint();
    if (jsonBytes.byteLength + xlsxBytes.byteLength > EXPORT_LIMITS.pairBytes)
      throw new ExportError('EXPORT_LIMIT_EXCEEDED', 'pairBytes');
    try {
      const observed = await options.xlsx.read(xlsxBytes.slice());
      if (
        observed.formulaCount !== 0 ||
        observed.hyperlinkCount !== 0 ||
        observed.externalRelationshipCount !== 0 ||
        observed.macroCount !== 0
      )
        throw new ExportError('PAIR_MISMATCH');
      validateWorkbookModelV5(observed.model, model);
      if (canonicalJson(reverseWorkbookModelV5(observed.model)) !== canonicalJson(payload))
        throw new ExportError('PAIR_MISMATCH');
    } catch {
      throw new ExportError('PAIR_MISMATCH');
    }
    checkpoint();
    const jsonHash = await options.digest(jsonBytes.slice()),
      xlsxHash = await options.digest(xlsxBytes.slice());
    if (!/^[a-f0-9]{64}$/.test(jsonHash) || !/^[a-f0-9]{64}$/.test(xlsxHash))
      throw new ExportError('DATASET_CORRUPT');
    checkpoint();
    const stem = `worktracker-${context.exportId}`;
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
    throw new ExportError('DATASET_CORRUPT');
  }
}
