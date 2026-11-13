import { z } from 'zod';
import { zWorkEntryId, zWorkEntryDate, zWorkEntryVersion, zWorkEntryEpoch } from './work-entry';
const count = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
const dayDifference = z
  .number()
  .int()
  .min(-Number.MAX_SAFE_INTEGER)
  .max(Number.MAX_SAFE_INTEGER)
  .nullable();
export const zWbsActualPeriodRange = z
  .strictObject({ startOn: zWorkEntryDate.nullable(), endOn: zWorkEntryDate.nullable() })
  .refine((v) => v.startOn === null || v.endOn === null || v.startOn <= v.endOn);
export const zWbsActualPeriodDifference = z.strictObject({
  startDays: dayDifference,
  endDays: dayDifference,
});
/** Calendar dates use UTC only for arithmetic; positive means actual is later. */
export function wbsActualDayDifference(
  actual: string | null,
  planned: string | null,
): number | null {
  if (actual === null || planned === null) return null;
  const a = zWorkEntryDate.parse(actual),
    p = zWorkEntryDate.parse(planned);
  return (Date.parse(`${a}T00:00:00.000Z`) - Date.parse(`${p}T00:00:00.000Z`)) / 86400000;
}
export const zWbsActualPeriod = z
  .strictObject({
    itemId: zWorkEntryId,
    companyId: zWorkEntryId,
    projectId: zWorkEntryId,
    planId: zWorkEntryId,
    itemVersion: zWorkEntryVersion,
    planVersion: zWorkEntryVersion,
    asOf: zWorkEntryEpoch,
    linkedCount: count,
    eligibleCount: count,
    hasRevisedSchedule: z.boolean(),
    actual: zWbsActualPeriodRange,
    originalPlan: zWbsActualPeriodRange,
    effectivePlan: z
      .strictObject({
        source: z.enum(['original', 'revised']),
        startOn: zWorkEntryDate.nullable(),
        endOn: zWorkEntryDate.nullable(),
      })
      .refine((v) => v.startOn === null || v.endOn === null || v.startOn <= v.endOn),
    difference: z.strictObject({
      original: zWbsActualPeriodDifference,
      effective: zWbsActualPeriodDifference,
    }),
  })
  .superRefine((v, c) => {
    const issue = (path: (string | number)[], message: string) =>
      c.addIssue({ code: 'custom', path, message });
    if (v.eligibleCount > v.linkedCount)
      issue(['eligibleCount'], '대상 수는 전체 연결 수보다 클 수 없습니다.');
    if (
      (v.eligibleCount === 0) !== (v.actual.startOn === null && v.actual.endOn === null) ||
      (v.actual.startOn === null) !== (v.actual.endOn === null)
    )
      issue(['actual'], '대상 없음과 실제 기간의 양끝을 일치시키세요.');
    if (v.effectivePlan.source !== (v.hasRevisedSchedule ? 'revised' : 'original'))
      issue(['effectivePlan', 'source'], '변경 일정 표시와 유효 일정 출처를 일치시키세요.');
    if (
      !v.hasRevisedSchedule &&
      (v.effectivePlan.startOn !== v.originalPlan.startOn ||
        v.effectivePlan.endOn !== v.originalPlan.endOn)
    )
      issue(['effectivePlan'], '변경이 없으면 원래 계획을 사용하세요.');
    // Child date refinements may fail without stopping this object refinement.
    // Preserve those issues and avoid parsing invalid dates during arithmetic.
    if (
      [v.actual, v.originalPlan, v.effectivePlan].some((range) =>
        [range.startOn, range.endOn].some(
          (date) => date !== null && !zWorkEntryDate.safeParse(date).success,
        ),
      )
    )
      return;
    for (const plan of ['original', 'effective'] as const) {
      const range = plan === 'original' ? v.originalPlan : v.effectivePlan;
      for (const end of ['start', 'end'] as const) {
        const expected = wbsActualDayDifference(
          v.actual[end === 'start' ? 'startOn' : 'endOn'],
          range[end === 'start' ? 'startOn' : 'endOn'],
        );
        if (v.difference[plan][end === 'start' ? 'startDays' : 'endDays'] !== expected)
          issue(
            ['difference', plan, end + 'Days'],
            '실제일에서 대응 계획일을 뺀 달력 일수를 사용하세요.',
          );
      }
    }
  });
export type WbsActualPeriod = z.output<typeof zWbsActualPeriod>;
