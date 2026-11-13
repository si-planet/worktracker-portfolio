import { zWorkEntryDate } from './schema/work-entry';
import { kstDate } from './work-entry-rules';

const DAY = 86_400_000;
const KST = 9 * 60 * 60 * 1000;
export type IsoWeek = { isoYear: number; isoWeek: number };
export type WeekDay = { date: string; weekday: number; isWeekend: boolean };
export type WeekCalendar = IsoWeek & {
  weekStart: string;
  weekEnd: string;
  startAt: number;
  endAtExclusive: number;
  days: WeekDay[];
};

const dateEpoch = (date: string) => Date.parse(`${zWorkEntryDate.parse(date)}T00:00:00.000Z`);
const isoDay = (at: number) => new Date(at).getUTCDay() || 7;
function dateString(at: number) {
  const value = new Date(at).toISOString().slice(0, 10);
  return zWorkEntryDate.parse(value);
}
function firstMonday(year: number) {
  const january4 = Date.parse(`${String(year).padStart(4, '0')}-01-04T00:00:00.000Z`);
  return january4 - (isoDay(january4) - 1) * DAY;
}

/** Date-only input uses UTC only as a calendar arithmetic carrier, never the host timezone. */
export function isoWeekForDate(date: string): IsoWeek {
  const at = dateEpoch(date);
  const thursday = at + (4 - isoDay(at)) * DAY;
  const isoYear = new Date(thursday).getUTCFullYear();
  return { isoYear, isoWeek: Math.floor((at - firstMonday(isoYear)) / (7 * DAY)) + 1 };
}

export function isoWeekAtKst(now: number): IsoWeek {
  return isoWeekForDate(kstDate(now));
}

/** weekEnd is Sunday's date. The instant interval is [KST Monday, next KST Monday). */
export function weekCalendar(isoYear: number, isoWeek: number): WeekCalendar {
  if (!Number.isInteger(isoYear) || isoYear < 1 || isoYear > 9999)
    throw new RangeError('INVALID_ISO_YEAR');
  if (!Number.isInteger(isoWeek) || isoWeek < 1 || isoWeek > 53)
    throw new RangeError('INVALID_ISO_WEEK');
  const monday = firstMonday(isoYear) + (isoWeek - 1) * 7 * DAY;
  const thursdayYear = new Date(monday + 3 * DAY).getUTCFullYear();
  if (thursdayYear !== isoYear) throw new RangeError('INVALID_ISO_WEEK');
  // Fail explicitly when a week would contain a date outside the app's 0001..9999 domain.
  const days = Array.from({ length: 7 }, (_, index) => ({
    date: dateString(monday + index * DAY),
    weekday: index + 1,
    isWeekend: index >= 5,
  }));
  return {
    isoYear,
    isoWeek,
    weekStart: days[0]!.date,
    weekEnd: days[6]!.date,
    startAt: monday - KST,
    endAtExclusive: monday + 7 * DAY - KST,
    days,
  };
}

/** Pass dates found across the entire result set, not just the current page of entries. */
export function visibleWeekDays(calendar: WeekCalendar, recordedDates: Iterable<string>) {
  const recorded = new Set(recordedDates);
  return calendar.days.filter((day) => !day.isWeekend || recorded.has(day.date));
}

export function shiftIsoWeek(week: IsoWeek, offset: number): IsoWeek {
  if (!Number.isSafeInteger(offset)) throw new RangeError('INVALID_WEEK_OFFSET');
  const current = weekCalendar(week.isoYear, week.isoWeek);
  const date = dateString(dateEpoch(current.weekStart) + offset * 7 * DAY);
  const next = isoWeekForDate(date);
  weekCalendar(next.isoYear, next.isoWeek);
  return next;
}
