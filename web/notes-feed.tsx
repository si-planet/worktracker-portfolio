import { useEffect, useRef, useState } from 'react';
import { z } from 'zod';
import {
  zWorkspaceCompany,
  zWorkspaceProject,
  type WorkspaceCompany,
  type WorkspaceProject,
} from '../shared/schema/workspace';
import type { AdminNoteTag } from '../shared/schema/tags';
import { WorkFailure, workApi } from './work-entry-api';
import { workspaceHasUnsavedChanges } from './workspace-draft-state';
import {
  readNoteFeed,
  readNoteTags,
  noteFilterParams,
  parseNoteFilters,
  noteFailure,
  noteLogin,
  noteWorkURL,
  noteOrder,
  type NoteFilters,
  type Note,
  type NoteParent,
} from './notes-api';
import { NoteEditorDesk, useNotesOnline, type NoteEditorTarget } from './work-entry-notes';
import './notes.css';
const blank: NoteFilters = { tagIds: [] };
function initial() {
  try {
    return { filters: parseNoteFilters(new URLSearchParams(location.search)), valid: true };
  } catch {
    return { filters: blank, valid: false };
  }
}
const formFor = (f: NoteFilters) => ({
  year: f.year === undefined ? '' : String(f.year),
  projectId: f.projectId ?? '',
  tagIds: f.tagIds,
  keyword: f.keyword ?? '',
});
function historyIndex() {
  const index = (window as Window & { navigation?: { currentEntry?: { index: number } } })
    .navigation?.currentEntry?.index;
  return index !== undefined && index >= 0 ? index : null;
}
export function NotesFeed({ companyId, userId }: { companyId: string; userId: string }) {
  const [start] = useState(initial),
    [applied, setApplied] = useState(start.filters),
    [valid, setValid] = useState(start.valid),
    [draft, setDraft] = useState(() => formFor(start.filters));
  const [company, setCompany] = useState<WorkspaceCompany | null>(null),
    [projects, setProjects] = useState<WorkspaceProject[]>([]),
    [tags, setTags] = useState<AdminNoteTag[]>([]),
    [metadata, setMetadata] = useState(false);
  const [items, setItems] = useState<{ note: Note; parent: NoteParent }[]>([]),
    [cursor, setCursor] = useState<string | null>(null),
    [ready, setReady] = useState(false),
    [loading, setLoading] = useState(false),
    [error, setError] = useState(start.valid ? '' : '노트 검색 주소의 조건을 확인해 주세요.'),
    [formError, setFormError] = useState(''),
    [denied, setDenied] = useState(false),
    [reload, setReload] = useState(0),
    [target, setTarget] = useState<NoteEditorTarget | null>(null);
  const online = useNotesOnline(),
    revision = useRef(0),
    metadataRevision = useRef(0),
    lock = useRef(false),
    displayed = useRef(''),
    seen = useRef(new Set<string>()),
    currentURL = useRef(location.pathname + location.search),
    currentState = useRef(history.state),
    currentIndex = useRef(historyIndex()),
    restoring = useRef(false);
  const params = noteFilterParams(applied).toString(),
    scope = `${companyId}?${params}`;
  function deny() {
    revision.current++;
    metadataRevision.current++;
    lock.current = false;
    setLoading(false);
    setDenied(true);
    setItems([]);
    setCursor(null);
    setCompany(null);
    setTags([]);
    setProjects([]);
    setMetadata(false);
  }
  function fail(e: unknown) {
    if (e instanceof WorkFailure && [401, 403].includes(e.status)) deny();
    setError(noteFailure(e));
    if (e instanceof WorkFailure && e.status === 401) noteLogin(companyId);
  }
  useEffect(() => {
    const ticket = ++metadataRevision.current;
    if (!online) return;
    setMetadata(false);
    void Promise.all([
      workApi(
        `/api/companies/${companyId}`,
        zWorkspaceCompany.refine((v) => v.id === companyId),
      ),
      workApi(
        `/api/companies/${companyId}/projects`,
        z
          .array(zWorkspaceProject)
          .refine(
            (rows) =>
              rows.every((p) => p.companyId === companyId) &&
              new Set(rows.map((p) => p.id)).size === rows.length,
          ),
      ),
      readNoteTags(companyId),
    ])
      .then(([c, p, t]) => {
        if (ticket === metadataRevision.current) {
          setCompany(c);
          setProjects(p);
          setTags(t);
          setMetadata(true);
        }
      })
      .catch((e) => {
        if (ticket === metadataRevision.current) fail(e);
      });
    return () => {
      metadataRevision.current++;
    };
  }, [companyId, reload, online]);
  async function load(more = false) {
    if (lock.current || !valid || !online) return;
    lock.current = true;
    const ticket = ++revision.current;
    setLoading(true);
    setError('');
    try {
      const result = await readNoteFeed(
        companyId,
        applied,
        more ? (cursor ?? undefined) : undefined,
      );
      if (ticket !== revision.current) return;
      if (
        more &&
        (result.items.some((v) => items.some((old) => old.note.id === v.note.id)) ||
          (items.length &&
            result.items.length &&
            noteOrder(items.at(-1)!.note, result.items[0]!.note) > 0) ||
          (result.nextCursor && seen.current.has(result.nextCursor)))
      )
        throw new WorkFailure(0, 'INVALID_RESPONSE');
      if (!more) seen.current.clear();
      if (result.nextCursor) seen.current.add(result.nextCursor);
      setItems(more ? [...items, ...result.items] : result.items);
      setCursor(result.nextCursor);
      setReady(true);
      setDenied(false);
      displayed.current = scope;
    } catch (e) {
      if (ticket === revision.current) fail(e);
    } finally {
      if (ticket === revision.current) {
        lock.current = false;
        setLoading(false);
      }
    }
  }
  useEffect(() => {
    if (displayed.current !== scope) setReady(false);
    lock.current = false;
    void load();
    return () => {
      revision.current++;
      lock.current = false;
    };
  }, [scope, reload, online, valid]);
  function allow() {
    return !workspaceHasUnsavedChanges() || confirm('노트 초안을 보관하고 조회 조건을 변경할까요?');
  }
  function apply() {
    let next: NoteFilters;
    try {
      if (draft.year && !/^[0-9]{1,4}$/.test(draft.year)) throw new Error();
      const p = new URLSearchParams();
      if (draft.year) p.set('year', draft.year);
      if (draft.projectId) p.set('projectId', draft.projectId);
      for (const id of draft.tagIds) p.append('tagIds', id);
      if (draft.keyword) p.set('keyword', draft.keyword);
      next = parseNoteFilters(p);
    } catch {
      setFormError('노트 작성연도 1~9999·프로젝트·노트 태그·검색어를 확인해 주세요.');
      return;
    }
    const nextParams = noteFilterParams(next).toString();
    if (nextParams !== params && !allow()) {
      setDraft(formFor(applied));
      return;
    }
    setFormError('');
    setValid(true);
    setApplied(next);
    if (nextParams === params) setReload((n) => n + 1);
    else {
      currentState.current = history.state;
      currentURL.current = `/c/${companyId}/notes${nextParams ? `?${nextParams}` : ''}`;
      history.pushState(currentState.current, '', currentURL.current);
      currentIndex.current = historyIndex();
    }
  }
  useEffect(() => {
    const pop = (e: PopStateEvent) => {
      if (restoring.current) {
        restoring.current = false;
        currentState.current = history.state;
        e.stopImmediatePropagation();
        return;
      }
      if (!allow()) {
        e.stopImmediatePropagation();
        const arrived = historyIndex(),
          previous = currentIndex.current;
        if (arrived !== null && previous !== null && arrived !== previous) {
          restoring.current = true;
          history.go(previous - arrived);
        } else history.pushState(currentState.current, '', currentURL.current);
        return;
      }
      if (location.pathname !== `/c/${companyId}/notes`) return;
      try {
        const f = parseNoteFilters(new URLSearchParams(location.search));
        setApplied(f);
        setDraft(formFor(f));
        setValid(true);
      } catch {
        setValid(false);
        setError('노트 검색 주소의 조건을 확인해 주세요.');
      }
      currentURL.current = location.pathname + location.search;
      currentState.current = history.state;
      currentIndex.current = historyIndex();
    };
    addEventListener('popstate', pop, true);
    return () => removeEventListener('popstate', pop, true);
  }, [companyId, params]);
  const shown = ready && metadata && !denied && displayed.current === scope;
  return (
    <section className="workspace notes-feed" aria-labelledby="notes-feed-title">
      <h1 id="notes-feed-title">업무 노트</h1>
      <p className="notes-meta">
        {company?.name ?? '현재 회사'} ·{' '}
        {applied.year === undefined ? '전체 작성 기간' : `${applied.year}년 작성 (KST)`} · 최신
        작성순
      </p>
      <form
        className="notes-filters"
        onSubmit={(e) => {
          e.preventDefault();
          apply();
        }}
      >
        <label>
          노트 작성연도 (KST)
          <input
            type="number"
            min="1"
            max="9999"
            step="1"
            value={draft.year}
            placeholder="전체 작성 기간"
            onChange={(e) => setDraft({ ...draft, year: e.target.value })}
          />
        </label>
        <label>
          노트 프로젝트
          <select
            value={draft.projectId}
            onChange={(e) => setDraft({ ...draft, projectId: e.target.value })}
          >
            <option value="">전체 프로젝트</option>
            {projects.map((p) => (
              <option key={p.id} value={p.id}>
                {p.code}
                {p.isActive ? '' : ' (비활성)'}
              </option>
            ))}
          </select>
        </label>
        <label>
          노트 본문 검색
          <input
            value={draft.keyword}
            maxLength={5000}
            onChange={(e) => setDraft({ ...draft, keyword: e.target.value })}
          />
        </label>
        <fieldset>
          <legend>노트 태그 · 하나 이상 일치 (OR)</legend>
          {tags.map((t) => (
            <label className="notes-check" key={t.id}>
              <input
                type="checkbox"
                checked={draft.tagIds.includes(t.id)}
                onChange={(e) =>
                  setDraft({
                    ...draft,
                    tagIds: e.target.checked
                      ? [...draft.tagIds, t.id].sort()
                      : draft.tagIds.filter((id) => id !== t.id),
                  })
                }
              />
              {t.label}
              {t.isActive ? '' : ' (비활성)'}
            </label>
          ))}
        </fieldset>
        <button type="submit" disabled={loading || !online}>
          노트 조회
        </button>
      </form>
      {formError && <p role="alert">{formError}</p>}
      {error && <p role="alert">{error}</p>}
      {loading && <p role="status">노트를 불러오고 있습니다.</p>}
      {!online && <p role="status">오프라인 · 마지막 성공 조회와 초안을 보존했습니다.</p>}
      {shown && (
        <>
          {(error || !online) && <p>마지막 성공 조회의 목록입니다.</p>}
          {!items.length && <p>조회 조건에 맞는 노트가 없습니다.</p>}
          <ul className="notes-list">
            {items.map(({ note, parent }) => (
              <li key={note.id}>
                <div className="notes-feed-line">
                  <a className="control-link" href={noteWorkURL(companyId, parent)}>
                    {parent.title} · 원래 업무
                  </a>
                  <span>{parent.projectCode ?? '프로젝트 없음'}</span>
                </div>
                <p className="notes-text">{note.body}</p>
                <p className="notes-meta">
                  작성{' '}
                  {new Date(note.createdAt).toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' })} ·
                  수정{' '}
                  {new Date(note.updatedAt).toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' })} ·{' '}
                  {note.tags.map((t) => `${t.label}${t.isActive ? '' : ' (비활성)'}`).join(', ') ||
                    '태그 없음'}
                </p>
                <button type="button" onClick={() => setTarget({ id: note.id, parent, note })}>
                  노트 수정 · {parent.title}
                </button>
              </li>
            ))}
          </ul>
          {cursor && (
            <button type="button" disabled={loading || !online} onClick={() => void load(true)}>
              노트 더 보기
            </button>
          )}
        </>
      )}
      <p className="notes-meta">
        새 노트는 원래 업무의 ‘업무 노트’에서 작성합니다.{' '}
        <a className="control-link" href={`/c/${companyId}/search`}>
          기존 업무 찾기
        </a>{' '}
        ·{' '}
        <a className="control-link" href={`/c/${companyId}/settings/tags`}>
          노트 태그 관리
        </a>
      </p>
      <NoteEditorDesk
        userId={userId}
        companyId={companyId}
        host="feed"
        target={target}
        tags={tags}
        denied={denied || !shown}
        onDenied={deny}
        onChanged={() => setReload((n) => n + 1)}
      />
    </section>
  );
}
