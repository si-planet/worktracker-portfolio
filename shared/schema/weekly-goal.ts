import { zWeeklyGoalSource } from './wbs-goal-import';
import { z } from 'zod';
import { weekCalendar } from '../week-calendar';
import {
  zWorkEntryId,
  zWorkEntryVersion,
  zWorkEntryEpoch,
  zWorkEntryDate,
  zWorkEntryCreate,
  zWorkEntryPatch,
  zWorkEntryFinal,
} from './work-entry';
import { zWorkEntryDuplicate } from './work-duplicate';
export const zGoalWeek = z
  .strictObject({
    isoYear: z.number().int().min(1).max(9999),
    isoWeek: z.number().int().min(1).max(53),
  })
  .refine((v) => {
    try {
      weekCalendar(v.isoYear, v.isoWeek);
      return true;
    } catch {
      return false;
    }
  });
const fields = {
  title: z.string().min(1).max(200),
  detail: z.string().max(5000).nullable(),
  sourceEntryId: zWorkEntryId.nullable(),
  sortOrder: z.number().int().min(-Number.MAX_SAFE_INTEGER).max(Number.MAX_SAFE_INTEGER),
};
export const zWeeklyGoalCreate = z
  .strictObject({
    id: zWorkEntryId,
    ...fields,
    detail: fields.detail.default(null),
    sourceEntryId: fields.sourceEntryId.default(null),
    sortOrder: fields.sortOrder.default(0),
    isoYear: z.number().int(),
    isoWeek: z.number().int(),
  })
  .refine((v) => zGoalWeek.safeParse({ isoYear: v.isoYear, isoWeek: v.isoWeek }).success);
export const zWeeklyGoalPatch = z
  .strictObject({
    version: zWorkEntryVersion,
    title: fields.title.optional(),
    detail: fields.detail.optional(),
    sourceEntryId: fields.sourceEntryId.optional(),
    sortOrder: fields.sortOrder.optional(),
  })
  .refine((v) => Object.keys(v).some((k) => k !== 'version'));
export const zWeeklyGoalDelete = z.strictObject({ version: zWorkEntryVersion });
export const zGoalPlacement = z
  .strictObject({
    id: zWorkEntryId,
    companyId: zWorkEntryId,
    goalId: zWorkEntryId,
    goalVersion: zWorkEntryVersion,
    intent: z.enum(['continue', 'new']),
    sourceEntryId: zWorkEntryId.nullable(),
    sourceVersion: zWorkEntryVersion.nullable(),
    workEntryId: zWorkEntryId,
    workEntryVersion: zWorkEntryVersion,
    targetDate: zWorkEntryDate,
    createdAt: zWorkEntryEpoch,
  })
  .refine(
    (v) =>
      (v.sourceEntryId === null) === (v.sourceVersion === null) &&
      (v.intent !== 'continue' || (v.sourceEntryId === v.workEntryId && v.sourceEntryId !== null)),
  );
export const zWeeklyGoal = z
  .strictObject({
    id: zWorkEntryId,
    companyId: zWorkEntryId,
    isoYear: z.number().int(),
    isoWeek: z.number().int(),
    ...fields,
    createdAt: zWorkEntryEpoch,
    updatedAt: zWorkEntryEpoch,
    version: zWorkEntryVersion,
    sourceDeleted: z.boolean(),
    source: zWeeklyGoalSource,
    placements: z.array(zGoalPlacement),
  })
  .refine((v) =>
    v.source.type === 'workEntry'
      ? v.source.entryId === v.sourceEntryId && v.source.deleted === v.sourceDeleted
      : v.sourceEntryId === null && v.sourceDeleted === false,
  );
export const zWeeklyGoalList = z.strictObject({
  companyId: zWorkEntryId,
  isoYear: z.number().int(),
  isoWeek: z.number().int(),
  items: z.array(zWeeklyGoal),
});
export const zGoalPlacementInput = z
  .discriminatedUnion('intent', [
    z.strictObject({
      id: zWorkEntryId,
      goalVersion: zWorkEntryVersion,
      intent: z.literal('continue'),
      sourceEntryId: zWorkEntryId,
      sourceVersion: zWorkEntryVersion,
      patch: zWorkEntryPatch,
    }),
    z.strictObject({
      id: zWorkEntryId,
      goalVersion: zWorkEntryVersion,
      intent: z.literal('new'),
      sourceEntryId: zWorkEntryId.nullable(),
      sourceVersion: zWorkEntryVersion.nullable(),
      entry: zWorkEntryCreate,
    }),
  ])
  .superRefine((v, c) => {
    if (v.intent === 'continue') {
      if (
        v.patch.version !== v.sourceVersion ||
        v.patch.plannedDate == null ||
        Object.keys(v.patch).some(
          (k) =>
            ![
              'version',
              'plannedDate',
              'endDate',
              'dueDate',
              'timeMode',
              'startAt',
              'endAt',
              'calculationBasis',
              'reason',
            ].includes(k),
        )
      )
        c.addIssue({ code: 'custom', message: '일정 변경과 원본 버전을 확인하세요.' });
    } else {
      if (
        (v.sourceEntryId === null) !== (v.sourceVersion === null) ||
        v.entry.id === v.sourceEntryId ||
        v.entry.plannedDate === null ||
        !zWorkEntryDuplicate.safeParse({ sourceVersion: v.sourceVersion ?? 1, entry: v.entry })
          .success
      )
        c.addIssue({ code: 'custom', message: '새 수행의 ID·날짜·초기 상태를 확인하세요.' });
    }
  });
export const zGoalPlacementResult = z.strictObject({
  placement: zGoalPlacement,
  entry: zWorkEntryFinal.nullable(),
  goalVersion: zWorkEntryVersion,
});
export type WeeklyGoal = z.output<typeof zWeeklyGoal>;
export type GoalPlacementInput = z.output<typeof zGoalPlacementInput>;
export type GoalPlacement = z.output<typeof zGoalPlacement>;
export type GoalPlacementResult = z.output<typeof zGoalPlacementResult>;
