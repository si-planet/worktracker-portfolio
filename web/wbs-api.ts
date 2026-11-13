import {
  zWbsCompletionSummary,
  zWbsCompletionResult,
  zWbsCompletionInput,
} from '../shared/schema/wbs-completion';
import { z } from 'zod';
import {
  zWbsPlan,
  zWbsList,
  zWbsItemResult,
  zWbsItem,
  zWbsChanges,
  zWbsPlanDeletePreview,
  zWbsItemDeletePreview,
  zWbsDeleteResult,
  zWbsPlanCreate,
  zWbsPlanPatch,
  zWbsItemCreate,
  zWbsItemPatch,
  zWbsPlanDelete,
  zWbsItemDelete,
  assertWbsBodyBytes,
  type WbsPlan,
  type WbsItem,
} from '../shared/schema/wbs';
import { workApi, WorkFailure } from './work-entry-api';
export type { WbsPlan, WbsItem };
export const zWbsCommand = z.strictObject({
  kind: z.enum(['planCreate', 'planPatch', 'itemCreate', 'itemPatch', 'planDelete', 'itemDelete']),
  companyId: z.uuid(),
  projectId: z.uuid(),
  year: z.number().int().min(1).max(9999),
  id: z.uuid(),
  planId: z.uuid(),
  body: z.record(z.string(), z.unknown()),
  original: zWbsItem.nullable().optional(),
});
export type WbsCommand = z.output<typeof zWbsCommand>;
export function readWbs(company: string, year: number) {
  return workApi(
    `/api/companies/${company}/wbs?year=${year}`,
    zWbsList.refine(
      (v) =>
        v.companyId === company &&
        v.year === year &&
        new Set(v.plans.map((p) => p.id)).size === v.plans.length &&
        new Set(v.plans.map((p) => p.projectId)).size === v.plans.length &&
        v.plans.every((p) => new Set(p.items.map((i) => i.id)).size === p.items.length),
    ),
  );
}
export function readWbsChanges(company: string, id: string) {
  return workApi(
    `/api/wbs-items/${id}/changes`,
    zWbsChanges.refine(
      (v) =>
        v.itemId === id &&
        v.changes.every((c) => c.companyId === company) &&
        new Set(v.changes.map((c) => c.id)).size === v.changes.length,
    ),
  );
}
export function previewWbs(c: WbsCommand) {
  return c.kind === 'planDelete'
    ? workApi(
        `/api/wbs/${c.id}/delete-preview`,
        zWbsPlanDeletePreview.refine(
          (v) => v.id === c.id && v.companyId === c.companyId && v.year === c.year,
        ),
      )
    : workApi(
        `/api/wbs-items/${c.id}/delete-preview`,
        zWbsItemDeletePreview.refine(
          (v) => v.id === c.id && v.companyId === c.companyId && v.planId === c.planId,
        ),
      );
}
export function validateWbsCommand(input: WbsCommand) {
  const c = zWbsCommand.parse(input);
  const schema = {
    planCreate: zWbsPlanCreate,
    planPatch: zWbsPlanPatch,
    itemCreate: zWbsItemCreate,
    itemPatch: zWbsItemPatch,
    planDelete: zWbsPlanDelete,
    itemDelete: zWbsItemDelete,
  }[c.kind];
  const body = schema.parse(c.body);
  if ((c.kind === 'planDelete' || c.kind === 'itemDelete') && c.body.contractVersion !== 4)
    throw new Error('INVALID_DELETE_CONTRACT');
  assertWbsBodyBytes(body);
  if (c.kind === 'planCreate' && (c.body.id !== c.id || c.body.year !== c.year))
    throw new Error('INVALID_SCOPE');
  if (c.kind === 'itemCreate' && c.body.id !== c.id) throw new Error('INVALID_SCOPE');
  if (c.kind === 'planDelete' && c.body.confirmText !== String(c.year))
    throw new Error('CONFIRMATION_MISMATCH');
  if (['planCreate', 'planPatch', 'planDelete'].includes(c.kind) && c.planId !== c.id)
    throw new Error('INVALID_SCOPE');
  return { ...c, body } as WbsCommand;
}
export async function sendWbs(input: WbsCommand) {
  const c = validateWbsCommand(input);
  if (c.kind === 'planCreate' || c.kind === 'planPatch')
    return workApi(
      c.kind === 'planCreate' ? `/api/projects/${c.projectId}/wbs` : `/api/wbs/${c.id}`,
      zWbsPlan.refine(
        (v) =>
          v.companyId === c.companyId &&
          v.projectId === c.projectId &&
          v.year === c.year &&
          v.id === c.id &&
          v.version === (c.kind === 'planCreate' ? 1 : Number(c.body.version) + 1) &&
          v.note === c.body.note,
      ),
      c.kind === 'planCreate' ? 'POST' : 'PATCH',
      c.body,
    );
  if (c.kind === 'itemCreate' || c.kind === 'itemPatch')
    return workApi(
      c.kind === 'itemCreate' ? `/api/wbs/${c.planId}/items` : `/api/wbs-items/${c.id}`,
      zWbsItemResult.refine(
        (v) =>
          v.item.companyId === c.companyId &&
          v.item.planId === c.planId &&
          v.item.id === c.id &&
          v.planVersion === Number(c.body.planVersion) + 1 &&
          matchesItem(c, v.item),
      ),
      c.kind === 'itemCreate' ? 'POST' : 'PATCH',
      c.body,
    );
  return workApi(
    `/api/${c.kind === 'planDelete' ? 'wbs' : 'wbs-items'}/${c.id}`,
    zWbsDeleteResult.refine(
      (v) =>
        v.id === c.id &&
        v.planVersion === (c.kind === 'planDelete' ? null : Number(c.body.planVersion) + 1),
    ),
    'DELETE',
    c.body,
  );
}
function matchesItem(c: WbsCommand, i: WbsItem) {
  const b = c.body;
  if (c.original) {
    const old = c.original;
    for (const key of ['plannedStartOn', 'plannedEndOn', 'createdAt'] as const)
      if (i[key] !== old[key]) return false;
    for (const key of ['title', 'description', 'sortOrder'] as const)
      if (!(key in b) && i[key] !== old[key]) return false;
    if (
      !b.schedule &&
      (i.hasRevisedSchedule !== old.hasRevisedSchedule ||
        i.revisedStartOn !== old.revisedStartOn ||
        i.revisedEndOn !== old.revisedEndOn)
    )
      return false;
  }
  if (i.version !== (c.kind === 'itemCreate' ? 1 : Number(b.version) + 1)) return false;
  for (const key of ['title', 'description', 'sortOrder'] as const)
    if (key in b && i[key] !== b[key]) return false;
  if (
    c.kind === 'itemCreate' &&
    (i.plannedStartOn !== b.plannedStartOn ||
      i.plannedEndOn !== b.plannedEndOn ||
      i.hasRevisedSchedule)
  )
    return false;
  const schedule = b.schedule as { startOn: string | null; endOn: string | null } | undefined;
  return (
    !schedule ||
    (i.hasRevisedSchedule &&
      i.revisedStartOn === schedule.startOn &&
      i.revisedEndOn === schedule.endOn)
  );
}
export function matchWbsResult(
  c: WbsCommand,
  plans: WbsPlan[],
): 'matched' | 'absent' | 'different' {
  const p = plans.find((p) => p.id === c.planId && p.projectId === c.projectId);
  if (c.kind === 'planDelete') return p ? 'different' : 'absent';
  if (c.kind === 'itemDelete') return p?.items.some((i) => i.id === c.id) ? 'different' : 'absent';
  if (!p) return 'absent';
  if (c.kind === 'planCreate' || c.kind === 'planPatch')
    return p.version === (c.kind === 'planCreate' ? 1 : Number(c.body.version) + 1) &&
      p.note === c.body.note
      ? 'matched'
      : 'different';
  const i = p.items.find((i) => i.id === c.id);
  return !i
    ? 'absent'
    : p.version === Number(c.body.planVersion) + 1 && matchesItem(c, i)
      ? 'matched'
      : 'different';
}
export function wbsFailure(e: unknown) {
  if (e instanceof WorkFailure) {
    if (e.status === 409)
      return '계획 또는 항목이 변경됐거나 같은 ID가 저장됐습니다. 입력을 유지하고 결과·최신 버전을 확인하세요.';
    if (e.status === 422)
      return '일정이 같거나 실제 변경이 없거나 삭제 확인·비활성 프로젝트 조건이 맞지 않습니다. 입력과 영향을 다시 확인하세요.';
  }
  return null;
}

type CompletionScope = { companyId: string; projectId: string; planId: string; itemId: string };
export function readWbsCompletion(scope: CompletionScope) {
  return workApi(
    `/api/wbs-items/${scope.itemId}/summary`,
    zWbsCompletionSummary.refine(
      (s) =>
        s.companyId === scope.companyId &&
        s.projectId === scope.projectId &&
        s.planId === scope.planId &&
        s.itemId === scope.itemId &&
        (!s.completion ||
          (s.completion.itemVersion <= s.itemVersion &&
            s.completion.planVersion <= s.planVersion &&
            s.completion.completedAt <= s.asOf)),
    ),
  );
}
export function completeWbs(
  command: CompletionScope & { input: z.output<typeof zWbsCompletionInput> },
) {
  const input = zWbsCompletionInput.parse(command.input);
  assertWbsBodyBytes(input);
  return workApi(
    `/api/wbs-items/${command.itemId}/complete`,
    zWbsCompletionResult.refine(
      (r) =>
        r.itemId === command.itemId &&
        r.planId === command.planId &&
        r.itemVersion === input.version + 1 &&
        r.planVersion === input.planVersion + 1 &&
        r.completion.commandId === input.id &&
        r.stateTokenAtCompletion === input.expectedStateToken &&
        (['total', 'todo', 'doing', 'paused', 'done', 'canceled'] as const).every(
          (k) => r.countsAtCompletion[k] === input.expectedCounts[k],
        ),
    ),
    'POST',
    input,
  );
}
