import { HelpHint } from './help-hint';
import { RefreshButton } from './ui-controls';
import { editableDailyNotes } from './daily-sheet-model';
import { useEffect, useRef, useState } from 'react';
import { z } from 'zod';
import {
  defaultSearchFilters,
  parseSearchFilters,
  searchParameters,
  searchFiltersMatch,
  zSearchFiltersDraft,
  type SearchFilters,
} from '../shared/search-filter';
import {
  zWorkspaceCompany,
  zWorkspaceProject,
  type WorkspaceCompany,
  type WorkspaceProject,
} from '../shared/schema/workspace';
import { zAdminWorkTag, type AdminWorkTag } from '../shared/schema/tags';
import type { WorkEntryFinal } from '../shared/schema/work-entry';
import { WorkFailure, workApi, workError, workListSchema } from './work-entry-api';
import './work-entries.css';

const kinds = {
  task: '업무',
  meeting: '회의',
  field: '외근',
  event: '회사 행사',
  leave: '휴가',
  etc: '기타',
};
const statuses = {
  todo: '미진행',
  doing: '진행 중',
  paused: '중단',
  planned: '예정',
  done: '완료',
  canceled: '취소',
};
function initial() {
  try {
    return {
      filters: parseSearchFilters(new URLSearchParams(window.location.search)),
      valid: true,
    };
  } catch {
    return { filters: defaultSearchFilters(), valid: false };
  }
}
function storedDraft(key: string, scope: string, fallback: SearchFilters) {
  try {
    const value: unknown = JSON.parse(sessionStorage.getItem(key) ?? 'null');
    const parsed = z
      .strictObject({ scope: z.string().max(20000), draft: zSearchFiltersDraft })
      .safeParse(value);
    if (parsed.success && parsed.data.scope === scope) return parsed.data.draft;
  } catch {
    /* Storage is optional; invalid values never replace filters. */
  }
  return fallback;
}
export function SearchView({ companyId, userId }: { companyId: string; userId: string }) {
  const [start] = useState(initial);
  const [applied, setApplied] = useState(start.filters);
  const [valid, setValid] = useState(start.valid);
  const appliedParams = searchParameters(applied).toString();
  const key = `wt:search:v1:${encodeURIComponent(userId)}:${companyId}`;
  const [draft, setDraft] = useState(() => storedDraft(key, appliedParams, start.filters));
  const [company, setCompany] = useState<WorkspaceCompany | null>(null);
  const [projects, setProjects] = useState<WorkspaceProject[]>([]);
  const [tags, setTags] = useState<AdminWorkTag[]>([]);
  const [metadataReady, setMetadataReady] = useState(false);
  const [metadataLoading, setMetadataLoading] = useState(false);
  const [metadataError, setMetadataError] = useState('');
  const [metadataReload, setMetadataReload] = useState(0);
  const [items, setItems] = useState<WorkEntryFinal[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(
    start.valid ? '' : '검색 주소의 조건을 확인해 주세요. 조건을 고친 뒤 검색하세요.',
  );
  const [formError, setFormError] = useState('');
  const [denied, setDenied] = useState(false);
  const [online, setOnline] = useState(navigator.onLine);
  const [reload, setReload] = useState(0);
  const revision = useRef(0),
    metadataRevision = useRef(0);
  const lock = useRef(false);
  const displayed = useRef<string | null>(null);
  const seen = useRef(new Set<string>());
  const scope = `${companyId}?${appliedParams}`;
  const shown = valid && displayed.current === scope && metadataReady && !denied;
  const current = useRef({ draft, appliedParams });
  current.current = { draft, appliedParams };
  function save() {
    try {
      sessionStorage.setItem(
        key,
        JSON.stringify({ scope: current.current.appliedParams, draft: current.current.draft }),
      );
    } catch {
      /* Keep the in-memory draft. */
    }
  }
  useEffect(() => {
    save();
  }, [draft, appliedParams, key]);
  function expired(failure: unknown) {
    if (!(failure instanceof WorkFailure) || failure.status !== 401) return false;
    save();
    window.location.assign(
      `/login?${new URLSearchParams({ returnTo: `/c/${companyId}/search?${current.current.appliedParams}` })}`,
    );
    return true;
  }
  useEffect(() => {
    if (start.valid)
      window.history.replaceState(null, '', `/c/${companyId}/search?${appliedParams}`);
    const pop = () => {
      const value = initial();
      setApplied(value.filters);
      setDraft(value.filters);
      setValid(value.valid);
      setFormError('');
      setError(value.valid ? '' : '검색 주소의 조건을 확인해 주세요. 조건을 고친 뒤 검색하세요.');
    };
    const update = () => setOnline(navigator.onLine);
    const awake = () => {
      if (document.visibilityState === 'visible' && navigator.onLine)
        setReload((value) => value + 1);
    };
    window.addEventListener('popstate', pop);
    window.addEventListener('online', update);
    window.addEventListener('offline', update);
    document.addEventListener('visibilitychange', awake);
    return () => {
      window.removeEventListener('popstate', pop);
      window.removeEventListener('online', update);
      window.removeEventListener('offline', update);
      document.removeEventListener('visibilitychange', awake);
    };
  }, []);
  useEffect(() => {
    const ticket = ++metadataRevision.current;
    setMetadataError('');
    if (!navigator.onLine) {
      setMetadataLoading(false);
      return;
    }
    setMetadataLoading(true);
    setMetadataReady(false);
    void Promise.all([
      workApi(
        `/api/companies/${companyId}`,
        zWorkspaceCompany.refine((value) => value.id === companyId),
      ),
      workApi(
        `/api/companies/${companyId}/projects`,
        z
          .array(zWorkspaceProject)
          .refine((values) => values.every((value) => value.companyId === companyId)),
      ),
      workApi(
        `/api/companies/${companyId}/work-tags?includeInactive=true`,
        z
          .array(zAdminWorkTag)
          .refine((values) =>
            values.every((value) => value.companyId === null || value.companyId === companyId),
          ),
      ),
    ])
      .then(([value, list, choices]) => {
        if (ticket !== metadataRevision.current) return;
        setCompany(value);
        setProjects(list);
        setTags(choices);
        setMetadataReady(true);
        setDenied(false);
      })
      .catch((failure: unknown) => {
        if (ticket !== metadataRevision.current || expired(failure)) return;
        revision.current++;
        lock.current = false;
        setLoading(false);
        setMetadataReady(false);
        displayed.current = null;
        setItems([]);
        setCursor(null);
        setReady(false);
        if (failure instanceof WorkFailure && failure.status === 403) {
          setDenied(true);
          setCompany(null);
          setProjects([]);
          setTags([]);
        }
        setMetadataError(workError(failure));
      })
      .finally(() => {
        if (ticket === metadataRevision.current) setMetadataLoading(false);
      });
    return () => {
      metadataRevision.current++;
    };
  }, [companyId, metadataReload, online]);
  async function load(more = false) {
    if (!valid || !metadataReady || (more && (lock.current || !cursor))) return;
    const ticket = ++revision.current;
    const requested = scope;
    lock.current = true;
    setError('');
    if (displayed.current !== requested) {
      displayed.current = null;
      setItems([]);
      setCursor(null);
      setReady(false);
    }
    if (!navigator.onLine) {
      lock.current = false;
      setLoading(false);
      return;
    }
    setLoading(true);
    if (!more) seen.current.clear();
    const query = new URLSearchParams(appliedParams);
    if (more && cursor) query.set('cursor', cursor);
    try {
      const value = await workApi(
        `/api/companies/${companyId}/work-entries?${query}`,
        workListSchema(companyId),
      );
      if (ticket !== revision.current) return;
      if (value.items.some((entry) => !searchFiltersMatch(entry, applied)))
        throw new WorkFailure(0, 'INVALID_RESPONSE');
      if (
        value.nextCursor &&
        ((more && value.nextCursor === cursor) || seen.current.has(value.nextCursor))
      )
        throw new WorkFailure(0, 'INVALID_RESPONSE');
      if (value.nextCursor) seen.current.add(value.nextCursor);
      setItems((previous) => {
        const rows = new Map((more ? previous : []).map((entry) => [entry.id, entry]));
        for (const entry of value.items) rows.set(entry.id, entry);
        return [...rows.values()];
      });
      setCursor(value.nextCursor);
      setReady(true);
      setDenied(false);
      displayed.current = requested;
    } catch (failure) {
      if (ticket !== revision.current || expired(failure)) return;
      if (failure instanceof WorkFailure && failure.status === 403) {
        displayed.current = null;
        setItems([]);
        setCursor(null);
        setReady(false);
        setDenied(true);
      }
      setError(workError(failure));
    } finally {
      if (ticket === revision.current) {
        lock.current = false;
        setLoading(false);
      }
    }
  }
  useEffect(() => {
    void load();
    return () => {
      revision.current++;
      lock.current = false;
    };
  }, [scope, valid, metadataReady, reload, online]);
  function apply(value: SearchFilters) {
    try {
      const params = searchParameters(value);
      const filters = parseSearchFilters(params);
      setApplied(filters);
      setDraft(filters);
      setValid(true);
      setFormError('');
      setDenied(false);
      window.history.pushState(null, '', `/c/${companyId}/search?${params}`);
      setReload((count) => count + 1);
    } catch {
      setFormError(
        '날짜·연도·검색 조건을 확인해 주세요. 날짜 미정에는 기간과 연도를 사용할 수 없습니다.',
      );
    }
  }
  function toggle(field: 'kinds' | 'statuses' | 'projectIds' | 'tagIds', value: string) {
    setDraft(
      (previous) =>
        ({
          ...previous,
          [field]: previous[field].includes(value as never)
            ? previous[field].filter((item) => item !== value)
            : [...previous[field], value],
        }) as SearchFilters,
    );
  }
  const projectLabel = (id: string) => {
    const value = projects.find((item) => item.id === id);
    return value
      ? `${value.code}${value.isActive ? '' : ' · 비활성'}`
      : `목록에 없는 프로젝트 · ${id}`;
  };
  const tagLabel = (id: string) => {
    const value = tags.find((item) => item.id === id);
    return value
      ? `${value.label}${value.isActive ? '' : ' · 비활성'}`
      : `목록에 없는 태그 · ${id}`;
  };
  return (
    <section className="workspace" aria-label="업무 검색">
      <nav className="workspace-nav" aria-label="회사 메뉴">
        <a className="control-link" href="/">
          회사 선택
        </a>
        <a className="control-link" href={`/c/${companyId}/week`}>
          회사 작업공간
        </a>
        <a className="control-link" href="/settings">
          계정 설정
        </a>
      </nav>
      <h1>업무 검색</h1>
      {company && <h2>{company.name}</h2>}
      <HelpHint label="검색 일치 기준">
        서로 다른 조건은 모두 일치해야 합니다. 같은 종류의 선택은 하나만 일치해도 포함합니다. 제목과
        본문을 입력한 그대로 검색합니다.
      </HelpHint>
      {metadataError && <p role="alert">{metadataError}</p>}
      {!online && (
        <p role="status">
          오프라인 · 마지막 조회 결과이며 최신 상태가 아닙니다. 검색 입력을 보존합니다.
        </p>
      )}
      {!metadataReady && !metadataError && online && (
        <p role="status">검색할 회사와 필터를 확인하고 있습니다.</p>
      )}
      <RefreshButton
        type="button"
        className="text-button"
        disabled={!online || metadataLoading || loading}
        busy={metadataLoading || loading}
        onClick={() => {
          setMetadataReload((count) => count + 1);
        }}
      >
        검색 다시 조회
      </RefreshButton>
      {!denied && (
        <form
          noValidate
          className="workspace-block"
          onSubmit={(event) => {
            event.preventDefault();
            if (online) apply(draft);
          }}
        >
          <label className="form-field">
            검색어
            <input
              value={draft.keyword}
              maxLength={100}
              onChange={(event) => setDraft({ ...draft, keyword: event.target.value })}
            />
          </label>
          <label className="form-field">
            날짜 범위
            <select
              value={draft.dateState}
              onChange={(event) => {
                const value = event.target.value as SearchFilters['dateState'];
                setDraft(
                  value === 'unscheduled'
                    ? {
                        ...draft,
                        dateState: value,
                        from: '',
                        to: '',
                        year: '',
                        kinds: ['task'],
                        statuses: draft.statuses.length
                          ? draft.statuses.filter(
                              (item) => item === 'todo' || item === 'paused' || item === 'canceled',
                            )
                          : [],
                      }
                    : { ...draft, dateState: value },
                );
              }}
            >
              <option value="all">전체</option>
              <option value="scheduled">날짜 있음</option>
              <option value="unscheduled">날짜 미정</option>
            </select>
          </label>
          {draft.dateState === 'unscheduled' && (
            <p>날짜 미정은 미진행·중단·취소 업무만 검색하며 기간과 연도 조건을 제거합니다.</p>
          )}
          <div className="workspace-inline">
            <label>
              시작 날짜
              <input
                type="date"
                value={draft.from}
                disabled={draft.dateState === 'unscheduled'}
                onChange={(event) => setDraft({ ...draft, from: event.target.value })}
              />
            </label>
            <label>
              종료 날짜
              <input
                type="date"
                value={draft.to}
                disabled={draft.dateState === 'unscheduled'}
                onChange={(event) => setDraft({ ...draft, to: event.target.value })}
              />
            </label>
            <label>
              검색 연도
              <input
                type="number"
                min="1"
                max="9999"
                value={draft.year}
                disabled={draft.dateState === 'unscheduled'}
                onChange={(event) => setDraft({ ...draft, year: event.target.value })}
              />
            </label>
          </div>
          <fieldset className="workspace-tags">
            <legend>기록 종류</legend>
            {Object.entries(kinds).map(([value, label]) => (
              <label key={value}>
                <input
                  type="checkbox"
                  checked={draft.kinds.includes(value as keyof typeof kinds)}
                  disabled={draft.dateState === 'unscheduled'}
                  onChange={() => toggle('kinds', value)}
                />
                {label}
              </label>
            ))}
          </fieldset>
          <fieldset className="workspace-tags">
            <legend>기록 상태</legend>
            {Object.entries(statuses)
              .filter(
                ([value]) =>
                  draft.dateState !== 'unscheduled' ||
                  value === 'todo' ||
                  value === 'paused' ||
                  value === 'canceled',
              )
              .map(([value, label]) => (
                <label key={value}>
                  <input
                    type="checkbox"
                    checked={draft.statuses.includes(value as keyof typeof statuses)}
                    onChange={() => toggle('statuses', value)}
                  />
                  {label}
                </label>
              ))}
          </fieldset>
          <fieldset className="workspace-tags">
            <legend>프로젝트 필터</legend>
            {[...new Set([...projects.map((item) => item.id), ...draft.projectIds])].map((id) => (
              <label key={id}>
                <input
                  type="checkbox"
                  checked={draft.projectIds.includes(id)}
                  onChange={() => toggle('projectIds', id)}
                />
                {projectLabel(id)}
              </label>
            ))}
          </fieldset>
          <fieldset className="workspace-tags">
            <legend>태그 필터</legend>
            {[...new Set([...tags.map((item) => item.id), ...draft.tagIds])].map((id) => (
              <label key={id}>
                <input
                  type="checkbox"
                  checked={draft.tagIds.includes(id)}
                  onChange={() => toggle('tagIds', id)}
                />
                {tagLabel(id)}
              </label>
            ))}
          </fieldset>
          <HelpHint label="검색 조건">
            비활성 항목은 과거 기록 검색에 사용할 수 있습니다. 선택하지 않은 조건은 제한하지
            않습니다. 작성 중인 조건은 검색 버튼을 눌러 적용합니다.
          </HelpHint>
          {formError && <p role="alert">{formError}</p>}
          <div className="work-actions">
            <button type="submit" className="button primary" disabled={!online || !metadataReady}>
              검색
            </button>
            <button
              type="button"
              className="button secondary"
              disabled={!online || !metadataReady}
              onClick={() => apply(defaultSearchFilters())}
            >
              검색 조건 초기화
            </button>
          </div>
        </form>
      )}
      <section className="workspace-block" aria-label="검색 결과">
        <h2>검색 결과</h2>
        {error && <p role="alert">{error}</p>}
        {error && shown && ready && (
          <p>마지막으로 조회한 결과를 표시합니다. 다시 조회해 최신 상태를 확인하세요.</p>
        )}
        {loading && <p role="status">검색 결과를 불러오고 있습니다.</p>}
        {denied ? (
          <a className="control-link" href="/">
            회사 선택으로 돌아가기
          </a>
        ) : (
          shown &&
          ready && (
            <>
              <p>
                조회한 기록 {items.length}건
                {cursor ? ' · 추가 결과가 있습니다.' : ' · 조회를 마쳤습니다.'}
              </p>
              {!items.length && !cursor && <p>검색 결과가 없습니다.</p>}
              <ul className="work-list" aria-label="검색 기록 목록">
                {items.map((entry) => (
                  <li className="work-card" key={entry.id} style={{ overflowWrap: 'anywhere' }}>
                    <article aria-label={entry.title}>
                      <h3>{entry.title}</h3>
                      <p>
                        {kinds[entry.kind]} · {statuses[entry.status]}
                      </p>
                      {entry.content && (
                        <p style={{ whiteSpace: 'pre-wrap' }}>
                          {editableDailyNotes(entry.content)}
                        </p>
                      )}
                      <p>{entry.projectId ? projectLabel(entry.projectId) : '프로젝트 없음'}</p>
                      <p>{entry.tagIds.map(tagLabel).join(' · ') || '태그 없음'}</p>
                      <p>
                        {entry.plannedDate
                          ? `${entry.plannedDate}${entry.endDate ? ` ~ ${entry.endDate}` : ''}`
                          : '날짜 미정'}
                      </p>
                      {entry.plannedDate ? (
                        <a
                          className="control-link"
                          href={`/c/${companyId}/day?${new URLSearchParams({ year: String(Number(entry.plannedDate.slice(0, 4))), date: entry.plannedDate, entryId: entry.id })}`}
                        >
                          해당 날짜 일간 보기
                        </a>
                      ) : (
                        <a className="control-link" href={`/c/${companyId}/unscheduled`}>
                          날짜 미정 업무 보기
                        </a>
                      )}
                    </article>
                  </li>
                ))}
              </ul>
              {cursor && (
                <button
                  type="button"
                  className="button secondary"
                  disabled={!online || loading}
                  onClick={() => void load(true)}
                >
                  검색 결과 더 보기
                </button>
              )}
            </>
          )
        )}
      </section>
    </section>
  );
}
