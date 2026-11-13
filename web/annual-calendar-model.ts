import type { WbsItem } from '../shared/schema/wbs';
import type { WorkEntryFinal } from '../shared/schema/work-entry';
import { confirmedPeriodRanges } from './confirmed-period-model';
import { plannerMonths, plannerMonthSegment, type PlannerRange } from './wbs-planner-calendar';
import { displayMonthWeeks } from './calendar-display';
import { dayHref } from './week-hub-model';

type ScheduledEntry = Pick<
  WorkEntryFinal,
  'id' | 'plannedDate' | 'endDate' | 'timeMode' | 'startAt' | 'endAt'
> & { confirmedPerformedDates?: readonly string[] };

/** Reading the baseline never substitutes a revised WBS or changes either record. */
export function baselineRange(
  item: Pick<WbsItem, 'plannedStartOn' | 'plannedEndOn'>,
): PlannerRange {
  return { startOn: item.plannedStartOn, endOn: item.plannedEndOn };
}

/** These are display segments of existing work IDs, not new personal-plan records. */
export function annualWorkSegments<T extends ScheduledEntry>(
  entries: readonly T[],
  year: number,
  month: number,
) {
  return entries.flatMap((entry) => {
    return confirmedPeriodRanges(entry).flatMap((dates) => {
      const range = { startOn: dates.firstDate, endOn: dates.lastDate };
      const segment = plannerMonthSegment(range, year, month);
      return segment ? [{ sourceId: entry.id, entry, range, segment }] : [];
    });
  });
}

/** Open the same record in the existing daily editor, including cross-year periods. */
export function annualWorkHref(
  companyId: string,
  entry: Pick<WorkEntryFinal, 'id' | 'projectId'>,
  date: string,
) {
  return `${dayHref(companyId, date, entry.projectId ?? '')}&${new URLSearchParams({ entryId: entry.id })}`;
}

export type AnnualCalendarPeriod<T> = { key: string; range: PlannerRange; value: T };
export type AnnualWeekSegment<T> = {
  period: AnnualCalendarPeriod<T>;
  startOn: string;
  endOn: string;
  startColumn: number;
  endColumn: number;
  lane: number;
  continuesBefore: boolean;
  continuesAfter: boolean;
};

/** Sunday-first display geometry only; source periods, IDs and stored dates stay untouched. */
export function annualMonthWeeks<T>(
  year: number,
  month: number,
  periods: readonly AnnualCalendarPeriod<T>[],
) {
  const target = plannerMonths(year)[month - 1];
  if (!Number.isInteger(month) || !target) throw new RangeError('INVALID_PLANNER_MONTH');
  const current = periods.filter((period) => plannerMonthSegment(period.range, year, month));
  return displayMonthWeeks(target.startOn.slice(0, 7)).map((week) => {
    const days = week.map((day) => (day && !day.isOutside ? day : null));
    const segments = current
      .flatMap((period, order) => {
        const columns = days.flatMap((day, index) =>
          day && day.date >= period.range.startOn! && day.date <= period.range.endOn!
            ? [index]
            : [],
        );
        if (!columns.length) return [];
        const first = columns[0]!,
          last = columns.at(-1)!;
        return [
          {
            period,
            order,
            startOn: days[first]!.date,
            endOn: days[last]!.date,
            startColumn: first + 1,
            endColumn: last + 2,
          },
        ];
      })
      .sort(
        (a, b) => a.startColumn - b.startColumn || b.endColumn - a.endColumn || a.order - b.order,
      );
    const ends: number[] = [];
    const placed: AnnualWeekSegment<T>[] = segments.map((segment) => {
      let lane = ends.findIndex((end) => end <= segment.startColumn);
      if (lane < 0) lane = ends.length;
      ends[lane] = segment.endColumn;
      return {
        period: segment.period,
        startOn: segment.startOn,
        endOn: segment.endOn,
        startColumn: segment.startColumn,
        endColumn: segment.endColumn,
        lane,
        continuesBefore: segment.period.range.startOn! < segment.startOn,
        continuesAfter: segment.period.range.endOn! > segment.endOn,
      };
    });
    return { days, segments: placed, laneCount: ends.length };
  });
}
