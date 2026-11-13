import { useEffect, useState } from 'react';
import { importedImportance } from './daily-sheet-model';
import { readWorkImportance, WORK_IMPORTANCE_CHANGED } from './work-importance-api';
type Entry = { id: string; content: string | null };
export function useWorkImportance(
  userId: string,
  companyId: string,
  entries: readonly Entry[],
  refresh = 0,
) {
  const [epoch, setEpoch] = useState(0);
  const ids = entries.map((entry) => entry.id);
  const key = `${userId}:${companyId}:${ids.join(',')}:${epoch}:${refresh}`;
  const [state, setState] = useState<{
    key: string;
    values: Record<string, boolean | null>;
  } | null>(null);
  useEffect(() => {
    const changed = (event: Event) => {
      if (event instanceof CustomEvent && event.detail === companyId)
        setEpoch((value) => value + 1);
    };
    window.addEventListener(WORK_IMPORTANCE_CHANGED, changed);
    return () => window.removeEventListener(WORK_IMPORTANCE_CHANGED, changed);
  }, [companyId]);
  useEffect(() => {
    if (!ids.length) return;
    let current = true;
    void readWorkImportance(companyId, ids).then(
      (result) => {
        if (current)
          setState({
            key,
            values: Object.fromEntries(
              Object.entries(result).map(([id, item]) => [id, item.importance]),
            ),
          });
      },
      () => {
        if (current) setState(null);
      },
    );
    return () => {
      current = false;
    };
  }, [companyId, key]);
  return (entry: Entry): boolean | undefined =>
    state?.key === key && Object.hasOwn(state.values, entry.id)
      ? (state.values[entry.id] ?? importedImportance(entry.content))
      : undefined;
}
