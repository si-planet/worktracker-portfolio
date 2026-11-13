import {
  zWorkImportanceItem,
  zWorkImportanceList,
  type WorkImportanceItem,
} from '../shared/schema/work-importance';
import { workApi } from './work-entry-api';
export const WORK_IMPORTANCE_CHANGED = 'work-tracker:work-importance-changed';
export async function readWorkImportanceList(companyId: string, ids: string[]) {
  const unique = [...new Set(ids)];
  const result: Record<string, WorkImportanceItem> = {};
  for (let start = 0; start < unique.length; start += 50) {
    const batch = unique.slice(start, start + 50);
    const query = new URLSearchParams(batch.map((id) => ['id', id]));
    const response = await workApi(
      `/api/companies/${companyId}/work-importance?${query}`,
      zWorkImportanceList.refine(
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
export async function writeWorkImportance(companyId: string, item: WorkImportanceItem) {
  const result = await workApi(
    `/api/companies/${companyId}/work-entries/${item.workEntryId}/importance`,
    zWorkImportanceItem.refine(
      (value) =>
        value.workEntryId === item.workEntryId &&
        value.importance === item.importance &&
        value.version === (item.version === null ? 1 : item.version + 1),
    ),
    'PUT',
    { importance: item.importance, version: item.version },
  );
  window.dispatchEvent(new CustomEvent(WORK_IMPORTANCE_CHANGED, { detail: companyId }));
  return result;
}

export const readWorkImportance = readWorkImportanceList;
export const importanceDraftKey = (userId: string, companyId: string, entryId: string) =>
  `work-tracker:work-importance-pending:${encodeURIComponent(userId)}:${companyId}:${entryId}`;
export type ImportanceDraft = { value: boolean; attempted: boolean };
const memoryDrafts = new Map<string, ImportanceDraft>();
export function readImportanceDraft(key: string): ImportanceDraft | null {
  if (memoryDrafts.has(key)) return memoryDrafts.get(key)!;
  try {
    const raw: unknown = JSON.parse(sessionStorage.getItem(key) ?? 'null');
    if (
      raw &&
      typeof raw === 'object' &&
      'value' in raw &&
      typeof raw.value === 'boolean' &&
      'attempted' in raw &&
      typeof raw.attempted === 'boolean'
    )
      return { value: raw.value, attempted: raw.attempted };
  } catch {
    /* Optional recovery. */
  }
  return null;
}
export function saveImportanceDraft(key: string, value: ImportanceDraft | null) {
  if (value === null) memoryDrafts.delete(key);
  else memoryDrafts.set(key, value);
  try {
    if (value === null) sessionStorage.removeItem(key);
    else sessionStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* Optional recovery; the checkbox still works for existing records. */
  }
}
/** Call once only after the new work ID has been confirmed saved. A failed attempt is not retried. */
export async function commitPendingWorkImportance(
  userId: string,
  companyId: string,
  entryId: string,
) {
  const key = importanceDraftKey(userId, companyId, entryId);
  const pending = readImportanceDraft(key);
  if (!pending) return;
  if (pending.attempted) throw new Error('IMPORTANCE_CONFIRM_REQUIRED');
  saveImportanceDraft(key, { ...pending, attempted: true });
  const item = (await readWorkImportanceList(companyId, [entryId]))[entryId]!;
  if (item.importance !== pending.value) {
    if (item.version !== null) throw new Error('IMPORTANCE_CONFIRM_REQUIRED');
    await writeWorkImportance(companyId, { ...item, importance: pending.value });
  }
  if (readImportanceDraft(key)?.value === pending.value) saveImportanceDraft(key, null);
}
