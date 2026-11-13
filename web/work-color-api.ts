import { zWorkColorItem, zWorkColors, type WorkColorItem } from '../shared/schema/work-color';
import { workApi } from './work-entry-api';
export const WORK_COLOR_CHANGED = 'work-tracker:work-color-changed';
export async function readWorkColors(companyId: string, ids: string[]) {
  const unique = [...new Set(ids)];
  const result: Record<string, WorkColorItem> = {};
  for (let start = 0; start < unique.length; start += 50) {
    const batch = unique.slice(start, start + 50);
    const query = new URLSearchParams(batch.map((id) => ['id', id]));
    const response = await workApi(
      `/api/companies/${companyId}/work-colors?${query}`,
      zWorkColors.refine(
        (value) =>
          value.companyId === companyId &&
          value.items.length === batch.length &&
          new Set(value.items.map((item) => item.workEntryId)).size === batch.length &&
          value.items.every((item) => batch.includes(item.workEntryId)),
      ),
    );
    for (const item of response.items) result[item.workEntryId] = item;
  }
  return result;
}
export async function writeWorkColor(companyId: string, item: WorkColorItem) {
  const result = await workApi(
    `/api/companies/${companyId}/work-entries/${item.workEntryId}/color`,
    zWorkColorItem.refine((value) => value.workEntryId === item.workEntryId),
    'PUT',
    { color: item.color, version: item.version },
  );
  window.dispatchEvent(new CustomEvent(WORK_COLOR_CHANGED, { detail: companyId }));
  return result;
}
