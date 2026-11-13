import { z } from 'zod';
import { zWbsItem, zWbsYear } from '../shared/schema/wbs';
import { zWorkEntryDate, zWorkEntryVersion } from '../shared/schema/work-entry';
import {
  zWbsPlannerItem,
  zWbsPlannerProject,
  type WbsPlannerItem,
  type WbsPlannerProject,
} from '../shared/schema/wbs-planner';
import { plannerMonths } from './wbs-planner-calendar';
import { validateWbsCommand, zWbsCommand, type WbsCommand } from './wbs-api';

const beforeYear = (year: number) => {
  const y = year - 1;
  return 365 * y + Math.floor(y / 4) - Math.floor(y / 100) + Math.floor(y / 400);
};
function ordinal(date: string) {
  zWorkEntryDate.parse(date);
  const year = Number(date.slice(0, 4)),
    month = Number(date.slice(5, 7));
  return (
    beforeYear(year) +
    plannerMonths(year)
      .slice(0, month - 1)
      .reduce((n, m) => n + m.days.length, 0) +
    Number(date.slice(8)) -
    1
  );
}
function fromOrdinal(day: number) {
  if (!Number.isInteger(day) || day < 0 || day >= beforeYear(10000))
    throw new Error('MOVE_DATE_RANGE');
  let low = 1,
    high = 9999;
  while (low < high) {
    const middle = Math.ceil((low + high) / 2);
    if (beforeYear(middle) <= day) low = middle;
    else high = middle - 1;
  }
  let remaining = day - beforeYear(low);
  for (const month of plannerMonths(low)) {
    if (remaining < month.days.length)
      return `${month.startOn.slice(0, 8)}${String(remaining + 1).padStart(2, '0')}`;
    remaining -= month.days.length;
  }
  throw new Error('MOVE_DATE_RANGE');
}
/** Inclusive calendar days; weekends and holidays are ordinary dates. */
export function previewWbsMove(
  range: { startOn: string | null; endOn: string | null },
  startOn: string,
) {
  if (range.startOn === null || range.endOn === null) throw new Error('MOVE_OPEN_RANGE');
  const start = ordinal(range.startOn),
    end = ordinal(range.endOn);
  if (end < start) throw new Error('MOVE_DATE_RANGE');
  const next = ordinal(startOn);
  if (next === start) throw new Error('MOVE_UNCHANGED');
  return { startOn, endOn: fromOrdinal(next + end - start), days: end - start + 1 };
}
export const zMoveTarget = z
  .strictObject({
    companyId: z.uuid(),
    projectId: z.uuid(),
    year: zWbsYear,
    planId: z.uuid(),
    planVersion: zWorkEntryVersion,
    projectCode: z.string().min(1).max(60),
    original: zWbsItem,
  })
  .refine((v) => v.original.companyId === v.companyId && v.original.planId === v.planId);
export type MoveTarget = z.output<typeof zMoveTarget>;
export function captureWbsMove(
  companyId: string,
  year: number,
  project: WbsPlannerProject,
  item: WbsPlannerItem,
): MoveTarget {
  project = zWbsPlannerProject.parse(project);
  item = zWbsPlannerItem.parse(item);
  const { actualPeriod, ...original } = item;
  if (
    project.companyId !== companyId ||
    actualPeriod.companyId !== companyId ||
    actualPeriod.projectId !== project.id ||
    actualPeriod.planId !== item.planId ||
    actualPeriod.itemId !== item.id ||
    actualPeriod.itemVersion !== item.version ||
    !project.plans.some(
      (p) =>
        p.id === item.planId &&
        p.year === year &&
        p.version === actualPeriod.planVersion &&
        p.items.some((i) => i.id === item.id && i.version === item.version),
    )
  )
    throw new Error('MOVE_SCOPE');
  return zMoveTarget.parse({
    companyId,
    year,
    projectId: project.id,
    planId: item.planId,
    planVersion: actualPeriod.planVersion,
    projectCode: project.code,
    original,
  });
}
export function wbsMoveCommand(target: MoveTarget, startOn: string, reason: string): WbsCommand {
  const t = zMoveTarget.parse(target);
  const range = previewWbsMove(
    { startOn: t.original.effectiveStartOn, endOn: t.original.effectiveEndOn },
    startOn,
  );
  return validateWbsCommand({
    kind: 'itemPatch',
    companyId: t.companyId,
    projectId: t.projectId,
    year: t.year,
    planId: t.planId,
    id: t.original.id,
    original: t.original,
    body: {
      version: t.original.version,
      planVersion: t.planVersion,
      schedule: { startOn: range.startOn, endOn: range.endOn, ...(reason ? { reason } : {}) },
    },
  });
}
export const zMoveDraft = z
  .strictObject({
    target: zMoveTarget,
    startOn: z.string().max(10),
    reason: z.string().max(5000),
    command: zWbsCommand.nullable(),
    stale: z.boolean(),
  })
  .refine((v) => {
    if (!v.command) return true;
    try {
      return (
        JSON.stringify(v.command) === JSON.stringify(wbsMoveCommand(v.target, v.startOn, v.reason))
      );
    } catch {
      return false;
    }
  });
export type MoveDraft = z.output<typeof zMoveDraft>;
export const zMoveDrafts = z
  .record(z.uuid(), zMoveDraft)
  .refine((drafts) => Object.entries(drafts).every(([id, d]) => d.target.original.id === id));
export function wbsMoveDirty(draft: MoveDraft) {
  return (
    !!draft.command ||
    draft.startOn !== (draft.target.original.effectiveStartOn ?? '') ||
    !!draft.reason ||
    draft.stale
  );
}
export function movePreviewMessage(draft: MoveDraft) {
  try {
    return {
      range: previewWbsMove(
        {
          startOn: draft.target.original.effectiveStartOn,
          endOn: draft.target.original.effectiveEndOn,
        },
        draft.startOn,
      ),
      error: '',
    };
  } catch {
    return {
      range: null,
      error: !draft.startOn
        ? '새 시작일을 선택해 주세요.'
        : draft.startOn === draft.target.original.effectiveStartOn
          ? '현재와 같은 시작일입니다. 다른 날짜를 선택해 주세요.'
          : '이동할 날짜와 종료일은 0001-01-01~9999-12-31 안의 유효한 날짜여야 합니다.',
    };
  }
}
