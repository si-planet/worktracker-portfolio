import { dayCalendar, shiftCalendarDay, shiftCalendarMonth } from './day-calendar';
import { zWorkEntryDate } from './schema/work-entry';

export function isCalendarMonth(value: string): boolean {
  return /^[0-9]{4}-[0-9]{2}$/.test(value) && zWorkEntryDate.safeParse(`${value}-01`).success;
}
export function shiftCalendarMonthValue(month: string, offset: number): string {
  if (!isCalendarMonth(month)) throw new RangeError('INVALID_MONTH');
  return shiftCalendarMonth(`${month}-01`, offset).slice(0, 7);
}
export function monthCalendar(month: string) {
  if (!isCalendarMonth(month)) throw new RangeError('INVALID_MONTH');
  const firstDate = `${month}-01`;
  const last = new Date(`${firstDate}T00:00:00.000Z`);
  last.setUTCMonth(last.getUTCMonth() + 1, 0);
  const lastDate = last.toISOString().slice(0, 10);
  const days = Array.from({ length: last.getUTCDate() }, (_, index) =>
    dayCalendar(shiftCalendarDay(firstDate, index)),
  );
  return { month, firstDate, lastDate, days };
}
