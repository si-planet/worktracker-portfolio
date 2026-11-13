import { z } from 'zod';
import {
  zWorkEntryDate,
  zWorkEntryVersion,
  zWorkEntryFinal,
  zWorkEntryId,
  zTaskStatus,
} from './work-entry';
import { zGoalWeek } from './weekly-goal';
import { zWorkCarryoverMembership, zWorkCarryoverSnapshot } from './work-carryover';
export const zDeadlinePlacement = z.strictObject({
  version: zWorkEntryVersion,
  plannedDate: zWorkEntryDate,
});
const ids = z
  .array(zWorkEntryId)
  .min(1)
  .max(100)
  .transform((v) => [...new Set(v)].sort());
export const zDeadlineListQuery = z.strictObject({
  limit: z.number().int().min(1).max(200).default(100),
  cursor: z.string().min(1).max(12000).optional(),
  statuses: z
    .array(zTaskStatus)
    .min(1)
    .max(100)
    .default(['todo', 'doing', 'paused', 'done'])
    .transform((v) => [...new Set(v)].sort()),
  projectIds: ids.optional(),
  tagIds: ids.optional(),
  keyword: z.string().max(100).optional(),
});
export const zDeadlineItem = z.strictObject({
  entry: zWorkEntryFinal,
  membership: zWorkCarryoverMembership.nullable(),
  isPlannedInWeek: z.boolean(),
});
export const zDeadlineList = z.strictObject({
  companyId: zWorkEntryId,
  isoYear: z.number().int(),
  isoWeek: z.number().int(),
  items: z.array(zDeadlineItem),
  nextCursor: z.string().nullable(),
});
export const zDeadlinePlacementResult = z.strictObject({
  entry: zWorkEntryFinal,
  targetWeek: zGoalWeek,
  isPlanned: z.literal(true),
});
export const zDeadlinePlacementSnapshot = zWorkCarryoverSnapshot;
export type DeadlinePlacement = z.output<typeof zDeadlinePlacement>;
export type DeadlineListQuery = z.output<typeof zDeadlineListQuery>;
export type DeadlineList = z.output<typeof zDeadlineList>;
export type DeadlinePlacementResult = z.output<typeof zDeadlinePlacementResult>;
export type DeadlinePlacementSnapshot = z.output<typeof zDeadlinePlacementSnapshot>;
