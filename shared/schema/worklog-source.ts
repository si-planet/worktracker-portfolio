import { z } from 'zod';
import { zWorkEntryId, zWorkEntryVersion } from './work-entry';
import { zWorklogItem, zWorklogRun } from './worklog-import';
import { WorkQueryError } from './work-query';

export const WORKLOG_SOURCE_LIMITS = { defaultLimit: 16, maxLimit: 32 } as const;
export const zWorklogSourceKind = z.enum([
  'sheet',
  'cell',
  'row',
  'group',
  'source_membership',
  'interpretation',
  'iso_membership',
  'relation',
]);
const limit = z
  .number()
  .int()
  .min(1)
  .max(WORKLOG_SOURCE_LIMITS.maxLimit)
  .default(WORKLOG_SOURCE_LIMITS.defaultLimit);
const cursor = z
  .string()
  .min(1)
  .max(1024)
  .regex(/^[A-Za-z0-9_-]+$/)
  .optional();
export const zWorklogSourceRunsQuery = z.strictObject({
  limit,
  cursor,
  sourceSha256: z
    .string()
    .regex(/^[0-9a-f]{64}$/)
    .optional(),
});
export const zWorklogSourceItemsQuery = z
  .strictObject({
    version: zWorkEntryVersion,
    limit,
    cursor,
    kind: zWorklogSourceKind.optional(),
    sheetId: zWorkEntryId.optional(),
  })
  .refine((q) => q.sheetId === undefined || ['cell', 'row', 'group'].includes(q.kind ?? ''), {
    message: 'SOURCE_SHEET_KIND_REQUIRED',
    path: ['sheetId'],
  });
export type WorklogSourceRunsQuery = z.output<typeof zWorklogSourceRunsQuery>;
export type WorklogSourceItemsQuery = z.output<typeof zWorklogSourceItemsQuery>;

function decode(parameters: URLSearchParams, keys: readonly string[]) {
  const decoded = Object.create(null) as Record<string, unknown>;
  for (const key of new Set(parameters.keys())) {
    const values = parameters.getAll(key);
    if (!keys.includes(key) || values.length !== 1) throw new WorkQueryError();
    const value = values[0]!;
    decoded[key] =
      ['limit', 'version'].includes(key) && /^[1-9][0-9]*$/.test(value) ? Number(value) : value;
  }
  return decoded;
}
export const parseWorklogSourceRunsQuery = (parameters: URLSearchParams) =>
  zWorklogSourceRunsQuery.parse(decode(parameters, ['limit', 'cursor', 'sourceSha256']));
export const parseWorklogSourceItemsQuery = (parameters: URLSearchParams) =>
  zWorklogSourceItemsQuery.parse(
    decode(parameters, ['version', 'limit', 'cursor', 'kind', 'sheetId']),
  );

export const zWorklogSourceRunPage = z.strictObject({
  companyId: zWorkEntryId,
  items: z.array(zWorklogRun).max(WORKLOG_SOURCE_LIMITS.maxLimit),
  nextCursor: z.string().nullable(),
});
export const zWorklogSourceItemPage = z.strictObject({
  run: zWorklogRun,
  items: z.array(zWorklogItem).max(WORKLOG_SOURCE_LIMITS.maxLimit),
  nextCursor: z.string().nullable(),
  query: z.strictObject({
    limit: z.number().int().min(1).max(WORKLOG_SOURCE_LIMITS.maxLimit),
    kind: zWorklogSourceKind.nullable(),
    sheetId: zWorkEntryId.nullable(),
  }),
});
export type WorklogSourceRunPage = z.output<typeof zWorklogSourceRunPage>;
export type WorklogSourceItemPage = z.output<typeof zWorklogSourceItemPage>;
