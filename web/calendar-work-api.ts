import { zWorkEntryDate, zWorkEntryId, type WorkEntryFinal } from '../shared/schema/work-entry';
import { placementRange } from '../shared/week-placement';
import {
  zConfirmedPeriodProjectionResult,
  type CalendarWorkEntry,
} from '../shared/schema/confirmed-worklog-recovery';
import { WorkFailure, workApi, workListSchema } from './work-entry-api';

export type CalendarWorkQuery = {
  from: string;
  to: string;
  projectId: string;
  status: 'active' | 'canceled';
};

/** Annual and monthly views share stored schedule dates, not the ongoing-work projection. */
export function calendarWorkParameters(query: CalendarWorkQuery) {
  const from = zWorkEntryDate.parse(query.from),
    to = zWorkEntryDate.parse(query.to);
  if (from > to) throw new RangeError('INVALID_CALENDAR_RANGE');
  const params = new URLSearchParams({ dateState: 'scheduled', from, to, limit: '50' });
  for (const status of query.status === 'canceled'
    ? ['canceled']
    : ['todo', 'doing', 'paused', 'planned', 'done'])
    params.append('statuses', status);
  if (query.projectId) params.append('projectIds', zWorkEntryId.parse(query.projectId));
  return params;
}

export function assertCalendarEntries(
  entries: readonly WorkEntryFinal[],
  query: CalendarWorkQuery,
) {
  if (entries.length > 50 || new Set(entries.map((entry) => entry.id)).size !== entries.length)
    throw new WorkFailure(0, 'INVALID_RESPONSE');
  for (const entry of entries) {
    const range = placementRange(entry);
    if (
      !range ||
      range.firstDate > query.to ||
      range.lastDate < query.from ||
      (query.projectId && entry.projectId !== query.projectId) ||
      (query.status === 'canceled' ? entry.status !== 'canceled' : entry.status === 'canceled')
    )
      throw new WorkFailure(0, 'INVALID_RESPONSE');
  }
}

export async function readCalendarWorkPage(
  companyId: string,
  query: CalendarWorkQuery,
  cursor: string | null = null,
) {
  const company = zWorkEntryId.parse(companyId);
  const params = calendarWorkParameters(query);
  if (cursor) params.set('cursor', cursor);
  const result = await workApi(
    `/api/companies/${company}/work-entries?${params}`,
    workListSchema(company),
  );
  assertCalendarEntries(result.items, query);
  if (!result.items.length) return result;
  const ids = new URLSearchParams();
  for (const entry of result.items) ids.append('ids', entry.id);
  const projection = await workApi(
    `/api/companies/${company}/confirmed-work-periods?${ids}`,
    zConfirmedPeriodProjectionResult,
  );
  return { ...result, items: bindConfirmedPeriods(company, result.items, projection) };
}

/** Bind only to this page's exact IDs/versions; never enlarge the stored schedule. */
export function bindConfirmedPeriods(
  companyId: string,
  entries: readonly WorkEntryFinal[],
  raw: unknown,
): CalendarWorkEntry[] {
  const parsed = zConfirmedPeriodProjectionResult.safeParse(raw);
  if (!parsed.success) throw new WorkFailure(0, 'INVALID_RESPONSE');
  const projection = parsed.data;
  if (
    projection.companyId !== companyId ||
    (!projection.available && projection.items.length > 0) ||
    entries.length > 50 ||
    new Set(entries.map((entry) => entry.id)).size !== entries.length ||
    entries.some((entry) => entry.companyId !== companyId)
  )
    throw new WorkFailure(0, 'INVALID_RESPONSE');
  const page = new Map(entries.map((entry) => [entry.id, entry]));
  const dates = new Map<string, string[]>();
  for (const item of projection.items) {
    const entry = page.get(item.entryId);
    const range = entry && placementRange(entry);
    if (
      !entry ||
      !range ||
      dates.has(item.entryId) ||
      item.entryVersion !== entry.version ||
      item.performedDates.some((date) => date < range.firstDate || date > range.lastDate)
    )
      throw new WorkFailure(0, 'INVALID_RESPONSE');
    dates.set(item.entryId, item.performedDates);
  }
  return entries.map((entry) => {
    const performedDates = dates.get(entry.id);
    return performedDates ? { ...entry, confirmedPerformedDates: performedDates } : entry;
  });
}

export function mergeCalendarEntries(
  previous: readonly CalendarWorkEntry[],
  incoming: readonly CalendarWorkEntry[],
) {
  const rows = new Map(previous.map((entry) => [entry.id, entry]));
  for (const entry of incoming) {
    const current = rows.get(entry.id);
    if (!current || entry.version >= current.version) rows.set(entry.id, entry);
  }
  return [...rows.values()];
}

export function assertCalendarCursor(next: string | null, seen: ReadonlySet<string>) {
  if (next && seen.has(next)) throw new WorkFailure(0, 'INVALID_RESPONSE');
}
