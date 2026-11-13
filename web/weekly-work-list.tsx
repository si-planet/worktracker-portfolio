import {
  dailyNoteCapacity,
  dailySheetDetails,
  editableDailyNotesFrom,
  replaceDailyNotes,
} from './daily-sheet-model';
import { WorkSourceBadges } from './work-source-labels';
import { RefreshButton } from './ui-controls';
import { createPortal } from 'react-dom';
import { setWorkspaceDraftDirty } from './workspace-draft-state';
import { useEffect, useRef, useState } from 'react';
import { z } from 'zod';
import {
  zWorkEntryCreate,
  zWorkEntryFinal,
  zWorkEntryId,
  zWorkEntryPatch,
  type WorkEntryFinal,
} from '../shared/schema/work-entry';
import type { WorkspaceProject, WorkspaceTag } from '../shared/schema/workspace';
import {
  readWorkDuplicate,
  uncertainWork,
  WorkFailure,
  workApi,
  workEntrySchema,
  workError,
} from './work-entry-api';
import { completionTarget, dayHref } from './week-hub-model';
import { isoWeekForDate } from '../shared/week-calendar';
import './weekly-work-list.css';
import { WorkDeadlineBadges } from './work-deadline';

const statuses = {
  todo: '미진행',
  doing: '진행 중',
  paused: '중단',
  planned: '예정',
  done: '완료',
  canceled: '취소',
};
const kinds = {
  task: '업무',
  meeting: '회의',
  field: '외근',
  event: '행사',
  leave: '휴가',
  etc: '기타',
};
const zFields = z.strictObject({
  title: z.string().max(200),
  start: z.string().max(10),
  due: z.string().max(10),
  projectId: z.string().max(36),
  content: z.string().max(5000),
});
const zDraft = z.strictObject({
  id: zWorkEntryId,
  original: zWorkEntryFinal.nullable(),
  fields: zFields,
  command: z.union([zWorkEntryPatch, zWorkEntryCreate]).nullable(),
  recovery: z.enum(['unknown', 'unchanged', 'matched', 'different']).nullable(),
  latest: zWorkEntryFinal.nullable(),
  error: z.string().max(2000),
});
type Draft = z.output<typeof zDraft>;
type Fields = z.output<typeof zFields>;
const zStored = z.strictObject({
  rows: z.array(zDraft).max(1000),
  fresh: zDraft.nullable(),
});
type Stored = z.output<typeof zStored>;
const emptyStored = (): Stored => ({ rows: [], fresh: null });
const fieldsFor = (entry: WorkEntryFinal): Fields => ({
  title: entry.title,
  start: entry.plannedDate ?? '',
  due: entry.dueDate ?? '',
  projectId: entry.projectId ?? '',
  content: entry.content ?? '',
});
const sameFields = (a: Fields, b: Fields) =>
  a.title === b.title && a.start === b.start && a.due === b.due && a.content === b.content;
const simpleStart = (entry: WorkEntryFinal) =>
  entry.kind !== 'leave' && entry.timeMode === 'date_only' && entry.endDate === null;
const storageKeyFor = (userId: string, companyId: string) =>
  `wt:weekly-work-list:v1:${encodeURIComponent(userId)}:${companyId}`;
function storeDrafts(key: string, value: Stored) {
  try {
    if (!value.rows.length && !value.fresh) sessionStorage.removeItem(key);
    else sessionStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Tab storage is optional; the in-memory draft remains usable.
  }
}
function restoreDrafts(key: string, companyId: string): Stored {
  try {
    const parsed = zStored.safeParse(JSON.parse(sessionStorage.getItem(key) ?? 'null'));
    if (
      parsed.success &&
      parsed.data.rows.every(
        (draft) =>
          draft.original?.companyId === companyId &&
          draft.original.id === draft.id &&
          (!draft.latest || (draft.latest.id === draft.id && draft.latest.companyId === companyId)),
      ) &&
      (!parsed.data.fresh ||
        (parsed.data.fresh.original === null &&
          (!parsed.data.fresh.latest ||
            (parsed.data.fresh.latest.id === parsed.data.fresh.id &&
              parsed.data.fresh.latest.companyId === companyId))))
    )
      return parsed.data;
  } catch {
    // Malformed drafts never replace server records.
  }
  return emptyStored();
}
function withoutAudit(entry: WorkEntryFinal) {
  return Object.entries(entry)
    .filter(([key]) => key !== 'version' && key !== 'updatedAt')
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, value]) => [key, key === 'tagIds' ? [...entry.tagIds].sort() : value]);
}
function sameRecord(before: WorkEntryFinal, after: WorkEntryFinal) {
  return (
    before.version === after.version &&
    before.updatedAt === after.updatedAt &&
    JSON.stringify(withoutAudit(before)) === JSON.stringify(withoutAudit(after))
  );
}
/** A later version never proves that this particular request was applied. */
export function weeklyListResultMatches(draft: Draft, value: WorkEntryFinal): boolean {
  if (!draft.command || value.id !== draft.id) return false;
  if (draft.original) {
    const parsed = zWorkEntryPatch.safeParse(draft.command);
    if (!parsed.success) return false;
    const changes = Object.fromEntries(
      Object.entries(parsed.data).filter(([key]) => key !== 'version' && key !== 'reason'),
    );
    return (
      value.companyId === draft.original.companyId &&
      value.version === draft.original.version + 1 &&
      JSON.stringify(withoutAudit(value)) ===
        JSON.stringify(withoutAudit({ ...draft.original, ...changes } as WorkEntryFinal))
    );
  }
  const input = zWorkEntryCreate.safeParse(draft.command);
  if (!input.success || input.data.kind !== 'task') return false;
  const expected = input.data;
  return (
    value.version === 1 &&
    value.kind === 'task' &&
    value.title === expected.title &&
    value.content === expected.content &&
    value.projectId === expected.projectId &&
    value.plannedDate === expected.plannedDate &&
    value.dueDate === expected.dueDate &&
    value.endDate === expected.endDate &&
    value.timeMode === expected.timeMode &&
    value.startAt === expected.startAt &&
    value.endAt === expected.endAt &&
    value.allDay === expected.allDay &&
    value.mustFinishToday === expected.mustFinishToday &&
    value.sortOrder === expected.sortOrder &&
    value.status === expected.status &&
    value.resumeStatus === null &&
    value.completedAt === null &&
    value.leave === null &&
    JSON.stringify([...value.tagIds].sort()) === JSON.stringify([...expected.tagIds].sort())
  );
}

export interface WeeklyWorkListProps {
  today: string;
  companyId: string;
  userId: string;
  date: string;
  entries: WorkEntryFinal[];
  sourceCategories?: (entry: WorkEntryFinal) => readonly string[];
  projects: WorkspaceProject[];
  tags: WorkspaceTag[];
  editing: boolean;
  placementDates?: string[];
  online: boolean;
  disabled: boolean;
  onExpired: (failure: unknown) => boolean;
  onChanged: () => void;
  onEntrySaved?: (entry: WorkEntryFinal) => void;
  onStatusChange?: (entry: WorkEntryFinal, status: WorkEntryFinal['status']) => void;
  onDirtyChange?: (dirty: boolean) => void;
  createSlot?: HTMLElement | null;
  creating?: boolean;
  onCreateClose?: () => void;
}

export function WeeklyWorkList(props: WeeklyWorkListProps) {
  const { companyId, userId } = props;
  const key = storageKeyFor(userId, companyId);
  useEffect(() => {
    if (props.creating)
      props.createSlot?.querySelector<HTMLInputElement>('#weekly-new-title')?.focus();
  }, [props.creating, props.createSlot]);
  const [saved, setSaved] = useState(() => ({
    key,
    value: restoreDrafts(key, companyId),
  }));
  const stored = saved.key === key ? saved.value : restoreDrafts(key, companyId);
  const current = useRef(stored);
  current.current = stored;
  const scope = useRef(key);
  scope.current = key;
  const callbacks = useRef(props);
  callbacks.current = props;
  const [pending, setPending] = useState<string | null>(null);
  const lock = useRef(false);
  const [notice, setNotice] = useState('');
  const [navigation, setNavigation] = useState<string | null>(null);
  const navigationHeading = useRef<HTMLParagraphElement>(null);
  const navigationDialog = useRef<HTMLDialogElement>(null);
  function cancelNavigation() {
    navigationDialog.current?.close();
    setNavigation(null);
    requestAnimationFrame(() => navigationOrigin.current?.focus());
  }
  useEffect(() => {
    if (navigation && navigationDialog.current && !navigationDialog.current.open) {
      navigationDialog.current.showModal();
      navigationHeading.current?.focus();
    }
  }, [navigation]);
  const navigationOrigin = useRef<HTMLAnchorElement | null>(null);
  const week = isoWeekForDate(props.date);
  const weekScope = `${companyId}/${week.isoYear}/${week.isoWeek}`;
  const [observed, setObserved] = useState<{ scope: string; rows: Record<string, WorkEntryFinal> }>(
    { scope: weekScope, rows: {} },
  );
  const dirty = !!stored.fresh || stored.rows.length > 0 || pending !== null;
  const dirtyRef = useRef(dirty);
  dirtyRef.current = dirty;
  function commit(value: Stored) {
    current.current = value;
    storeDrafts(key, value);
    setSaved({ key, value });
  }
  useEffect(() => {
    if (saved.key !== key) {
      setSaved({ key, value: restoreDrafts(key, companyId) });
      setObserved({ scope: weekScope, rows: {} });
      setPending(null);
      setNotice('');
      setNavigation(null);
    }
  }, [key, companyId, saved.key]);
  useEffect(() => {
    setWorkspaceDraftDirty(key, dirty);
    return () => setWorkspaceDraftDirty(key, false);
  }, [key, dirty]);
  useEffect(() => {
    props.onDirtyChange?.(dirty);
  }, [dirty, props.onDirtyChange]);
  useEffect(() => () => callbacks.current.onDirtyChange?.(false), []);
  useEffect(() => {
    const before = (event: BeforeUnloadEvent) => {
      if (!dirtyRef.current) return;
      event.preventDefault();
      event.returnValue = '';
    };
    const link = (event: MouseEvent) => {
      if (
        event.defaultPrevented ||
        event.button !== 0 ||
        event.metaKey ||
        event.ctrlKey ||
        event.shiftKey ||
        event.altKey ||
        !dirtyRef.current
      )
        return;
      const target = event.target instanceof Element ? event.target.closest('a[href]') : null;
      if (!(target instanceof HTMLAnchorElement) || target.target || target.download) return;
      const url = new URL(target.href);
      if (url.href === location.href || url.protocol === 'javascript:') return;
      event.preventDefault();
      navigationOrigin.current = target;
      setNavigation(url.href);
      requestAnimationFrame(() => navigationHeading.current?.focus());
    };
    window.addEventListener('beforeunload', before);
    document.addEventListener('click', link, true);
    return () => {
      window.removeEventListener('beforeunload', before);
      document.removeEventListener('click', link, true);
    };
  }, []);
  const activeProjects = props.projects.filter(
    (project) => project.companyId === companyId && project.isActive,
  );
  const activeTags = new Set(
    props.tags
      .filter((tag) => tag.isActive && (tag.companyId === null || tag.companyId === companyId))
      .map((tag) => tag.id),
  );
  const defaultFields: Fields = {
    title: '',
    start: props.date,
    due: '',
    projectId: activeProjects[0]?.id ?? '',
    content: '',
  };
  const draftById = new Map(stored.rows.map((draft) => [draft.id, draft]));
  const entryById = new Map(
    props.entries
      .filter((entry) => entry.companyId === companyId)
      .map((entry) => [entry.id, entry]),
  );
  for (const entry of Object.values(observed.scope === weekScope ? observed.rows : {})) {
    if (entry.companyId !== companyId) continue;
    const latest = entryById.get(entry.id);
    if (!latest || latest.version < entry.version) entryById.set(entry.id, entry);
  }
  // Keep a row with an unsaved draft visible if a refresh moves it outside this week's result.
  for (const draft of stored.rows) {
    if (draft.original && !entryById.has(draft.id)) entryById.set(draft.id, draft.original);
  }
  const rows = [...entryById.values()].sort(
    (a, b) =>
      Number(b.plannedDate === null) - Number(a.plannedDate === null) ||
      (a.plannedDate ?? '9999').localeCompare(b.plannedDate ?? '9999') ||
      a.sortOrder - b.sortOrder ||
      a.createdAt - b.createdAt ||
      a.id.localeCompare(b.id),
  );
  const disabled = props.disabled || !props.online || pending !== null;
  function replace(draft: Draft, fresh: boolean) {
    const next = current.current;
    commit(
      fresh
        ? { ...next, fresh: draft }
        : {
            ...next,
            rows: [...next.rows.filter((row) => row.id !== draft.id), draft],
          },
    );
  }
  function remove(draft: Draft, fresh: boolean) {
    const next = current.current;
    commit(
      fresh
        ? { ...next, fresh: null }
        : {
            ...next,
            rows: next.rows.filter((row) => row.id !== draft.id),
          },
    );
  }
  function update(entry: WorkEntryFinal | null, field: keyof Fields, value: string) {
    if (disabled) return;
    const existing = entry
      ? current.current.rows.find((row) => row.id === entry.id)
      : current.current.fresh;
    if (existing?.command) return;
    const draft: Draft = existing ?? {
      id: entry?.id ?? crypto.randomUUID(),
      original: entry,
      fields: entry ? fieldsFor(entry) : defaultFields,
      command: null,
      recovery: null,
      latest: null,
      error: '',
    };
    const next = {
      ...draft,
      fields: { ...draft.fields, [field]: value },
      error: '',
    };
    if (entry && sameFields(next.fields, fieldsFor(draft.original!))) remove(next, false);
    else replace(next, entry === null);
  }
  function cancelled(draft: Draft, fresh: boolean) {
    if (draft.command || pending !== null) return;
    remove(draft, fresh);
  }
  function observe(entry: WorkEntryFinal) {
    setObserved((old) => ({
      scope: weekScope,
      rows: { ...(old.scope === weekScope ? old.rows : {}), [entry.id]: entry },
    }));
    callbacks.current.onEntrySaved?.(entry);
    callbacks.current.onChanged();
  }
  async function check(draft: Draft, fresh: boolean) {
    if (lock.current || !props.online || props.disabled || !draft.command) return;
    lock.current = true;
    setPending(draft.id);
    const requested = key;
    try {
      const value = (await readWorkDuplicate(companyId, draft.id)).entry;
      if (scope.current !== requested) return;
      const recovery = weeklyListResultMatches(draft, value)
        ? 'matched'
        : draft.original && sameRecord(draft.original, value)
          ? 'unchanged'
          : 'different';
      replace({ ...draft, latest: value, recovery, error: '' }, fresh);
    } catch (failure) {
      if (scope.current !== requested || callbacks.current.onExpired(failure)) return;
      if (fresh && failure instanceof WorkFailure && failure.status === 404) {
        replace({ ...draft, latest: null, recovery: 'unchanged', error: '' }, true);
      } else replace({ ...draft, error: workError(failure), recovery: 'unknown' }, fresh);
    } finally {
      lock.current = false;
      if (scope.current === requested) setPending(null);
    }
  }
  async function save(draft: Draft, fresh: boolean, retry = false) {
    if (lock.current || disabled || (!retry && draft.command)) return;
    if (retry && (!draft.command || draft.recovery !== 'unchanged')) return;
    let command = draft.command;
    if (!command) {
      if (!draft.fields.title.trim()) {
        replace({ ...draft, error: '제목을 입력해 주세요.' }, fresh);
        return;
      }
      const original = draft.original;
      const changes = original
        ? {
            ...(draft.fields.title !== original.title ? { title: draft.fields.title } : {}),
            ...(draft.fields.content !== (original.content ?? '')
              ? { content: draft.fields.content || null }
              : {}),
            ...(draft.fields.start !== (original.plannedDate ?? '') && simpleStart(original)
              ? { plannedDate: draft.fields.start || null }
              : {}),
            ...(original.kind !== 'leave' && draft.fields.due !== (original.dueDate ?? '')
              ? { dueDate: draft.fields.due || null }
              : {}),
          }
        : null;
      const parsed = original
        ? zWorkEntryPatch.safeParse({ ...changes, version: original.version })
        : zWorkEntryCreate.safeParse({
            id: draft.id,
            kind: 'task',
            title: draft.fields.title,
            content: draft.fields.content || null,
            projectId: draft.fields.projectId || null,
            plannedDate: draft.fields.start || null,
            dueDate: draft.fields.due || null,
            tagIds: (
              activeProjects.find((project) => project.id === draft.fields.projectId)
                ?.defaultTagIds ?? []
            ).filter((id) => activeTags.has(id)),
          });
      const mergedValid =
        !original || zWorkEntryFinal.safeParse({ ...original, ...changes }).success;
      if (
        !parsed.success ||
        !mergedValid ||
        (!original && !activeProjects.some((project) => project.id === draft.fields.projectId))
      ) {
        replace(
          {
            ...draft,
            error:
              '제목·프로젝트·날짜와 현재 상태를 확인해 주세요. 정확한 시각·기간·휴가 날짜는 일간 상세에서 편집해 주세요.',
          },
          fresh,
        );
        return;
      }
      command = parsed.data;
    }
    const held: Draft = {
      ...draft,
      command,
      recovery: 'unknown',
      latest: null,
      error: '',
    };
    // Persist the original payload before sending. Result checks and retries keep the same ID/version.
    replace(held, fresh);
    lock.current = true;
    setPending(draft.id);
    setNotice('');
    const requested = key;
    try {
      const result = await workApi(
        fresh ? `/api/companies/${companyId}/work-entries` : `/api/work-entries/${draft.id}`,
        workEntrySchema(companyId, draft.id).refine((entry) =>
          weeklyListResultMatches(held, entry),
        ),
        fresh ? 'POST' : 'PATCH',
        command,
      );
      if (scope.current !== requested) return;
      remove(held, fresh);
      observe(result);
      setNotice(fresh ? '새 업무를 저장했습니다.' : '업무를 저장했습니다.');
    } catch (failure) {
      if (scope.current !== requested) return;
      // Authentication failure can follow a submitted request, so retain the in-flight snapshot.
      if (callbacks.current.onExpired(failure)) return;
      if (uncertainWork(failure) || (failure instanceof WorkFailure && failure.status === 409)) {
        replace(
          {
            ...held,
            error: `${workError(failure)} 저장 결과를 확인해 주세요.`,
          },
          fresh,
        );
      } else {
        replace(
          {
            ...draft,
            command: null,
            recovery: null,
            latest: null,
            error: workError(failure),
          },
          fresh,
        );
      }
    } finally {
      lock.current = false;
      if (scope.current === requested) setPending(null);
    }
  }
  function useVerified(draft: Draft, fresh: boolean) {
    if (draft.recovery !== 'matched' || !draft.latest || disabled) return;
    remove(draft, fresh);
    observe(draft.latest);
    setNotice('같은 ID와 예상 버전의 기록에서 요청한 내용을 확인했습니다.');
  }
  function continueEditing(draft: Draft, fresh: boolean) {
    if (disabled || draft.recovery !== 'unchanged') return;
    replace({ ...draft, command: null, recovery: null, latest: null, error: '' }, fresh);
  }
  function useLatest(draft: Draft) {
    if (disabled || !draft.latest || draft.recovery !== 'different' || !draft.original) return;
    if (!window.confirm('입력한 초안을 버리고 아래 최신 기록을 사용하시겠습니까?')) return;
    remove(draft, false);
    observe(draft.latest);
  }
  function recoveryPanel(draft: Draft, fresh: boolean) {
    return (
      <div className="weekly-list-row-message">
        {draft.error && <p role="alert">{draft.error}</p>}
        {draft.command && (
          <>
            <p>
              {draft.recovery === 'matched'
                ? '같은 ID와 예상 버전에 입력 내용이 반영되어 있습니다. 내용을 확인한 뒤 반영하세요.'
                : draft.recovery === 'unchanged'
                  ? '조회 시점에 요청한 변경이 확인되지 않았습니다. 자동 재전송하지 않습니다.'
                  : draft.recovery === 'different'
                    ? '최신 기록의 버전 또는 내용이 다릅니다. 이 요청의 저장 성공으로 처리하지 않았습니다.'
                    : '저장 결과 확인이 필요합니다. 입력과 요청 ID를 보존했습니다.'}
            </p>
            {draft.latest && (
              <p className="weekly-list-comparison">
                최신 v{draft.latest.version}: {draft.latest.title} · 시작{' '}
                {draft.latest.plannedDate ?? '미정'} · 마감 {draft.latest.dueDate ?? '없음'} ·{' '}
                {statuses[draft.latest.status]}
              </p>
            )}
            <div className="weekly-list-actions">
              <RefreshButton
                type="button"
                disabled={disabled}
                onClick={() => void check(draft, fresh)}
                showLabel
              >
                저장 결과 확인
              </RefreshButton>
              {draft.recovery === 'matched' && (
                <button type="button" disabled={disabled} onClick={() => useVerified(draft, fresh)}>
                  확인한 기록 반영
                </button>
              )}
              {draft.recovery === 'unchanged' && (
                <>
                  <button
                    type="button"
                    disabled={disabled}
                    onClick={() => void save(draft, fresh, true)}
                  >
                    같은 ID로 다시 저장
                  </button>
                  <button
                    type="button"
                    disabled={disabled}
                    onClick={() => continueEditing(draft, fresh)}
                  >
                    입력 계속
                  </button>
                </>
              )}
              {draft.recovery === 'different' && draft.original && (
                <button type="button" disabled={disabled} onClick={() => useLatest(draft)}>
                  최신 내용 사용
                </button>
              )}
            </div>
          </>
        )}
      </div>
    );
  }
  const createForm = (
    <div hidden={!props.creating} className="weekly-list-create" aria-label="새 업무 입력">
      <div className="weekly-list-row">
        <div className="weekly-list-title-cell">
          <label className="weekly-list-mobile-label" htmlFor="weekly-new-title">
            새 업무
          </label>
          <input
            id="weekly-new-title"
            aria-label="새 업무 제목"
            placeholder="새 업무를 입력하세요"
            maxLength={200}
            value={stored.fresh?.fields.title ?? ''}
            disabled={disabled || !!stored.fresh?.command}
            onChange={(event) => update(null, 'title', event.target.value)}
          />
          <textarea
            aria-label="새 업무 내용"
            placeholder="내용 (선택)"
            rows={1}
            maxLength={5000}
            value={stored.fresh?.fields.content ?? ''}
            disabled={disabled || !!stored.fresh?.command}
            onChange={(event) => update(null, 'content', event.target.value)}
          />
        </div>
        <div className="weekly-list-project">
          <label className="weekly-list-mobile-label" htmlFor="weekly-new-project">
            프로젝트
          </label>
          <select
            id="weekly-new-project"
            aria-label="새 업무 프로젝트"
            value={stored.fresh?.fields.projectId ?? defaultFields.projectId}
            disabled={disabled || !!stored.fresh?.command}
            onChange={(event) => update(null, 'projectId', event.target.value)}
          >
            <option value="">프로젝트 선택</option>
            {activeProjects.map((project) => (
              <option key={project.id} value={project.id}>
                {project.code}
              </option>
            ))}
          </select>
        </div>
        <div className="weekly-list-date">
          <label className="weekly-list-mobile-label" htmlFor="weekly-new-start">
            시작일
          </label>
          <input
            id="weekly-new-start"
            type="date"
            aria-label="새 업무 시작일"
            value={stored.fresh?.fields.start ?? defaultFields.start}
            disabled={disabled || !!stored.fresh?.command}
            onChange={(event) => update(null, 'start', event.target.value)}
          />
        </div>
        <div className="weekly-list-date">
          <label className="weekly-list-mobile-label" htmlFor="weekly-new-due">
            마감기한
          </label>
          <input
            id="weekly-new-due"
            type="date"
            aria-label="새 업무 마감기한"
            value={stored.fresh?.fields.due ?? ''}
            disabled={disabled || !!stored.fresh?.command}
            onChange={(event) => update(null, 'due', event.target.value)}
          />
        </div>
        <div className="weekly-list-status-cell">
          <span className="weekly-list-status is-todo">미진행</span>
          <div className="weekly-list-actions">
            <button
              type="button"
              disabled={disabled || !stored.fresh || !!stored.fresh.command}
              onClick={() => stored.fresh && void save(stored.fresh, true)}
            >
              {pending === stored.fresh?.id ? '저장 중…' : '추가 저장'}
            </button>
            {stored.fresh && !stored.fresh.command && (
              <button
                type="button"
                disabled={pending !== null}
                onClick={() => stored.fresh && cancelled(stored.fresh, true)}
              >
                입력 취소
              </button>
            )}
          </div>
        </div>
        {stored.fresh &&
          (stored.fresh.error || stored.fresh.command) &&
          recoveryPanel(stored.fresh, true)}
      </div>
      {!activeProjects.length && (
        <p className="weekly-list-notice">새 업무를 저장하려면 활성 프로젝트가 필요합니다.</p>
      )}
    </div>
  );
  return (
    <section className="weekly-work-list" aria-label="주간 전체 업무 목록" data-work-dirty={dirty}>
      <div className="weekly-list-heading">
        <h4>
          전체 업무 <span>{rows.length}</span>
        </h4>
        <p>
          {props.editing
            ? '미배정 업무는 요일을 선택하고 저장하세요.'
            : '이번 주 업무를 한 목록에서 확인하세요.'}
        </p>
      </div>
      {notice && (
        <p role="status" className="weekly-list-notice">
          {notice}
        </p>
      )}
      {!props.online && (
        <p className="weekly-list-notice">오프라인입니다. 조회한 기록과 입력을 유지합니다.</p>
      )}
      {!props.editing && dirty && (
        <p className="weekly-list-notice">
          저장하지 않은 입력이 있습니다. 총괄 상세에서 이어서 확인하세요.
        </p>
      )}
      {navigation &&
        createPortal(
          <dialog
            ref={navigationDialog}
            className="weekly-list-navigation"
            role="alertdialog"
            aria-label="미저장 입력 이동 확인"
            onCancel={(event) => {
              event.preventDefault();
              cancelNavigation();
            }}
          >
            <p ref={navigationHeading} tabIndex={-1}>
              저장하지 않은 입력을 이 탭에 보관하고 이동하시겠습니까?
            </p>
            <div className="weekly-list-actions">
              <button
                type="button"
                onClick={() => {
                  cancelNavigation();
                }}
              >
                계속 편집
              </button>
              <button
                type="button"
                disabled={pending !== null}
                onClick={() => {
                  storeDrafts(key, current.current);
                  dirtyRef.current = false;
                  window.location.assign(navigation);
                }}
              >
                초안 보관하고 이동
              </button>
            </div>
          </dialog>,
          document.body,
        )}
      <div className="weekly-list-columns" aria-hidden="true">
        <span>업무 / 내용</span>
        <span>프로젝트 / 태그</span>
        <span>시작일</span>
        <span>마감기한</span>
        <span>상태 / 작업</span>
      </div>
      <ol className="weekly-list-rows">
        {rows.map((entry) => {
          const draft = draftById.get(entry.id);
          const fields = draft?.fields ?? fieldsFor(entry);
          const display = dailySheetDetails(entry.content, entry.mustFinishToday);
          const fieldLocked = disabled || !!draft?.command;
          const project = props.projects.find(
            (item) => item.id === entry.projectId && item.companyId === companyId,
          );
          const target = completionTarget(entry);
          const edited = !!draft;
          const startLocked = !simpleStart(draft?.original ?? entry);
          return (
            <li
              key={entry.id}
              className={`weekly-list-row ${edited ? 'has-draft' : ''} ${entry.status === 'done' || entry.status === 'canceled' ? 'is-finished' : ''}`}
            >
              <div className="weekly-list-title-cell">
                {props.editing ? (
                  <input
                    aria-label={`${entry.title} 제목`}
                    maxLength={200}
                    value={fields.title}
                    disabled={fieldLocked}
                    onChange={(event) => update(entry, 'title', event.target.value)}
                  />
                ) : (
                  <strong>{entry.title}</strong>
                )}
                {props.editing ? (
                  <details className="weekly-list-content-editor">
                    <summary>{kinds[entry.kind]} · 내용 편집</summary>
                    <textarea
                      aria-label={`${entry.title} 내용`}
                      value={editableDailyNotesFrom(
                        (draft?.original ?? entry).content,
                        fields.content,
                      )}
                      maxLength={dailyNoteCapacity(fields.content)}
                      disabled={fieldLocked}
                      onChange={(event) =>
                        update(
                          entry,
                          'content',
                          replaceDailyNotes(
                            (draft?.original ?? entry).content ?? '',
                            event.target.value,
                          ),
                        )
                      }
                      rows={3}
                    />
                  </details>
                ) : (
                  <span className="weekly-list-content">
                    {kinds[entry.kind]}
                    {display.notes ? ` · ${display.notes}` : ''}
                  </span>
                )}
                {edited && !props.editing && (
                  <span className="weekly-list-draft-label">편집 중인 입력 보관됨</span>
                )}
                <WorkDeadlineBadges entry={entry} today={props.today} />
              </div>
              <div className="weekly-list-project">
                <span className="weekly-list-mobile-label">프로젝트</span>
                {project?.code ?? (entry.projectId ? '확인 필요' : '없음')}
                <WorkSourceBadges categories={props.sourceCategories?.(entry) ?? []} />
                {entry.tagIds.length > 0 && (
                  <span className="weekly-list-tags">
                    {entry.tagIds.map((id) => {
                      const tag = props.tags.find((row) => row.id === id);
                      return (
                        <span key={id} className={tag?.isCore ? 'is-core' : undefined}>
                          {tag?.label ?? '연결 태그'}
                        </span>
                      );
                    })}
                  </span>
                )}
              </div>
              <div className="weekly-list-date">
                <span className="weekly-list-mobile-label">시작일</span>
                {props.editing ? (
                  <>
                    {entry.plannedDate === null && props.placementDates ? (
                      <select
                        aria-label={`${entry.title} 요일 배정`}
                        value={fields.start}
                        disabled={fieldLocked || startLocked}
                        onChange={(event) => update(entry, 'start', event.target.value)}
                      >
                        <option value="">미배정</option>
                        {props.placementDates.map((date, index) => (
                          <option key={date} value={date}>
                            {['월', '화', '수', '목', '금', '토', '일'][index]}요일 ·{' '}
                            {date.slice(5)}
                          </option>
                        ))}
                      </select>
                    ) : (
                      <input
                        type="date"
                        aria-label={`${entry.title} 시작일`}
                        value={fields.start}
                        disabled={fieldLocked || startLocked}
                        onChange={(event) => update(entry, 'start', event.target.value)}
                      />
                    )}
                    {startLocked && (
                      <small>
                        시각·기간·휴가 날짜는{' '}
                        <a
                          className="weekly-list-link"
                          href={dayHref(companyId, entry.plannedDate ?? props.date)}
                        >
                          일간 상세
                        </a>
                        에서 편집
                      </small>
                    )}
                  </>
                ) : (
                  <time dateTime={entry.plannedDate ?? undefined}>
                    {entry.plannedDate ?? '미정'}
                  </time>
                )}
              </div>
              <div className="weekly-list-date">
                <span className="weekly-list-mobile-label">마감기한</span>
                {props.editing ? (
                  <input
                    type="date"
                    aria-label={`${entry.title} 마감기한`}
                    value={fields.due}
                    disabled={fieldLocked || entry.kind === 'leave'}
                    onChange={(event) => update(entry, 'due', event.target.value)}
                  />
                ) : (
                  <time dateTime={entry.dueDate ?? undefined}>{entry.dueDate ?? '없음'}</time>
                )}
              </div>
              <div className="weekly-list-status-cell">
                <span className={`weekly-list-status is-${entry.status}`}>
                  {statuses[entry.status]}
                </span>
                <div className="weekly-list-actions">
                  {props.onStatusChange && target && (
                    <button
                      type="button"
                      disabled={disabled || edited}
                      aria-label={`${entry.title} ${entry.status === 'done' ? '완료 해제' : '완료'}`}
                      onClick={() => props.onStatusChange?.(entry, target)}
                    >
                      {entry.status === 'done' ? '완료 해제' : '완료'}
                    </button>
                  )}
                  {props.onStatusChange &&
                    entry.kind === 'task' &&
                    entry.status === 'todo' &&
                    entry.plannedDate && (
                      <button
                        type="button"
                        disabled={disabled || edited}
                        onClick={() => props.onStatusChange?.(entry, 'doing')}
                      >
                        시작
                      </button>
                    )}
                  {props.onStatusChange &&
                    entry.status !== 'done' &&
                    entry.status !== 'canceled' &&
                    entry.status !== 'paused' && (
                      <button
                        type="button"
                        disabled={disabled || edited}
                        onClick={() => props.onStatusChange?.(entry, 'canceled')}
                      >
                        취소
                      </button>
                    )}
                  <a
                    className="weekly-list-link"
                    href={dayHref(companyId, entry.plannedDate ?? props.date)}
                  >
                    상세
                  </a>
                </div>
                {props.editing && draft && !draft.command && (
                  <div className="weekly-list-actions">
                    <button
                      type="button"
                      disabled={disabled}
                      onClick={() => void save(draft, false)}
                    >
                      {pending === draft.id ? '저장 중…' : '저장'}
                    </button>
                    <button
                      type="button"
                      disabled={pending !== null}
                      onClick={() => cancelled(draft, false)}
                    >
                      편집 취소
                    </button>
                  </div>
                )}
              </div>
              {draft && (draft.error || draft.command) && recoveryPanel(draft, false)}
            </li>
          );
        })}
      </ol>
      {!rows.length && <p className="weekly-list-empty">이 주에 배정된 업무가 없습니다.</p>}
      {props.createSlot && props.creating
        ? createPortal(
            <section className="weekly-work-list weekly-quick-create" aria-label="주간 업무 추가">
              <div className="weekly-quick-heading">
                <h4>업무 추가</h4>
                <button type="button" onClick={props.onCreateClose}>
                  닫기 · 초안 유지
                </button>
              </div>
              {notice && <p role="status">{notice}</p>}
              {createForm}
            </section>,
            props.createSlot,
          )
        : createForm}
    </section>
  );
}
