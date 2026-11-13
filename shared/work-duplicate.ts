import { kstDate } from './work-entry-rules';
import { zWorkEntryFinal, zWorkEntryId, type WorkEntryFinal } from './schema/work-entry';

/** Draft-only whitelist. Source identity, schedules, audit and computed leave values never transfer. */
export function createWorkDuplicateDraft(source: WorkEntryFinal, newId: string) {
  const entry = zWorkEntryFinal.parse(source);
  const id = zWorkEntryId.parse(newId);
  if (id === entry.id) throw new RangeError('DUPLICATE_REQUIRES_NEW_ID');
  return {
    id,
    kind: entry.kind,
    title: entry.title,
    content: entry.content,
    projectId: entry.projectId,
    tagIds: [...entry.tagIds],
    mustFinishToday: entry.mustFinishToday,
    status: entry.kind === 'task' ? ('todo' as const) : ('planned' as const),
    plannedDate: null,
    endDate: null,
    dueDate: null,
    timeMode: 'date_only' as const,
    startAt: null,
    endAt: null,
    leave: entry.leave ? { type: entry.leave.type } : null,
  };
}

/** A stable ID alone is insufficient evidence after an uncertain duplicate response. */
export function matchesWorkDuplicate(
  companyId: string,
  request: import('./schema/work-duplicate').WorkEntryDuplicate,
  snapshot: import('./schema/work-duplicate').WorkEntryDuplicateSnapshot,
): boolean {
  const input = request.entry,
    actual = snapshot.entry;
  if (
    actual.id !== input.id ||
    actual.companyId !== companyId ||
    actual.version !== 1 ||
    snapshot.wbs.entryId !== input.id ||
    snapshot.wbs.sourceEntryVersion !== actual.version
  )
    return false;
  const fields = [
    'kind',
    'projectId',
    'title',
    'content',
    'plannedDate',
    'dueDate',
    'endDate',
    'timeMode',
    'startAt',
    'endAt',
    'mustFinishToday',
    'sortOrder',
  ] as const;
  if (fields.some((key) => input[key] !== actual[key])) return false;
  if (JSON.stringify([...input.tagIds].sort()) !== JSON.stringify([...actual.tagIds].sort()))
    return false;
  if (input.kind === 'leave') {
    if (
      !actual.leave ||
      actual.leave.type !== input.leave.type ||
      actual.leave.workHoursPerDay !== input.calculationBasis.workHoursPerDay ||
      actual.status !== (input.plannedDate! < kstDate(actual.createdAt) ? 'done' : 'planned')
    )
      return false;
  } else if (
    actual.leave !== null ||
    actual.status !== input.status ||
    actual.allDay !== input.allDay ||
    actual.completedAt !== null
  )
    return false;
  const expected = request.wbs?.link;
  const { link, target } = snapshot.wbs;
  if (!expected) return link === null && target === null;
  return (
    !!link &&
    !!target &&
    link.id === expected.id &&
    link.entryId === actual.id &&
    link.companyId === companyId &&
    link.itemId === expected.target.itemId &&
    link.version === 1 &&
    target.itemId === expected.target.itemId &&
    target.planId === expected.target.planId &&
    target.itemVersion >= expected.target.itemVersion + 1 &&
    target.planVersion >= expected.target.planVersion + 1
  );
}

export function createDuplicateWbsReview(
  snapshot: import('./schema/work-duplicate').WorkEntryDuplicateSnapshot,
  linkId: string,
): import('./schema/work-duplicate').DuplicateWbsReview {
  zWorkEntryId.parse(linkId);
  const { link, target } = snapshot.wbs;
  return {
    expectedSource: link ? { id: link.id, version: link.version, itemId: link.itemId } : null,
    link:
      link && target && snapshot.entry.projectId && snapshot.entry.kind === 'task'
        ? { id: linkId, projectId: snapshot.entry.projectId, target: { ...target } }
        : null,
  };
}
