import { RefreshButton } from './ui-controls';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { z } from 'zod';
import { zWorkEntryFinal, type WorkEntryFinal } from '../shared/schema/work-entry';
import { zWorkExtend, zWorkPostpone } from '../shared/schema/work-reschedule';
import {
  readWorkDuplicate,
  rescheduleMatches,
  unchangedWorkFields,
  saveWorkReschedule,
  WorkFailure,
  workError,
  type RescheduleCommand,
} from './work-entry-api';
export const zRescheduleSelection = z.strictObject({
  entry: zWorkEntryFinal,
  intent: z.enum(['extend', 'postpone']),
  unresolved: z.boolean().default(false),
});
export type RescheduleSelection = z.output<typeof zRescheduleSelection>;
const zCommand = z.discriminatedUnion('intent', [
  z.strictObject({ intent: z.literal('extend'), input: zWorkExtend }),
  z.strictObject({ intent: z.literal('postpone'), input: zWorkPostpone }),
]);
const zDraft = z.strictObject({
  original: zWorkEntryFinal,
  intent: z.enum(['extend', 'postpone']),
  planned: z.string().max(10),
  due: z.string().max(10),
  changeDue: z.boolean(),
  reason: z.string().max(5000),
  command: zCommand.nullable(),
  result: zWorkEntryFinal.nullable(),
});
export function readRescheduleSelection(
  key: string,
  companyId: string,
): RescheduleSelection | null {
  try {
    const result = zRescheduleSelection.safeParse(
      JSON.parse(sessionStorage.getItem(key) ?? 'null'),
    );
    return result.success && result.data.entry.companyId === companyId ? result.data : null;
  } catch {
    return null;
  }
}
export function storeReschedule(key: string, value: unknown) {
  try {
    if (value === null) sessionStorage.removeItem(key);
    else sessionStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* Keep the in-memory form usable. */
  }
}
const labels = {
  todo: '미진행',
  doing: '진행 중',
  paused: '중단',
  done: '완료',
  canceled: '취소',
  planned: '예정',
};
export function WorkReschedule({
  selection,
  companyId,
  userId,
  online,
  onExpired,
  onForbidden,
  onObserved,
  onClose,
  onUnresolved,
}: {
  selection: RescheduleSelection;
  companyId: string;
  userId: string;
  online: boolean;
  onExpired: (e: unknown) => boolean;
  onForbidden: () => void;
  onObserved: (entry: WorkEntryFinal, confirmedSourceVersion?: number) => void;
  onClose: (keep: boolean) => void;
  onUnresolved: (value: boolean) => void;
}) {
  const key = `wt:reschedule:v1:${encodeURIComponent(userId)}:${companyId}:${selection.entry.id}:${selection.intent}`;
  const [draft, setDraft] = useState(() => {
    try {
      const saved = zDraft.safeParse(JSON.parse(sessionStorage.getItem(key) ?? 'null'));
      if (
        saved.success &&
        saved.data.original.companyId === companyId &&
        saved.data.original.id === selection.entry.id &&
        saved.data.intent === selection.intent
      )
        return saved.data;
    } catch {
      /* Invalid drafts never replace a server record. */
    }
    return {
      original: selection.entry,
      intent: selection.intent,
      planned: '',
      due: '',
      changeDue: false,
      reason: '',
      command: null,
      result: null,
    } as z.output<typeof zDraft>;
  });
  const current = useRef(draft);
  current.current = draft;
  const [pending, setPending] = useState(false),
    [error, setError] = useState(''),
    [notice, setNotice] = useState(''),
    [latest, setLatest] = useState<WorkEntryFinal | null>(null),
    [verified, setVerified] = useState<'matched' | 'unchanged' | 'different' | null>(null),
    [saved, setSaved] = useState<WorkEntryFinal | null>(draft.result);
  const revision = useRef(0),
    lock = useRef(false),
    heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    heading.current?.focus();
    return () => {
      revision.current++;
    };
  }, []);
  useEffect(() => {
    storeReschedule(key, draft);
  }, [key, draft]);
  useEffect(() => {
    onUnresolved(!!draft.command);
  }, [!!draft.command]);
  function failure(value: unknown) {
    storeReschedule(key, current.current);
    if (onExpired(value)) return true;
    if (value instanceof WorkFailure && value.status === 403) {
      onForbidden();
      return true;
    }
    return false;
  }
  const original = draft.original;
  function reflect(value: WorkEntryFinal, command: RescheduleCommand | null) {
    setLatest(value);
    if (command && rescheduleMatches(original, value, command)) {
      setVerified('matched');
      setNotice(
        '현재 일정에 요청한 날짜가 반영된 것을 확인했습니다. 명령 영수증이 아니며 저장 주체를 단정하지 않습니다.',
      );
      setDraft((old) => ({ ...old, command: null, result: value }));
      setSaved(value);
      onObserved(value);
    } else if (
      value.version === original.version &&
      unchangedWorkFields(original, value) &&
      value.plannedDate === original.plannedDate &&
      value.dueDate === original.dueDate
    ) {
      setVerified('unchanged');
      setNotice(
        '현재 버전과 일정이 변경 전과 같고 요청 날짜가 미반영임을 확인했습니다. 자동 재전송하지 않습니다.',
      );
    } else {
      setVerified('different');
      setNotice(
        '최신 기록의 버전이나 내용이 다릅니다. 후속 변경이 있을 수 있어 이 요청의 성공 여부를 단정하지 않습니다.',
      );
    }
  }
  async function check() {
    if (lock.current || !online) return;
    lock.current = true;
    setPending(true);
    setError('');
    const ticket = revision.current;
    try {
      const value = (await readWorkDuplicate(companyId, original.id)).entry;
      if (ticket === revision.current) reflect(value, draft.command);
    } catch (value) {
      if (ticket === revision.current && !failure(value)) setError(workError(value));
    } finally {
      if (ticket === revision.current) {
        lock.current = false;
        setPending(false);
      }
    }
  }
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (lock.current || !online || draft.command || saved) return;
    let command: RescheduleCommand;
    try {
      command =
        draft.intent === 'extend'
          ? {
              intent: 'extend',
              input: zWorkExtend.parse({
                version: original.version,
                newDueDate: draft.due,
                reason: draft.reason,
              }),
            }
          : {
              intent: 'postpone',
              input: zWorkPostpone.parse({
                version: original.version,
                newPlannedDate: draft.planned,
                ...(draft.changeDue ? { newDueDate: draft.due } : {}),
                reason: draft.reason,
              }),
            };
      if (
        (command.intent === 'extend' ? original.plannedDate : command.input.newPlannedDate) ===
          original.plannedDate &&
        (command.input.newDueDate ?? original.dueDate) === original.dueDate
      )
        throw new Error('현재와 같은 날짜입니다. 변경할 날짜를 입력해 주세요.');
    } catch (value) {
      setError(
        value instanceof z.ZodError
          ? '실제 달력 날짜와 사유 길이를 확인해 주세요.'
          : value instanceof Error
            ? value.message
            : '입력 내용을 확인해 주세요.',
      );
      return;
    }
    const next = { ...draft, command };
    setDraft(next);
    current.current = next;
    storeReschedule(key, next);
    setVerified(null);
    setLatest(null);
    setError('');
    setNotice('');
    lock.current = true;
    setPending(true);
    const ticket = revision.current;
    try {
      const value = await saveWorkReschedule(companyId, original, command);
      if (ticket !== revision.current) return;
      setSaved(value);
      setLatest(value);
      setDraft((old) => ({ ...old, command: null, result: value }));
      setNotice(
        draft.intent === 'extend'
          ? '마감기한만 변경했습니다. 예정일·상태·업무 ID를 유지했습니다.'
          : '업무 일정을 변경했습니다. 상태·업무 ID를 유지했습니다.',
      );
      onObserved(value, command.input.version);
    } catch (value) {
      if (ticket !== revision.current || failure(value)) return;
      setError(workError(value));
      if (value instanceof WorkFailure && [400, 422].includes(value.status)) {
        setDraft((old) => ({ ...old, command: null }));
      } else {
        try {
          const latest = (await readWorkDuplicate(companyId, original.id)).entry;
          if (ticket === revision.current) reflect(latest, command);
        } catch (checkFailure) {
          if (ticket === revision.current && !failure(checkFailure))
            setError(workError(checkFailure));
        }
      }
    } finally {
      if (ticket === revision.current) {
        lock.current = false;
        setPending(false);
      }
    }
  }
  const action = draft.intent === 'extend' ? '마감 연장' : '업무 미루기';
  const disabled = pending || !online || !!draft.command || !!saved;
  return (
    <section className="work-reschedule work-history" aria-label={`${action} 검토`}>
      <h3 ref={heading} tabIndex={-1}>
        {action} 검토 · {original.title}
      </h3>
      <p>같은 업무를 변경합니다. 새 ID를 만들거나 상태를 바꾸지 않습니다.</p>
      <dl className="reschedule-current">
        <dt>검토 기준 예정일</dt>
        <dd>{original.plannedDate ?? '날짜 미정'}</dd>
        <dt>검토 기준 마감기한</dt>
        <dd>{original.dueDate ?? '없음'}</dd>
        <dt>검토 기준 상태</dt>
        <dd>
          {labels[original.status]}
          {original.status === 'paused'
            ? ` · ${original.resumeStatus === 'doing' ? '진행 중' : '미진행'}으로 재개 가능 · 자동 재개·이월 없음`
            : ''}
        </dd>
        <dt>검토 기준 버전</dt>
        <dd>{original.version}</dd>
      </dl>
      {original.endDate && (
        <p>
          기간 종료일 {original.endDate}은 자동 이동하지 않습니다. 새 예정일은 이 종료일을 넘길 수
          없습니다.
        </p>
      )}
      {original.timeMode === 'exact' && (
        <p>
          정확 시각은 그대로 보존합니다. 미루기에서 다른 날짜를 입력하면 기존 한국 시각 시작일과
          충돌할 수 있습니다. 전체 시각 조정은 기존 일정 편집을 사용하세요.
        </p>
      )}
      {!online && <p role="status">오프라인 읽기 전용입니다. 일정 변경 초안을 유지합니다.</p>}
      {error && (
        <p className="form-message" role="alert">
          {error}
        </p>
      )}
      {notice && <p role="status">{notice}</p>}
      <form onSubmit={submit}>
        <fieldset disabled={disabled}>
          <legend>{action} 입력</legend>
          {draft.intent === 'postpone' && (
            <>
              <label>
                새 예정일
                <input
                  type="date"
                  required
                  value={draft.planned}
                  onChange={(e) => setDraft({ ...draft, planned: e.target.value })}
                />
              </label>
              <label className="workspace-check">
                <input
                  type="checkbox"
                  checked={draft.changeDue}
                  onChange={(e) => setDraft({ ...draft, changeDue: e.target.checked })}
                />
                마감기한도 변경
              </label>
              {!draft.changeDue && (
                <p>마감기한을 보내지 않고 현재 값({original.dueDate ?? '없음'})을 유지합니다.</p>
              )}
            </>
          )}
          {(draft.intent === 'extend' || draft.changeDue) && (
            <label>
              새 마감기한
              <input
                type="date"
                required
                value={draft.due}
                onChange={(e) => setDraft({ ...draft, due: e.target.value })}
              />
            </label>
          )}
          <label>
            일정 변경 사유
            <textarea
              maxLength={5000}
              value={draft.reason}
              onChange={(e) => setDraft({ ...draft, reason: e.target.value })}
            />
          </label>
          <p>사유는 선택 사항입니다. 입력한 공백과 내용을 그대로 보냅니다.</p>
          <button type="submit">{action} 저장</button>
        </fieldset>
      </form>
      {draft.command && (
        <section aria-label="일정 변경 결과 확인">
          <p>저장 결과를 확인하는 동안 입력·원래 버전을 보관하고 재제출을 잠급니다.</p>
          <RefreshButton
            type="button"
            disabled={pending || !online}
            onClick={() => void check()}
            busy={pending}
            showLabel
          >
            일정 변경 결과 다시 확인
          </RefreshButton>
          {verified === 'unchanged' && (
            <button
              type="button"
              disabled={pending || !online}
              onClick={() => {
                setDraft((old) => ({ ...old, command: null }));
                setVerified(null);
                setNotice('원래 버전과 입력을 유지했습니다. 다시 검토하고 직접 저장하세요.');
              }}
            >
              같은 버전으로 일정 재시도 준비
            </button>
          )}
        </section>
      )}
      {latest && (
        <section aria-label="최신 일정 비교">
          <h4>최신 일정</h4>
          <p>
            {latest.title} · 예정일 {latest.plannedDate ?? '날짜 미정'} · 마감{' '}
            {latest.dueDate ?? '없음'} · {labels[latest.status]} · 버전 {latest.version}
          </p>
          {verified === 'different' && (
            <>
              <p>
                최신 일정과 저장 이력을 별도로 확인하세요. 현재 확인은 안전한 스냅샷만 사용합니다.
              </p>
              <button
                type="button"
                disabled={
                  pending ||
                  !online ||
                  latest.kind !== 'task' ||
                  !['todo', 'doing', 'paused'].includes(latest.status)
                }
                onClick={() => {
                  setDraft((old) => ({ ...old, original: latest, command: null }));
                  setVerified(null);
                  setLatest(null);
                  setError('');
                  setNotice(
                    '입력을 유지하고 최신 버전을 선택했습니다. 상태와 날짜를 다시 검토하고 직접 저장하세요.',
                  );
                }}
              >
                일정 입력 유지하고 최신 버전 선택
              </button>
            </>
          )}
        </section>
      )}
      {saved && (
        <p>
          확인한 일정: 예정일 {saved.plannedDate ?? '날짜 미정'} · 마감 {saved.dueDate ?? '없음'} ·{' '}
          {labels[saved.status]}
        </p>
      )}
      {saved && (
        <button
          type="button"
          disabled={pending || !online}
          onClick={async () => {
            if (lock.current) return;
            lock.current = true;
            setPending(true);
            const ticket = revision.current;
            try {
              const value = (await readWorkDuplicate(companyId, original.id)).entry;
              if (ticket !== revision.current) return;
              if (value.kind !== 'task' || !['todo', 'doing', 'paused'].includes(value.status)) {
                setError('현재 업무는 연장·미루기를 지원하는 미완성 업무가 아닙니다.');
                return;
              }
              setDraft({
                original: value,
                intent: draft.intent,
                planned: '',
                due: '',
                changeDue: false,
                reason: '',
                command: null,
                result: null,
              });
              setSaved(null);
              setLatest(null);
              setVerified(null);
              setError('');
              setNotice('현재 버전으로 새 일정 변경 초안을 준비했습니다. 직접 저장하세요.');
            } catch (value) {
              if (ticket === revision.current && !failure(value)) setError(workError(value));
            } finally {
              if (ticket === revision.current) {
                lock.current = false;
                setPending(false);
              }
            }
          }}
        >
          새 일정 변경 준비
        </button>
      )}
      <button
        type="button"
        disabled={pending}
        onClick={() => {
          storeReschedule(key, current.current);
          onClose(!!draft.command);
        }}
      >
        일정 검토 닫기 · 초안 유지
      </button>
    </section>
  );
}
