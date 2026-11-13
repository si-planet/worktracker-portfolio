import { z } from 'zod';
import { zWorkEntryId, zWorkEntryVersion } from './work-entry';

// A display preference, deliberately separate from work snapshots/import receipts.
export const zWorkColor = z
  .string()
  .regex(/^#[0-9a-fA-F]{6}$/)
  .transform((value) => value.toLowerCase());
export const zWorkColorScope = z.strictObject({
  companyId: zWorkEntryId,
  workEntryId: zWorkEntryId,
});
export const zWorkColorWrite = z.strictObject({
  color: zWorkColor.nullable(),
  version: zWorkEntryVersion.nullable(),
});
export const zWorkColorItem = z.strictObject({
  workEntryId: zWorkEntryId,
  color: zWorkColor.nullable(),
  version: zWorkEntryVersion.nullable(),
});
export const zWorkColors = z.strictObject({
  companyId: zWorkEntryId,
  items: z.array(zWorkColorItem).max(50),
});
export const zWorkColorIds = z
  .array(zWorkEntryId)
  .min(1)
  .max(50)
  .refine((ids) => new Set(ids).size === ids.length);
export type WorkColorItem = z.infer<typeof zWorkColorItem>;
