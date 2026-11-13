import type { WorkEntryFinal } from './schema/work-entry';
import type { WeekCalendar } from './week-calendar';

type PlacementEntry = Pick<
  WorkEntryFinal,
  'plannedDate' | 'endDate' | 'timeMode' | 'startAt' | 'endAt'
>;
const KST = 9 * 60 * 60 * 1000;
function dateAt(at: number) {
  const date = new Date(at + KST).toISOString().slice(0, 10);
  if (!/^[0-9]{4}-[0-9]{2}-[0-9]{2}$/.test(date) || date.startsWith('0000'))
    throw new RangeError('PLACEMENT_DATE_OUT_OF_RANGE');
  return date;
}

/** Display dates for a millisecond interval [startAt, endAt), without changing stored instants. */
export function exactDisplayDates(startAt: number, endAt: number) {
  if (!Number.isSafeInteger(startAt) || !Number.isSafeInteger(endAt) || endAt <= startAt)
    throw new RangeError('INVALID_PLACEMENT_INTERVAL');
  return { plannedDate: dateAt(startAt), endDate: dateAt(endAt - 1) };
}

/** A null date stays in the company backlog; dueDate never determines placement. */
export function placementRange(entry: PlacementEntry) {
  if (entry.plannedDate === null) return null;
  const lastDate = entry.endDate ?? entry.plannedDate;
  if (entry.timeMode === 'exact') {
    if (entry.startAt === null || entry.endAt === null)
      throw new RangeError('INVALID_PLACEMENT_INTERVAL');
    const actual = exactDisplayDates(entry.startAt, entry.endAt);
    if (entry.plannedDate !== actual.plannedDate || lastDate !== actual.endDate)
      throw new RangeError('INCONSISTENT_PLACEMENT_DATES');
  }
  if (lastDate < entry.plannedDate) throw new RangeError('INVALID_PLACEMENT_RANGE');
  return { firstDate: entry.plannedDate, lastDate };
}

export function entryDatesInWeek(entry: PlacementEntry, calendar: WeekCalendar): string[] {
  const range = placementRange(entry);
  return range
    ? calendar.days
        .filter((day) => day.date >= range.firstDate && day.date <= range.lastDate)
        .map((day) => day.date)
    : [];
}
