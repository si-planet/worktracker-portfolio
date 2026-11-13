import { zWorkEntryId, type WorkEntryFinal } from '../shared/schema/work-entry';
import { zWorkEntrySourceLabelsResult } from '../shared/schema/work-entry-source-labels';
import { WorkFailure, workApi } from './work-entry-api';

export type SourceLabelEntry = Pick<WorkEntryFinal, 'id' | 'companyId' | 'version'>;
export type SourceLabels = Map<string, { entryVersion: number; categories: string[] }>;

/** A separate display projection. Never add provenance fields to editable work DTOs. */
export function bindWorkSourceLabels(
  companyId: string,
  entries: readonly SourceLabelEntry[],
  raw: unknown,
) {
  const parsed = zWorkEntrySourceLabelsResult.safeParse(raw);
  if (!parsed.success) throw new WorkFailure(0, 'INVALID_RESPONSE');
  const result = parsed.data;
  if (
    result.companyId !== companyId ||
    (!result.available && result.items.length > 0) ||
    entries.length > 50 ||
    new Set(entries.map((entry) => entry.id)).size !== entries.length ||
    entries.some((entry) => entry.companyId !== companyId)
  )
    throw new WorkFailure(0, 'INVALID_RESPONSE');
  const page = new Map(entries.map((entry) => [entry.id, entry]));
  const labels: SourceLabels = new Map();
  for (const item of result.items) {
    const entry = page.get(item.entryId);
    if (!entry || item.entryVersion !== entry.version || labels.has(item.entryId))
      throw new WorkFailure(0, 'INVALID_RESPONSE');
    labels.set(item.entryId, {
      entryVersion: item.entryVersion,
      categories: [...item.sourceCategories],
    });
  }
  return { available: result.available, labels };
}

/** At most one request per 50 distinct displayed records, never one per card/day. */
export async function readWorkSourceLabels(
  companyId: string,
  entries: readonly SourceLabelEntry[],
) {
  const company = zWorkEntryId.parse(companyId);
  if (
    entries.some((entry) => entry.companyId !== company) ||
    new Set(entries.map((entry) => entry.id)).size !== entries.length
  )
    throw new WorkFailure(0, 'INVALID_RESPONSE');
  const labels: SourceLabels = new Map();
  let available = true;
  for (let offset = 0; offset < entries.length; offset += 50) {
    const batch = entries.slice(offset, offset + 50);
    const query = new URLSearchParams();
    for (const entry of batch) query.append('ids', zWorkEntryId.parse(entry.id));
    const raw = await workApi(
      `/api/companies/${company}/work-entry-source-labels?${query}`,
      zWorkEntrySourceLabelsResult,
    );
    const result = bindWorkSourceLabels(company, batch, raw);
    if (!result.available) available = false;
    for (const [id, value] of result.labels) labels.set(id, value);
  }
  if (!available && labels.size) throw new WorkFailure(0, 'INVALID_RESPONSE');
  return { available, labels };
}
