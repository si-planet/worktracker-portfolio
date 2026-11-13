import {
  ExportError,
  zExportContext,
  zExportDatasetV4,
  zExportDatasetV5,
  zExportDatasetV6,
} from '../shared/schema/export-dataset';
import { buildExportPairV4, buildExportPairV5 } from '../shared/export/pair';
import { createXlsxExportAdapterV4, createXlsxExportAdapterV5 } from '../shared/export/xlsx-writer';
import type { ExportWorkerReply, ExportWorkerRequest } from './export-worker-client';
import { buildExportPairV6 } from '../shared/export/v6-pair';
import { createXlsxExportAdapterV6 } from '../shared/export/xlsx-writer';

const port = self as unknown as {
  onmessage: ((event: MessageEvent<ExportWorkerRequest>) => void) | null;
  postMessage: (message: ExportWorkerReply, transfer?: Transferable[]) => void;
};
let started = false;
async function digest(bytes: Uint8Array) {
  const value = await crypto.subtle.digest('SHA-256', bytes.slice().buffer);
  return [...new Uint8Array(value)].map((n) => n.toString(16).padStart(2, '0')).join('');
}
port.onmessage = (event) => {
  if (started) return;
  started = true;
  void (async () => {
    try {
      const request = event.data;
      if (
        !request ||
        !['build', 'build-range', 'build-v6'].includes(request.type) ||
        Object.keys(request).sort().join(',') !== 'context,dataset,type'
      )
        throw new ExportError('DATASET_CORRUPT');
      const context = zExportContext.safeParse(request.context);
      if (!context.success) throw new ExportError('DATASET_CORRUPT');
      const pair = await (async () => {
        if (request.type === 'build-v6') {
          const dataset = zExportDatasetV6.safeParse(request.dataset);
          if (!dataset.success) throw new ExportError('DATASET_CORRUPT');
          const adapter = createXlsxExportAdapterV6();
          return buildExportPairV6(dataset.data, context.data, {
            digest,
            xlsx: {
              write: (model) => adapter.write(model),
              read: (bytes) => {
                port.postMessage({ type: 'validating' });
                return adapter.read(bytes);
              },
            },
          });
        }
        if (request.type === 'build-range') {
          const dataset = zExportDatasetV5.safeParse(request.dataset);
          if (!dataset.success) throw new ExportError('DATASET_CORRUPT');
          const adapter = createXlsxExportAdapterV5();
          return buildExportPairV5(dataset.data, context.data, {
            digest,
            xlsx: {
              write: (model) => adapter.write(model),
              read: (bytes) => {
                port.postMessage({ type: 'validating' });
                return adapter.read(bytes);
              },
            },
          });
        }
        const dataset = zExportDatasetV4.safeParse(request.dataset);
        if (!dataset.success) throw new ExportError('DATASET_CORRUPT');
        const adapter = createXlsxExportAdapterV4();
        return buildExportPairV4(dataset.data, context.data, {
          digest,
          xlsx: {
            write: (model) => adapter.write(model),
            read: (bytes) => {
              port.postMessage({ type: 'validating' });
              return adapter.read(bytes);
            },
          },
        });
      })();
      const utc = new Date(context.data.generatedAt).toISOString().replace(/[-:.]/g, '');
      const scope = pair.manifest.scope;
      const period =
        scope.period === 'all'
          ? 'all'
          : `range-${scope.from}-${scope.to}-undated-${scope.includeUndated ? 'yes' : 'no'}`;
      const stem = `worktracker-${context.data.exportId}-${period}-${utc}`;
      pair.json.name = `${stem}.json`;
      pair.xlsx.name = `${stem}.xlsx`;
      port.postMessage({ type: 'ready', pair }, [
        pair.json.bytes.buffer as ArrayBuffer,
        pair.xlsx.bytes.buffer as ArrayBuffer,
      ]);
    } catch (error) {
      const failure = error instanceof ExportError ? error : new ExportError('XLSX_BUILD_FAILED');
      port.postMessage({
        type: 'failure',
        code: failure.code,
        ...(failure.limit === undefined ? {} : { limit: failure.limit }),
      });
    }
  })();
};
