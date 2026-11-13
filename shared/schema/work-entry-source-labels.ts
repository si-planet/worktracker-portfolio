import { z } from 'zod';
import { zWorkEntryId, zWorkEntryVersion } from './work-entry';

export const zWorkEntrySourceLabelIds = z
  .array(zWorkEntryId)
  .min(1)
  .max(50)
  .refine((ids) => new Set(ids).size === ids.length);
export const zWorkEntrySourceLabelsResult = z
  .strictObject({
    companyId: zWorkEntryId,
    available: z.boolean(),
    items: z
      .array(
        z.strictObject({
          entryId: zWorkEntryId,
          entryVersion: zWorkEntryVersion,
          sourceCategories: z
            .array(
              z
                .string()
                .min(1)
                .max(32768)
                .refine((s) => s.trim().length > 0),
            )
            .min(1)
            .max(200)
            .refine((values) => new Set(values).size === values.length),
        }),
      )
      .max(50),
  })
  .refine((v) => new Set(v.items.map((i) => i.entryId)).size === v.items.length)
  .refine((v) => v.available || v.items.length === 0);
export type WorkEntrySourceLabelsResult = z.infer<typeof zWorkEntrySourceLabelsResult>;
