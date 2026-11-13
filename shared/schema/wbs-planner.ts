import { z } from 'zod';
import { zWorkEntryId, zWorkEntryEpoch, zWorkEntryVersion } from './work-entry';
import { zWbsYear, zWbsItem, zWbsPlan } from './wbs';
import { zWbsActualPeriod } from './wbs-actual-period';
export const zWbsPlannerQuery = z.strictObject({ year: zWbsYear });
export function parseWbsPlannerQuery(params: URLSearchParams) {
  if (
    [...params.keys()].some((key) => key !== 'year') ||
    params.getAll('year').length !== 1 ||
    !/^[0-9]{1,4}$/.test(params.get('year') ?? '')
  )
    throw new Error('INVALID_PLANNER_QUERY');
  return zWbsPlannerQuery.parse({ year: Number(params.get('year')) });
}
export const zWbsPlannerItem = zWbsItem
  .safeExtend({ actualPeriod: zWbsActualPeriod })
  .refine((v) => {
    const a = v.actualPeriod;
    return (
      a.itemId === v.id &&
      a.companyId === v.companyId &&
      a.planId === v.planId &&
      a.itemVersion === v.version &&
      a.hasRevisedSchedule === v.hasRevisedSchedule &&
      a.originalPlan.startOn === v.plannedStartOn &&
      a.originalPlan.endOn === v.plannedEndOn &&
      a.effectivePlan.startOn === v.effectiveStartOn &&
      a.effectivePlan.endOn === v.effectiveEndOn
    );
  });
export const zWbsPlannerPlan = zWbsPlan
  .safeExtend({ items: z.array(zWbsPlannerItem) })
  .refine(
    (v) =>
      v.items.every(
        (i) => i.actualPeriod.projectId === v.projectId && i.actualPeriod.planVersion === v.version,
      ) && new Set(v.items.map((i) => i.id)).size === v.items.length,
  );
export const zWbsPlannerProject = z
  .strictObject({
    id: zWorkEntryId,
    companyId: zWorkEntryId,
    code: z.string().min(1).max(60),
    color: z
      .string()
      .regex(/^#[0-9a-fA-F]{6}$/)
      .nullable(),
    isActive: z.boolean(),
    version: zWorkEntryVersion,
    plans: z.array(zWbsPlannerPlan),
  })
  .refine(
    (v) =>
      v.plans.every((p) => p.projectId === v.id && p.companyId === v.companyId) &&
      new Set(v.plans.map((p) => p.id)).size === v.plans.length,
  );
export const zWbsPlanner = z
  .strictObject({
    companyId: zWorkEntryId,
    year: zWbsYear,
    asOf: zWorkEntryEpoch,
    projects: z.array(zWbsPlannerProject),
  })
  .refine(
    (v) =>
      v.projects.every(
        (p) =>
          p.companyId === v.companyId &&
          p.plans.every(
            (plan) =>
              plan.year === v.year && plan.items.every((i) => i.actualPeriod.asOf === v.asOf),
          ),
      ) && new Set(v.projects.map((p) => p.id)).size === v.projects.length,
  );
export type WbsPlanner = z.output<typeof zWbsPlanner>;
export type WbsPlannerProject = z.output<typeof zWbsPlannerProject>;
export type WbsPlannerPlan = z.output<typeof zWbsPlannerPlan>;
export type WbsPlannerItem = z.output<typeof zWbsPlannerItem>;
