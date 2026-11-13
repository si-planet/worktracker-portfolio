import type { WorkEntryFinal } from '../shared/schema/work-entry';
import { placementRange } from '../shared/week-placement';

type ScheduledEntry = Pick<
  WorkEntryFinal,
  'plannedDate' | 'endDate' | 'timeMode' | 'startAt' | 'endAt'
> & { confirmedPerformedDates?: readonly string[] };
type Day = { date: string; isOutside?: boolean } | null;

/** Display only: each confirmed run retains its original entry and never fills a gap. */
export function confirmedPeriodRanges(entry: ScheduledEntry) {
  if (entry.confirmedPerformedDates === undefined) {
    const range = placementRange(entry);
    return range ? [range] : [];
  }
  const ranges: { firstDate: string; lastDate: string }[] = [];
  for (const date of entry.confirmedPerformedDates) {
    const previous = ranges.at(-1);
    if (previous && Date.parse(date) - Date.parse(previous.lastDate) === 86_400_000)
      previous.lastDate = date;
    else ranges.push({ firstDate: date, lastDate: date });
  }
  return ranges;
}

export function calendarEntryOnDate(entry: ScheduledEntry, date: string) {
  return confirmedPeriodRanges(entry).some(
    (range) => range.firstDate <= date && range.lastDate >= date,
  );
}

/** Week/month clipping restarts the title; independent IDs are never combined. */
export function monthPeriodLanes<T extends ScheduledEntry>(
  week: readonly Day[],
  entries: readonly T[],
) {
  const dates = week.flatMap((day) => (day && !day.isOutside ? [day.date] : []));
  const firstDate = dates[0],
    lastDate = dates.at(-1);
  if (!firstDate || !lastDate) return [];
  const laneEnds: string[] = [];
  return entries
    .flatMap((entry) =>
      confirmedPeriodRanges(entry).flatMap((range) =>
        range.firstDate <= lastDate && range.lastDate >= firstDate ? [{ entry, ...range }] : [],
      ),
    )
    .sort(
      (left, right) =>
        left.firstDate.localeCompare(right.firstDate) ||
        right.lastDate.localeCompare(left.lastDate),
    )
    .map((row) => {
      const segmentStart = row.firstDate < firstDate ? firstDate : row.firstDate;
      let lane = laneEnds.findIndex((end) => end < segmentStart);
      if (lane === -1) lane = laneEnds.length;
      laneEnds[lane] = row.lastDate;
      return { ...row, lane, segmentStart };
    });
}
