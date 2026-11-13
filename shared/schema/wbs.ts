import { z } from 'zod';
import { zWorkEntryId, zWorkEntryDate, zWorkEntryVersion, zWorkEntryEpoch } from './work-entry';
const text = z.string().max(5000).nullable(),
  sort = z.number().int().min(-Number.MAX_SAFE_INTEGER).max(Number.MAX_SAFE_INTEGER);
const year = z.number().int().min(1).max(9999);
const pair = (v: { startOn: string | null; endOn: string | null }) =>
  v.startOn === null || v.endOn === null || v.startOn <= v.endOn;
export const zWbsSchedule = z
  .strictObject({
    startOn: zWorkEntryDate.nullable(),
    endOn: zWorkEntryDate.nullable(),
    reason: text.optional(),
  })
  .refine(pair);
export const zWbsPlanCreate = z.strictObject({ id: zWorkEntryId, year, note: text.default(null) });
export const zWbsPlanPatch = z.strictObject({ version: zWorkEntryVersion, note: text });
export const zWbsItemCreate = z
  .strictObject({
    id: zWorkEntryId,
    planVersion: zWorkEntryVersion,
    title: z.string().min(1).max(200),
    description: text.default(null),
    plannedStartOn: zWorkEntryDate.nullable().default(null),
    plannedEndOn: zWorkEntryDate.nullable().default(null),
    sortOrder: sort.default(0),
  })
  .refine((v) => pair({ startOn: v.plannedStartOn, endOn: v.plannedEndOn }));
export const zWbsItemPatch = z
  .strictObject({
    version: zWorkEntryVersion,
    planVersion: zWorkEntryVersion,
    title: z.string().min(1).max(200).optional(),
    description: text.optional(),
    sortOrder: sort.optional(),
    schedule: zWbsSchedule.optional(),
  })
  .refine(
    (v) =>
      v.title !== undefined ||
      v.description !== undefined ||
      v.sortOrder !== undefined ||
      v.schedule !== undefined,
  );
export const zWbsScheduleSnapshot = z
  .strictObject({
    plannedStartOn: zWorkEntryDate.nullable(),
    plannedEndOn: zWorkEntryDate.nullable(),
    hasRevisedSchedule: z.boolean(),
    revisedStartOn: zWorkEntryDate.nullable(),
    revisedEndOn: zWorkEntryDate.nullable(),
  })
  .refine(
    (v) =>
      pair({ startOn: v.plannedStartOn, endOn: v.plannedEndOn }) &&
      pair({ startOn: v.revisedStartOn, endOn: v.revisedEndOn }) &&
      (v.hasRevisedSchedule || (v.revisedStartOn === null && v.revisedEndOn === null)),
  );
export const zWbsItemState = z
  .strictObject({
    id: zWorkEntryId,
    companyId: zWorkEntryId,
    planId: zWorkEntryId,
    title: z.string().min(1).max(200),
    description: text,
    plannedStartOn: zWorkEntryDate.nullable(),
    plannedEndOn: zWorkEntryDate.nullable(),
    hasRevisedSchedule: z.boolean(),
    revisedStartOn: zWorkEntryDate.nullable(),
    revisedEndOn: zWorkEntryDate.nullable(),
    sortOrder: sort,
    createdAt: zWorkEntryEpoch,
    updatedAt: zWorkEntryEpoch,
    version: zWorkEntryVersion,
  })
  .refine(
    (v) =>
      zWbsScheduleSnapshot.safeParse(
        v.hasRevisedSchedule
          ? {
              plannedStartOn: v.plannedStartOn,
              plannedEndOn: v.plannedEndOn,
              hasRevisedSchedule: true,
              revisedStartOn: v.revisedStartOn,
              revisedEndOn: v.revisedEndOn,
            }
          : {
              plannedStartOn: v.plannedStartOn,
              plannedEndOn: v.plannedEndOn,
              hasRevisedSchedule: false,
              revisedStartOn: v.revisedStartOn,
              revisedEndOn: v.revisedEndOn,
            },
      ).success,
  );
export const zWbsPlanDelete = z.strictObject({
  version: zWorkEntryVersion,
  confirmText: z.string().max(20),
  expectedImpact: z.strictObject({
    itemCount: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
    historyCount: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
    workLinkCount: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
    goalCount: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
    completionHistoryCount: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
  }),
  contractVersion: z.literal(4),
});
export const zWbsItemDelete = z.strictObject({
  version: zWorkEntryVersion,
  planVersion: zWorkEntryVersion,
  confirmText: z.literal('WBS 항목 삭제'),
  expectedImpact: z.strictObject({
    historyCount: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
    workLinkCount: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
    goalCount: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
    completionHistoryCount: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
  }),
  contractVersion: z.literal(4),
});
export function validatePlanDelete(input: unknown, planYear: number) {
  const d = zWbsPlanDelete.parse(input);
  if (d.confirmText !== String(year.parse(planYear))) throw new Error('CONFIRMATION_MISMATCH');
  return d;
}
export function mergeWbsItemPatch(current: unknown, input: unknown, currentPlanVersion: number) {
  zWorkEntryVersion.parse(currentPlanVersion);
  const old = zWbsItemState.parse(current),
    d = zWbsItemPatch.parse(input);
  if (old.version !== d.version || d.planVersion !== currentPlanVersion)
    throw new Error('VERSION_CONFLICT');
  if (d.schedule) {
    const from = old.hasRevisedSchedule
      ? [old.revisedStartOn, old.revisedEndOn]
      : [old.plannedStartOn, old.plannedEndOn];
    if (from[0] === d.schedule.startOn && from[1] === d.schedule.endOn)
      throw new Error('SCHEDULE_UNCHANGED');
  }
  const next = zWbsItemState.parse({
    ...old,
    title: d.title ?? old.title,
    description: d.description === undefined ? old.description : d.description,
    sortOrder: d.sortOrder ?? old.sortOrder,
    ...(d.schedule
      ? {
          hasRevisedSchedule: true,
          revisedStartOn: d.schedule.startOn,
          revisedEndOn: d.schedule.endOn,
        }
      : {}),
  });
  if (JSON.stringify(next) === JSON.stringify(old)) throw new Error('NO_CHANGES');
  zWorkEntryVersion.parse(old.version + 1);
  zWorkEntryVersion.parse(currentPlanVersion + 1);
  return {
    next: { ...next, version: old.version + 1 },
    reason: d.schedule?.reason ?? null,
    scheduleChanged: d.schedule !== undefined,
    planVersion: currentPlanVersion + 1,
  };
}
export function assertWbsBodyBytes(input: unknown) {
  if (new TextEncoder().encode(JSON.stringify(input)).byteLength > 8192)
    throw new Error('BODY_TOO_LARGE');
}

const count = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
export const zWbsYear = year;
export const zWbsItem = zWbsItemState
  .safeExtend({
    effectiveStartOn: zWorkEntryDate.nullable(),
    effectiveEndOn: zWorkEntryDate.nullable(),
  })
  .refine(
    (v) =>
      v.effectiveStartOn === (v.hasRevisedSchedule ? v.revisedStartOn : v.plannedStartOn) &&
      v.effectiveEndOn === (v.hasRevisedSchedule ? v.revisedEndOn : v.plannedEndOn),
  );
export const zWbsPlan = z
  .strictObject({
    id: zWorkEntryId,
    companyId: zWorkEntryId,
    projectId: zWorkEntryId,
    year,
    note: text,
    createdAt: zWorkEntryEpoch,
    updatedAt: zWorkEntryEpoch,
    version: zWorkEntryVersion,
    items: z.array(zWbsItem),
  })
  .refine((v) => v.items.every((i) => i.planId === v.id && i.companyId === v.companyId));
export const zWbsList = z
  .strictObject({ companyId: zWorkEntryId, year, plans: z.array(zWbsPlan) })
  .refine((v) => v.plans.every((p) => p.companyId === v.companyId && p.year === v.year));
export const zWbsItemResult = z.strictObject({ item: zWbsItem, planVersion: zWorkEntryVersion });
export const zWbsChange = z
  .strictObject({
    id: zWorkEntryId,
    companyId: zWorkEntryId,
    itemId: zWorkEntryId,
    itemVersion: zWorkEntryVersion,
    schemaVersion: z.literal(1),
    type: z.enum(['create', 'revise']),
    before: zWbsScheduleSnapshot.nullable(),
    after: zWbsScheduleSnapshot,
    reason: text,
    changedAt: zWorkEntryEpoch,
  })
  .refine((v) =>
    v.type === 'create'
      ? v.itemVersion === 1 && v.before === null
      : v.itemVersion > 1 && v.before !== null,
  );
export const zWbsChanges = z
  .strictObject({ itemId: zWorkEntryId, changes: z.array(zWbsChange) })
  .refine((v) => v.changes.every((c) => c.itemId === v.itemId));
const unsupported = {
  workCount: count,
  workLinkCount: count,
  goalCount: count,
  completionHistoryCount: count,
  receiptCount: z.null(),
  reportCount: z.null(),
  actualCount: z.null(),
};
export const zWbsPlanDeletePreview = z
  .strictObject({
    contractVersion: z.literal(4),
    id: zWorkEntryId,
    companyId: zWorkEntryId,
    version: zWorkEntryVersion,
    year,
    confirmText: z.string(),
    impact: z.strictObject({ itemCount: count, historyCount: count, ...unsupported }),
  })
  .refine((v) => v.confirmText === String(v.year));
export const zWbsItemDeletePreview = z.strictObject({
  contractVersion: z.literal(4),
  id: zWorkEntryId,
  companyId: zWorkEntryId,
  planId: zWorkEntryId,
  version: zWorkEntryVersion,
  planVersion: zWorkEntryVersion,
  confirmText: z.literal('WBS 항목 삭제'),
  impact: z.strictObject({ historyCount: count, ...unsupported }),
});
export const zWbsDeleteResult = z.strictObject({
  deleted: z.literal(true),
  id: zWorkEntryId,
  planVersion: zWorkEntryVersion.nullable(),
});
export type WbsItemState = z.infer<typeof zWbsItemState>;
export type WbsItem = z.infer<typeof zWbsItem>;
export type WbsPlan = z.infer<typeof zWbsPlan>;
export type WbsList = z.infer<typeof zWbsList>;
export type WbsItemResult = z.infer<typeof zWbsItemResult>;
export type WbsChanges = z.infer<typeof zWbsChanges>;
export type WbsPlanDeletePreview = z.infer<typeof zWbsPlanDeletePreview>;
export type WbsItemDeletePreview = z.infer<typeof zWbsItemDeletePreview>;
export type WbsDeleteResult = z.infer<typeof zWbsDeleteResult>;
