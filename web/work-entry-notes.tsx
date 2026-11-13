import { RefreshButton } from './ui-controls';
import { useEffect, useRef, useState } from 'react';
import { z } from 'zod';
import { zNote, zNoteParent, zNoteCreate, zNotePatch, zNoteDelete } from '../shared/schema/note';
import { setWorkspaceDraftDirty } from './workspace-draft-state';
import { WorkFailure, uncertainWork } from './work-entry-api';
import {
  assertNoteBody,
  createNote,
  patchNote,
  deleteNote,
  readNote,
  readWorkNotes,
  readNoteTags,
  noteFailure,
  noteLogin,
  noteOrder,
  type Note,
  type NoteParent,
} from './notes-api';
import './notes.css';

type TagChoice = { id: string; label: string; isActive: boolean };
const zTarget = z.strictObject({ id: z.uuid(), parent: zNoteParent, note: zNote.nullable() });
export type NoteEditorTarget = z.output<typeof zTarget>;
const zCommand = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('create'), body: zNoteCreate }),
  z.strictObject({ kind: z.literal('patch'), body: zNotePatch }),
  z.strictObject({ kind: z.literal('delete'), body: zNoteDelete }),
]);
const zDraft = z
  .strictObject({
    id: z.uuid(),
    companyId: z.uuid(),
    workEntryId: z.uuid(),
    original: zNote.nullable(),
    parentVersion: z.number().int().positive(),
    body: z.string().max(5000),
    tagIds: z.array(z.uuid()).max(100),
    command: zCommand.nullable(),
    stale: z.boolean(),
    deleted: z.boolean(),
  })
  .refine(
    (d) =>
      new Set(d.tagIds).size === d.tagIds.length &&
      (!d.command ||
        (d.command.kind === 'create'
          ? !d.original &&
            d.command.body.id === d.id &&
            d.command.body.workEntryVersion === d.parentVersion
          : !!d.original && d.command.body.version === d.original.version)),
  );

type Draft = z.output<typeof zDraft>;
const editorKey = (user: string, company: string, work: string, note: string) =>
  `wt:note:v1:${encodeURIComponent(user)}:${company}:${work}:${note}`;
const sameTags = (a: readonly string[], b: readonly string[]) =>
  [...a].sort().join() === [...b].sort().join();
function dirty(d: Draft) {
  return (
    !d.deleted &&
    (!!d.command ||
      d.body !== (d.original?.body ?? '') ||
      !sameTags(d.tagIds, d.original?.tagIds ?? []))
  );
}
function stored<T extends z.ZodType>(key: string, schema: T): z.output<T> | null {
  try {
    const value = schema.safeParse(JSON.parse(sessionStorage.getItem(key) ?? 'null'));
    return value.success ? value.data : null;
  } catch {
    return null;
  }
}
function put(key: string, value: unknown) {
  try {
    sessionStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* The in-memory draft remains. */
  }
}
export function useNotesOnline() {
  const [online, setOnline] = useState(navigator.onLine);
  useEffect(() => {
    const change = () => setOnline(navigator.onLine);
    addEventListener('online', change);
    addEventListener('offline', change);
    return () => {
      removeEventListener('online', change);
      removeEventListener('offline', change);
    };
  }, []);
  return online;
}
const targetMatches = (target: NoteEditorTarget, company: string) =>
  target.parent.companyId === company &&
  (!target.note ||
    (target.note.id === target.id &&
      target.note.companyId === company &&
      target.note.workEntryId === target.parent.id));

/** Editors stay mounted while hidden so closing a panel keeps draft and navigation protection. */
export function NoteEditorDesk({
  userId,
  companyId,
  host,
  target,
  tags,
  denied,
  onDenied,
  onChanged,
}: {
  userId: string;
  companyId: string;
  host: string;
  target: NoteEditorTarget | null;
  tags: readonly TagChoice[];
  denied: boolean;
  onDenied: () => void;
  onChanged: () => void;
}) {
  const key = `wt:note-desk:v1:${encodeURIComponent(userId)}:${companyId}:${host}`;
  const [desk, setDesk] = useState(() => {
    const value = stored(key, z.strictObject({ targets: z.array(zTarget), active: z.string() }));
    return value && value.targets.every((t) => targetMatches(t, companyId))
      ? value
      : { targets: [] as NoteEditorTarget[], active: '' };
  });
  const [error, setError] = useState('');
  const root = useRef<HTMLDivElement>(null);
  useEffect(() => put(key, desk), [key, desk]);
  useEffect(() => {
    if (!desk.active || denied) return;
    const frame = requestAnimationFrame(() => {
      const heading = root.current?.querySelector<HTMLElement>(
        `[data-note-editor="${desk.active}"] h3`,
      );
      heading?.focus({ preventScroll: true });
      heading?.scrollIntoView({ block: 'start' });
    });
    return () => cancelAnimationFrame(frame);
  }, [desk.active, denied]);
  useEffect(() => {
    if (!target || !targetMatches(target, companyId)) return;
    const active = desk.targets.find((t) => t.id === desk.active);
    if (active && active.id !== target.id) {
      const previous = stored(editorKey(userId, companyId, active.parent.id, active.id), zDraft);
      if (previous?.command) {
        setError('저장 결과를 먼저 확인해 주세요. 같은 노트 ID와 초안을 보존했습니다.');
        return;
      }
      if (previous && dirty(previous) && !confirm('현재 노트 초안을 보관하고 다른 노트를 열까요?'))
        return;
    }
    setError('');
    setDesk((d) => ({
      targets: d.targets.some((t) => t.id === target.id) ? d.targets : [...d.targets, target],
      active: target.id,
    }));
  }, [target]);
  return (
    <div className="notes-editor-desk" ref={root} hidden={denied}>
      {error && <p role="alert">{error}</p>}
      {desk.targets
        .filter((t) => t.id !== desk.active)
        .map((t) => (
          <button type="button" key={t.id} onClick={() => setDesk({ ...desk, active: t.id })}>
            보존한 노트 검토 열기 ·{' '}
            {t.note
              ? new Date(t.note.createdAt).toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' })
              : '새 노트'}
          </button>
        ))}
      {desk.targets.map((t) => (
        <div key={t.id} data-note-editor={t.id} hidden={t.id !== desk.active}>
          <NoteEditor
            userId={userId}
            companyId={companyId}
            target={t}
            tags={tags}
            allowed={!denied}
            onDenied={onDenied}
            onChanged={onChanged}
            onClose={() => setDesk((d) => ({ ...d, active: '' }))}
          />
        </div>
      ))}
    </div>
  );
}
function NoteEditor({
  userId,
  companyId,
  target,
  tags,
  allowed,
  onDenied,
  onChanged,
  onClose,
}: {
  userId: string;
  companyId: string;
  target: NoteEditorTarget;
  tags: readonly TagChoice[];
  allowed: boolean;
  onDenied: () => void;
  onChanged: () => void;
  onClose: () => void;
}) {
  const key = editorKey(userId, companyId, target.parent.id, target.id);
  const [draft, setDraft] = useState<Draft>(() => {
    const old = stored(key, zDraft);
    if (
      old &&
      old.id === target.id &&
      old.companyId === companyId &&
      old.workEntryId === target.parent.id &&
      (!old.original ||
        (old.original.id === target.id &&
          old.original.companyId === companyId &&
          old.original.workEntryId === target.parent.id))
    )
      return old;
    return {
      id: target.id,
      companyId,
      workEntryId: target.parent.id,
      original: target.note,
      parentVersion: target.parent.version,
      body: target.note?.body ?? '',
      tagIds: target.note?.tagIds ?? [],
      command: null,
      stale: false,
      deleted: false,
    };
  });
  const current = useRef(draft);
  current.current = draft;
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [message, setMessage] = useState(''),
    [latest, setLatest] = useState<Note | null>(null),
    [observedParent, setObservedParent] = useState<NoteParent | null>(null),
    [forbidden, setForbidden] = useState(false);
  const readRevision = useRef(0),
    lock = useRef(false),
    alive = useRef(true),
    heading = useRef<HTMLHeadingElement>(null);
  const online = useNotesOnline();
  function update(d: Draft) {
    current.current = d;
    put(key, d);
    setDraft(d);
  }
  useEffect(() => {
    alive.current = true;
    put(key, current.current);
    return () => {
      alive.current = false;
      readRevision.current++;
    };
  }, [key]);
  useEffect(() => {
    setWorkspaceDraftDirty(key, dirty(draft) || busy);
    return () => setWorkspaceDraftDirty(key, false);
  }, [key, draft, busy]);
  useEffect(() => {
    const before = (e: BeforeUnloadEvent) => {
      if (!dirty(current.current) && !lock.current) return;
      e.preventDefault();
      e.returnValue = '';
    };
    addEventListener('beforeunload', before);
    return () => removeEventListener('beforeunload', before);
  }, []);
  function fail(e: unknown) {
    if (e instanceof WorkFailure && [401, 403].includes(e.status)) {
      setForbidden(true);
      setLatest(null);
      setObservedParent(null);
      onDenied();
    }
    setError(noteFailure(e));
    if (e instanceof WorkFailure && e.status === 401) noteLogin(companyId);
  }
  function saved(note: Note) {
    update({
      ...current.current,
      original: note,
      body: note.body,
      tagIds: note.tagIds,
      command: null,
      stale: false,
    });
    setLatest(note);
    setMessage('노트를 저장했습니다.');
    onChanged();
  }
  function matches(note: Note, c: z.output<typeof zCommand>) {
    if (
      note.id !== draft.id ||
      note.companyId !== companyId ||
      note.workEntryId !== target.parent.id
    )
      return false;
    if (c.kind === 'delete') return false;
    const version = c.kind === 'create' ? 1 : c.body.version + 1;
    return (
      note.version === version &&
      (c.body.body === undefined || note.body === c.body.body) &&
      (c.body.tagIds === undefined || sameTags(note.tagIds, c.body.tagIds))
    );
  }
  async function observe(command = current.current.command) {
    const ticket = ++readRevision.current;
    try {
      const result = await readNote(companyId, target.parent.id, target.id);
      if (!alive.current || ticket !== readRevision.current) return;
      if (
        current.current.original &&
        result.note &&
        result.note.createdAt !== current.current.original.createdAt
      )
        throw new WorkFailure(0, 'INVALID_RESPONSE');
      setForbidden(false);
      setObservedParent(result.parent);
      setLatest(result.note);
      if (command && command.kind === 'delete' && result.note === null) {
        update({ ...current.current, command: null, deleted: true });
        setMessage(
          '소유한 원래 업무 안에서 현재 노트 부재를 확인했습니다. 어느 요청이 삭제했는지는 증명하지 않습니다.',
        );
        onChanged();
      } else if (command && result.note && matches(result.note, command)) saved(result.note);
      else if (command)
        setMessage(
          '현재 관측은 제출값·기대 버전과 일치하지 않습니다. 과거 저장 성공을 단정하지 않으며 고정 ID·초안을 보존했습니다.',
        );
      else if (result.note === null)
        setMessage(
          '소유한 원래 업무에서 현재 노트가 없습니다. 다른 업무에 자동 연결하거나 다시 생성하지 않습니다.',
        );
      else if (
        current.current.original &&
        result.note.version !== current.current.original.version
      ) {
        update({ ...current.current, stale: true });
        setMessage('현재 노트 버전이 달라졌습니다. 원래 입력·버전을 유지했습니다.');
      }
    } catch (e) {
      if (alive.current && ticket === readRevision.current) fail(e);
    }
  }
  useEffect(() => {
    if (!allowed) return;
    setForbidden(false);
    if (current.current.original || current.current.command) void observe();
  }, [allowed]);
  async function perform(kind: 'save' | 'delete') {
    if (lock.current || !online || draft.deleted || draft.command || forbidden) return;
    let command: z.output<typeof zCommand>;
    try {
      command =
        kind === 'delete'
          ? { kind: 'delete', body: zNoteDelete.parse({ version: draft.original?.version }) }
          : draft.original
            ? {
                kind: 'patch',
                body: zNotePatch.parse({
                  version: draft.original.version,
                  body: draft.body,
                  tagIds: draft.tagIds,
                }),
              }
            : {
                kind: 'create',
                body: zNoteCreate.parse({
                  id: draft.id,
                  workEntryVersion: draft.parentVersion,
                  body: draft.body,
                  tagIds: draft.tagIds,
                }),
              };
      assertNoteBody(command.body);
    } catch {
      setError(
        '본문 1~5,000자·노트 태그·버전과 8192바이트 요청 한도를 확인해 주세요. 원문을 유지했습니다.',
      );
      return;
    }
    readRevision.current++;
    lock.current = true;
    setBusy(true);
    setError('');
    setMessage('');
    update({ ...current.current, command });
    try {
      if (command.kind === 'delete') {
        await deleteNote(companyId, target.parent.id, target.id, command.body);
        if (!alive.current) return;
        update({ ...current.current, command: null, deleted: true });
        setMessage('노트를 삭제했습니다.');
        onChanged();
      } else {
        const result =
          command.kind === 'create'
            ? await createNote(companyId, target.parent.id, command.body)
            : await patchNote(companyId, target.parent.id, target.id, command.body);
        if (!alive.current) return;
        if (
          current.current.original &&
          result.note.createdAt !== current.current.original.createdAt
        )
          throw new WorkFailure(0, 'INVALID_RESPONSE');
        saved(result.note);
      }
    } catch (e) {
      if (!alive.current) return;
      if (e instanceof WorkFailure && [400, 409, 422].includes(e.status))
        update({ ...current.current, command: null, stale: e.status === 409 });
      fail(e);
      if (uncertainWork(e)) await observe(command);
    } finally {
      lock.current = false;
      if (alive.current) setBusy(false);
    }
  }
  const choices = [
    ...new Map(
      [...(draft.original?.tags ?? []), ...(latest?.tags ?? []), ...tags].map((t) => [t.id, t]),
    ).values(),
  ];
  const disabled = busy || !online || !!draft.command || draft.stale || forbidden || draft.deleted;
  if (forbidden)
    return (
      <section className="notes-editor">
        <p role="alert">{error}</p>
        <p>내용을 숨겼습니다. 원래 회사·업무·노트 ID의 초안은 보존됩니다.</p>
      </section>
    );
  return (
    <section className="notes-editor" aria-label="노트 검토">
      <h3 ref={heading} tabIndex={-1}>
        {draft.deleted ? '삭제한 노트' : draft.original ? '노트 수정' : '노트 작성'} ·{' '}
        {target.parent.title}
      </h3>
      <p className="notes-meta">
        노트 ID {draft.id}
        {draft.original
          ? ` · 버전 ${draft.original.version}`
          : ` · 원래 업무 버전 ${draft.parentVersion}`}
      </p>
      {error && <p role="alert">{error}</p>}
      {message && <p role="status">{message}</p>}
      {draft.command && (
        <p role="status">
          저장 결과 확인 필요 · 같은 노트 ID와 제출값을 보존했으며 자동 재전송하지 않습니다.
        </p>
      )}
      {(draft.command || draft.stale) && (
        <RefreshButton
          type="button"
          disabled={busy || !online}
          onClick={() => void observe()}
          busy={!!busy}
          showLabel
        >
          노트 저장 결과 다시 확인
        </RefreshButton>
      )}
      {!draft.deleted && (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void perform('save');
          }}
        >
          <label>
            노트 본문
            <textarea
              maxLength={5000}
              required
              value={draft.body}
              disabled={disabled}
              onChange={(e) => update({ ...draft, body: e.target.value })}
            />
          </label>
          <fieldset disabled={disabled}>
            <legend>노트 태그 (선택)</legend>
            {choices.length ? (
              choices.map((tag) => (
                <label className="notes-check" key={tag.id}>
                  <input
                    type="checkbox"
                    checked={draft.tagIds.includes(tag.id)}
                    disabled={!tag.isActive && !draft.tagIds.includes(tag.id)}
                    onChange={(e) =>
                      update({
                        ...draft,
                        tagIds: e.target.checked
                          ? [...draft.tagIds, tag.id].sort()
                          : draft.tagIds.filter((id) => id !== tag.id),
                      })
                    }
                  />
                  {tag.label}
                  {tag.isActive ? '' : ' (비활성)'}
                </label>
              ))
            ) : (
              <p>선택할 노트 태그가 없습니다.</p>
            )}
            <a className="control-link" href={`/c/${companyId}/settings/tags`}>
              노트 태그 관리
            </a>
          </fieldset>
          <button type="submit" disabled={disabled || !dirty(draft)}>
            노트 저장
          </button>
          {draft.original && (
            <button
              type="button"
              disabled={disabled}
              onClick={() => {
                if (confirm('이 노트를 삭제할까요? 원래 업무는 유지됩니다.'))
                  void perform('delete');
              }}
            >
              노트 삭제
            </button>
          )}
        </form>
      )}
      {observedParent && !draft.command && draft.stale && (
        <button
          type="button"
          disabled={busy || !online}
          onClick={() => {
            update({
              ...draft,
              original: latest ?? draft.original,
              parentVersion: observedParent.version,
              stale: false,
            });
            setMessage('현재 버전을 명시 선택했습니다. 보존한 본문·태그를 비교한 뒤 저장하세요.');
          }}
        >
          현재 버전으로 노트 검토
        </button>
      )}
      {draft.command && latest && (
        <details>
          <summary>현재 기록과 초안 비교</summary>
          <p className="notes-text">{latest.body}</p>
          <p>
            현재 노트 버전 {latest.version} ·{' '}
            {latest.tags.map((t) => t.label).join(', ') || '태그 없음'}
          </p>
          <button
            type="button"
            disabled={busy}
            onClick={() => {
              if (
                confirm('과거 요청의 성공을 단정하지 않고 현재 노트 버전으로 초안을 검토할까요?')
              ) {
                update({ ...draft, original: latest, command: null, stale: false });
                setMessage('고정 노트 ID의 현재 버전을 명시 선택했습니다.');
              }
            }}
          >
            현재 기록으로 결과 검토 마치기
          </button>
        </details>
      )}
      <button type="button" onClick={onClose}>
        노트 검토 닫기 · 초안 유지
      </button>
    </section>
  );
}

export function WorkEntryNotes({
  companyId,
  userId,
  parent,
}: {
  companyId: string;
  userId: string;
  parent: NoteParent;
}) {
  const [opened, setOpened] = useState(false);
  return (
    <details
      className="work-entry-notes"
      aria-label={`업무 노트: ${parent.title}`}
      onToggle={(e) => {
        if (e.currentTarget.open) setOpened(true);
      }}
    >
      <summary>업무 노트</summary>
      {opened && (
        <WorkNotesScope
          key={`${userId}:${companyId}:${parent.id}`}
          companyId={companyId}
          userId={userId}
          initialParent={parent}
        />
      )}
    </details>
  );
}
function WorkNotesScope({
  companyId,
  userId,
  initialParent,
}: {
  companyId: string;
  userId: string;
  initialParent: NoteParent;
}) {
  const [parent, setParent] = useState(initialParent),
    [items, setItems] = useState<Note[]>([]),
    [tags, setTags] = useState<TagChoice[]>([]),
    [cursor, setCursor] = useState<string | null>(null),
    [ready, setReady] = useState(false),
    [loading, setLoading] = useState(false),
    [error, setError] = useState(''),
    [denied, setDenied] = useState(false),
    [target, setTarget] = useState<NoteEditorTarget | null>(null);
  const online = useNotesOnline(),
    revision = useRef(0),
    lock = useRef(false),
    seen = useRef(new Set<string>());
  const deny = () => {
    revision.current++;
    lock.current = false;
    setLoading(false);
    setDenied(true);
    setItems([]);
    setTags([]);
    setCursor(null);
  };
  async function load(more = false) {
    if (lock.current || !online) return;
    lock.current = true;
    const ticket = ++revision.current;
    setLoading(true);
    setError('');
    try {
      const [list, choices] = await Promise.all([
        readWorkNotes(companyId, initialParent.id, more ? (cursor ?? undefined) : undefined),
        readNoteTags(companyId),
      ]);
      if (ticket !== revision.current) return;
      if (
        more &&
        (list.items.some((n) => items.some((old) => old.id === n.id)) ||
          (items.length && list.items.length && noteOrder(items.at(-1)!, list.items[0]!) > 0) ||
          (list.nextCursor && seen.current.has(list.nextCursor)))
      )
        throw new WorkFailure(0, 'INVALID_RESPONSE');
      if (!more) seen.current.clear();
      if (list.nextCursor) seen.current.add(list.nextCursor);
      setParent(list.parent);
      setItems(more ? [...items, ...list.items] : list.items);
      setTags(choices);
      setCursor(list.nextCursor);
      setReady(true);
      setDenied(false);
    } catch (e) {
      if (ticket !== revision.current) return;
      if (e instanceof WorkFailure && [401, 403].includes(e.status)) deny();
      setError(noteFailure(e));
      if (e instanceof WorkFailure && e.status === 401) noteLogin(companyId);
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
  }, []);
  return (
    <section className="notes-scope" aria-label={`원래 업무의 노트: ${initialParent.title}`}>
      {error && <p role="alert">{error}</p>}
      {loading && <p role="status">노트를 불러오고 있습니다.</p>}
      {!online && <p role="status">오프라인 · 초안을 보존했습니다.</p>}
      <div className="notes-actions">
        <RefreshButton
          type="button"
          disabled={!online || loading}
          onClick={() => void load()}
          busy={loading}
        >
          노트 조회
        </RefreshButton>
        <button
          type="button"
          disabled={!ready || denied || loading || !online}
          onClick={() => setTarget({ id: crypto.randomUUID(), parent, note: null })}
        >
          노트 작성
        </button>
      </div>
      {ready && !denied && (
        <>
          {!items.length && <p>등록된 노트가 없습니다.</p>}
          <ul className="notes-list">
            {items.map((note) => (
              <li key={note.id}>
                <p className="notes-text">{note.body}</p>
                <p className="notes-meta">
                  {new Date(note.createdAt).toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' })} ·{' '}
                  {note.tags.map((t) => `${t.label}${t.isActive ? '' : ' (비활성)'}`).join(', ') ||
                    '태그 없음'}
                </p>
                <button type="button" onClick={() => setTarget({ id: note.id, parent, note })}>
                  노트 수정 ·{' '}
                  {new Date(note.createdAt).toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' })}
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
      <NoteEditorDesk
        companyId={companyId}
        userId={userId}
        host={`work:${initialParent.id}`}
        target={target}
        tags={tags}
        denied={denied || !ready}
        onDenied={deny}
        onChanged={() => void load()}
      />
    </section>
  );
}
