import { z } from 'zod';
import {
  zRecurrenceSpec,
  zRecurrenceWeeks,
  type RecurrenceMonthlyDecision,
} from './schema/recurrence';
import { weeklyRecurrenceCandidates } from './weekly-recurrence-candidates';
import { weekCalendar } from './week-calendar';

const inputSchema = z.strictObject({ rule: zRecurrenceSpec, weeks: zRecurrenceWeeks });
const DAY = 86_400_000;
const epoch = (date: string) => Date.parse(`${date}T00:00:00.000Z`);

/** Original dates only. No clock, holiday movement, storage, or automatic materialization. */
export function recurrenceCandidates(input: unknown): {
  weeks: ReturnType<typeof weeklyRecurrenceCandidates>['weeks'];
  monthlyDecisions?: Omit<RecurrenceMonthlyDecision, 'revision'>[];
} {
  const { rule, weeks } = inputSchema.parse(input);
  if (rule.freq === 'weekly') {
    return weeklyRecurrenceCandidates({
      rule: {
        freq: rule.freq,
        startOn: rule.startOn,
        endOn: rule.endOn,
        interval: rule.interval,
        byweekday: rule.byweekday,
        isActive: rule.isActive,
      },
      weeks,
    });
  }
  const calendars = weeks.map((w) => weekCalendar(w.isoYear, w.isoWeek));
  const requested = new Set(calendars.flatMap((c) => c.days.map((d) => d.date)));
  const dates = new Set<string>();
  const bounded = (date: string) =>
    date >= rule.startOn && (rule.endOn === null || date <= rule.endOn);
  const monthlyDecisions: Omit<RecurrenceMonthlyDecision, 'revision'>[] = [];
  if (rule.freq === 'daily') {
    const start = epoch(rule.startOn);
    if (rule.isActive)
      for (const date of requested)
        if (bounded(date) && ((epoch(date) - start) / DAY) % rule.interval === 0) dates.add(date);
  } else {
    const startMonth = Number(rule.startOn.slice(0, 4)) * 12 + Number(rule.startOn.slice(5, 7)) - 1;
    const months = [...new Set([...requested].map((date) => date.slice(0, 7)))].sort();
    if (rule.isActive)
      for (const month of months) {
        const year = Number(month.slice(0, 4)),
          monthNumber = Number(month.slice(5, 7));
        const offset = year * 12 + monthNumber - 1 - startMonth;
        if (offset < 0 || offset % rule.interval !== 0) continue;
        // Parse ISO text rather than Date.UTC: years 0001..0099 must remain literal years.
        const first = new Date(`${month}-01T00:00:00.000Z`);
        first.setUTCMonth(first.getUTCMonth() + 1, 0);
        const lastDay = first.getUTCDate();
        const missing = rule.bymonthday > lastDay;
        const actualDate =
          missing && rule.invalidDayPolicy === 'skip'
            ? null
            : `${month}-${String(Math.min(rule.bymonthday, lastDay)).padStart(2, '0')}`;
        // Only report months that overlap the inclusive rule range.
        if (
          `${month}-${String(lastDay).padStart(2, '0')}` < rule.startOn ||
          (rule.endOn !== null && `${month}-01` > rule.endOn)
        )
          continue;
        const basisDate = actualDate ?? `${month}-${String(lastDay).padStart(2, '0')}`;
        if (!bounded(basisDate)) continue;
        const inRequestedWeeks = actualDate !== null && requested.has(actualDate);
        monthlyDecisions.push({
          month,
          requestedDay: rule.bymonthday,
          actualDate,
          reason: missing
            ? rule.invalidDayPolicy === 'skip'
              ? 'skip_missing_day'
              : 'last_day'
            : 'requested_day',
          inRequestedWeeks,
        });
        if (inRequestedWeeks) dates.add(actualDate!);
      }
  }
  return {
    weeks: calendars.map((calendar) => ({
      isoYear: calendar.isoYear,
      isoWeek: calendar.isoWeek,
      weekStart: calendar.weekStart,
      weekEnd: calendar.weekEnd,
      occurrenceDates: calendar.days.filter((d) => dates.has(d.date)).map((d) => d.date),
    })),
    ...(rule.freq === 'monthly' ? { monthlyDecisions } : {}),
  };
}
