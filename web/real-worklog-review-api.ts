import { z } from 'zod';
import { zWorkEntryDate } from '../shared/schema/work-entry';

export const zLocalReviewRange = z.enum(['aug-sep', 'sep-oct']);
export type LocalReviewRange = z.output<typeof zLocalReviewRange>;
const text = z.string().max(100_000);
const scalar = z.union([text, z.number().finite(), z.boolean(), z.null()]);
const nullableDate = zWorkEntryDate.nullable();
const zSourceFields = z.object({
  number: z.number().int(),
  category: text,
  title: text,
  priority: scalar.optional(),
  due: scalar.optional(),
  completion: scalar.optional(),
  remarks: scalar.optional(),
});

export const zLocalReviewRecord = z.object({
  sourceRecordId: z.string().min(1).max(300),
  sourceFileSha256: z.string().regex(/^[a-f0-9]{64}$/),
  sourceTab: text,
  sourceMonth: z.number().int().min(1).max(12),
  sourceWeekStartRow: z.number().int().positive(),
  sourceRow: z.number().int().positive(),
  section: z.enum(['weeklySummary', 'daily']),
  sourceTitleCell: text,
  sourceCells: z.array(text),
  fields: zSourceFields,
  categoryDisplayValue: text,
  sourceCompletionState: z.enum(['checked', 'unchecked', 'blank']),
  originalDayHeader: scalar,
  weekdaySlot: z.number().int().min(0).max(7).nullable(),
  explicitWeekStart: nullableDate,
  activityDate: nullableDate,
  candidateWeekStart: nullableDate,
  candidateActivityDate: nullableDate,
  dateBasis: z.enum([
    'not_day_record',
    'explicit_day_header',
    'explicit_week_plus_column_proposal',
    'adjacent_block_proposal',
  ]),
  dueDateParsed: nullableDate,
  normalized: z.object({
    title: text,
    description: text.nullable(),
    projectContextOriginal: text,
    tags: z.null(),
    status: z.null(),
    sourceStatusLabel: text,
    hours: z.null(),
    startAt: z.null(),
    endAt: z.null(),
    completedAt: z.null(),
    kpi: z.null(),
  }),
  issueCodes: z.array(text),
  materializationApproved: z.literal(false),
});
export type LocalReviewRecord = z.output<typeof zLocalReviewRecord>;

export const zLocalWorklogReview = z
  .object({
    format: z.literal('worktracker-local-review-sample/v1'),
    label: text,
    companyContext: z.object({
      companyName: text,
      employmentStartMonth: z.string().regex(/^[0-9]{4}-(0[1-9]|1[0-2])$/),
      currentEmployment: z.boolean(),
      contextBasis: z.literal('user_statement'),
    }),
    source: z.object({ byteSha256: z.string().regex(/^[a-f0-9]{64}$/) }),
    months: z.array(z.number().int().min(1).max(12)).length(2),
    basis: text,
    records: z.array(zLocalReviewRecord).max(10_000),
    compactRecordIds: z.array(z.string()).max(16),
    overlapGroups: z.array(
      z.object({
        id: text,
        type: text,
        recordIds: z.array(text),
        basis: text,
        merge: z.literal(false),
        delete: z.literal(false),
        completionPropagation: z.literal(false),
      }),
    ),
    weeklyDailyCandidates: z.array(
      z.object({
        weeklySummarySourceId: text,
        dailySourceId: text,
        state: z.literal('candidate'),
        basis: text,
        merge: z.literal(false),
        completionPropagation: z.literal(false),
      }),
    ),
  })
  .superRefine((value, context) => {
    const ids = new Set(value.records.map((row) => row.sourceRecordId));
    if (
      ids.size !== value.records.length ||
      new Set(value.compactRecordIds).size !== value.compactRecordIds.length ||
      value.compactRecordIds.some((id) => !ids.has(id)) ||
      value.records.some(
        (row) =>
          row.sourceFileSha256 !== value.source.byteSha256 ||
          !value.months.includes(row.sourceMonth) ||
          (row.activityDate !== null &&
            (row.section !== 'daily' || row.dateBasis !== 'explicit_day_header')),
      )
    )
      context.addIssue({
        code: 'custom',
        message: '원문 식별자·출처·확인 날짜를 검토해야 합니다.',
      });
  });
export type LocalWorklogReview = z.output<typeof zLocalWorklogReview>;

export function reviewRecords(value: LocalWorklogReview, full: boolean) {
  if (full) return value.records;
  const byId = new Map(value.records.map((row) => [row.sourceRecordId, row]));
  return value.compactRecordIds.map((id) => byId.get(id)!);
}
export function confirmedReviewDates(value: LocalWorklogReview) {
  return [
    ...new Set(value.records.flatMap((row) => (row.activityDate ? [row.activityDate] : []))),
  ].sort();
}
export function confirmedDayRecords(value: LocalWorklogReview, date: string) {
  return value.records.filter((row) => row.section === 'daily' && row.activityDate === date);
}
export function isLocalReviewHost(hostname: string) {
  return ['localhost', '127.0.0.1', '[::1]', '::1'].includes(hostname);
}

export class LocalReviewFailure extends Error {
  constructor(
    readonly code:
      | 'LOCAL_ONLY'
      | 'OFFLINE'
      | 'AUTH_REQUIRED'
      | 'FORBIDDEN'
      | 'NOT_AVAILABLE'
      | 'INVALID_DATA'
      | 'TIMEOUT'
      | 'ABORTED'
      | 'UNAVAILABLE',
  ) {
    super(code);
  }
}

export async function readLocalWorklogReview(
  range: LocalReviewRange,
  signal?: AbortSignal,
): Promise<LocalWorklogReview> {
  if (!isLocalReviewHost(location.hostname)) throw new LocalReviewFailure('LOCAL_ONLY');
  if (!navigator.onLine) throw new LocalReviewFailure('OFFLINE');
  const parsedRange = zLocalReviewRange.parse(range);
  const controller = new AbortController();
  let timedOut = false;
  const abort = () => controller.abort();
  if (signal?.aborted) abort();
  signal?.addEventListener('abort', abort, { once: true });
  const timeout = window.setTimeout(() => {
    timedOut = true;
    abort();
  }, 15_000);
  try {
    const response = await fetch(`/api/local-review/worklog?range=${parsedRange}`, {
      method: 'GET',
      credentials: 'same-origin',
      cache: 'no-store',
      redirect: 'error',
      headers: { Accept: 'application/json' },
      signal: controller.signal,
    });
    if (response.status === 401) throw new LocalReviewFailure('AUTH_REQUIRED');
    if (response.status === 403) throw new LocalReviewFailure('FORBIDDEN');
    if (response.status === 404) throw new LocalReviewFailure('NOT_AVAILABLE');
    if (!response.ok) throw new LocalReviewFailure('UNAVAILABLE');
    let body: unknown;
    try {
      body = await response.json();
    } catch (error) {
      if (controller.signal.aborted) throw error;
      throw new LocalReviewFailure('INVALID_DATA');
    }
    const parsed = zLocalWorklogReview.safeParse(body);
    const months = parsedRange === 'aug-sep' ? [8, 9] : [9, 10];
    if (!parsed.success || parsed.data.months.some((month, index) => month !== months[index]))
      throw new LocalReviewFailure('INVALID_DATA');
    return parsed.data;
  } catch (error) {
    if (error instanceof LocalReviewFailure) throw error;
    if (controller.signal.aborted) throw new LocalReviewFailure(timedOut ? 'TIMEOUT' : 'ABORTED');
    throw new LocalReviewFailure('UNAVAILABLE');
  } finally {
    window.clearTimeout(timeout);
    signal?.removeEventListener('abort', abort);
  }
}
