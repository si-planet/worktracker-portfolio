import { useEffect, useId, useRef, useState } from 'react';
import type { WbsPlannerItem, WbsPlannerProject } from '../shared/schema/wbs-planner';
import { readWbs, sendWbs, matchWbsResult, wbsFailure } from './wbs-api';
import { WorkFailure, workError } from './work-entry-api';
import { setWorkspaceDraftDirty } from './workspace-draft-state';
import { plannerRangeText } from './wbs-planner-calendar';
import {
  captureWbsMove,
  movePreviewMessage,
  wbsMoveCommand,
  wbsMoveDirty,
  zMoveDrafts,
  type MoveDraft,
  type MoveTarget,
} from './wbs-planner-move-model';
import './wbs-planner-move.css';

type Props = {
  userId: string;
  companyId: string;
  year: number;
  projectId: string;
  online: boolean;
  guard: { current: () => boolean };
  expired: (error: unknown) => boolean;
  onChanged: () => void;
  onItemOpen: (projectId: string, itemId: string) => boolean;
};
function load(key: string, props: Props) {
  try {
    const drafts = zMoveDrafts.parse(JSON.parse(sessionStorage.getItem(key) ?? '{}'));
    if (
      Object.values(drafts).some(
        (d) =>
          d.target.companyId !== props.companyId ||
          d.target.year !== props.year ||
          (props.projectId && d.target.projectId !== props.projectId),
      )
    )
      return {};
    return drafts;
  } catch {
    return {};
  }
}
/** Separate scoped drafts never replace the host editor or another item's move. */
export function useWbsPlannerMove(props: Props) {
  const key = `wt:wbs-move:v1:${encodeURIComponent(props.userId)}:${props.companyId}/${props.year}/${props.projectId}`;
  const [drafts, setDrafts] = useState(() => load(key, props));
  const current = useRef(drafts);
  current.current = drafts;
  const [active, setActive] = useState<string | null>(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [message, setMessage] = useState(''),
    [denied, setDenied] = useState(false);
  const [latest, setLatest] = useState<MoveTarget | null>(null);
  const lock = useRef(false),
    alive = useRef(true),
    dialog = useRef<HTMLDialogElement>(null),
    trigger = useRef<HTMLElement | null>(null),
    id = useId();
  const callback = useRef(props);
  callback.current = props;
  const draft = active ? drafts[active] : undefined;
  const preview = draft ? movePreviewMessage(draft) : null;
  function update(next: typeof drafts) {
    current.current = next;
    try {
      sessionStorage.setItem(key, JSON.stringify(next));
    } catch {
      /* Memory draft remains. */
    }
    setDrafts(next);
  }
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  useEffect(() => {
    const dirty = () => Object.values(current.current).some(wbsMoveDirty);
    props.guard.current = dirty;
    const leave = (event: BeforeUnloadEvent) => {
      if (dirty()) {
        event.preventDefault();
        event.returnValue = '';
      }
    };
    window.addEventListener('beforeunload', leave);
    return () => {
      window.removeEventListener('beforeunload', leave);
      setWorkspaceDraftDirty(key, false);
      if (props.guard.current === dirty) props.guard.current = () => false;
    };
  }, [key, props.guard]);
  useEffect(() => {
    setWorkspaceDraftDirty(key, Object.values(drafts).some(wbsMoveDirty));
  }, [drafts, key]);
  useEffect(() => {
    if (active && !denied && dialog.current && !dialog.current.open) {
      dialog.current.showModal();
      dialog.current.querySelector<HTMLInputElement>('input')?.focus();
    }
  }, [active, denied]);
  function confirmChange() {
    return (
      !Object.values(current.current).some(wbsMoveDirty) ||
      window.confirm(
        '미저장 일정 이동 초안 또는 결과 확인이 필요한 요청을 현재 범위에 보관하고 이동할까요? 원래 ID·버전은 유지됩니다.',
      )
    );
  }
  function close() {
    if (lock.current) return;
    dialog.current?.close();
    setActive(null);
    setLatest(null);
    requestAnimationFrame(() => {
      if (trigger.current?.isConnected) trigger.current.focus();
    });
  }
  function start(project: WbsPlannerProject, item: WbsPlannerItem, startOn?: string) {
    if (denied || lock.current || !props.online) return;
    if (
      Object.values(current.current).some(
        (d) => d.target.original.id !== item.id && wbsMoveDirty(d),
      ) &&
      !confirmChange()
    )
      return;
    trigger.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    setError('');
    setMessage('');
    setLatest(null);
    const old = current.current[item.id];
    if (old) {
      if (startOn && !wbsMoveDirty(old))
        update({ ...current.current, [item.id]: { ...old, startOn } });
      else if (startOn)
        setMessage(
          '보존한 이동 초안을 열었습니다. 새 드롭 날짜로 기존 입력을 덮어쓰지 않았습니다.',
        );
      setActive(item.id);
      return;
    }
    try {
      const target = captureWbsMove(props.companyId, props.year, project, item);
      if (!target.original.effectiveStartOn || !target.original.effectiveEndOn) {
        setError(
          '적용 계획의 시작일·종료일이 모두 있어야 이동할 수 있습니다. WBS 상세의 명시 편집에서 날짜를 확인해 주세요.',
        );
        return;
      }
      update({
        ...current.current,
        [item.id]: {
          target,
          startOn: startOn ?? target.original.effectiveStartOn,
          reason: '',
          command: null,
          stale: false,
        },
      });
      setActive(item.id);
    } catch {
      setError('선택한 회사·계획·항목의 조회값을 확인할 수 없습니다. 다시 조회해 주세요.');
    }
  }
  function change(value: Partial<MoveDraft>) {
    if (!active || !draft || draft.command || draft.stale || lock.current) return;
    update({ ...current.current, [active]: { ...draft, ...value } });
    setError('');
  }
  function fail(failure: unknown) {
    if (failure instanceof WorkFailure && [401, 403].includes(failure.status)) {
      setDenied(true);
      dialog.current?.close();
      callback.current.expired(failure);
    }
    setError(wbsFailure(failure) ?? workError(failure));
  }
  async function save() {
    const d = active ? current.current[active] : undefined;
    if (!active || !d || lock.current || d.command || d.stale || !props.online || denied) return;
    let command;
    try {
      command = wbsMoveCommand(d.target, d.startOn, d.reason);
    } catch {
      setError('날짜·실제 변경·사유 길이와 8192바이트 제한을 확인해 주세요.');
      return;
    }
    lock.current = true;
    setBusy(true);
    setError('');
    setMessage('');
    update({ ...current.current, [active]: { ...d, command } });
    try {
      await sendWbs(command);
      if (!alive.current) return;
      const next = { ...current.current };
      delete next[command.id];
      update(next);
      dialog.current?.close();
      setActive(null);
      setMessage('계획 일정을 이동해 저장했습니다. 원래 계획과 실제 업무는 유지됩니다.');
      callback.current.onChanged();
      requestAnimationFrame(() => {
        if (trigger.current?.isConnected) trigger.current.focus();
      });
    } catch (failure) {
      if (!alive.current) return;
      if (failure instanceof WorkFailure && [400, 409, 422].includes(failure.status))
        update({
          ...current.current,
          [command.id]: { ...d, command: null, stale: failure.status === 409 },
        });
      fail(failure);
    } finally {
      lock.current = false;
      if (alive.current) setBusy(false);
    }
  }
  async function inspect() {
    const d = active ? current.current[active] : undefined;
    if (!d || lock.current || !props.online || denied) return;
    lock.current = true;
    setBusy(true);
    setError('');
    setMessage('');
    setLatest(null);
    try {
      const t = d.target,
        list = await readWbs(t.companyId, t.year);
      if (!alive.current) return;
      if (d.command) {
        const result = matchWbsResult(d.command, list.plans);
        if (result === 'matched') {
          const next = { ...current.current };
          delete next[t.original.id];
          update(next);
          dialog.current?.close();
          setActive(null);
          setMessage('고정 ID·제출값과 기대 버전이 일치하는 결과를 확인했습니다.');
          callback.current.onChanged();
          requestAnimationFrame(() => {
            if (trigger.current?.isConnected) trigger.current.focus();
          });
        } else
          setMessage(
            result === 'absent'
              ? '현재 전체 목록에 대상이 없습니다. 저장 실패를 단정하거나 자동 재전송하지 않습니다. 고정 명령을 보존했습니다.'
              : '제출값·기대 버전과 다릅니다. 후속 버전의 성공 주체를 단정하지 않습니다. 고정 명령을 보존했습니다.',
          );
      } else {
        const plan = list.plans.find((p) => p.id === t.planId && p.projectId === t.projectId),
          item = plan?.items.find((i) => i.id === t.original.id);
        if (!plan || !item)
          setMessage('원래 회사·연도 전체 목록에 대상이 없습니다. 기존 초안을 보존했습니다.');
        else {
          setLatest({ ...t, original: item, planVersion: plan.version });
          setMessage(
            '현재 값을 조회했습니다. 기존 이동안의 ID·버전은 그대로입니다. 새 검토를 시작하려면 아래에서 명시 선택하세요.',
          );
        }
      }
    } catch (failure) {
      if (alive.current) fail(failure);
    } finally {
      lock.current = false;
      if (alive.current) setBusy(false);
    }
  }
  return {
    start,
    confirmChange,
    denied,
    content: denied ? (
      <p role="alert">
        일정 이동 자료에 접근할 수 없습니다. 계정별 초안과 고정 명령은 보존했습니다.
      </p>
    ) : (
      <>
        {error && !active && <p role="alert">{error}</p>}
        {message && !active && <p role="status">{message}</p>}
        {Object.values(drafts).length > 0 && (
          <div className="wbs-move-drafts" aria-label="보존한 일정 이동 초안">
            {Object.values(drafts).map((d) => (
              <button
                type="button"
                key={d.target.original.id}
                disabled={busy}
                onClick={() => {
                  if (active && active !== d.target.original.id && !confirmChange()) return;
                  trigger.current = document.activeElement as HTMLElement;
                  setActive(d.target.original.id);
                  setLatest(null);
                  setError('');
                  setMessage('');
                }}
              >
                이동 초안 다시 열기: {d.target.original.title}
                {d.command ? ' · 결과 확인 필요' : ''}
              </button>
            ))}
          </div>
        )}
        {draft && (
          <dialog
            ref={dialog}
            className="wbs-move-dialog"
            aria-modal="true"
            aria-labelledby={`${id}-title`}
            onCancel={(e) => {
              e.preventDefault();
              close();
            }}
          >
            <h2 id={`${id}-title`}>WBS 계획 일정 이동</h2>
            <p>
              {draft.target.projectCode} · {draft.target.year}년 · {draft.target.original.title}
            </p>
            <p>
              적용 계획{' '}
              {plannerRangeText({
                startOn: draft.target.original.effectiveStartOn,
                endOn: draft.target.original.effectiveEndOn,
              })}{' '}
              · 항목 버전 {draft.target.original.version} · 계획 버전 {draft.target.planVersion}
            </p>
            <p>
              같은 일수로 변경 계획을 저장합니다. 휴일에도 선택한 날짜를 그대로 사용합니다. 계획의
              소속 연도·ID는 바뀌지 않습니다. 연도 밖으로 이동한 항목은 아래 항목별 목록에서 다시
              찾을 수 있습니다.
            </p>
            <form
              onSubmit={(e) => {
                e.preventDefault();
                void save();
              }}
            >
              <label>
                이동할 새 시작일
                <input
                  type="date"
                  min="0001-01-01"
                  max="9999-12-31"
                  value={draft.startOn}
                  disabled={busy || !!draft.command || draft.stale}
                  onChange={(e) => change({ startOn: e.target.value })}
                />
              </label>
              <p role="status">
                {preview?.range
                  ? `이동 미리보기 ${preview.range.startOn} ~ ${preview.range.endOn} · 양끝 포함 ${preview.range.days}일`
                  : preview?.error}
              </p>
              <label>
                일정 이동 사유 (선택)
                <textarea
                  maxLength={5000}
                  value={draft.reason}
                  disabled={busy || !!draft.command || draft.stale}
                  onChange={(e) => change({ reason: e.target.value })}
                />
              </label>
              {busy && <p role="status">일정 이동 요청을 처리하고 있습니다.</p>}
              {error && <p role="alert">{error}</p>}
              {message && <p role="status">{message}</p>}
              {draft.stale && (
                <p role="alert">
                  409 · 다른 변경이 있습니다. 원래 항목·부모 버전을 보존했으며 자동 재시도하지
                  않습니다.
                </p>
              )}
              {draft.command && !busy && (
                <p role="status">
                  저장 결과 확인 필요 · 고정 항목 ID {draft.command.id}. 제출값·두 버전을 보존했으며
                  자동 재전송하지 않습니다.
                </p>
              )}
              {!busy && (draft.stale || draft.command) && (
                <button
                  type="button"
                  disabled={busy || !props.online}
                  onClick={() => void inspect()}
                >
                  {draft.command ? '일정 이동 저장 결과 다시 확인' : '일정 이동 현재 값 조회'}
                </button>
              )}
              {latest && (
                <section aria-label="일정 이동 현재 값 비교">
                  <p>
                    현재 적용 계획{' '}
                    {plannerRangeText({
                      startOn: latest.original.effectiveStartOn,
                      endOn: latest.original.effectiveEndOn,
                    })}{' '}
                    · 항목 {latest.original.version} · 계획 {latest.planVersion}
                  </p>
                  <button
                    type="button"
                    disabled={
                      busy || !latest.original.effectiveStartOn || !latest.original.effectiveEndOn
                    }
                    onClick={() => {
                      if (
                        !active ||
                        !window.confirm(
                          '보존한 이동안과 비교한 현재 값으로 새 검토를 시작할까요? 입력 날짜·사유를 유지하며 저장은 따로 실행합니다.',
                        )
                      )
                        return;
                      update({
                        ...current.current,
                        [active]: { ...draft, target: latest, stale: false },
                      });
                      setLatest(null);
                      setMessage(
                        '현재 버전으로 새 검토를 시작했습니다. 미리보기를 확인하고 명시 저장해 주세요.',
                      );
                    }}
                  >
                    현재 값을 선택해 새 이동 검토
                  </button>
                </section>
              )}
              {!props.online && (
                <p role="status">오프라인 · 이동 초안을 보존하며 조회·저장을 제한합니다.</p>
              )}
              <div className="wbs-move-actions">
                <button
                  type="submit"
                  className="primary"
                  disabled={
                    busy || !props.online || !preview?.range || draft.stale || !!draft.command
                  }
                >
                  계획 일정 이동 저장
                </button>
                <button type="button" disabled={busy} onClick={close}>
                  이동 검토 닫기 · 초안 유지
                </button>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => {
                    if (!active) return;
                    const prompt = draft.command
                      ? '서버 저장 여부를 단정하지 않고 재전송하지 않습니다. 이미 저장된 일정을 취소하는 동작이 아닙니다. 로컬 고정 검토만 버릴까요?'
                      : '이 항목의 미저장 일정 이동 초안을 버릴까요?';
                    if ((draft.command || wbsMoveDirty(draft)) && !window.confirm(prompt)) return;
                    const next = { ...current.current };
                    delete next[active];
                    update(next);
                    setError('');
                    setMessage(
                      draft.command
                        ? '고정 이동 검토만 이 기기에서 폐기했습니다. 서버의 저장 상태는 바꾸지 않았습니다.'
                        : '일정 이동 초안을 버렸습니다.',
                    );
                    close();
                  }}
                >
                  {draft.command ? '고정 이동 검토 명시 폐기' : '이동 초안 버리기'}
                </button>
              </div>
              <button
                type="button"
                disabled={busy}
                onClick={() => {
                  if (props.onItemOpen(draft.target.projectId, draft.target.original.id)) close();
                }}
              >
                WBS 상세의 명시 일정 편집으로 이동
              </button>
            </form>
          </dialog>
        )}
      </>
    ),
  };
}
