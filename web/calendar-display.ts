import { dayCalendar, shiftCalendarDay } from '../shared/day-calendar';
import { monthCalendar } from '../shared/month-calendar';
import { isoWeekForDate } from '../shared/week-calendar';

export const sundayWeekdays = ['일', '월', '화', '수', '목', '금', '토'] as const;

/** Presentation only. Queries and ISO reporting weeks retain their existing boundaries. */
export function displayMonthWeeks(month: string) {
  const calendar = monthCalendar(month);
  const before = calendar.days[0]!.weekday % 7;
  const rows = Math.ceil((before + calendar.days.length) / 7);
  return Array.from({ length: rows }, (_, row) =>
    Array.from({ length: 7 }, (_, column) => {
      try {
        const day = dayCalendar(shiftCalendarDay(calendar.firstDate, row * 7 + column - before));
        return { ...day, isOutside: day.date.slice(0, 7) !== month };
      } catch {
        // The app's supported date domain is 0001-01-01 through 9999-12-31.
        return null;
      }
    }),
  );
}

/** The selected date supplies the month; its Sunday-start calendar row supplies month week. */
export function displayWeekLabel(date: string) {
  const day = dayCalendar(date);
  const first = dayCalendar(`${date.slice(0, 7)}-01`);
  const monthWeek = Math.floor((Number(date.slice(8)) - 1 + (first.weekday % 7)) / 7) + 1;
  const iso = isoWeekForDate(day.date);
  return `${Number(date.slice(0, 4))}년 ${Number(date.slice(5, 7))}월 ${monthWeek}주 (${iso.isoWeek}주)`;
}
