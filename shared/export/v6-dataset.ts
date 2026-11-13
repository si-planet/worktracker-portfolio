import { ExportError, EXPORT_LIMITS, zExportDatasetV6 } from '../schema/export-dataset';
import {
  canonicalJson,
  compareCodeUnits,
  freezeExport,
  prepareExportDatasetV4,
  prepareExportDatasetV5,
} from './dataset';

export function prepareExportDatasetV6(input: unknown) {
  try {
    if (new TextEncoder().encode(canonicalJson(input)).byteLength > EXPORT_LIMITS.datasetBytes)
      throw new ExportError('EXPORT_LIMIT_EXCEEDED', 'datasetBytes');
    const value = zExportDatasetV6.parse(input);
    const base =
      value.base.formatVersion === 4
        ? prepareExportDatasetV4(value.base)
        : prepareExportDatasetV5(value.base);
    value.base = base.dataset;
    const company = value.base.scope.companyId;
    if (
      value.provenance.scope.companyId !== company ||
      canonicalJson([...value.schemaFamilies].sort(compareCodeUnits)) !==
        canonicalJson([...value.base.schemaFamilies, '0013'].sort(compareCodeUnits))
    )
      throw new ExportError('RELATION_INVALID');
    value.schemaFamilies.sort(compareCodeUnits);
    const { recoveries, sourceClaims } = value.provenance;
    if (
      Object.values(base.entityCounts).reduce((a, b) => a + b, 0) +
        recoveries.length +
        sourceClaims.length >
      EXPORT_LIMITS.logicalRows
    )
      throw new ExportError('EXPORT_LIMIT_EXCEEDED', 'logicalRows');
    const receipts = new Map<string, (typeof recoveries)[number]>();
    const decisions = new Set<string>();
    const entries = new Map(value.base.data.workEntries.map((row) => [row.id, row]));
    for (const row of recoveries) {
      const decision = row.decision;
      const key = canonicalJson([row.sourceSha256, row.decisionKey]);
      if (
        row.companyId !== company ||
        receipts.has(row.id) ||
        decisions.has(key) ||
        row.id !== decision.id ||
        row.sourceSha256 !== decision.sourceSha256 ||
        row.action !== decision.action ||
        row.decisionKey !== decision.decisionKey ||
        row.entryId !== decision.targetEntryId ||
        canonicalJson(row.performedDates) !== canonicalJson(decision.performedDates)
      )
        throw new ExportError('RELATION_INVALID');
      decisions.add(key);
      receipts.set(row.id, row);
      const work = row.action === 'completed' || row.action === 'paused';
      if (
        work !== (row.entryId !== null && row.after !== null) ||
        (!work &&
          (row.before !== null ||
            row.after !== null ||
            row.currentEntryPresence !== 'notApplicable')) ||
        (work && row.currentEntryPresence === 'notApplicable')
      )
        throw new ExportError('RELATION_INVALID');
      for (const snapshot of [row.before, row.after])
        if (snapshot && (snapshot.companyId !== company || snapshot.id !== row.entryId))
          throw new ExportError('RELATION_INVALID');
      if (
        row.after &&
        ((row.before !== null) !== (decision.anchor !== null) ||
          row.after.version !== (row.before ? row.before.version + 1 : 1) ||
          (row.before && row.before.version !== decision.anchor!.expectedVersion) ||
          (!decision.anchor && row.after.projectId !== decision.project!.id) ||
          row.after.kind !== (decision.entryKind ?? 'task') ||
          (decision.entryKind === 'meeting' &&
            (row.after.timeMode !== 'date_only' ||
              !row.after.allDay ||
              row.after.startAt !== null ||
              row.after.endAt !== null)) ||
          row.after.status !== (row.action === 'completed' ? 'done' : 'paused') ||
          row.after.completedAt !== null ||
          row.after.plannedDate !== row.performedDates[0] ||
          (row.after.endDate ?? row.after.plannedDate) !== row.performedDates.at(-1))
      )
        throw new ExportError('RELATION_INVALID');
      if (
        row.entryId &&
        (entries.has(row.entryId)
          ? row.currentEntryPresence !== 'present'
          : value.base.scope.period === 'all' && row.currentEntryPresence === 'present')
      )
        throw new ExportError('RELATION_INVALID');
    }
    for (const row of recoveries) {
      const anchor = row.decision.anchor;
      if (!anchor || !('kind' in anchor)) continue;
      const parent = receipts.get(anchor.recoveryId);
      if (
        !parent ||
        parent.id === row.id ||
        parent.action !== 'completed' ||
        parent.entryId !== row.entryId ||
        parent.sourceSha256 !== row.sourceSha256 ||
        parent.requestHash !== anchor.recoveryRequestHash ||
        !parent.after ||
        !row.before ||
        canonicalJson(parent.after) !== canonicalJson(row.before) ||
        parent.after.version !== anchor.expectedVersion ||
        !parent.performedDates.every((date) => row.performedDates.includes(date)) ||
        !parent.decision.excludedDates.every((date) => row.decision.excludedDates.includes(date))
      )
        throw new ExportError('RELATION_INVALID');
    }
    const claims = new Set<string>();
    const byReceipt = new Map<string, typeof sourceClaims>();
    for (const row of sourceClaims) {
      const receipt = receipts.get(row.recoveryId);
      const key = canonicalJson([row.companyId, row.sourceSha256, row.sourceRecordId]);
      if (
        row.companyId !== company ||
        !receipt ||
        receipt.sourceSha256 !== row.sourceSha256 ||
        claims.has(key)
      )
        throw new ExportError('RELATION_INVALID');
      claims.add(key);
      const rows = byReceipt.get(row.recoveryId) ?? [];
      rows.push(row);
      byReceipt.set(row.recoveryId, rows);
    }
    for (const receipt of recoveries) {
      const actual = (byReceipt.get(receipt.id) ?? []).map((row) => ({
        runId: row.runId,
        rowId: row.rowId,
        payloadHash: row.payloadHash,
        sourceRecordId: row.sourceRecordId,
      }));
      const sorted = (rows: typeof actual) =>
        [...rows].sort((a, b) => compareCodeUnits(a.sourceRecordId, b.sourceRecordId));
      if (canonicalJson(sorted(actual)) !== canonicalJson(sorted(receipt.decision.sources)))
        throw new ExportError('RELATION_INVALID');
    }
    recoveries.sort((a, b) => compareCodeUnits(a.id, b.id));
    sourceClaims.sort((a, b) =>
      compareCodeUnits(
        canonicalJson([a.sourceSha256, a.sourceRecordId]),
        canonicalJson([b.sourceSha256, b.sourceRecordId]),
      ),
    );
    const references = recoveries
      .filter((row) => row.entryId !== null)
      .map((row) => ({
        recoveryId: row.id,
        entryId: row.entryId!,
        relationType: 'historical' as const,
        presence: entries.has(row.entryId!)
          ? ('presentInBase' as const)
          : row.currentEntryPresence === 'present'
            ? ('outsideSelectedBase' as const)
            : ('absentHistorical' as const),
        provenance: 'retained-snapshot' as const,
      }));
    const canonicalDataset = canonicalJson({
      projectionVersion: 6,
      base: JSON.parse(base.canonicalDataset),
      schemaFamilies: value.schemaFamilies,
      provenance: value.provenance,
      references,
    });
    if (new TextEncoder().encode(canonicalDataset).byteLength > EXPORT_LIMITS.datasetBytes)
      throw new ExportError('EXPORT_LIMIT_EXCEEDED', 'datasetBytes');
    return freezeExport({ dataset: value, base, references, canonicalDataset });
  } catch (error) {
    if (error instanceof ExportError) throw error;
    throw new ExportError('DATASET_CORRUPT');
  }
}
export type PreparedExportDatasetV6 = ReturnType<typeof prepareExportDatasetV6>;
