import { z } from 'zod';
import { zWorkEntryId, zWorkEntryVersion, zWorkEntryEpoch } from './work-entry';
export const zMonthlyFocusMonth = z.strictObject({
  year: z.number().int().min(1).max(9999),
  month: z.number().int().min(1).max(12),
});
const fields = {
  title: z.string().min(1).max(200),
  detail: z.string().max(5000).nullable(),
  sortOrder: z.number().int().min(-Number.MAX_SAFE_INTEGER).max(Number.MAX_SAFE_INTEGER),
};
export const zMonthlyFocusCreate = z.strictObject({
  id: zWorkEntryId,
  ...zMonthlyFocusMonth.shape,
  ...fields,
  detail: fields.detail.default(null),
  sortOrder: fields.sortOrder.default(0),
});
export const zMonthlyFocusPatch = z
  .strictObject({
    version: zWorkEntryVersion,
    title: fields.title.optional(),
    detail: fields.detail.optional(),
    sortOrder: fields.sortOrder.optional(),
  })
  .refine((v) =>
    ['title', 'detail', 'sortOrder'].some((k) => v[k as keyof typeof v] !== undefined),
  );
export const zMonthlyFocusDelete = z.strictObject({ version: zWorkEntryVersion });
export const zMonthlyFocusItem = z.strictObject({
  id: zWorkEntryId,
  companyId: zWorkEntryId,
  ...zMonthlyFocusMonth.shape,
  ...fields,
  createdAt: zWorkEntryEpoch,
  updatedAt: zWorkEntryEpoch,
  version: zWorkEntryVersion,
});
export const zMonthlyFocusList = z.strictObject({
  companyId: zWorkEntryId,
  ...zMonthlyFocusMonth.shape,
  items: z.array(zMonthlyFocusItem),
});
export type MonthlyFocusCreate = z.output<typeof zMonthlyFocusCreate>;
export type MonthlyFocusPatch = z.output<typeof zMonthlyFocusPatch>;
export type MonthlyFocusItem = z.output<typeof zMonthlyFocusItem>;
export type MonthlyFocusList = z.output<typeof zMonthlyFocusList>;
