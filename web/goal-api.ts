import { z } from 'zod';
import {
  zWeeklyGoal,
  zWeeklyGoalList,
  zGoalPlacementResult,
  zGoalPlacementInput,
  type GoalPlacementInput,
} from '../shared/schema/weekly-goal';
import { workApi, workListSchema, WorkFailure, workError } from './work-entry-api';
export const goalPath = (company: string, id?: string) =>
  `/api/companies/${company}/weekly-goals${id ? `/${id}` : ''}`;
export const goalSchema = (company: string, id: string) =>
  zWeeklyGoal.refine(
    (v) =>
      v.companyId === company &&
      v.id === id &&
      v.placements.every((p) => p.companyId === company && p.goalId === id),
  );
export function readGoal(company: string, id: string) {
  return workApi(goalPath(company, id), goalSchema(company, id));
}
export function readGoals(company: string, year: number, week: number) {
  return workApi(
    `/api/companies/${company}/weeks/${year}/${week}/goals`,
    zWeeklyGoalList.refine(
      (v) =>
        v.companyId === company &&
        v.isoYear === year &&
        v.isoWeek === week &&
        new Set(v.items.map((i) => i.id)).size === v.items.length &&
        v.items.every(
          (i) =>
            i.companyId === company &&
            i.isoYear === year &&
            i.isoWeek === week &&
            i.placements.every((p) => p.companyId === company && p.goalId === i.id),
        ),
    ),
  );
}
export function candidates(company: string, query: URLSearchParams) {
  return workApi(
    `/api/companies/${company}/goal-work-candidates?${query}`,
    workListSchema(company),
  );
}
export function placementSchema(company: string, id: string, goalId?: string) {
  return zGoalPlacementResult.refine(
    (v) =>
      v.placement.companyId === company &&
      v.placement.id === id &&
      (!goalId || v.placement.goalId === goalId) &&
      v.goalVersion === v.placement.goalVersion &&
      (v.entry === null ||
        (v.entry.companyId === company && v.entry.id === v.placement.workEntryId)),
  );
}
export function readPlacement(company: string, id: string, goalId: string) {
  return workApi(
    `/api/companies/${company}/goal-placements/${id}`,
    placementSchema(company, id, goalId),
  );
}
export function placeGoal(company: string, goalId: string, input: GoalPlacementInput) {
  const body = zGoalPlacementInput.parse(input);
  return workApi(
    `${goalPath(company, goalId)}/placements`,
    placementSchema(company, body.id, goalId).refine(
      (v) =>
        v.placement.intent === body.intent &&
        v.placement.workEntryId === (body.intent === 'new' ? body.entry.id : body.sourceEntryId),
    ),
    'POST',
    body,
  );
}
export function goalError(failure: unknown) {
  if (failure instanceof WorkFailure && failure.status === 409)
    return '목표 또는 원본이 변경되었거나 같은 배치가 저장되었습니다. 입력과 ID를 유지하고 결과·최신 버전을 확인하세요.';
  return workError(failure);
}
export function storeGoalDraft(key: string, value: unknown) {
  try {
    sessionStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* Optional session storage; the in-memory draft remains. */
  }
}
export function loadGoalDraft<T extends z.ZodType>(key: string, schema: T): z.output<T> | null {
  try {
    const result = schema.safeParse(JSON.parse(sessionStorage.getItem(key) ?? 'null'));
    return result.success ? result.data : null;
  } catch {
    return null;
  }
}
export function clearGoalDraft(key: string) {
  try {
    sessionStorage.removeItem(key);
  } catch {
    /* Optional storage. */
  }
}

import {
  zWbsGoalDraftSource,
  zWbsGoalImport,
  assertWbsGoalImportBytes,
  observeWbsGoalImport,
  type WbsGoalImport,
} from '../shared/schema/wbs-goal-import';
export { observeWbsGoalImport };
export function readWbsGoalSource(companyId: string, itemId: string) {
  return workApi(
    `/api/wbs-items/${itemId}/goal-draft-source`,
    zWbsGoalDraftSource.refine((v) => v.companyId === companyId && v.itemId === itemId),
  );
}
export function importWbsGoal(companyId: string, input: WbsGoalImport) {
  const body = zWbsGoalImport.parse(input);
  assertWbsGoalImportBytes(body);
  return workApi(
    `${goalPath(companyId)}/from-wbs`,
    goalSchema(companyId, body.goal.id).refine(
      (v) => observeWbsGoalImport(companyId, body, v) === 'matching-current',
    ),
    'POST',
    body,
  );
}
