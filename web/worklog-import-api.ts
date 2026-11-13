import { z } from 'zod';
import { workEntrySnapshot } from '../shared/work-entry-rules';
import { workApi, WorkFailure } from './work-entry-api';
import {
  zWorklogBegin,
  zWorklogRun,
  zWorklogChunk,
  zWorklogChunkResult,
  zWorklogChunkObservation,
  zWorklogValidate,
  zWorklogDryRun,
  zWorklogDryRunResult,
  zWorklogMaterialize,
  zWorklogReceipt,
  zWorklogSummaries,
  type WorklogMapping,
} from '../shared/schema/worklog-import';
import {
  worklogCanonical,
  worklogHash,
  worklogPackageReceiptMatches,
  worklogPackageRowPreview,
  type WorklogImportPackage,
} from '../shared/schema/worklog-import-package';
export type ImportRun = z.output<typeof zWorklogRun>;
export type ImportReceipt = z.output<typeof zWorklogReceipt>;
export type ImportDryRun = z.output<typeof zWorklogDryRunResult>;
export type ImportSummaries = z.output<typeof zWorklogSummaries>;
export function importRoot(companyId: string, runId?: string) {
  z.uuid().parse(companyId);
  if (runId) z.uuid().parse(runId);
  return `/api/companies/${companyId}/worklog-imports${runId ? `/${runId}` : ''}`;
}
export function importRunSchema(companyId: string, runId: string, pkg?: WorklogImportPackage) {
  return zWorklogRun.refine(
    (v) =>
      v.companyId === companyId &&
      v.id === runId &&
      (!pkg ||
        (v.id === pkg.begin.id &&
          v.documentKey === pkg.begin.documentKey &&
          v.sourceSha256 === pkg.begin.sourceSha256 &&
          v.manifestHash === pkg.begin.manifestHash &&
          worklogCanonical(v.counts) === worklogCanonical(pkg.begin.counts) &&
          v.receivedBytes <= pkg.begin.expectedBytes)),
  );
}
export function readImportRun(companyId: string, runId: string, pkg?: WorklogImportPackage) {
  return workApi(importRoot(companyId, runId), importRunSchema(companyId, runId, pkg));
}
export function beginImport(companyId: string, pkg: WorklogImportPackage) {
  return workApi(
    importRoot(companyId),
    importRunSchema(companyId, pkg.begin.id, pkg),
    'POST',
    zWorklogBegin.parse(pkg.begin),
  );
}
export function sendImportChunk(companyId: string, pkg: WorklogImportPackage, index: number) {
  const input = zWorklogChunk.parse(pkg.chunks[index]);
  return workApi(
    `${importRoot(companyId, pkg.begin.id)}/chunks`,
    zWorklogChunkResult.refine(
      (r) =>
        r.id === input.id &&
        r.appliedVersion === input.expectedRunVersion + 1 &&
        importRunSchema(companyId, pkg.begin.id, pkg).safeParse(r.run).success &&
        r.run.version >= r.appliedVersion,
    ),
    'POST',
    input,
  );
}
export async function observeImportChunk(
  companyId: string,
  pkg: WorklogImportPackage,
  index: number,
) {
  const chunk = zWorklogChunk.parse(pkg.chunks[index]),
    hash = await worklogHash(chunk);
  return workApi(
    `${importRoot(companyId, pkg.begin.id)}/chunks/${chunk.id}`,
    zWorklogChunkObservation.refine(
      (r) =>
        r.id === chunk.id &&
        r.payloadHash === hash &&
        r.appliedVersion === chunk.expectedRunVersion + 1 &&
        r.itemCount === chunk.items.length &&
        importRunSchema(companyId, pkg.begin.id, pkg).safeParse(r.run).success &&
        r.run.version >= r.appliedVersion,
    ),
  );
}
export function validateImport(
  companyId: string,
  pkg: WorklogImportPackage,
  input: z.output<typeof zWorklogValidate>,
) {
  return workApi(
    `${importRoot(companyId, pkg.begin.id)}/validate`,
    importRunSchema(companyId, pkg.begin.id, pkg).refine(
      (r) => r.state === 'validated' && r.receivedBytes === pkg.begin.expectedBytes,
    ),
    'POST',
    zWorklogValidate.parse(input),
  );
}
export function dryRunImport(
  companyId: string,
  pkg: WorklogImportPackage,
  mappings: WorklogMapping[],
) {
  return workApi(
    `${importRoot(companyId, pkg.begin.id)}/dry-run`,
    zWorklogDryRunResult.refine(
      (r) =>
        r.runId === pkg.begin.id &&
        r.results.length === pkg.rows.length &&
        new Set(r.results.map((x) => x.rowId)).size === pkg.rows.length &&
        r.results.every((x) => {
          const row = pkg.rows.find((y) => y.rowId === x.rowId);
          return (
            row &&
            (row.section === 'weeklySummary' ? x.state === 'summary' : x.state !== 'summary') &&
            (x.state !== 'ready' || mappings.some((m) => m.rowId === x.rowId))
          );
        }),
    ),
    'POST',
    zWorklogDryRun.parse({ mappings }),
  );
}
async function checkedReceipt(
  companyId: string,
  pkg: WorklogImportPackage,
  mapping: WorklogMapping,
  promise: Promise<ImportReceipt>,
) {
  const receipt = await promise;
  if (
    !(await worklogPackageReceiptMatches(pkg, mapping.rowId, companyId, mapping, receipt)) ||
    receipt.originalHistory.id !== receipt.id ||
    receipt.originalHistory.workEntryId !== mapping.entryId ||
    receipt.originalHistory.entryVersion !== 1 ||
    receipt.originalHistory.changeType !== 'create' ||
    (receipt.current.entry &&
      (receipt.current.entry.id !== mapping.entryId ||
        receipt.current.entry.companyId !== companyId))
  )
    throw new WorkFailure(0, 'INVALID_RESPONSE');
  return receipt;
}
export function materializeImport(
  companyId: string,
  pkg: WorklogImportPackage,
  input: z.output<typeof zWorklogMaterialize>,
) {
  const body = zWorklogMaterialize.parse(input);
  return checkedReceipt(
    companyId,
    pkg,
    body.mapping,
    workApi(`${importRoot(companyId, pkg.begin.id)}/materialize`, zWorklogReceipt, 'POST', body),
  );
}
export function readImportReceipt(
  companyId: string,
  pkg: WorklogImportPackage,
  mapping: WorklogMapping,
) {
  const row = pkg.rows.find((r) => r.rowId === mapping.rowId);
  if (!row?.materializeCommandId) throw new Error('INVALID_ROW');
  return checkedReceipt(
    companyId,
    pkg,
    mapping,
    workApi(
      `${importRoot(companyId, pkg.begin.id)}/receipts/${row.materializeCommandId}`,
      zWorklogReceipt,
    ),
  );
}
export function readExistingImportReceipt(
  companyId: string,
  pkg: WorklogImportPackage,
  rowId: string,
) {
  const row = pkg.rows.find((r) => r.rowId === rowId);
  if (!row?.materializeCommandId || !row.entryCandidateId) throw new Error('INVALID_ROW');
  const source = worklogPackageRowPreview(pkg, rowId);
  return workApi(
    `${importRoot(companyId, pkg.begin.id)}/receipts/${row.materializeCommandId}`,
    zWorklogReceipt.refine(
      (r) =>
        r.id === row.materializeCommandId &&
        r.runId === pkg.begin.id &&
        r.rowId === row.rowId &&
        r.interpretationId === row.interpretationId &&
        r.originalEntry.id === row.entryCandidateId &&
        r.originalEntry.companyId === companyId &&
        r.originalHistory.id === r.id &&
        r.originalHistory.workEntryId === row.entryCandidateId &&
        r.originalHistory.entryVersion === 1 &&
        r.originalHistory.changeType === 'create' &&
        r.originalHistory.schemaVersion === 2 &&
        r.originalHistory.before === null &&
        r.originalHistory.changedAt === r.createdAt &&
        r.originalEntry.createdAt === r.createdAt &&
        r.originalEntry.updatedAt === r.createdAt &&
        r.originalEntry.version === 1 &&
        worklogCanonical(r.originalHistory.after) ===
          worklogCanonical(workEntrySnapshot(r.originalEntry)) &&
        r.originalEntry.title === source.title &&
        r.originalEntry.content === source.content &&
        r.originalEntry.plannedDate === row.activityDate &&
        r.originalEntry.dueDate === row.dueDate &&
        (r.current.entry === null ||
          (r.current.entry.id === row.entryCandidateId && r.current.entry.companyId === companyId)),
    ),
  );
}
export function readImportSummaries(companyId: string, pkg: WorklogImportPackage) {
  return workApi(
    `${importRoot(companyId, pkg.begin.id)}/summaries`,
    zWorklogSummaries.refine(
      (r) =>
        r.runId === pkg.begin.id &&
        r.items.length === pkg.summary.weeklySummaries &&
        new Set(r.items.map((x) => x.row.id)).size === r.items.length &&
        r.items.every((x) => {
          const row = pkg.rows.find((y) => y.rowId === x.row.id);
          return (
            row?.section === 'weeklySummary' &&
            x.row.kind === 'row' &&
            x.row.data.section === 'weeklySummary' &&
            x.interpretation.kind === 'interpretation' &&
            x.interpretation.id === row.interpretationId &&
            x.interpretation.data.rowId === row.rowId &&
            x.isoMembership.kind === 'iso_membership' &&
            x.isoMembership.data.rowId === row.rowId &&
            x.sourceMembership.kind === 'source_membership' &&
            x.sourceMembership.data.rowId === row.rowId &&
            x.relations.every(
              (v) =>
                v.kind === 'relation' &&
                v.data.state === 'candidate' &&
                v.data.merge === false &&
                v.data.completionPropagation === false &&
                v.data.weeklyRowId === row.rowId,
            )
          );
        }),
    ),
  );
}
