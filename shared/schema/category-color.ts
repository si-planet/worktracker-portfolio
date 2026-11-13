import { z } from 'zod';
import { zWorkColor } from './work-color';
import { zWorkEntryId, zWorkEntryVersion } from './work-entry';

// Account/company display preferences, never task or catalog mutations.
export const zCategoryColorKind = z.enum(['project', 'tag']);
export const zCategoryColorScope = z.strictObject({
  companyId: zWorkEntryId,
  kind: zCategoryColorKind,
  targetId: zWorkEntryId,
});
export const zCategoryColorWrite = z.strictObject({
  color: zWorkColor.nullable(),
  version: zWorkEntryVersion.nullable(),
});
export const zCategoryColorItem = z.strictObject({
  kind: zCategoryColorKind,
  targetId: zWorkEntryId,
  color: zWorkColor.nullable(),
  version: zWorkEntryVersion.nullable(),
});
export const zCategoryColors = z.strictObject({
  companyId: zWorkEntryId,
  items: z.array(zCategoryColorItem),
});
export type CategoryColorItem = z.infer<typeof zCategoryColorItem>;
