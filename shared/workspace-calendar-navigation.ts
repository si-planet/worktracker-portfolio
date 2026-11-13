import { isCalendarMonth } from './month-calendar';
import { zWorkEntryDate } from './schema/work-entry';
import { zWorkspaceId } from './schema/workspace';

/** Existing outer calendar links replace the removed inner view switcher. */
export function workspaceCalendarHref(companyId: string, view: string, currentHref: string) {
  const path = `/c/${companyId}/${view}`;
  if (view !== 'week' && view !== 'month') return path;
  const current = new URL(currentHref);
  if (!current.pathname.startsWith(`/c/${companyId}/`)) return path;
  const rawDate = current.searchParams.get('date');
  const rawMonth = current.searchParams.get('month');
  const date = zWorkEntryDate.safeParse(rawDate).success
    ? rawDate!
    : rawMonth && isCalendarMonth(rawMonth)
      ? `${rawMonth}-01`
      : null;
  if (!date) return path;
  const params = new URLSearchParams({ year: String(Number(date.slice(0, 4))), date });
  if (view === 'month') params.set('month', date.slice(0, 7));
  const projectId = current.searchParams.get('projectId');
  if (zWorkspaceId.safeParse(projectId).success) params.set('projectId', projectId!);
  return `${path}?${params}`;
}
