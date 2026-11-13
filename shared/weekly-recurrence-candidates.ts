import {
  zWeeklyRecurrenceCandidatesInput,
  zWeeklyRecurrenceCandidates,
  type WeeklyRecurrenceCandidates,
} from './schema/weekly-recurrence-candidates';
import { weekCalendar } from './week-calendar';

const DAY = 86_400_000;
const WEEK = 7 * DAY;
const epoch = (date: string) => Date.parse(`${date}T00:00:00.000Z`);

/**
 * Original weekly occurrence dates only: no work entries, holiday moves or storage.
 * Interval zero is the Monday of startOn's ISO week. Start/end bounds are inclusive.
 * UTC is only a date arithmetic carrier; host time and timezone are never consulted.
 */
export function weeklyRecurrenceCandidates(input: unknown): WeeklyRecurrenceCandidates {
  const { rule, weeks } = zWeeklyRecurrenceCandidatesInput.parse(input);
  const start = epoch(rule.startOn);
  const anchorMonday = start - ((new Date(start).getUTCDay() + 6) % 7) * DAY;
  const weekdays = new Set(rule.byweekday);
  const calendars = weeks
    .map((w) => weekCalendar(w.isoYear, w.isoWeek))
    .sort((a, b) => (a.weekStart < b.weekStart ? -1 : a.weekStart > b.weekStart ? 1 : 0));
  return zWeeklyRecurrenceCandidates.parse({
    weeks: calendars.map((calendar) => {
      const offset = (epoch(calendar.weekStart) - anchorMonday) / WEEK;
      const eligibleWeek = rule.isActive && offset >= 0 && offset % rule.interval === 0;
      return {
        isoYear: calendar.isoYear,
        isoWeek: calendar.isoWeek,
        weekStart: calendar.weekStart,
        weekEnd: calendar.weekEnd,
        occurrenceDates: eligibleWeek
          ? calendar.days
              .filter(
                (day) =>
                  weekdays.has(day.weekday) &&
                  day.date >= rule.startOn &&
                  (rule.endOn === null || day.date <= rule.endOn),
              )
              .map((day) => day.date)
          : [],
      };
    }),
  });
}
