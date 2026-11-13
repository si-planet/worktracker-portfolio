import { z } from 'zod';
import { zWorkEntryDate } from '../shared/schema/work-entry';
import { zWorkspaceProject } from '../shared/schema/workspace';
import { zAdminWorkTag } from '../shared/schema/tags';
import { isoWeekForDate, shiftIsoWeek } from '../shared/week-calendar';
import {
  RECURRENCE_SUPPORT,
  zRecurrenceSpec,
  zRecurrenceCreate,
  zRecurrenceGenerate,
  zRecurrencePatch,
  zRecurrenceStop,
  zRecurrenceChangePreview,
  zRecurrenceWeeks,
  type RecurrenceWeeks,
} from '../shared/schema/recurrence';
import { workApi, WorkFailure } from './work-entry-api';
export const zRule = z
  .strictObject({
    id: z.uuid(),
    companyId: z.uuid(),
    version: z.number().int().positive(),
    revision: z.number().int().positive(),
    effectiveFrom: zWorkEntryDate,
    spec: zRecurrenceSpec,
    createdAt: z.number().int().nonnegative(),
    updatedAt: z.number().int().nonnegative(),
  })
  .refine((r) => r.updatedAt >= r.createdAt);
const support = z.strictObject({
  delivery: z.literal(RECURRENCE_SUPPORT.delivery),
  productDefaultHolidayPolicy: z.literal(RECURRENCE_SUPPORT.productDefaultHolidayPolicy),
  supportedHolidayPolicies: z.array(z.literal('ask')).length(1),
  policySelectionRequired: z.literal(true),
  intervalAnchor: z.literal('initial_start_week'),
  intervalAnchors: z.strictObject({
    daily: z.literal('initial_start_day'),
    weekly: z.literal('initial_start_week'),
    monthly: z.literal('initial_start_month'),
  }),
  supportedFrequencies: z.tuple([z.literal('daily'), z.literal('weekly'), z.literal('monthly')]),
  supportedInvalidDayPolicies: z.tuple([z.literal('skip'), z.literal('last_day')]),
  invalidDayPolicySelectionRequired: z.literal(true),
  unsupported: z
    .array(z.string())
    .refine((v) => v.join() === RECURRENCE_SUPPORT.unsupported.join()),
});
const metadata = z.strictObject({
  ruleId: z.uuid(),
  occurrenceDate: zWorkEntryDate,
  originalWorkEntryId: z.uuid(),
  liveWorkEntryId: z.uuid().nullable(),
  appliedRevision: z.number().int().positive(),
  engineEntryVersion: z.number().int().positive().nullable(),
  disposition: z.enum(['generated', 'skipped']),
  engineCanceled: z.boolean(),
});
const previewItem = z
  .strictObject({
    occurrenceDate: zWorkEntryDate,
    revision: z.number().int().positive(),
    eligible: z.boolean(),
    calendar: z.enum(['verified', 'unsupported']),
    holidayName: z.string().nullable(),
    weekend: z.boolean(),
    disposition: z.enum([
      'new',
      'unchanged',
      'reapply',
      'removed',
      'preserved',
      'deleted',
      'skipped',
      'historical',
    ]),
    requiresResolution: z.boolean(),
    plannedDate: zWorkEntryDate.nullable(),
    metadata: metadata.nullable(),
  })
  .refine((v) => !v.metadata || v.metadata.occurrenceDate === v.occurrenceDate);
const pending = z
  .array(
    z.strictObject({
      isoYear: z.number().int().min(1).max(9999),
      isoWeek: z.number().int().min(1).max(53),
    }),
  )
  .refine((v) => new Set(v.map((w) => `${w.isoYear}:${w.isoWeek}`)).size === v.length);
const preview = z
  .strictObject({
    rule: zRule,
    sourceVersion: z.number().int().positive(),
    weeks: zRecurrenceWeeks,
    occurrences: z.array(previewItem).max(182),
    pendingWeeks: pending,
    support,
    monthlyDecisions: z
      .array(
        z
          .strictObject({
            revision: z.number().int().positive(),
            month: z.string().regex(/^(?!0000)\d{4}-(?:0[1-9]|1[0-2])$/),
            requestedDay: z.number().int().min(1).max(31),
            actualDate: zWorkEntryDate.nullable(),
            reason: z.enum(['requested_day', 'last_day', 'skip_missing_day']),
            inRequestedWeeks: z.boolean(),
          })
          .refine((d) => {
            const end = new Date(`${d.month}-01T00:00:00.000Z`);
            end.setUTCMonth(end.getUTCMonth() + 1, 0);
            const lastDay = end.getUTCDate();
            if (d.reason === 'skip_missing_day')
              return d.requestedDay > lastDay && d.actualDate === null && !d.inRequestedWeeks;
            const day = d.reason === 'last_day' ? lastDay : d.requestedDay;
            return (
              (d.reason === 'last_day' ? d.requestedDay > lastDay : d.requestedDay <= lastDay) &&
              d.actualDate === `${d.month}-${String(day).padStart(2, '0')}`
            );
          }),
      )
      .max(1664)
      .optional(),
  })
  .refine(
    (v) =>
      new Set(v.occurrences.map((x) => x.occurrenceDate)).size === v.occurrences.length &&
      (v.rule.spec.freq === 'monthly') === (v.monthlyDecisions !== undefined) &&
      (!v.monthlyDecisions ||
        new Set(v.monthlyDecisions.map((d) => `${d.revision}:${d.month}`)).size ===
          v.monthlyDecisions.length) &&
      v.occurrences.every(
        (x, i) =>
          (!x.metadata || x.metadata.ruleId === v.rule.id) &&
          (i === 0 || v.occurrences[i - 1]!.occurrenceDate < x.occurrenceDate),
      ),
  );
const generation = z
  .strictObject({
    commandId: z.uuid(),
    ruleId: z.uuid(),
    ruleVersion: z.number().int().positive(),
    created: z.number().int().nonnegative(),
    updated: z.number().int().nonnegative(),
    canceled: z.number().int().nonnegative(),
    restored: z.number().int().nonnegative(),
    preserved: z.number().int().nonnegative(),
    skipped: z.number().int().nonnegative(),
    unchanged: z.number().int().nonnegative(),
    occurrences: z.array(metadata).max(182),
    pendingWeeks: pending,
  })
  .refine(
    (v) =>
      v.occurrences.every((x) => x.ruleId === v.ruleId) &&
      new Set(v.occurrences.map((x) => x.occurrenceDate)).size === v.occurrences.length,
  );
export type Rule = z.output<typeof zRule>;
export type Preview = z.output<typeof preview>;
export type Generation = z.output<typeof generation>;
export const zRecurrenceCommand = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('create'), body: zRecurrenceCreate }),
  z.strictObject({ kind: z.literal('generate'), body: zRecurrenceGenerate }),
  z.strictObject({ kind: z.literal('revise'), body: zRecurrencePatch }),
  z.strictObject({ kind: z.literal('stop'), body: zRecurrenceStop }),
]);
export type RecurrenceCommand = z.output<typeof zRecurrenceCommand>;
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
const path = (id: string) => `/api/recurrence-rules/${z.uuid().parse(id)}`;
export function recurrenceWeeks(date: string, count: string): RecurrenceWeeks {
  if (!/^(?:[1-9]|1[0-9]|2[0-6])$/.test(count)) throw new Error('INVALID_WEEKS');
  const first = isoWeekForDate(zWorkEntryDate.parse(date));
  return zRecurrenceWeeks.parse(
    Array.from({ length: Number(count) }, (_, i) => shiftIsoWeek(first, i)),
  );
}
export function recurrenceReturnTo(value: string, company: string) {
  try {
    z.uuid().parse(company);
    const u = new URL(value, location.origin);
    if (
      !value.startsWith('/') ||
      value.startsWith('//') ||
      value.includes('\\') ||
      u.origin !== location.origin ||
      u.hash ||
      u.pathname !== `/c/${company}/recurrence`
    )
      return '/';
    const keys = [...u.searchParams.keys()];
    if (keys.length > 1 || keys.some((k) => k !== 'ruleId')) return '/';
    const id = u.searchParams.get('ruleId');
    if (id !== null && !z.uuid().safeParse(id).success) return '/';
    return u.pathname + (id ? `?${new URLSearchParams({ ruleId: id })}` : '');
  } catch {
    return '/';
  }
}
export function recurrenceLogin(company: string) {
  location.assign(
    `/login?${new URLSearchParams({ returnTo: recurrenceReturnTo(location.pathname + location.search, company) })}`,
  );
}
export function recurrenceRuleId(company: string) {
  const target = recurrenceReturnTo(location.pathname + location.search, company);
  if (target === '/') throw new Error('INVALID_RECURRENCE_URL');
  return new URL(target, location.origin).searchParams.get('ruleId');
}
export function listRules(company: string, cursor?: string) {
  z.uuid().parse(company);
  const p = new URLSearchParams({ limit: '50' });
  if (cursor) p.set('cursor', z.uuid().parse(cursor));
  return workApi(
    `/api/companies/${company}/recurrence-rules?${p}`,
    z
      .strictObject({ items: z.array(zRule).max(50), nextCursor: z.uuid().nullable(), support })
      .refine(
        (v) =>
          v.items.every(
            (r, i) =>
              r.companyId === company &&
              (!cursor || r.id > cursor) &&
              (i === 0 || v.items[i - 1]!.id < r.id),
          ) &&
          (v.nextCursor === null || v.nextCursor === v.items.at(-1)?.id),
      ),
  );
}
export function readRule(company: string, id: string) {
  return workApi(
    path(id),
    z
      .strictObject({ rule: zRule, pendingWeeks: pending, support })
      .refine((v) => v.rule.companyId === company && v.rule.id === id),
  );
}
export function readRecurrenceChoices(company: string) {
  z.uuid().parse(company);
  return Promise.all([
    workApi(
      `/api/companies/${company}/projects`,
      z
        .array(zWorkspaceProject)
        .refine(
          (v) =>
            v.every((p) => p.companyId === company) &&
            new Set(v.map((p) => p.id)).size === v.length,
        ),
    ),
    workApi(
      `/api/companies/${company}/work-tags?includeInactive=true`,
      z
        .array(zAdminWorkTag)
        .refine(
          (v) =>
            v.every((t) => t.companyId === null || t.companyId === company) &&
            new Set(v.map((t) => t.id)).size === v.length,
        ),
    ),
  ]);
}
export function readPreview(company: string, id: string, weeks: RecurrenceWeeks) {
  const body = zRecurrenceWeeks.parse(weeks);
  return workApi(
    `${path(id)}/preview?${new URLSearchParams({ weeks: JSON.stringify(body) })}`,
    preview.refine(
      (v) =>
        v.rule.companyId === company &&
        v.rule.id === id &&
        same(v.weeks, body) &&
        v.sourceVersion === v.rule.version,
    ),
  );
}
export function previewChange(company: string, id: string, value: unknown) {
  const body = zRecurrenceChangePreview.parse(value);
  return workApi(
    `${path(id)}/preview`,
    preview.refine(
      (v) =>
        v.rule.companyId === company &&
        v.rule.id === id &&
        same(v.weeks, body.weeks) &&
        v.sourceVersion === body.version &&
        v.rule.version === body.version + 1,
    ),
    'POST',
    body,
  );
}
export async function submitRecurrence(company: string, id: string, value: RecurrenceCommand) {
  const c = zRecurrenceCommand.parse(value);
  if (new TextEncoder().encode(JSON.stringify(c.body)).byteLength > 32768)
    throw new WorkFailure(400, 'VALIDATION_FAILED');
  if (c.kind === 'create') {
    const { id: _, commandId: __, ...spec } = c.body;
    void _;
    void __;
    z.uuid().parse(company);
    if (c.body.id !== id) throw new WorkFailure(400, 'VALIDATION_FAILED');
    return {
      rule: await workApi(
        `/api/companies/${company}/recurrence-rules`,
        zRule.refine(
          (r) =>
            r.companyId === company &&
            r.id === id &&
            r.version === 1 &&
            r.revision === 1 &&
            same(r.spec, zRecurrenceSpec.parse({ ...spec, isActive: true })),
        ),
        'POST',
        c.body,
      ),
      generation: null,
    };
  }
  await readRule(company, id);
  const expected = c.body.version + (c.kind === 'generate' ? 0 : 1);
  const resultSchema = generation.refine(
    (g) => g.commandId === c.body.commandId && g.ruleId === id && g.ruleVersion === expected,
  );
  if (c.kind === 'generate')
    return {
      rule: null,
      generation: await workApi(`${path(id)}/generate`, resultSchema, 'POST', c.body),
    };
  return workApi(
    c.kind === 'stop' ? `${path(id)}/stop` : path(id),
    z
      .strictObject({ rule: zRule, generation: resultSchema })
      .refine(
        (v) => v.rule.companyId === company && v.rule.id === id && v.rule.version === expected,
      ),
    c.kind === 'stop' ? 'POST' : 'PATCH',
    c.body,
  );
}
export function recurrenceFailure(e: unknown) {
  if (e instanceof WorkFailure) {
    if (e.status === 401) return '로그인이 만료되었습니다. 회사별 초안을 보존했습니다.';
    if (e.status === 403)
      return '접근할 수 없어 기존 내용을 숨겼습니다. 회사별 초안은 보존했습니다.';
    if (e.status === 409)
      return '규칙 또는 회차가 변경되었습니다. 현재 기록을 읽고 초안·버전을 비교해 주세요.';
    if (e.status === 400 || e.status === 422)
      return '입력·버전·요청 주와 각 회차 확인을 점검해 주세요. 지원하지 않는 방식은 저장하지 않습니다.';
  }
  return '응답을 확인하지 못했습니다. 명령 ID와 제출값을 유지하고 현재 기록을 확인해 주세요.';
}
