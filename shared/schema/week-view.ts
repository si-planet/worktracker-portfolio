import { z } from 'zod';
import {
  zLeaveCalculationBasis,
  zWorkEntryDate,
  zWorkEntryFinal,
  zWorkEntryId,
  zWorkEntryVersion,
} from './work-entry';
import { parseWorkListQuery, WorkQueryError, zWorkListQuery } from './work-query';
import { weekCalendar } from '../week-calendar';
import { entryDatesForWeek } from '../work-state-projection';

export const zWeekQuery = z.strictObject({
  projection: zWorkListQuery.shape.projection,
  kinds: zWorkListQuery.shape.kinds,
  statuses: zWorkListQuery.shape.statuses,
  projectIds: zWorkListQuery.shape.projectIds,
  tagIds: zWorkListQuery.shape.tagIds,
  keyword: zWorkListQuery.shape.keyword,
  limit: zWorkListQuery.shape.limit,
  cursor: zWorkListQuery.shape.cursor,
});
export type WeekQuery = z.output<typeof zWeekQuery>;
export function parseWeekQuery(parameters: URLSearchParams): WeekQuery {
  if (['dateState', 'from', 'to', 'year'].some((key) => parameters.has(key)))
    throw new WorkQueryError();
  const scheduledParameters = new URLSearchParams(parameters);
  scheduledParameters.set('dateState', 'scheduled');
  const query = Object.fromEntries(
    Object.entries(parseWorkListQuery(scheduledParameters)).filter(([key]) => key !== 'dateState'),
  );
  return zWeekQuery.parse(query);
}
export const zWeekDay = z.strictObject({
  date: zWorkEntryDate,
  weekday: z.number().int().min(1).max(7),
  isWeekend: z.boolean(),
  entries: z.array(zWorkEntryFinal),
  calculationBasis: zLeaveCalculationBasis,
  inputPolicy: z.strictObject({
    allowTaskInput: z.boolean(),
    version: zWorkEntryVersion.nullable(),
  }),
  leaveSummary: z.strictObject({
    unavailableHours: z.number().int().nonnegative(),
    amHours: z.number().int().nonnegative(),
    pmHours: z.number().int().nonnegative(),
    canAddTask: z.boolean(),
    inputBlockReason: z.literal('FULL_DAY_LEAVE').nullable(),
  }),
});
export const zWeekView = z
  .strictObject({
    companyId: zWorkEntryId,
    projection: zWorkListQuery.shape.projection,
    isoYear: z.number().int().min(1).max(9999),
    isoWeek: z.number().int().min(1).max(53),
    weekStart: zWorkEntryDate,
    weekEnd: zWorkEntryDate,
    days: z.array(zWeekDay).min(5).max(7),
    nextCursor: z.string().min(1).max(12000).nullable(),
  })
  .superRefine((value, context) => {
    try {
      const calendar = weekCalendar(value.isoYear, value.isoWeek);
      const expected = calendar.days.filter((day) =>
        value.days.some((shown) => shown.date === day.date),
      );
      if (
        value.weekStart !== calendar.weekStart ||
        value.weekEnd !== calendar.weekEnd ||
        expected.length !== value.days.length ||
        calendar.days
          .slice(0, 5)
          .some((day) => !value.days.some((shown) => shown.date === day.date))
      )
        throw new Error('WEEK_RANGE');
      for (const [index, day] of value.days.entries()) {
        const expectedDay = expected[index]!;
        if (
          day.date !== expectedDay.date ||
          day.weekday !== expectedDay.weekday ||
          day.isWeekend !== expectedDay.isWeekend ||
          day.calculationBasis.date !== day.date ||
          day.inputPolicy.version !== day.calculationBasis.dayVersion ||
          day.leaveSummary.canAddTask !== (day.leaveSummary.inputBlockReason === null) ||
          new Set(day.entries.map((entry) => entry.id)).size !== day.entries.length ||
          day.entries.some(
            (entry) =>
              entry.companyId !== value.companyId ||
              !entryDatesForWeek(entry, calendar, value.projection).includes(day.date),
          )
        )
          throw new Error('WEEK_DAY');
      }
    } catch {
      context.addIssue({
        code: 'custom',
        message: '주간 범위·기록·날짜 정책이 일치하지 않습니다.',
      });
    }
  });
export type WeekView = z.infer<typeof zWeekView>;
