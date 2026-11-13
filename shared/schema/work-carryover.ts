import { z } from 'zod';
import { zWorkEntryDate, zWorkEntryVersion, zWorkEntryFinal } from './work-entry';
import { zGoalWeek } from './weekly-goal';
export const zWorkCarryover = z.strictObject({
  version: zWorkEntryVersion,
  newPlannedDate: zWorkEntryDate,
  reason: z.string().max(5000).nullable().optional(),
});
export const zWorkCarryoverResult = z.strictObject({
  entry: zWorkEntryFinal,
  targetWeek: zGoalWeek,
  isCarriedOver: z.literal(true),
});
export const zWorkCarryoverMembership = z.strictObject({
  isoYear: z.number().int(),
  isoWeek: z.number().int(),
  sourceVersion: zWorkEntryVersion,
  isCarriedOver: z.boolean(),
  finalized: z.boolean(),
});
export const zWorkCarryoverSnapshot = z
  .strictObject({
    sourceVersion: zWorkEntryVersion,
    entry: zWorkEntryFinal,
    membership: zWorkCarryoverMembership.nullable(),
  })
  .refine((v) => v.sourceVersion === v.entry.version);
export type WorkCarryover = z.output<typeof zWorkCarryover>;
export type WorkCarryoverResult = z.output<typeof zWorkCarryoverResult>;
export type WorkCarryoverSnapshot = z.output<typeof zWorkCarryoverSnapshot>;
