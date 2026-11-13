import type { CalendarWorkEntry } from '../shared/schema/confirmed-worklog-recovery';
import type { WorkspaceProject, WorkspaceTag } from '../shared/schema/workspace';
import {
  zCategoryColors,
  zCategoryColorItem,
  type CategoryColorItem,
} from '../shared/schema/category-color';
import { workApi } from './work-entry-api';
import { monthWorkAppearance } from './month-work-appearance';

export const categoryKey = (kind: 'project' | 'tag', targetId: string) => `${kind}:${targetId}`;
export async function readCategoryColors(companyId: string) {
  const result = await workApi(
    `/api/companies/${companyId}/category-colors`,
    zCategoryColors.refine((value) => value.companyId === companyId),
  );
  return Object.fromEntries(
    result.items.map((item) => [categoryKey(item.kind, item.targetId), item]),
  );
}
export async function writeCategoryColor(companyId: string, item: CategoryColorItem) {
  return workApi(
    `/api/companies/${companyId}/category-colors/${item.kind}/${item.targetId}`,
    zCategoryColorItem.refine(
      (value) => value.kind === item.kind && value.targetId === item.targetId,
    ),
    'PUT',
    { color: item.color, version: item.version },
  );
}
/** Tag overrides are explicit; stable catalog order prevents filtering/reordering changing a color. */
export function categoryAppearance(
  entry: Pick<CalendarWorkEntry, 'projectId' | 'tagIds'>,
  projects: WorkspaceProject[],
  tags: WorkspaceTag[],
  colors: Record<string, CategoryColorItem>,
) {
  const tagged = tags
    .filter((tag) => entry.tagIds.includes(tag.id) && colors[categoryKey('tag', tag.id)]?.color)
    .sort((a, b) => a.sortOrder - b.sortOrder || a.id.localeCompare(b.id))[0];
  if (tagged)
    return monthWorkAppearance(
      categoryKey('tag', tagged.id),
      colors[categoryKey('tag', tagged.id)]?.color,
    );
  const project = projects.find((item) => item.id === entry.projectId);
  const key = categoryKey('project', entry.projectId ?? 'none');
  return monthWorkAppearance(key, colors[key]?.color ?? project?.color);
}
