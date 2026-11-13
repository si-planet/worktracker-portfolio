import { zWorkImportanceItem, type WorkImportanceItem } from '../shared/schema/work-importance';

// These are identities of the two initial examples, never their current list positions.
const defaultImportantIds = [
  '019950d3-b800-7000-8000-000000000900',
  '019950d3-b800-7000-8000-000000000905',
];

export function restoreImportance(
  entries: readonly { id: string }[], saved: unknown,
): Record<string, WorkImportanceItem> {
  const ids = new Set(entries.map(entry => entry.id));
  if (saved && typeof saved === 'object' && !Array.isArray(saved)) {
    const valid: Array<[string, WorkImportanceItem]> = [];
    for (const [id, value] of Object.entries(saved)) {
      const parsed = zWorkImportanceItem.safeParse(value);
      if (ids.has(id) && parsed.success && parsed.data.workEntryId === id)
        valid.push([id, parsed.data]);
    }
    // A saved empty set and explicit false/null values are deliberate choices.
    return Object.fromEntries(valid);
  }
  return Object.fromEntries(defaultImportantIds.filter(id => ids.has(id)).map(id => [id, {
    workEntryId: id, importance: true, version: 1,
  } satisfies WorkImportanceItem]));
}
