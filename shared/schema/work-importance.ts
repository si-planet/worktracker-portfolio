import { z } from 'zod';
import { zWorkEntryId, zWorkEntryVersion } from './work-entry';
// Personal display preference, not a work/deadline field or imported source mutation.
export const zWorkImportance = z.boolean();
export const zWorkImportanceScope = z.strictObject({
  companyId: zWorkEntryId,
  workEntryId: zWorkEntryId,
});
export const zWorkImportanceWrite = z.strictObject({
  importance: zWorkImportance.nullable(),
  version: zWorkEntryVersion.nullable(),
});
export const zWorkImportanceItem = z.strictObject({
  workEntryId: zWorkEntryId,
  importance: zWorkImportance.nullable(),
  version: zWorkEntryVersion.nullable(),
});
export const zWorkImportanceList = z.strictObject({
  companyId: zWorkEntryId,
  items: z.array(zWorkImportanceItem).max(50),
});
export const zWorkImportanceIds = z
  .array(zWorkEntryId)
  .min(1)
  .max(50)
  .refine((ids) => new Set(ids).size === ids.length);
export type WorkImportanceItem = z.infer<typeof zWorkImportanceItem>;
