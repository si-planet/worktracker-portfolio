import { useEffect, useState } from 'react';
import {
  readWorkSourceLabels,
  type SourceLabelEntry,
  type SourceLabels,
} from './work-source-labels-api';
import './work-source-labels.css';

type State = {
  key: string;
  status: 'loading' | 'ready' | 'unavailable' | 'error';
  labels: SourceLabels;
};

/** Tab-local, version-bound read-only information. New navigation invalidates pending responses. */
export function useWorkSourceLabels(
  companyId: string,
  entries: readonly SourceLabelEntry[],
  scope: string,
  enabled = true,
) {
  const key = `${companyId}:${scope}:${entries.map((entry) => `${entry.id}:${entry.version}`).join(',')}`;
  const [state, setState] = useState<State | null>(null);
  useEffect(() => {
    if (!enabled || !entries.length) return;
    let current = true;
    setState({ key, status: 'loading', labels: new Map() });
    void readWorkSourceLabels(companyId, entries).then(
      (result) => {
        if (current)
          setState({
            key,
            status: result.available ? 'ready' : 'unavailable',
            labels: result.labels,
          });
      },
      () => {
        if (current) setState({ key, status: 'error', labels: new Map() });
      },
    );
    return () => {
      current = false;
    };
  }, [companyId, key, enabled]);
  const shown = enabled && state?.key === key ? state : null;
  return {
    status: shown?.status ?? null,
    categories: (entry: SourceLabelEntry) => {
      const value = shown?.labels.get(entry.id);
      return value?.entryVersion === entry.version ? value.categories : [];
    },
  };
}

export function WorkSourceBadges({ categories }: { categories: readonly string[] }) {
  if (!categories.length) return null;
  return (
    <span className="work-source-badges" aria-label="업무 구분">
      {categories.map((category) => (
        <span
          className="work-source-badge"
          key={category}
          title="업무 구분입니다. 현재 프로젝트나 태그를 바꾸지 않습니다."
        >
          {category}
        </span>
      ))}
    </span>
  );
}

export function WorkSourceNotice({ status }: { status: State['status'] | null }) {
  if (status !== 'error' && status !== 'unavailable') return null;
  return (
    <p className="work-source-notice" role="status">
      {status === 'error'
        ? '업무 구분을 조회하지 못했습니다. 기록을 다시 조회해 주세요.'
        : '업무 구분 정보를 아직 제공하지 않습니다.'}
    </p>
  );
}
