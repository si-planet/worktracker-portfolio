import { z } from 'zod';
import { zWorkEntryDate, zWorkEntryId } from './work-entry';
export const zWbsExcelRow = z
  .strictObject({
    sourceRow: z.number().int().min(1),
    code: z.string().trim().min(1).max(80),
    title: z.string().trim().min(1).max(200),
    description: z.string().max(5000).nullable(),
    plannedStartOn: zWorkEntryDate.nullable(),
    plannedEndOn: zWorkEntryDate.nullable(),
    sortOrder: z.number().int().min(0).max(199),
  })
  .refine((r) => !r.plannedStartOn || !r.plannedEndOn || r.plannedStartOn <= r.plannedEndOn);
export const zWbsExcelRequest = z
  .strictObject({
    year: z.number().int().min(1).max(9999),
    rows: z.array(zWbsExcelRow).min(1).max(200),
  })
  .superRefine((v, c) => {
    const codes = new Set<string>();
    v.rows.forEach((r, i) => {
      const code = r.code.normalize('NFKC').toLocaleLowerCase();
      if (codes.has(code))
        c.addIssue({ code: 'custom', message: '기능번호 중복', path: ['rows', i, 'code'] });
      codes.add(code);
      if (r.sortOrder !== i)
        c.addIssue({ code: 'custom', message: '표시 순서 불일치', path: ['rows', i, 'sortOrder'] });
    });
  });
export const zWbsExcelPreview = z.strictObject({
  projectId: zWorkEntryId,
  year: z.number().int(),
  rowCount: z.number().int(),
  canCreate: z.boolean(),
  alreadyImported: z.boolean(),
  existingPlanId: zWorkEntryId.nullable(),
  existingCount: z.number().int(),
  identicalCount: z.number().int(),
  fingerprint: z.string().regex(/^[a-f0-9]{64}$/),
});
export const zWbsExcelResult = z.strictObject({
  planId: zWorkEntryId,
  projectId: zWorkEntryId,
  year: z.number().int(),
  rowCount: z.number().int(),
  replayed: z.boolean(),
});
export type WbsExcelRequest = z.infer<typeof zWbsExcelRequest>;
