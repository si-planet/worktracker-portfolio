import { z } from 'zod';
import { zWorkEntryDate, zWorkEntryId, zWorkEntryKind, zWorkEntryStatusValue } from './work-entry';

const setOf = <T extends z.ZodType<string>>(schema: T, maximum: number) =>
  z
    .array(schema)
    .min(1)
    .max(maximum)
    .transform((values) => [...new Set(values)].sort());

/** Decoded filters also validate direct server calls; URL decoding lives below. */
export const zWorkListQuery = z
  .strictObject({
    dateState: z.enum(['all', 'scheduled', 'unscheduled']).default('all'),
    // Omitted keeps stored schedule semantics for existing calendar/search callers.
    projection: z.enum(['scheduled', 'working']).optional(),
    from: zWorkEntryDate.optional(),
    to: zWorkEntryDate.optional(),
    year: z.number().int().min(1).max(9999).optional(),
    kinds: setOf(zWorkEntryKind, 100).optional(),
    statuses: setOf(zWorkEntryStatusValue, 100).optional(),
    projectIds: setOf(zWorkEntryId, 100).optional(),
    tagIds: setOf(zWorkEntryId, 100).optional(),
    keyword: z.string().max(100).optional(),
    limit: z.number().int().min(1).max(200).default(100),
    cursor: z.string().min(1).max(12000).optional(),
  })
  .superRefine((value, context) => {
    if (value.from && value.to && value.from > value.to)
      context.addIssue({
        code: 'custom',
        path: ['to'],
        message: 'INVALID_DATE_RANGE',
      });
    if (value.projection === 'working' && value.dateState !== 'scheduled')
      context.addIssue({
        code: 'custom',
        path: ['projection'],
        message: 'SCHEDULED_REQUIRED',
      });
    if (
      value.dateState === 'unscheduled' &&
      (value.from !== undefined ||
        value.to !== undefined ||
        value.year !== undefined ||
        value.kinds?.some((kind) => kind !== 'task') ||
        value.statuses?.some(
          (status) => status !== 'todo' && status !== 'paused' && status !== 'canceled',
        ))
    )
      context.addIssue({
        code: 'custom',
        message: 'INVALID_UNSCHEDULED_FILTER',
      });
  });
export type WorkListQuery = z.output<typeof zWorkListQuery>;

const repeatedKeys = new Set(['kinds', 'statuses', 'projectIds', 'tagIds']);
const numericKeys = new Set(['year', 'limit']);
const allowedKeys = new Set([
  'dateState',
  'projection',
  'from',
  'to',
  'year',
  'kinds',
  'statuses',
  'projectIds',
  'tagIds',
  'keyword',
  'limit',
  'cursor',
]);
export class WorkQueryError extends Error {
  constructor() {
    super('INVALID_WORK_QUERY');
    this.name = 'WorkQueryError';
  }
}

/** Repeated array keys are intentional; duplicate scalar keys are ambiguous. */
export function parseWorkListQuery(parameters: URLSearchParams): WorkListQuery {
  const decoded = Object.create(null) as Record<string, unknown>;
  for (const key of new Set(parameters.keys())) {
    // Zod intentionally skips prototype keys, so reject every unknown URL key here.
    if (!allowedKeys.has(key)) throw new WorkQueryError();
    const values = parameters.getAll(key);
    if (repeatedKeys.has(key)) decoded[key] = values;
    else {
      if (values.length !== 1) throw new WorkQueryError();
      const value = values[0]!;
      decoded[key] = numericKeys.has(key) && /^[0-9]+$/.test(value) ? Number(value) : value;
    }
  }
  return zWorkListQuery.parse(decoded);
}
