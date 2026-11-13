import { shiftCalendarDay } from '../shared/day-calendar';
import { monthCalendar } from '../shared/month-calendar';
import { isoWeekForDate, weekCalendar } from '../shared/week-calendar';
import type { LocalReviewRecord, LocalWorklogReview } from './real-worklog-review-api';

export const realReviewMonths = ['2026-08', '2026-09', '2026-10'] as const;
export type RealReviewMonth = (typeof realReviewMonths)[number];
export type RealReviewCalendarView = 'month' | 'week';

/** Projection only: retain each original object, title, cell and unknown state. */
export function realReviewProjection(value: LocalWorklogReview, month: string) {
  const calendar = monthCalendar(month);
  const days = new Map<string, LocalReviewRecord[]>();
  const summaries = new Map<string, LocalReviewRecord[]>();
  const unresolved: LocalReviewRecord[] = [];
  for (const row of value.records) {
    if (row.section === 'daily' && row.activityDate && row.dateBasis === 'explicit_day_header') {
      const rows = days.get(row.activityDate) ?? [];
      rows.push(row);
      days.set(row.activityDate, rows);
    } else if (row.section === 'weeklySummary' && row.explicitWeekStart) {
      const rows = summaries.get(row.explicitWeekStart) ?? [];
      rows.push(row);
      summaries.set(row.explicitWeekStart, rows);
    } else if (row.sourceMonth === Number(month.slice(5))) {
      unresolved.push(row);
    }
  }
  const monthDates = [...days.keys()].filter((date) => date.slice(0, 7) === month).sort();
  const monthSummaries = [...summaries.entries()].flatMap(([start, rows]) =>
    start <= calendar.lastDate && shiftCalendarDay(start, 6) >= calendar.firstDate ? rows : [],
  );
  return {
    calendar,
    days,
    summaries,
    unresolved,
    monthDates,
    monthDaily: monthDates.flatMap((date) => days.get(date)!),
    monthSummaries,
    sourceMonthRecords: value.records.filter((row) => row.sourceMonth === Number(month.slice(5))),
  };
}

export function realReviewWeek(date: string) {
  const week = isoWeekForDate(date);
  return weekCalendar(week.isoYear, week.isoWeek);
}

export function realReviewMonthCells(month: string) {
  const calendar = monthCalendar(month);
  const before = (calendar.days[0]!.weekday - 1) % 7;
  const count = Math.ceil((before + calendar.days.length) / 7) * 7;
  return Array.from({ length: count }, (_, index) => calendar.days[index - before] ?? null);
}
