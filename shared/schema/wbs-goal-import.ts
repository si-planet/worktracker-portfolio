import { z } from 'zod';
import { zWorkEntryId as id, zWorkEntryVersion as version } from './work-entry';
import { weekCalendar } from '../week-calendar';
import type { WeeklyGoal } from './weekly-goal';
export const zWbsGoalSourceCas = z.strictObject({
  itemId: id,
  itemVersion: version,
  planId: id,
  planVersion: version,
});
export const zWbsGoalDraftSource = zWbsGoalSourceCas.extend({
  companyId: id,
  projectId: id,
  projectCode: z.string(),
  year: z.number().int().min(1).max(9999),
  title: z.string().min(1).max(200),
});
export const zWbsGoalDraft = z
  .strictObject({
    id,
    title: z.string().min(1).max(200),
    detail: z.string().max(5000).nullable().default(null),
    sortOrder: z
      .number()
      .int()
      .min(-Number.MAX_SAFE_INTEGER)
      .max(Number.MAX_SAFE_INTEGER)
      .default(0),
    isoYear: z.number().int(),
    isoWeek: z.number().int(),
  })
  .refine((v) =>
    (() => {
      try {
        weekCalendar(v.isoYear, v.isoWeek);
        return true;
      } catch {
        return false;
      }
    })(),
  );
export const zWbsGoalImport = z.strictObject({ goal: zWbsGoalDraft, source: zWbsGoalSourceCas });
export const zWeeklyGoalSource = z.discriminatedUnion('type', [
  z.strictObject({ type: z.literal('manual') }),
  z.strictObject({ type: z.literal('workEntry'), entryId: id, deleted: z.boolean() }),
  z
    .strictObject({
      type: z.literal('wbsItem'),
      originalItemId: id,
      originalPlanId: id,
      sourceItemVersion: version,
      sourcePlanVersion: version,
      liveItemId: id.nullable(),
      deleted: z.boolean(),
    })
    .refine(
      (v) =>
        (v.liveItemId === null) === v.deleted &&
        (v.liveItemId === null || v.liveItemId === v.originalItemId),
    ),
]);
export const zWbsGoalImportObservation = z.enum([
  'matching-current',
  'matching-deleted-source',
  'later-version',
  'different-current',
  'currently-absent',
]);
export function observeWbsGoalImport(
  companyId: string,
  input: unknown,
  current: WeeklyGoal | null,
) {
  id.parse(companyId);
  const d = zWbsGoalImport.parse(input);
  if (current === null) return zWbsGoalImportObservation.parse('currently-absent');
  const g = current;
  zWeeklyGoalSource.parse(g.source);
  if (g.companyId !== companyId || g.id !== d.goal.id) return 'different-current' as const;
  if (g.version !== 1) return 'later-version' as const;
  const s = g.source;
  return g.isoYear === d.goal.isoYear &&
    g.isoWeek === d.goal.isoWeek &&
    g.title === d.goal.title &&
    g.detail === d.goal.detail &&
    g.sortOrder === d.goal.sortOrder &&
    s.type === 'wbsItem' &&
    s.originalItemId === d.source.itemId &&
    s.originalPlanId === d.source.planId &&
    s.sourceItemVersion === d.source.itemVersion &&
    s.sourcePlanVersion === d.source.planVersion
    ? s.deleted
      ? ('matching-deleted-source' as const)
      : ('matching-current' as const)
    : ('different-current' as const);
}
export function assertWbsGoalImportBytes(input: unknown) {
  if (new TextEncoder().encode(JSON.stringify(input)).length > 8192)
    throw new Error('BODY_TOO_LARGE');
}

export type WbsGoalImport = z.output<typeof zWbsGoalImport>;
export type WbsGoalDraftSource = z.output<typeof zWbsGoalDraftSource>;
export type WeeklyGoalSource = z.output<typeof zWeeklyGoalSource>;
