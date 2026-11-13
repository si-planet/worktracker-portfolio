import { z } from 'zod';
import { zWorkEntryDate } from './work-entry';
import { weekCalendar } from '../week-calendar';

/** Weekly only. Weekdays use ISO numbering (Monday=1, Sunday=7). */
export const zWeeklyRecurrenceRule = z
  .strictObject({
    freq: z.literal('weekly'),
    startOn: zWorkEntryDate,
    endOn: zWorkEntryDate.nullable().default(null),
    interval: z.number().int().min(1).max(12).default(1),
    byweekday: z.array(z.number().int().min(1).max(7)).min(1).max(7),
    isActive: z.boolean().default(true),
  })
  .refine((v) => v.endOn === null || v.startOn <= v.endOn, {
    path: ['endOn'],
    message: '종료일은 시작일보다 빠를 수 없습니다.',
  })
  .refine((v) => new Set(v.byweekday).size === v.byweekday.length, {
    path: ['byweekday'],
    message: '반복 요일을 중복 지정할 수 없습니다.',
  });
export const zWeeklyRecurrenceWeek = z
  .strictObject({
    isoYear: z.number().int().min(1).max(9999),
    isoWeek: z.number().int().min(1).max(53),
  })
  .refine((v) => {
    try {
      weekCalendar(v.isoYear, v.isoWeek);
      return true;
    } catch {
      return false;
    }
  }, '앱 날짜 범위 안의 실제 ISO 주를 지정하세요.');
const requestedWeeks = z
  .array(zWeeklyRecurrenceWeek)
  .min(1)
  .max(26)
  .refine(
    (weeks) => new Set(weeks.map((w) => `${w.isoYear}:${w.isoWeek}`)).size === weeks.length,
    '요청 ISO 주가 중복되었습니다.',
  );
export const zWeeklyRecurrenceCandidatesInput = z.strictObject({
  rule: zWeeklyRecurrenceRule,
  weeks: requestedWeeks,
});
export const zWeeklyRecurrenceCandidateWeek = zWeeklyRecurrenceWeek
  .safeExtend({
    weekStart: zWorkEntryDate,
    weekEnd: zWorkEntryDate,
    occurrenceDates: z.array(zWorkEntryDate).max(7),
  })
  .refine((v) => {
    try {
      const calendar = weekCalendar(v.isoYear, v.isoWeek);
      return (
        v.weekStart === calendar.weekStart &&
        v.weekEnd === calendar.weekEnd &&
        v.occurrenceDates.every(
          (date, index) =>
            date >= v.weekStart &&
            date <= v.weekEnd &&
            (index === 0 || v.occurrenceDates[index - 1]! < date),
        )
      );
    } catch {
      return false;
    }
  }, '원래 회차 날짜를 해당 ISO 주 안에서 중복 없이 날짜순으로 반환하세요.');
export const zWeeklyRecurrenceCandidates = z
  .strictObject({
    weeks: z.array(zWeeklyRecurrenceCandidateWeek).min(1).max(26),
  })
  .refine(
    (v) =>
      v.weeks.every((week, index) => index === 0 || v.weeks[index - 1]!.weekStart < week.weekStart),
    '결과 ISO 주를 중복 없이 날짜순으로 반환하세요.',
  );
export type WeeklyRecurrenceRule = z.output<typeof zWeeklyRecurrenceRule>;
export type WeeklyRecurrenceCandidatesInput = z.input<typeof zWeeklyRecurrenceCandidatesInput>;
export type WeeklyRecurrenceCandidates = z.output<typeof zWeeklyRecurrenceCandidates>;
