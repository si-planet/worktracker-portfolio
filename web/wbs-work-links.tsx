import { RefreshButton } from './ui-controls';
import { editableDailyNotes } from './daily-sheet-model';
import { createPortal } from 'react-dom';
import { useEffect, useRef } from 'react';
export type WorkLinkAction = 'connect' | 'replace' | 'unlink';
/** Explicit confirmation only; this component never writes or refreshes work data. */
export function WorkLinkConfirmation({
  action,
  sourceTitle,
  sourceDescription,
  currentTarget,
  nextTarget,
  busy,
  uncertain,
  error,
  onConfirm,
  onCancel,
}: {
  action: WorkLinkAction;
  sourceTitle: string;
  sourceDescription: string;
  currentTarget: string | null;
  nextTarget: string | null;
  busy: boolean;
  uncertain: boolean;
  error: string;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const modal = useRef<HTMLDialogElement>(null),
    origin = useRef<HTMLElement | null>(null);
  const title =
    action === 'connect'
      ? 'WBS 연결 검토'
      : action === 'replace'
        ? 'WBS 연결 교체 확인'
        : 'WBS 연결 해제 확인';
  useEffect(() => {
    origin.current = document.activeElement as HTMLElement;
    const node = modal.current;
    if (node && !node.open) node.showModal();
    node?.querySelector<HTMLButtonElement>('[data-link-cancel]')?.focus();
    return () => {
      if (node?.open) node.close();
      origin.current?.focus();
    };
  }, []);
  function cancel() {
    if (busy) return;
    modal.current?.close();
    onCancel();
    origin.current?.focus();
  }
  return (
    <dialog
      ref={modal}
      role="alertdialog"
      aria-modal="true"
      aria-labelledby="work-link-confirm-title"
      aria-describedby="work-link-confirm-description"
      className="work-link-dialog"
      onCancel={(e) => {
        e.preventDefault();
        cancel();
      }}
    >
      <h3 id="work-link-confirm-title">{title}</h3>
      <p id="work-link-confirm-description">
        기존 업무의 WBS 연결만{' '}
        {action === 'unlink' ? '해제' : action === 'replace' ? '교체' : '저장'}합니다. 업무의
        제목·본문·프로젝트·날짜·상태·태그와 확정 과거보고·기존 영수증은 이 명령으로 바꾸지 않습니다.
      </p>
      <h4>{sourceTitle}</h4>
      <p>{sourceDescription}</p>
      <dl>
        <dt>현재 WBS 연결</dt>
        <dd>{currentTarget ?? '연결 없음'}</dd>
        <dt>변경 후 WBS 연결</dt>
        <dd>{action === 'unlink' ? '연결 없음' : (nextTarget ?? '대상 확인 필요')}</dd>
      </dl>
      {action === 'replace' && (
        <p>기존 연결을 선택한 항목으로 바꿉니다. 여러 항목에 동시에 연결하지 않습니다.</p>
      )}
      {error && <p role="alert">{error}</p>}
      {uncertain && (
        <p role="status">
          결과가 확인되지 않았습니다. 고정 ID와 입력을 유지하며 자동 재제출하지 않습니다.
        </p>
      )}
      <button type="button" data-link-cancel disabled={busy} onClick={cancel}>
        WBS 연결 검토 취소 · 입력 유지
      </button>
      <button
        type="button"
        className="primary"
        disabled={busy || uncertain || (action !== 'unlink' && !nextTarget)}
        onClick={onConfirm}
      >
        {action === 'connect'
          ? '선택한 WBS에 연결'
          : action === 'replace'
            ? '기존 WBS 연결 교체'
            : 'WBS 연결 해제'}
      </button>
    </dialog>
  );
}

import { useState, useId } from 'react';
import { z } from 'zod';
import { zWorkEntryFinal, type WorkEntryFinal } from '../shared/schema/work-entry';
import {
  readWorkLink,
  readWorkLinks,
  readWorkLinkTarget,
  sendWorkLink,
  matchesWorkLink,
  zWorkLinkCommand,
  workLinkEntryHref,
  workLinkItemHref,
  type WorkLinkCommand,
  type WbsWorkLinkSnapshot,
  type LinkTarget,
  type WbsWorkLinkList,
} from './wbs-work-link-api';
import { workApi, WorkFailure, workError } from './work-entry-api';
import { readWbs } from './wbs-api';
import { zAdminWorkTag } from '../shared/schema/tags';

type TargetInfo = Awaited<ReturnType<typeof readWorkLinkTarget>>;
const zReview = z.strictObject({
  command: zWorkLinkCommand,
  source: zWorkEntryFinal,
  oldLabel: z.string().nullable(),
  nextLabel: z.string().nullable(),
  sent: z.boolean(),
});
type Review = z.output<typeof zReview>;
const labels: Record<string, string> = {
  todo: '미진행',
  doing: '진행 중',
  paused: '중단',
  done: '완료',
  canceled: '취소',
};
function sourceDescription(e: WorkEntryFinal) {
  return `업무 · ${labels[e.status]}${e.resumeStatus ? ` (재개 시 ${labels[e.resumeStatus]})` : ''} · 예정 ${e.plannedDate ?? '날짜 미정'}${e.endDate ? ` ~ ${e.endDate}` : ''} · 마감 ${e.dueDate ?? '없음'}${e.timeMode === 'exact' ? ` · 정확 시각 ${new Date(e.startAt!).toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' })} ~ ${new Date(e.endAt!).toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' })} (한국 시간)` : ''}`;
}
function loadReview(key: string, companyId: string, entryId: string): Review | null {
  try {
    const r = zReview.parse(JSON.parse(sessionStorage.getItem(key) ?? 'null'));
    return r.command.companyId === companyId &&
      r.command.entryId === entryId &&
      r.source.companyId === companyId &&
      r.source.id === entryId &&
      r.source.kind === 'task' &&
      r.source.version === r.command.body.sourceEntryVersion
      ? r
      : null;
  } catch {
    return null;
  }
}
function rememberItem(itemId: string) {
  const u = new URL(location.href);
  u.searchParams.set('itemId', itemId);
  history.replaceState(null, '', u.pathname + u.search);
}
function linkError(e: unknown) {
  if (e instanceof WorkFailure) {
    const map: Record<string, string> = {
      SOURCE_CHANGED: '업무 버전이 바뀌었습니다. 현재 업무를 다시 확인해 주세요.',
      TARGET_CHANGED: 'WBS 항목이나 부모 계획이 바뀌었습니다. 현재 대상을 다시 확인해 주세요.',
      LINK_CHANGED: '현재 연결이 바뀌었습니다. 연결을 다시 확인해 주세요.',
      LINK_UNCHANGED: '이미 같은 WBS에 연결되어 있습니다.',
      LINK_SCOPE: '같은 회사와 프로젝트의 업무만 연결할 수 있습니다.',
      WBS_LINK_REQUIRES_UNLINK: '프로젝트 또는 종류를 바꾸려면 WBS 연결을 먼저 명시 해제해 주세요.',
    };
    if (e.reason && map[e.reason]) return map[e.reason]!;
  }
  return workError(e) ?? 'WBS 연결을 확인하지 못했습니다. 입력을 보존했습니다.';
}
function sameTarget(a: LinkTarget, b: LinkTarget) {
  return (
    a.itemId === b.itemId &&
    a.itemVersion === b.itemVersion &&
    a.planId === b.planId &&
    a.planVersion === b.planVersion
  );
}

/** Account/company scoped fixed command. All reads in this component use safe routes. */
export function WorkEntryWbsLink({
  entry,
  userId,
  disabled = false,
  expired,
  target,
  onChanged,
  autoOpen = false,
  triggerTargetId,
}: {
  entry: WorkEntryFinal;
  userId: string;
  disabled?: boolean;
  expired: (e: unknown) => boolean;
  target?: LinkTarget;
  onChanged?: (() => void) | undefined;
  autoOpen?: boolean;
  triggerTargetId?: string;
}) {
  const [triggerTarget, setTriggerTarget] = useState<HTMLElement | null>(null);
  useEffect(() => {
    setTriggerTarget(triggerTargetId ? document.getElementById(triggerTargetId) : null);
  }, [triggerTargetId]);
  const key = `wt:wbs-link:v1:${encodeURIComponent(userId)}:${entry.companyId}:${entry.id}`;
  const [review, setReview] = useState<Review | null>(() =>
    loadReview(key, entry.companyId, entry.id),
  );
  const [open, setOpen] = useState(autoOpen || !!review),
    [snapshot, setSnapshot] = useState<WbsWorkLinkSnapshot | null>(null),
    [info, setInfo] = useState<TargetInfo | null>(null),
    [choices, setChoices] = useState<TargetInfo[]>([]),
    [chosen, setChosen] = useState(''),
    [year, setYear] = useState(
      String(
        Number(new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Seoul' }).slice(0, 4)),
      ),
    ),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [message, setMessage] = useState(''),
    [modal, setModal] = useState(false),
    [denied, setDenied] = useState(false);
  const alive = useRef(true),
    lock = useRef(false),
    revision = useRef(0),
    readOwner = useRef<number | null>(null),
    panelId = useId();
  const scope = `${userId}:${entry.companyId}:${entry.id}`,
    currentScope = useRef(scope);
  currentScope.current = scope;
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      revision.current++;
      if (readOwner.current !== null) {
        readOwner.current = null;
        lock.current = false;
      }
    };
  }, []);
  function save(r: Review | null) {
    if (r) sessionStorage.setItem(key, JSON.stringify(r));
    else sessionStorage.removeItem(key);
    setReview(r);
  }
  function fail(e: unknown) {
    if (expired(e)) return;
    if (e instanceof WorkFailure && e.status === 403) {
      setDenied(true);
      setSnapshot(null);
      setInfo(null);
      setChoices([]);
    }
    setError(linkError(e));
  }
  async function read() {
    if (lock.current || disabled || !navigator.onLine) return;
    lock.current = true;
    setBusy(true);
    setError('');
    const ticket = ++revision.current,
      readScope = scope;
    readOwner.current = ticket;
    try {
      const s = await readWorkLink(entry.companyId, entry.id);
      const t = s.target ? await readWorkLinkTarget(entry.companyId, s.target) : null;
      if (!alive.current || currentScope.current !== readScope || ticket !== revision.current)
        return;
      if (t && s.target && !sameTarget(t, s.target)) throw new Error('WBS_TARGET_CHANGED');
      setSnapshot(s);
      setInfo(t);
      if (s.sourceEntryVersion !== entry.version)
        setError(
          '표시한 업무 이후 버전이 변경되었습니다. 업무 목록을 직접 다시 조회한 뒤 검토해 주세요.',
        );
    } catch (e) {
      if (!alive.current || currentScope.current !== readScope) return;
      // Session expiry belongs to this mounted scope, even after a read is superseded.
      if (e instanceof WorkFailure && e.status === 401) {
        expired(e);
        return;
      }
      if (ticket === revision.current) fail(e);
    } finally {
      if (readOwner.current === ticket) {
        readOwner.current = null;
        lock.current = false;
        if (alive.current) setBusy(false);
      }
    }
  }
  useEffect(() => {
    if (open && !snapshot && !review && !denied) void read();
  }, [open, disabled]); // explicit opening or restored navigation only
  function toggle() {
    if (!open) {
      const u = new URL(location.href);
      if (/\/(day|unscheduled)$/.test(u.pathname)) {
        u.searchParams.set('entryId', entry.id);
        history.replaceState(null, '', u.pathname + u.search);
      }
    }
    setOpen(!open);
  }
  async function loadTargets() {
    if (lock.current || disabled || !navigator.onLine || !entry.projectId) return;
    const y = Number(year);
    if (!Number.isInteger(y) || y < 1 || y > 9999) {
      setError('WBS 연도는 1~9999로 입력해 주세요.');
      return;
    }
    lock.current = true;
    setBusy(true);
    setError('');
    try {
      const data = await readWbs(entry.companyId, y);
      if (!alive.current) return;
      setChoices(
        data.plans
          .filter((p) => p.projectId === entry.projectId)
          .flatMap((p) =>
            p.items.map((i) => ({
              projectId: p.projectId,
              year: p.year,
              title: i.title,
              planId: p.id,
              itemId: i.id,
              itemVersion: i.version,
              planVersion: p.version,
            })),
          ),
      );
      setChosen('');
    } catch (e) {
      if (alive.current) fail(e);
    } finally {
      lock.current = false;
      if (alive.current) setBusy(false);
    }
  }
  async function prepare(unlink = false) {
    if (lock.current || disabled || review?.sent || !navigator.onLine) return;
    lock.current = true;
    setBusy(true);
    setError('');
    setMessage('');
    try {
      const s = await readWorkLink(entry.companyId, entry.id);
      if (s.sourceEntryVersion !== entry.version) throw new Error('SOURCE_STALE');
      const old = s.target ? await readWorkLinkTarget(entry.companyId, s.target) : null;
      if (old && s.target && !sameTarget(old, s.target)) throw new Error('TARGET_STALE');
      const desired = target ?? choices.find((t) => t.itemId === chosen);
      const next = !unlink && desired ? await readWorkLinkTarget(entry.companyId, desired) : null;
      if (!unlink && (!desired || !next || !sameTarget(desired, next)))
        throw new Error('TARGET_STALE');
      if (next && next.projectId !== entry.projectId) throw new Error('PROJECT_SCOPE');
      if (next && s.link?.itemId === next.itemId) {
        setError('이미 같은 WBS에 연결되어 있습니다.');
        return;
      }
      let command: WorkLinkCommand;
      if (unlink) {
        if (!s.link || !s.target) throw new Error('NO_LINK');
        command = {
          method: 'DELETE',
          companyId: entry.companyId,
          entryId: entry.id,
          body: {
            sourceEntryVersion: s.sourceEntryVersion,
            expectedLink: { id: s.link.id, version: s.link.version, itemId: s.link.itemId },
            target: s.target,
          },
        };
      } else {
        if (!next) throw new Error('NO_TARGET');
        command = {
          method: 'PUT',
          companyId: entry.companyId,
          entryId: entry.id,
          body: {
            linkId: s.link?.id ?? crypto.randomUUID(),
            sourceEntryVersion: s.sourceEntryVersion,
            expectedLink: s.link
              ? { id: s.link.id, version: s.link.version, itemId: s.link.itemId }
              : null,
            previousTarget: s.target,
            target: {
              itemId: next.itemId,
              itemVersion: next.itemVersion,
              planId: next.planId,
              planVersion: next.planVersion,
            },
          },
        };
      }
      zWorkLinkCommand.parse(command);
      if (!alive.current) return;
      save({
        command,
        source: entry,
        oldLabel: old ? `${old.year}년 · ${old.title}` : null,
        nextLabel: next ? `${next.year}년 · ${next.title}` : null,
        sent: false,
      });
      setSnapshot(s);
      setInfo(old);
      setModal(true);
    } catch (e) {
      if (alive.current) {
        if (e instanceof Error && ['SOURCE_STALE', 'TARGET_STALE'].includes(e.message))
          setError(
            '업무 또는 WBS 버전이 바뀌었습니다. 목록과 연결을 직접 다시 조회한 뒤 새로 검토해 주세요.',
          );
        else fail(e);
      }
    } finally {
      lock.current = false;
      if (alive.current) setBusy(false);
    }
  }
  async function submit() {
    if (lock.current || !review || review.sent || disabled || !navigator.onLine) return;
    lock.current = true;
    setBusy(true);
    setError('');
    try {
      save({ ...review, sent: true });
      const r = await sendWorkLink(review.command);
      if (!alive.current) return;
      setSnapshot(r.snapshot);
      setInfo(null);
      save(null);
      setModal(false);
      setMessage('WBS 연결을 저장했습니다. 업무와 집계는 변경하지 않았습니다.');
      onChanged?.();
    } catch (e) {
      if (!alive.current) return;
      setModal(false);
      if (e instanceof WorkFailure && [400, 409, 422].includes(e.status)) {
        save({ ...review, sent: true });
        setError(`${linkError(e)} 이전 검토를 폐기하고 현재 연결을 다시 조회해 주세요.`);
      } else fail(e);
    } finally {
      lock.current = false;
      if (alive.current) setBusy(false);
    }
  }
  async function recover() {
    if (lock.current || !review || disabled || !navigator.onLine) return;
    lock.current = true;
    setBusy(true);
    setError('');
    try {
      const s = await readWorkLink(entry.companyId, entry.id);
      if (!alive.current) return;
      setSnapshot(s);
      if (matchesWorkLink(review.command, s)) {
        save(null);
        setModal(false);
        setInfo(null);
        setMessage(
          review.command.method === 'DELETE'
            ? '현재 연결이 해제되어 있음을 확인했습니다. 과거 실행의 영수증은 아닙니다.'
            : '고정 ID·버전·대상이 일치하는 현재 연결을 확인했습니다. 자동 재제출하지 않았습니다.',
        );
        onChanged?.();
      } else
        setError(
          '현재 연결이 고정 명령의 예상 결과와 다릅니다. 후속 변경 또는 미실행을 구분할 수 없어 성공으로 단정하지 않습니다. 자동 재제출하지 않습니다.',
        );
    } catch (e) {
      if (alive.current) fail(e);
    } finally {
      lock.current = false;
      if (alive.current) setBusy(false);
    }
  }
  const blocked = disabled || busy || !navigator.onLine;
  const trigger = (
    <button
      type="button"
      className={triggerTargetId ? 'work-edit-action' : undefined}
      aria-label={`WBS 연결 확인: ${entry.title}`}
      aria-expanded={open}
      aria-controls={panelId}
      onClick={toggle}
      disabled={disabled}
    >
      {triggerTargetId ? 'WBS 연결' : `WBS 연결 확인: ${entry.title}`}
    </button>
  );
  return (
    <section
      className="work-entry-wbs-link"
      aria-label={`WBS 연결: ${entry.title}`}
      hidden={!!triggerTarget && !open}
    >
      {triggerTarget ? createPortal(trigger, triggerTarget) : trigger}
      <div id={panelId} hidden={!open}>
        {!denied && (
          <>
            <p>
              기존 업무의 연결만 관리합니다. 프로젝트·종류 변경 전에는 먼저 연결을 해제해 주세요.
            </p>
            {snapshot && (
              <p>
                {snapshot.link
                  ? `현재 연결: ${info?.title ?? '연결된 WBS 항목'} · 연결 버전 ${snapshot.link.version}`
                  : '현재 WBS 연결 없음'}
              </p>
            )}
            {info && (
              <a
                className="control-link"
                href={workLinkItemHref(entry.companyId, info.projectId, info.year, info.itemId)}
              >
                연결된 WBS 항목으로 이동
              </a>
            )}
            <RefreshButton type="button" disabled={blocked || !!review} onClick={() => void read()}>
              현재 WBS 연결 다시 조회
            </RefreshButton>
            {!target && !review && (
              <>
                <label>
                  연결 대상 WBS 연도
                  <input
                    type="number"
                    min="1"
                    max="9999"
                    value={year}
                    disabled={blocked}
                    onChange={(e) => setYear(e.target.value)}
                  />
                </label>
                <RefreshButton
                  type="button"
                  disabled={blocked || !entry.projectId}
                  onClick={() => void loadTargets()}
                  showLabel
                >
                  같은 프로젝트 WBS 조회
                </RefreshButton>
                <label>
                  연결할 WBS 항목
                  <select
                    value={chosen}
                    disabled={blocked}
                    onChange={(e) => setChosen(e.target.value)}
                  >
                    <option value="">항목 선택</option>
                    {choices.map((t) => (
                      <option key={t.itemId} value={t.itemId}>
                        {t.year}년 · {t.title}
                      </option>
                    ))}
                  </select>
                </label>
              </>
            )}
            {!review && (
              <>
                <button
                  type="button"
                  disabled={blocked || (!target && !chosen)}
                  onClick={() => void prepare()}
                >
                  WBS 연결 검토: {entry.title}
                </button>
                <button
                  type="button"
                  disabled={blocked || !snapshot?.link}
                  onClick={() => void prepare(true)}
                >
                  WBS 연결 해제 검토: {entry.title}
                </button>
              </>
            )}
            {review && (
              <>
                <p role="status">
                  {review.sent ? '결과 미확인 · 고정 명령 보존' : 'WBS 연결 검토 초안 보존'}
                </p>
                <button
                  type="button"
                  disabled={blocked || review.sent}
                  onClick={() => setModal(true)}
                >
                  보존한 WBS 연결 검토 다시 열기
                </button>
                <RefreshButton
                  type="button"
                  disabled={blocked}
                  onClick={() => void recover()}
                  showLabel
                >
                  고정 WBS 연결 결과 확인
                </RefreshButton>
                <button
                  type="button"
                  disabled={blocked}
                  onClick={() => {
                    if (
                      window.confirm(
                        '보존한 연결 검토를 폐기할까요? 결과 미확인 명령은 자동 재제출되지 않습니다.',
                      )
                    ) {
                      save(null);
                      setModal(false);
                      setSnapshot(null);
                      setInfo(null);
                      setError('');
                    }
                  }}
                >
                  WBS 연결 검토 명시 폐기
                </button>
              </>
            )}
          </>
        )}
        {busy && <p role="status">WBS 연결 확인 중…</p>}
        {error && <p role="alert">{error}</p>}
        {message && <p role="status">{message}</p>}
        {!navigator.onLine && (
          <p role="status">오프라인입니다. 마지막 조회와 초안을 보존하며 쓰지 않습니다.</p>
        )}
      </div>
      {modal && review && (
        <WorkLinkConfirmation
          action={
            review.command.method === 'DELETE'
              ? 'unlink'
              : review.command.body.expectedLink
                ? 'replace'
                : 'connect'
          }
          sourceTitle={review.source.title}
          sourceDescription={sourceDescription(review.source)}
          currentTarget={review.oldLabel}
          nextTarget={review.nextLabel}
          busy={busy}
          uncertain={review.sent}
          error={error}
          onConfirm={() => void submit()}
          onCancel={() => setModal(false)}
        />
      )}
    </section>
  );
}

export function WbsWorkLinks({
  companyId,
  userId,
  projectId,
  itemId,
  itemTitle,
  target,
  disabled,
  expired,
  onChanged,
  autoOpen = false,
}: {
  companyId: string;
  userId: string;
  projectId: string;
  itemId: string;
  itemTitle: string;
  target: LinkTarget;
  disabled: boolean;
  expired: (e: unknown) => boolean;
  onChanged: () => void;
  autoOpen?: boolean;
}) {
  const [open, setOpen] = useState(autoOpen),
    [mode, setMode] = useState<'entries' | 'candidates'>('entries'),
    [data, setData] = useState<WbsWorkLinkList | null>(null),
    [rows, setRows] = useState<WbsWorkLinkList['items']>([]),
    [tags, setTags] = useState<z.output<typeof zAdminWorkTag>[]>([]),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [denied, setDenied] = useState(false);
  const ticket = useRef(0),
    readOwner = useRef<number | null>(null),
    lock = useRef(false),
    alive = useRef(true),
    seen = useRef(new Set<string>()),
    panelId = useId();
  const scope = `${userId}:${companyId}:${projectId}:${itemId}`,
    currentScope = useRef(scope);
  currentScope.current = scope;
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      ticket.current++;
      if (readOwner.current !== null) {
        readOwner.current = null;
        lock.current = false;
      }
    };
  }, []);
  async function read(next = false, newMode = mode) {
    if (lock.current || disabled || !navigator.onLine) return;
    lock.current = true;
    setBusy(true);
    setError('');
    const rev = ++ticket.current,
      readScope = scope;
    readOwner.current = rev;
    try {
      const cursor = next ? data?.nextCursor : undefined;
      if (next && (!cursor || seen.current.has(cursor))) throw new Error('CURSOR_LOOP');
      const [v, t] = await Promise.all([
        readWorkLinks(companyId, projectId, itemId, newMode, cursor ?? undefined),
        workApi(
          `/api/companies/${companyId}/work-tags?includeInactive=true`,
          z
            .array(zAdminWorkTag)
            .refine(
              (rows) =>
                new Set(rows.map((t) => t.id)).size === rows.length &&
                rows.every((t) => t.companyId === null || t.companyId === companyId),
            ),
        ),
      ]);
      if (!alive.current || currentScope.current !== readScope || rev !== ticket.current) return;
      if (
        next &&
        (v.items.some((r) => rows.some((x) => x.entry.id === r.entry.id)) ||
          v.nextCursor === cursor)
      )
        throw new Error('CURSOR_LOOP');
      if (!next) seen.current.clear();
      if (cursor) seen.current.add(cursor);
      setData(v);
      setRows(next ? [...rows, ...v.items] : v.items);
      setTags(t);
      setMode(newMode);
    } catch (e) {
      if (!alive.current || currentScope.current !== readScope) return;
      // Session expiry belongs to this mounted scope, even after a read is superseded.
      if (e instanceof WorkFailure && e.status === 401) {
        expired(e);
        return;
      }
      if (rev !== ticket.current) return;
      if (expired(e)) return;
      if (e instanceof WorkFailure && e.status === 403) {
        setDenied(true);
        setRows([]);
        setData(null);
      }
      setError(
        e instanceof Error && e.message === 'CURSOR_LOOP'
          ? '다음 페이지를 확인할 수 없습니다. 처음부터 다시 조회해 주세요.'
          : linkError(e),
      );
    } finally {
      if (readOwner.current === rev) {
        readOwner.current = null;
        lock.current = false;
        if (alive.current) setBusy(false);
      }
    }
  }
  useEffect(() => {
    if (open && !data && !denied) void read();
  }, [open, disabled]);
  return (
    <section className="wbs-work-links" aria-label={`관련 업무: ${itemTitle}`}>
      <button
        type="button"
        disabled={disabled}
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => {
          rememberItem(itemId);
          setOpen(!open);
        }}
      >
        관련 업무 열기: {itemTitle}
      </button>
      <div id={panelId} hidden={!open}>
        <p>
          현재 연결 목록입니다. 과거보고·새 분모·실제기간을 계산하지 않습니다. 같은 회사·프로젝트의
          모든 상태 업무와 날짜 미정 업무를 선택할 수 있습니다.
        </p>
        {!denied && (
          <>
            <RefreshButton
              type="button"
              disabled={disabled || busy || !navigator.onLine}
              onClick={() => void read(false, 'entries')}
              busy={!!busy}
              showLabel
            >
              연결된 업무 조회
            </RefreshButton>
            <RefreshButton
              type="button"
              disabled={disabled || busy || !navigator.onLine}
              onClick={() => void read(false, 'candidates')}
              busy={!!busy}
              showLabel
            >
              기존 업무 후보 조회
            </RefreshButton>
          </>
        )}
        {busy && <p role="status">관련 업무 조회 중…</p>}
        {error && <p role="alert">{error}</p>}
        {data && (
          <p>
            {mode === 'entries' ? '현재 연결' : '기존 업무 후보'} 총 {data.counts.total}건 · 미진행{' '}
            {data.counts.todo} · 진행 중 {data.counts.doing} · 중단 {data.counts.paused} · 완료{' '}
            {data.counts.done} · 취소 {data.counts.canceled} · 기준{' '}
            {new Date(data.asOf).toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' })} (한국 시간)
          </p>
        )}
        {data?.mode === 'entries' && (
          <p>
            마지막 완료일: {data.counts.lastCompletedOn ?? (data.counts.done > 0 ? '미상' : '없음')}
            {(busy || error || !navigator.onLine) && ' · 마지막 성공 조회 값'}
          </p>
        )}
        {(error || !navigator.onLine) && data && (
          <p>마지막 성공 조회입니다. 오류를 빈 목록으로 해석하지 않습니다.</p>
        )}
        {data && !busy && !error && !rows.length && (
          <p>
            {mode === 'entries'
              ? '현재 연결된 업무가 없습니다.'
              : '조회 조건에 맞는 기존 업무 후보가 없습니다.'}
          </p>
        )}
        {!denied && (
          <PendingWorkLinkReviews
            userId={userId}
            companyId={companyId}
            projectId={projectId}
            itemId={itemId}
            exclude={rows.map((r) => r.entry.id)}
            disabled={disabled || busy}
            expired={expired}
            onChanged={onChanged}
          />
        )}
        <ul>
          {rows.map(({ entry, snapshot }) => (
            <li key={entry.id}>
              <h4>{entry.title}</h4>
              <p>{sourceDescription(entry)}</p>
              {entry.content && <p className="wbs-text">{editableDailyNotes(entry.content)}</p>}
              <p>
                태그:{' '}
                {entry.tagIds.length
                  ? entry.tagIds
                      .map((id) => tags.find((t) => t.id === id)?.label ?? '이름 확인 불가')
                      .join(', ')
                  : '없음'}
              </p>
              <p>
                {snapshot.link
                  ? snapshot.link.itemId === itemId
                    ? '이 항목에 연결됨'
                    : '다른 WBS 항목에 연결됨 · 교체 확인 필요'
                  : '현재 연결 없음'}
              </p>
              <a className="control-link" href={workLinkEntryHref(entry)}>
                기존 업무 화면으로 이동: {entry.title}
              </a>
              <WorkEntryWbsLink
                entry={entry}
                userId={userId}
                target={data?.target ?? target}
                disabled={disabled || busy}
                expired={expired}
                onChanged={() => {
                  onChanged();
                  void read();
                }}
              />
            </li>
          ))}
        </ul>
        {data?.nextCursor && !denied && (
          <button
            type="button"
            disabled={disabled || busy || !navigator.onLine}
            onClick={() => void read(true)}
          >
            관련 업무 다음 50개
          </button>
        )}
      </div>
    </section>
  );
}

/** Restores fixed commands even when the affected entry is no longer on the first page. */
export function PendingWorkLinkReviews({
  userId,
  companyId,
  projectId,
  itemId,
  entryId,
  exclude = [],
  disabled,
  expired,
  onChanged,
}: {
  userId: string;
  companyId: string;
  projectId?: string;
  itemId?: string;
  entryId?: string | undefined;
  exclude?: string[];
  disabled: boolean;
  expired: (e: unknown) => boolean;
  onChanged?: (() => void) | undefined;
}) {
  const [saved] = useState(() => {
    const found: Review[] = [];
    const prefix = `wt:wbs-link:v1:${encodeURIComponent(userId)}:${companyId}:`;
    try {
      for (let i = 0; i < sessionStorage.length; i++) {
        const key = sessionStorage.key(i);
        if (!key?.startsWith(prefix)) continue;
        const id = key.slice(prefix.length);
        const r = loadReview(key, companyId, id);
        if (
          !r ||
          (projectId && r.source.projectId !== projectId) ||
          (entryId && r.source.id !== entryId)
        )
          continue;
        const b = r.command.body;
        if (
          itemId &&
          !(r.command.method === 'PUT' && r.command.body.previousTarget?.itemId === itemId) &&
          b.target.itemId !== itemId
        )
          continue;
        found.push(r);
      }
    } catch {
      /* Storage unavailable: do not invent a command. */
    }
    return found;
  });
  const pending = saved.filter((r) => !exclude.includes(r.source.id));
  if (!pending.length) return null;
  return (
    <section aria-label="보존한 WBS 연결 명령">
      <p>
        이 목록은 보존한 검토 당시 업무입니다. 현재 목록이나 현재 상태로 해석하지 않습니다. 결과
        확인은 안전 조회만 사용합니다.
      </p>
      {pending.map((r) => (
        <WorkEntryWbsLink
          key={r.source.id}
          entry={r.source}
          userId={userId}
          disabled={disabled}
          expired={expired}
          onChanged={onChanged}
          autoOpen
        />
      ))}
    </section>
  );
}
