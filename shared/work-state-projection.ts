import type { WorkEntryFinal } from './schema/work-entry';
import type { WeekCalendar } from './week-calendar';
import { placementRange } from './week-placement';

export type WorkListProjection = 'scheduled' | 'working';
type ProjectionEntry = Pick<
  WorkEntryFinal,
  'kind' | 'status' | 'plannedDate' | 'endDate' | 'timeMode' | 'startAt' | 'endAt' | 'completedAt'
>;
const LAST_DATE = '9999-12-31';
const LAST_DATE_END = Date.parse('9999-12-31T15:00:00.000Z');

/** Current working-list placement only; stored dates and report snapshots stay unchanged. */
export function workingPlacementRange(entry: ProjectionEntry) {
  const scheduled = placementRange(entry);
  if (!scheduled || entry.kind !== 'task') return scheduled;
  if (entry.status === 'doing') return { ...scheduled, lastDate: LAST_DATE };
  if (entry.status !== 'done' || entry.completedAt === null) return scheduled;
  // Completion uses the existing KST date convention. Clamp to the app's date domain.
  const completedDate =
    entry.completedAt >= LAST_DATE_END
      ? LAST_DATE
      : new Date(entry.completedAt + 9 * 60 * 60 * 1000).toISOString().slice(0, 10);
  return {
    firstDate: scheduled.firstDate,
    lastDate: completedDate < scheduled.firstDate ? scheduled.firstDate : completedDate,
  };
}

export function entryVisibleOnDate(
  entry: ProjectionEntry,
  date: string,
  projection: WorkListProjection = 'scheduled',
) {
  const range = projection === 'working' ? workingPlacementRange(entry) : placementRange(entry);
  return range !== null && date >= range.firstDate && date <= range.lastDate;
}

export function entryDatesForWeek(
  entry: ProjectionEntry,
  calendar: WeekCalendar,
  projection: WorkListProjection = 'scheduled',
) {
  return calendar.days
    .filter((day) => entryVisibleOnDate(entry, day.date, projection))
    .map((day) => day.date);
}
