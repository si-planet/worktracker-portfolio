import {
  EXPORT_LIMITS,
  ExportError,
  type ExportContext,
  type ExportDatasetV4,
  type ExportDatasetV5,
  type ExportDatasetV6,
} from '../shared/schema/export-dataset';
import type { ExportFile, ExportPairV4, ExportPairV5 } from '../shared/export/pair';
import { canonicalJson, digestExport, prepareExportDatasetV5 } from '../shared/export/dataset';
import { createExportManifestV5 } from '../shared/export/workbook-model';
import { isExportFailureCode } from './export-api';
import type { ExportPairV6 } from '../shared/export/v6-pair';
import { prepareExportDatasetV6 } from '../shared/export/v6-dataset';
import { createExportManifestV6, exportPayloadV6 } from '../shared/export/v6-workbook';

type MemoryFile = Omit<ExportFile, 'bytes'> & {
  bytes: Uint8Array<ArrayBuffer>;
};
type VersionedExportPair = ExportPairV4 | ExportPairV5 | ExportPairV6;
export type PreparedExportPair = Omit<VersionedExportPair, 'json' | 'xlsx'> & {
  json: MemoryFile;
  xlsx: MemoryFile;
};
export type ExportWorkerRequest =
  | { type: 'build'; dataset: ExportDatasetV4; context: ExportContext }
  | { type: 'build-range'; dataset: ExportDatasetV5; context: ExportContext }
  | { type: 'build-v6'; dataset: ExportDatasetV6; context: ExportContext };
export type ExportWorkerReply =
  | { type: 'validating' }
  | { type: 'ready'; pair: VersionedExportPair }
  | {
      type: 'failure';
      code: ExportError['code'];
      limit?: keyof typeof EXPORT_LIMITS;
    };

export function disposeExportPair(pair: VersionedExportPair | PreparedExportPair) {
  for (const file of [pair?.json, pair?.xlsx]) {
    if (file?.bytes instanceof Uint8Array && file.bytes.byteLength > 0) file.bytes.fill(0);
  }
}

async function sha256(bytes: Uint8Array) {
  const digest = await crypto.subtle.digest('SHA-256', bytes.slice().buffer);
  return [...new Uint8Array(digest)].map((value) => value.toString(16).padStart(2, '0')).join('');
}

function checkedFile(value: ExportFile, format: 'json' | 'xlsx', exportId: string): MemoryFile {
  const mime =
    format === 'json'
      ? 'application/json'
      : 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
  if (
    !value ||
    typeof value !== 'object' ||
    !(value.bytes instanceof Uint8Array) ||
    !(value.bytes.buffer instanceof ArrayBuffer) ||
    value.bytes.byteLength === 0 ||
    value.bytes.byteLength > EXPORT_LIMITS.pairBytes ||
    value.mime !== mime ||
    !/^[a-f0-9]{64}$/.test(value.sha256) ||
    typeof value.name !== 'string' ||
    !value.name.startsWith(`worktracker-${exportId}`) ||
    !new RegExp(`^[a-zA-Z0-9._-]+\\.${format}$`).test(value.name)
  )
    throw new ExportError('PAIR_MISMATCH');
  return { ...value, bytes: value.bytes as Uint8Array<ArrayBuffer> };
}

export function prepareExportPair(
  dataset: ExportDatasetV4 | ExportDatasetV5 | ExportDatasetV6,
  context: ExportContext,
  signal: AbortSignal,
  onValidating: () => void,
): Promise<PreparedExportPair> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) {
      reject(new ExportError('CANCELLED'));
      return;
    }
    let worker: Worker;
    try {
      worker = new Worker(new URL('./export-worker.ts', import.meta.url), {
        type: 'module',
      });
    } catch {
      reject(new ExportError('XLSX_BUILD_FAILED'));
      return;
    }
    let settled = false;
    let received = false;
    let pending: VersionedExportPair | null = null;
    const timer = setTimeout(() => finish(new ExportError('CANCELLED')), 30_000);
    function cleanup() {
      clearTimeout(timer);
      signal.removeEventListener('abort', abort);
      worker.onmessage = null;
      worker.onerror = null;
      worker.onmessageerror = null;
      worker.terminate();
    }
    function finish(error: ExportError) {
      if (settled) return;
      settled = true;
      cleanup();
      if (pending) disposeExportPair(pending);
      pending = null;
      reject(error);
    }
    function abort() {
      finish(new ExportError('CANCELLED'));
    }
    signal.addEventListener('abort', abort, { once: true });
    worker.onerror = (event) => {
      event.preventDefault();
      finish(new ExportError('XLSX_BUILD_FAILED'));
    };
    worker.onmessageerror = () => finish(new ExportError('PAIR_MISMATCH'));
    worker.onmessage = (event: MessageEvent<ExportWorkerReply>) => {
      if (settled) return;
      const message = event.data;
      if (!message || typeof message !== 'object') {
        finish(new ExportError('PAIR_MISMATCH'));
        return;
      }
      if (message.type === 'validating') {
        onValidating();
        return;
      }
      if (message.type === 'failure') {
        // The Worker publishes only the shared error code; no raw error text crosses threads.
        if (
          !isExportFailureCode(message.code) ||
          (message.limit !== undefined &&
            (typeof message.limit !== 'string' || !Object.hasOwn(EXPORT_LIMITS, message.limit)))
        ) {
          finish(new ExportError('PAIR_MISMATCH'));
        } else finish(new ExportError(message.code, message.limit));
        return;
      }
      if (message.type !== 'ready') {
        finish(new ExportError('PAIR_MISMATCH'));
        return;
      }
      if (received) {
        disposeExportPair(message.pair);
        finish(new ExportError('PAIR_MISMATCH'));
        return;
      }
      received = true;
      void (async () => {
        try {
          const pair = message.pair;
          pending = pair;
          const baseDataset = dataset.formatVersion === 6 ? dataset.base : dataset;
          if (
            pair.status !== 'ready' ||
            pair.manifest.formatVersion !== dataset.formatVersion ||
            pair.manifest.projectionVersion !== dataset.formatVersion ||
            pair.manifest.scopeVersion !== baseDataset.scope.scopeVersion ||
            pair.manifest.exportId !== context.exportId ||
            pair.manifest.scope.companyId !== baseDataset.scope.companyId ||
            pair.manifest.scope.period !== baseDataset.scope.period ||
            pair.manifest.snapshotAt !== baseDataset.snapshotAt ||
            pair.manifest.requestedAt !== context.requestedAt ||
            pair.manifest.generatedAt !== context.generatedAt
          )
            throw new ExportError('PAIR_MISMATCH');
          const prepared = dataset.formatVersion === 5 ? prepareExportDatasetV5(dataset) : null;
          const expectedManifest = prepared
            ? createExportManifestV5(prepared, context, await digestExport(prepared, sha256))
            : null;
          if (settled) return;
          if (expectedManifest && canonicalJson(pair.manifest) !== canonicalJson(expectedManifest))
            throw new ExportError('PAIR_MISMATCH');
          const json = checkedFile(pair.json, 'json', context.exportId);
          const xlsx = checkedFile(pair.xlsx, 'xlsx', context.exportId);
          if (json.bytes.byteLength + xlsx.bytes.byteLength > EXPORT_LIMITS.pairBytes)
            throw new ExportError('EXPORT_LIMIT_EXCEEDED', 'pairBytes');
          const hashes = await Promise.all([sha256(json.bytes), sha256(xlsx.bytes)]);
          if (settled) return;
          if (hashes[0] !== json.sha256 || hashes[1] !== xlsx.sha256)
            throw new ExportError('PAIR_MISMATCH');
          if (prepared && expectedManifest) {
            const payload: unknown = JSON.parse(
              new TextDecoder('utf-8', { fatal: true }).decode(json.bytes),
            );
            if (
              canonicalJson(payload) !==
              canonicalJson({
                manifest: expectedManifest,
                data: prepared.dataset.data,
                selection: prepared.dataset.selection,
                relationships: prepared.relationships,
              })
            )
              throw new ExportError('PAIR_MISMATCH');
          }
          if (dataset.formatVersion === 6) {
            const p = prepareExportDatasetV6(dataset);
            const [digest, baseDigest] = await Promise.all([
              sha256(new TextEncoder().encode(p.canonicalDataset)),
              digestExport(p.base, sha256),
            ]);
            const manifest = createExportManifestV6(p, context, digest, baseDigest);
            const payload: unknown = JSON.parse(
              new TextDecoder('utf-8', { fatal: true }).decode(json.bytes),
            );
            if (
              canonicalJson(pair.manifest) !== canonicalJson(manifest) ||
              canonicalJson(payload) !== canonicalJson(exportPayloadV6(p, manifest))
            )
              throw new ExportError('PAIR_MISMATCH');
            if (settled) return;
          }
          settled = true;
          pending = null;
          cleanup();
          resolve({ ...pair, json, xlsx });
        } catch (error) {
          finish(error instanceof ExportError ? error : new ExportError('PAIR_MISMATCH'));
        }
      })();
    };
    try {
      const request: ExportWorkerRequest =
        dataset.formatVersion === 6
          ? { type: 'build-v6', dataset, context }
          : dataset.formatVersion === 5
            ? { type: 'build-range', dataset, context }
            : { type: 'build', dataset, context };
      worker.postMessage(request);
    } catch {
      finish(new ExportError('DATASET_CORRUPT'));
    }
  });
}
