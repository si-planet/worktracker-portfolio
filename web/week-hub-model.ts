import type { WorkEntryFinal } from '../shared/schema/work-entry';
/** Period entries can appear on more than one day; metrics count each ID once. */
export function weeklyEntries(days: { entries: WorkEntryFinal[] }[]): WorkEntryFinal[] {
  return [
    ...new Map(days.flatMap((day) => day.entries).map((entry) => [entry.id, entry])).values(),
  ];
}
export function completionTarget(entry: WorkEntryFinal): WorkEntryFinal['status'] | null {
  if (
    entry.kind === 'leave' ||
    !entry.plannedDate ||
    entry.status === 'paused' ||
    entry.status === 'canceled'
  )
    return null;
  return entry.status === 'done' ? (entry.kind === 'task' ? 'todo' : 'planned') : 'done';
}
export function dayHref(companyId: string, date: string, projectId = '') {
  return `/c/${companyId}/day?${new URLSearchParams({ year: String(Number(date.slice(0, 4))), date, ...(projectId ? { projectId } : {}) })}`;
}

/** A blank tab draft must not silently override the day the user just opened. */
export function newDraftForDate<
  T extends { kind: string; title: string; content: string; dueDate: string; date: string },
>(form: T, date: string, protectedDraft: boolean): T {
  return !protectedDraft && form.kind === 'task' && !form.title && !form.content && !form.dueDate
    ? { ...form, date }
    : form;
}
