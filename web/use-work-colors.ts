import { useEffect, useState } from 'react';
import type { WorkColorItem } from '../shared/schema/work-color';
import { readWorkColors, WORK_COLOR_CHANGED } from './work-color-api';
export function useWorkColors(companyId: string, ids: string[], refresh = 0) {
  const signature = [...new Set(ids)].sort().join(',');
  const scope = `${companyId}:${signature}`;
  const [revision, setRevision] = useState(0);
  const [state, setState] = useState<{
    scope: string;
    items: Record<string, WorkColorItem>;
    error: boolean;
  }>({ scope: '', items: {}, error: false });
  useEffect(() => {
    const changed = (event: Event) => {
      if ((event as CustomEvent<unknown>).detail === companyId) setRevision((value) => value + 1);
    };
    window.addEventListener(WORK_COLOR_CHANGED, changed);
    return () => window.removeEventListener(WORK_COLOR_CHANGED, changed);
  }, [companyId]);
  useEffect(() => {
    let current = true;
    void readWorkColors(companyId, signature ? signature.split(',') : [])
      .then((items) => {
        if (current) setState({ scope, items, error: false });
      })
      .catch(() => {
        if (current)
          setState((previous) => ({
            scope,
            items: previous.scope === scope ? previous.items : {},
            error: true,
          }));
      });
    return () => {
      current = false;
    };
  }, [companyId, signature, scope, revision, refresh]);
  return {
    colors: state.scope === scope ? state.items : {},
    error: state.scope === scope && state.error,
  };
}
