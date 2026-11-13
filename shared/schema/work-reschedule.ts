import { z } from 'zod';
import { zWorkEntryDate, zWorkEntryVersion } from './work-entry';
const common = { version: zWorkEntryVersion, reason: z.string().max(5000).nullable().optional() };
export const zWorkExtend = z.strictObject({ ...common, newDueDate: zWorkEntryDate });
export const zWorkPostpone = z.strictObject({
  ...common,
  newPlannedDate: zWorkEntryDate,
  newDueDate: zWorkEntryDate.optional(),
});
export type WorkExtend = z.output<typeof zWorkExtend>;
export type WorkPostpone = z.output<typeof zWorkPostpone>;
