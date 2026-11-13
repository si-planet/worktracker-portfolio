import { zWorkEntryDate } from './schema/work-entry';

const DAY = 86_400_000;
function epoch(date: string) {
  return Date.parse(`${zWorkEntryDate.parse(date)}T00:00:00.000Z`);
}
function dateString(at: number) {
  const value = new Date(at).toISOString().slice(0, 10);
  return zWorkEntryDate.parse(value);
}
export function dayCalendar(date: string) {
  const weekday = new Date(epoch(date)).getUTCDay() || 7;
  return { date, weekday, isWeekend: weekday >= 6 };
}
/** Calendar days use UTC as an arithmetic carrier; application instants remain KST. */
export function shiftCalendarDay(date: string, offset: number) {
  if (!Number.isSafeInteger(offset)) throw new RangeError('INVALID_DAY_OFFSET');
  return dateString(epoch(date) + offset * DAY);
}
/** Month jumps retain the day where possible and otherwise use the month's last day. */
export function shiftCalendarMonth(date: string, offset: number) {
  epoch(date);
  if (!Number.isSafeInteger(offset)) throw new RangeError('INVALID_MONTH_OFFSET');
  const index = (Number(date.slice(0, 4)) - 1) * 12 + Number(date.slice(5, 7)) - 1 + offset;
  if (!Number.isSafeInteger(index) || index < 0 || index >= 9999 * 12)
    throw new RangeError('DATE_OUT_OF_RANGE');
  const year = Math.floor(index / 12) + 1;
  const month = (index % 12) + 1;
  const first = `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-01`;
  const last = new Date(epoch(first));
  last.setUTCMonth(last.getUTCMonth() + 1, 0);
  return `${first.slice(0, 8)}${String(Math.min(Number(date.slice(8)), last.getUTCDate())).padStart(2, '0')}`;
}
