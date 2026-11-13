import { z } from 'zod';
import {
  zWorkEntryDate,
  zWorkEntryEpoch,
  zWorkEntryId,
  zWorkEntryKind,
  zWorkEntryStatusValue,
  zWorkEntryVersion,
} from './work-entry';
export const zPlanReportItem = z.strictObject({
  sourceEntryId: zWorkEntryId,
  sourceVersion: zWorkEntryVersion,
  sourceDeleted: z.boolean(),
  title: z.string().min(1).max(200),
  kind: zWorkEntryKind,
  status: zWorkEntryStatusValue,
  resumeStatus: z.enum(['todo', 'doing']).nullable(),
  plannedDate: zWorkEntryDate.nullable(),
  dueDate: zWorkEntryDate.nullable(),
  endDate: zWorkEntryDate.nullable(),
  project: z.strictObject({ id: zWorkEntryId, code: z.string().max(60) }).nullable(),
  tags: z.array(
    z.strictObject({ id: zWorkEntryId, label: z.string().max(40), isCore: z.boolean() }),
  ),
  isCarriedOver: z.boolean(),
  counted: z.boolean(),
  completed: z.boolean(),
});
export const zPlanReport = z.strictObject({
  companyId: zWorkEntryId,
  isoYear: z.number().int().min(1).max(9999),
  isoWeek: z.number().int().min(1).max(53),
  mode: z.enum(['live', 'historical']),
  asOf: zWorkEntryEpoch,
  finalized: z.boolean(),
  coverage: z.enum(['complete', 'partial', 'unknown']),
  items: z.array(zPlanReportItem),
  achievement: z
    .strictObject({
      total: z.number().int().nonnegative(),
      completed: z.number().int().nonnegative(),
      rate: z.number().min(0).max(100),
    })
    .nullable(),
});
export type PlanReport = z.output<typeof zPlanReport>;
