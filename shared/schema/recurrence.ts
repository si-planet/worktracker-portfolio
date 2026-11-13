import { z } from 'zod';
import { zWorkEntryDate, zWorkEntryId, zWorkEntryTagIds, zWorkEntryVersion } from './work-entry';
import { zWeeklyRecurrenceWeek } from './weekly-recurrence-candidates';

/** Product holiday defaults are unchanged; this delivery requires an explicit ask choice. */
export const RECURRENCE_WEEKLY_SUPPORT = {
  delivery: 'weekly-explicit-v1',
  productDefaultHolidayPolicy: 'prev_workday',
  supportedHolidayPolicies: ['ask'],
  policySelectionRequired: true,
  intervalAnchor: 'initial_start_week',
  unsupported: [
    'daily',
    'monthly',
    'exact-time',
    'leave',
    'event',
    'automatic-materialization',
    'automatic-carryover',
    'automatic-holiday-move',
  ],
} as const;

export const RECURRENCE_SUPPORT = {
  delivery: 'calendar-explicit-v2',
  productDefaultHolidayPolicy: 'prev_workday',
  supportedHolidayPolicies: ['ask'],
  policySelectionRequired: true,
  intervalAnchor: 'initial_start_week',
  supportedFrequencies: ['daily', 'weekly', 'monthly'],
  intervalAnchors: {
    daily: 'initial_start_day',
    weekly: 'initial_start_week',
    monthly: 'initial_start_month',
  },
  supportedInvalidDayPolicies: ['skip', 'last_day'],
  invalidDayPolicySelectionRequired: true,
  unsupported: [
    'exact-time',
    'leave',
    'event',
    'automatic-materialization',
    'automatic-carryover',
    'automatic-holiday-move',
  ],
} as const;
const content = z.string().max(5000).nullable();
const weekdays = z
  .array(z.number().int().min(1).max(7))
  .min(1)
  .max(7)
  .refine((v) => new Set(v).size === v.length, '반복 요일은 중복될 수 없습니다.')
  .transform((v) => [...v].sort((a, b) => a - b));
const tags = zWorkEntryTagIds.max(100).transform((v) => [...v].sort());
const specShape = {
  kind: z.enum(['task', 'meeting', 'field', 'etc']),
  projectId: zWorkEntryId.nullable(),
  title: z.string().min(1).max(200),
  content: content.default(null),
  tagIds: tags.default([]),
  timeMode: z.literal('date_only'),
  startOn: zWorkEntryDate,
  endOn: zWorkEntryDate.nullable().default(null),
  interval: z.number().int().min(1).max(12).default(1),
  // Deliberately no default: omission must never silently opt a rule into ask.
  holidayPolicy: z.literal('ask'),
  dueOffsetDays: z.literal(0),
};
const frequencyShapes = {
  weekly: {
    freq: z.literal('weekly'),
    byweekday: weekdays,
    intervalAnchor: z.literal('initial_start_week'),
  },
  daily: { freq: z.literal('daily'), intervalAnchor: z.literal('initial_start_day') },
  monthly: {
    freq: z.literal('monthly'),
    bymonthday: z.number().int().min(1).max(31),
    // No default: an absent day must never be silently skipped or moved.
    invalidDayPolicy: z.enum(['skip', 'last_day']),
    intervalAnchor: z.literal('initial_start_month'),
  },
};
function validateSpec(
  value: {
    freq: string;
    kind: string;
    projectId: string | null;
    startOn: string;
    endOn: string | null;
  },
  ctx: z.RefinementCtx,
) {
  if (value.kind === 'task' && value.projectId === null)
    ctx.addIssue({
      code: 'custom',
      path: ['projectId'],
      message: '일반 업무에는 프로젝트가 필요합니다.',
    });
  if (value.endOn !== null && value.endOn < value.startOn)
    ctx.addIssue({
      code: 'custom',
      path: ['endOn'],
      message: '종료일은 시작일보다 빠를 수 없습니다.',
    });
}
export const zRecurrenceSpec = z
  .discriminatedUnion('freq', [
    z.strictObject({ ...specShape, ...frequencyShapes.weekly, isActive: z.boolean() }),
    z.strictObject({ ...specShape, ...frequencyShapes.daily, isActive: z.boolean() }),
    z.strictObject({ ...specShape, ...frequencyShapes.monthly, isActive: z.boolean() }),
  ])
  .superRefine(validateSpec);
export const zRecurrenceCreate = z
  .discriminatedUnion('freq', [
    z.strictObject({
      id: zWorkEntryId,
      commandId: zWorkEntryId,
      ...specShape,
      ...frequencyShapes.weekly,
    }),
    z.strictObject({
      id: zWorkEntryId,
      commandId: zWorkEntryId,
      ...specShape,
      ...frequencyShapes.daily,
    }),
    z.strictObject({
      id: zWorkEntryId,
      commandId: zWorkEntryId,
      ...specShape,
      ...frequencyShapes.monthly,
    }),
  ])
  .superRefine(validateSpec);
export const zRecurrenceWeeks = z
  .array(zWeeklyRecurrenceWeek)
  .min(1)
  .max(26)
  .refine(
    (v) => new Set(v.map((w) => `${w.isoYear}:${w.isoWeek}`)).size === v.length,
    '요청 주가 중복되었습니다.',
  )
  .transform((v) => [...v].sort((a, b) => a.isoYear - b.isoYear || a.isoWeek - b.isoWeek));
export const zRecurrencePreviewQuery = z.strictObject({ weeks: zRecurrenceWeeks });
const resolution = z.discriminatedUnion('action', [
  z.strictObject({
    occurrenceDate: zWorkEntryDate,
    action: z.literal('confirm'),
    plannedDate: zWorkEntryDate,
  }),
  z.strictObject({ occurrenceDate: zWorkEntryDate, action: z.literal('skip') }),
]);
export const zRecurrenceGenerate = z
  .strictObject({
    commandId: zWorkEntryId,
    version: zWorkEntryVersion,
    weeks: zRecurrenceWeeks,
    resolutions: z.array(resolution).max(182).default([]),
  })
  .refine(
    (v) => new Set(v.resolutions.map((r) => r.occurrenceDate)).size === v.resolutions.length,
    '회차별 확인이 중복되었습니다.',
  );
const patch = z
  .strictObject({
    kind: specShape.kind.optional(),
    projectId: specShape.projectId.optional(),
    title: specShape.title.optional(),
    content: content.optional(),
    tagIds: tags.optional(),
    endOn: zWorkEntryDate.nullable().optional(),
    interval: z.number().int().min(1).max(12).optional(),
    byweekday: weekdays.optional(),
    bymonthday: z.number().int().min(1).max(31).optional(),
    invalidDayPolicy: z.enum(['skip', 'last_day']).optional(),
  })
  .refine((v) => Object.keys(v).length > 0, '변경할 값을 지정하세요.');
export const zRecurrencePatch = z
  .strictObject({
    commandId: zWorkEntryId,
    version: zWorkEntryVersion,
    applyFrom: zWorkEntryDate,
    intervalAnchor: z.enum(['initial_start_week', 'initial_start_day', 'initial_start_month']),
    weeks: zRecurrenceWeeks,
    patch,
    resolutions: z.array(resolution).max(182).default([]),
  })
  .refine(
    (v) => new Set(v.resolutions.map((r) => r.occurrenceDate)).size === v.resolutions.length,
    '회차별 확인이 중복되었습니다.',
  )
  .superRefine((v, ctx) => {
    const forbidden =
      v.intervalAnchor === 'initial_start_week'
        ? ['bymonthday', 'invalidDayPolicy']
        : v.intervalAnchor === 'initial_start_day'
          ? ['byweekday', 'bymonthday', 'invalidDayPolicy']
          : ['byweekday'];
    for (const key of forbidden)
      if (Object.hasOwn(v.patch, key))
        ctx.addIssue({
          code: 'custom',
          path: ['patch', key],
          message: '이 반복 주기에 적용할 수 없는 필드입니다.',
        });
  });
export const zRecurrenceStop = z.strictObject({
  commandId: zWorkEntryId,
  version: zWorkEntryVersion,
  mode: z.enum(['end', 'deactivate']),
  on: zWorkEntryDate,
  existingFuture: z.enum(['preserve', 'cancel_untouched']),
  weeks: zRecurrenceWeeks,
});
export const zRecurrenceChangePreview = z.discriminatedUnion('intent', [
  zRecurrencePatch.safeExtend({ intent: z.literal('revise') }),
  zRecurrenceStop.safeExtend({ intent: z.literal('stop') }),
]);
export const zRecurrenceListQuery = z.strictObject({
  cursor: zWorkEntryId.optional(),
  limit: z.number().int().min(1).max(100).default(50),
});
export type RecurrenceSpec = z.output<typeof zRecurrenceSpec>;
export type RecurrenceWeeks = z.output<typeof zRecurrenceWeeks>;
export type RecurrenceResolution = z.output<typeof resolution>;
export type RecurrenceRule = {
  id: string;
  companyId: string;
  version: number;
  revision: number;
  effectiveFrom: string;
  spec: RecurrenceSpec;
  createdAt: number;
  updatedAt: number;
};
export type RecurrenceOccurrenceMetadata = {
  ruleId: string;
  occurrenceDate: string;
  originalWorkEntryId: string;
  liveWorkEntryId: string | null;
  appliedRevision: number;
  engineEntryVersion: number | null;
  disposition: 'generated' | 'skipped';
  engineCanceled: boolean;
};
export type RecurrencePreviewItem = {
  occurrenceDate: string;
  revision: number;
  eligible: boolean;
  calendar: 'verified' | 'unsupported';
  holidayName: string | null;
  weekend: boolean;
  disposition:
    | 'new'
    | 'unchanged'
    | 'reapply'
    | 'removed'
    | 'preserved'
    | 'deleted'
    | 'skipped'
    | 'historical';
  requiresResolution: boolean;
  plannedDate: string | null;
  metadata: RecurrenceOccurrenceMetadata | null;
};
export type RecurrenceMonthlyDecision = {
  revision: number;
  month: string;
  requestedDay: number;
  actualDate: string | null;
  reason: 'requested_day' | 'last_day' | 'skip_missing_day';
  inRequestedWeeks: boolean;
};
export type RecurrencePreview = {
  rule: RecurrenceRule;
  sourceVersion: number;
  weeks: RecurrenceWeeks;
  occurrences: RecurrencePreviewItem[];
  pendingWeeks: RecurrenceWeeks;
  monthlyDecisions?: RecurrenceMonthlyDecision[];
  support: typeof RECURRENCE_SUPPORT;
};
export type RecurrenceGenerateResult = {
  commandId: string;
  ruleId: string;
  ruleVersion: number;
  created: number;
  updated: number;
  canceled: number;
  restored: number;
  preserved: number;
  skipped: number;
  unchanged: number;
  occurrences: RecurrenceOccurrenceMetadata[];
  pendingWeeks: RecurrenceWeeks;
};
