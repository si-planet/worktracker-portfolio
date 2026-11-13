import { HelpHint } from './help-hint';
import { displayWeekLabel } from './calendar-display';
import { RefreshButton } from './ui-controls';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { z } from 'zod';
import { zWorkEntryFinal, zWorkEntryDate, type WorkEntryFinal } from '../shared/schema/work-entry';
import { isoWeekForDate, weekCalendar } from '../shared/week-calendar';
import {
  WorkFailure,
  workApi,
  workError,
  unchangedWorkFields,
  carryoverCandidates,
  carryoverMatches,
  readCarryoverSnapshot,
  saveWorkCarryover,
} from './work-entry-api';
import {
  zWorkCarryover,
  type WorkCarryover,
  type WorkCarryoverSnapshot,
} from '../shared/schema/work-carryover';

const statuses = {
  todo: '미진행',
  doing: '진행 중',
  paused: '중단',
  planned: '예정',
  done: '완료',
  canceled: '취소',
};
/** Calendar arithmetic only; reject dates outside the existing app/ISO domain. */
export function carryoverOffset(date: string, days: number) {
  try {
    if (!Number.isSafeInteger(days)) return null;
    const at = Date.parse(`${zWorkEntryDate.parse(date)}T00:00:00Z`);
    const target = new Date(at + days * 86400000).toISOString().slice(0, 10);
    const week = isoWeekForDate(target);
    weekCalendar(week.isoYear, week.isoWeek);
    return target;
  } catch {
    return null;
  }
}
function storage(key: string, value: unknown) {
  try {
    sessionStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* Optional storage. */
  }
}
const zProfile = z.strictObject({
  userId: z.string().min(1).max(128),
  username: z.string().min(1).max(32),
  email: z.email(),
  emailVerified: z.literal(true),
  lastCompanyId: z.uuid().nullable(),
  capabilities: z.strictObject({ manageSignup: z.boolean() }).optional(),
});

export function WorkCarryover({
  companyId,
  date,
  online,
  disabled,
  onExpired,
  onChanged,
  onSelectDate,
}: {
  companyId: string;
  date: string;
  online: boolean;
  disabled: boolean;
  onExpired: (failure: unknown) => boolean;
  onChanged: () => void;
  onSelectDate: (date: string) => void;
}) {
  const [identity, setIdentity] = useState<string | null>(null),
    [error, setError] = useState(''),
    [reload, setReload] = useState(0);
  useEffect(() => {
    let active = true;
    setError('');
    if (!online) return;
    void workApi('/api/me', zProfile)
      .then((p) => {
        if (active) setIdentity(p.userId);
      })
      .catch((e) => {
        if (active && !onExpired(e)) setError(workError(e));
      });
    return () => {
      active = false;
    };
  }, [companyId, reload, online]);
  return (
    <section className="work-carryover" aria-label="명시 이월 검토">
      <h3>명시 이월 검토</h3>
      <p>
        미완료 업무를 한 건씩 직접 이월합니다. 같은 ID와 상태를 유지하며 이전 주의 미완료 결과를
        보존합니다. 자동 이월·자동 재개·새 회차 생성은 하지 않습니다.
      </p>
      {error && <p role="alert">{error}</p>}
      {!identity && (
        <>
          <p>본인 정보를 확인한 뒤 보관한 초안을 엽니다.</p>
          <RefreshButton type="button" disabled={!online} onClick={() => setReload((n) => n + 1)}>
            이월 본인 정보 다시 확인
          </RefreshButton>
        </>
      )}
      {identity && (
        <CarryoverEditor
          key={`${identity}:${companyId}`}
          companyId={companyId}
          userId={identity}
          date={date}
          online={online}
          disabled={disabled}
          onExpired={onExpired}
          onChanged={onChanged}
          onSelectDate={onSelectDate}
        />
      )}
    </section>
  );
}

const zDraft = z.strictObject({
  source: zWorkEntryFinal.nullable(),
  targetDate: z.string().max(10),
  reason: z.string().max(5000),
  command: zWorkCarryover.nullable(),
  result: zWorkEntryFinal.nullable(),
});
const blank = () => ({ source: null, targetDate: '', reason: '', command: null, result: null });
function readDraft(key: string, companyId: string): z.output<typeof zDraft> {
  try {
    const r = zDraft.safeParse(JSON.parse(sessionStorage.getItem(key) ?? 'null'));
    if (
      r.success &&
      (!r.data.source || r.data.source.companyId === companyId) &&
      (!r.data.result || r.data.result.companyId === companyId)
    )
      return r.data;
  } catch {
    /* Invalid session data is ignored. */
  }
  return blank();
}
function CarryoverEditor({
  companyId,
  userId,
  date,
  online,
  disabled,
  onExpired,
  onChanged,
  onSelectDate,
}: {
  companyId: string;
  userId: string;
  date: string;
  online: boolean;
  disabled: boolean;
  onExpired: (e: unknown) => boolean;
  onChanged: () => void;
  onSelectDate: (date: string) => void;
}) {
  const key = `wt:carryover:v1:${encodeURIComponent(userId)}:${companyId}`;
  const [draft, setDraft] = useState(() => readDraft(key, companyId)),
    [items, setItems] = useState<WorkEntryFinal[]>([]),
    [cursor, setCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(false),
    [pending, setPending] = useState(false),
    [denied, setDenied] = useState(false),
    [error, setError] = useState(''),
    [notice, setNotice] = useState(''),
    [reload, setReload] = useState(0);
  const [latest, setLatest] = useState<WorkCarryoverSnapshot | null>(null),
    [verified, setVerified] = useState<'matched' | 'unchanged' | 'different' | null>(null);
  const revision = useRef(0),
    operation = useRef(0),
    lock = useRef(false),
    seen = useRef(new Set<string>()),
    heading = useRef<HTMLHeadingElement>(null);
  const current = useRef(draft);
  current.current = draft;
  const scope = (() => {
    try {
      const w = isoWeekForDate(date);
      return weekCalendar(w.isoYear, w.isoWeek);
    } catch {
      return null;
    }
  })();
  const scopeKey = scope ? `${companyId}/${scope.isoYear}/${scope.isoWeek}` : '';
  useEffect(() => {
    storage(key, draft);
  }, [key, draft]);
  useEffect(() => {
    heading.current?.focus();
    return () => {
      operation.current++;
    };
  }, []);
  function fail(value: unknown) {
    storage(key, current.current);
    if (onExpired(value)) return true;
    if (value instanceof WorkFailure && value.status === 403) {
      revision.current++;
      setDenied(true);
      setItems([]);
      setLatest(null);
      setError('이 회사의 이월 기록에 접근할 수 없습니다. 입력은 계정별 초안에 보관합니다.');
      return true;
    }
    return false;
  }
  async function load(more = false) {
    const ticket = ++revision.current;
    setError('');
    if (!scope || !online || !navigator.onLine || denied) {
      setLoading(false);
      return;
    }
    setLoading(true);
    if (!more) {
      setItems([]);
      setCursor(null);
      seen.current.clear();
    }
    const query = new URLSearchParams({
      dateState: 'scheduled',
      from: scope.weekStart,
      to: scope.weekEnd,
      limit: '50',
    });
    if (more && cursor) query.set('cursor', cursor);
    try {
      const result = await carryoverCandidates(companyId, query);
      if (ticket !== revision.current) return;
      if (result.nextCursor && seen.current.has(result.nextCursor))
        throw new WorkFailure(0, 'INVALID_RESPONSE');
      if (result.nextCursor) seen.current.add(result.nextCursor);
      setItems((old) =>
        more
          ? [...old, ...result.items.filter((e) => !old.some((x) => x.id === e.id))]
          : result.items,
      );
      setCursor(result.nextCursor);
    } catch (e) {
      if (ticket === revision.current && !fail(e)) setError(workError(e));
    } finally {
      if (ticket === revision.current) setLoading(false);
    }
  }
  useEffect(() => {
    void load();
    return () => {
      revision.current++;
    };
  }, [scopeKey, reload, online]);
  const source = draft.source;
  function reflect(snapshot: WorkCarryoverSnapshot, command: WorkCarryover) {
    if (!source) return;
    setLatest(snapshot);
    const target = isoWeekForDate(command.newPlannedDate),
      m = snapshot.membership;
    if (
      carryoverMatches(source, snapshot.entry, command) &&
      m &&
      m.sourceVersion === snapshot.entry.version &&
      m.isoYear === target.isoYear &&
      m.isoWeek === target.isoWeek &&
      m.isCarriedOver &&
      !m.finalized
    ) {
      setVerified('matched');
      setNotice(
        '현재 업무의 요청 날짜와 목적 주 이월 소속이 반영된 것을 확인했습니다. 명령 영수증이 아니며 저장 주체를 단정하지 않습니다.',
      );
      setDraft((old) => ({ ...old, command: null, result: snapshot.entry }));
    } else if (
      snapshot.entry.version === source.version &&
      unchangedWorkFields(source, snapshot.entry) &&
      snapshot.entry.plannedDate === source.plannedDate &&
      snapshot.entry.dueDate === source.dueDate
    ) {
      setVerified('unchanged');
      setNotice(
        '현재 업무와 버전이 변경 전과 같습니다. 자동 재전송하지 않습니다. 원래 입력과 버전을 유지해 직접 재시도할 수 있습니다.',
      );
    } else {
      setVerified('different');
      setNotice(
        '후속 버전이나 목적 주 소속이 다르거나 확정되었습니다. 이 요청의 성공 여부를 단정하지 않습니다. 입력과 최신 상태를 비교해 주세요.',
      );
    }
  }
  async function check() {
    if (lock.current || !online || !source || !draft.command || denied) return;
    lock.current = true;
    setPending(true);
    setError('');
    const ticket = operation.current;
    try {
      const result = await readCarryoverSnapshot(companyId, source.id);
      if (ticket === operation.current) reflect(result, draft.command);
    } catch (e) {
      if (ticket === operation.current && !fail(e)) setError(workError(e));
    } finally {
      if (ticket === operation.current) {
        lock.current = false;
        setPending(false);
      }
    }
  }
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (lock.current || !online || disabled || denied || !source || draft.command || draft.result)
      return;
    let input: WorkCarryover;
    try {
      input = zWorkCarryover.parse({
        version: source.version,
        newPlannedDate: draft.targetDate,
        reason: draft.reason,
      });
      if (!source.plannedDate || input.newPlannedDate <= source.plannedDate)
        throw new Error('현재 예정일보다 늦은 날짜를 선택해 주세요.');
      const w = isoWeekForDate(input.newPlannedDate);
      weekCalendar(w.isoYear, w.isoWeek);
    } catch (e) {
      setError(
        e instanceof z.ZodError
          ? '실제 달력 날짜와 사유 길이를 확인해 주세요.'
          : e instanceof Error
            ? e.message
            : '입력을 확인해 주세요.',
      );
      return;
    }
    const next = { ...draft, command: input };
    setDraft(next);
    current.current = next;
    storage(key, next);
    setLatest(null);
    setVerified(null);
    setNotice('');
    setError('');
    lock.current = true;
    setPending(true);
    const ticket = operation.current;
    try {
      const result = await saveWorkCarryover(companyId, source, input);
      if (ticket !== operation.current) return;
      setDraft((old) => ({ ...old, command: null, result: result.entry }));
      setNotice(
        '업무를 이월했습니다. 같은 ID와 상태를 유지하고 목적 주 계획에 연결했습니다. 이전 주의 미완료 결과는 보존됩니다.',
      );
      onChanged();
      setReload((n) => n + 1);
    } catch (e) {
      if (ticket !== operation.current || fail(e)) return;
      setError(workError(e));
      if (e instanceof WorkFailure && [400, 422].includes(e.status)) {
        setDraft((old) => ({ ...old, command: null }));
      } else {
        try {
          const snapshot = await readCarryoverSnapshot(companyId, source.id);
          if (ticket === operation.current) reflect(snapshot, input);
        } catch (f) {
          if (ticket === operation.current && !fail(f)) setError(workError(f));
        }
      }
    } finally {
      if (ticket === operation.current) {
        lock.current = false;
        setPending(false);
      }
    }
  }
  const busy = disabled || pending || !online || denied,
    locked = busy || !!draft.command || !!draft.result;
  let targetWeek: string | null = null;
  try {
    const w = isoWeekForDate(draft.targetDate);
    weekCalendar(w.isoYear, w.isoWeek);
    targetWeek = `${w.isoYear}년 ${w.isoWeek}주`;
  } catch {
    /* Draft dates may be incomplete. */
  }
  if (denied)
    return (
      <>
        <p role="alert">{error}</p>
        <a className="control-link" href="/">
          회사 선택으로 돌아가기
        </a>
      </>
    );
  return (
    <>
      <h4 ref={heading} tabIndex={-1}>
        미완료 이월 후보 · {scope ? displayWeekLabel(date) : '조회 범위 없음'}
      </h4>
      <HelpHint label="연장 후보 범위">
        이 주와 예정 기간이 겹치는 회사 전체의 미완료 업무·회의·외근입니다. 달력 검색 조건은
        적용하지 않습니다. 날짜 미정 업무는 먼저 날짜를 배정해 주세요.
      </HelpHint>
      {!online && (
        <p role="status">오프라인 읽기 전용입니다. 이월 초안을 유지하며 자동 저장하지 않습니다.</p>
      )}
      {error && <p role="alert">{error}</p>}
      {notice && <p role="status">{notice}</p>}
      <RefreshButton
        type="button"
        disabled={busy || loading || !!draft.command}
        onClick={() => setReload((n) => n + 1)}
        busy={loading || !!busy}
      >
        이월 후보 다시 조회
      </RefreshButton>
      {loading && <p role="status">이월 후보를 불러오고 있습니다.</p>}
      {!loading && !items.length && !cursor && <p>이 주의 이월 후보가 없습니다.</p>}
      <ul aria-label="미완료 이월 후보 목록" className="work-list">
        {items.map((entry) => (
          <li className="work-card" key={entry.id}>
            <h4>{entry.title}</h4>
            <p>
              {entry.plannedDate} · {statuses[entry.status]} · 버전 {entry.version}
            </p>
            {entry.status === 'paused' && (
              <p>
                중단 유지 · 자동 재개 없음 · {entry.resumeStatus === 'doing' ? '진행 중' : '미진행'}
                으로 명시 재개 가능
              </p>
            )}
            <button
              type="button"
              aria-label={`이월 선택: ${entry.title}`}
              disabled={busy || !!source}
              onClick={() => {
                setDraft({ ...blank(), source: entry });
                setError('');
                setNotice('');
                setLatest(null);
                setVerified(null);
              }}
            >
              이월 선택
            </button>
          </li>
        ))}
      </ul>
      {cursor && (
        <button
          type="button"
          disabled={busy || loading || !!draft.command}
          onClick={() => void load(true)}
        >
          이월 후보 더 보기
        </button>
      )}
      {source && (
        <section aria-label="이월 업무 검토" className="carryover-review">
          <h4>{source.title}</h4>
          <dl>
            <dt>현재 예정일</dt>
            <dd>{source.plannedDate ?? '날짜 미정'}</dd>
            <dt>현재 마감기한</dt>
            <dd>{source.dueDate ?? '없음'}</dd>
            <dt>현재 상태</dt>
            <dd>
              {statuses[source.status]}
              {source.status === 'paused'
                ? ` · ${source.resumeStatus === 'doing' ? '진행 중' : '미진행'}으로 명시 재개 가능 · 자동 재개 없음`
                : ''}
            </dd>
            <dt>기준 버전</dt>
            <dd>{source.version}</dd>
          </dl>
          <p>
            마감기한·종료일·정확 시각은 그대로 유지합니다. 기간 종료일 뒤 또는 정확 시각의 다른
            날짜로 이동하면 기존 일정 검증에 따라 거부됩니다. 이미 끝났거나 확정된 목적 주에는
            이월할 수 없습니다.
          </p>
          <form onSubmit={submit}>
            <fieldset disabled={locked}>
              <legend>이월 날짜와 사유</legend>
              <div className="work-actions">
                <button
                  type="button"
                  disabled={!source.plannedDate || !carryoverOffset(source.plannedDate, 1)}
                  onClick={() => {
                    if (source.plannedDate) {
                      const d = carryoverOffset(source.plannedDate, 1);
                      if (d) setDraft({ ...draft, targetDate: d });
                    }
                  }}
                >
                  다음 날 선택
                </button>
                <button
                  type="button"
                  disabled={!source.plannedDate || !carryoverOffset(source.plannedDate, 7)}
                  onClick={() => {
                    if (source.plannedDate) {
                      const d = carryoverOffset(source.plannedDate, 7);
                      if (d) setDraft({ ...draft, targetDate: d });
                    }
                  }}
                >
                  다음 주 선택
                </button>
              </div>
              <HelpHint label="날짜 단축 선택">
                다음 날은 현재 예정일 +1일, 다음 주는 +7일입니다. 선택은 입력만 바꾸며 저장하지
                않습니다.
              </HelpHint>
              <label>
                이월할 날짜
                <input
                  type="date"
                  required
                  value={draft.targetDate}
                  onChange={(e) => setDraft({ ...draft, targetDate: e.target.value })}
                />
              </label>
              {targetWeek && <p>목적 주: {targetWeek} · 한국 시간</p>}
              <label>
                이월 사유
                <textarea
                  maxLength={5000}
                  value={draft.reason}
                  onChange={(e) => setDraft({ ...draft, reason: e.target.value })}
                />
              </label>
              <HelpHint label="변경 사유">
                사유는 선택 사항이며 입력한 공백과 내용을 그대로 보냅니다.
              </HelpHint>
              <button type="submit">업무 이월 저장</button>
            </fieldset>
          </form>
          {draft.command && (
            <section aria-label="이월 결과 확인">
              <p>결과가 불명확한 동안 원래 ID·버전·입력을 보관하고 재제출을 잠급니다.</p>
              <RefreshButton
                type="button"
                disabled={busy}
                onClick={() => void check()}
                busy={!!busy}
                showLabel
              >
                이월 결과 다시 확인
              </RefreshButton>
              {verified === 'unchanged' && (
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => {
                    setDraft((old) => ({ ...old, command: null }));
                    setVerified(null);
                    setError('');
                    setNotice('원래 버전과 입력을 유지했습니다. 다시 검토하고 직접 저장하세요.');
                  }}
                >
                  같은 버전으로 이월 재시도 준비
                </button>
              )}
            </section>
          )}
          {latest && (
            <section aria-label="최신 이월 상태">
              <h4>최신 업무·계획 소속</h4>
              <p>
                {latest.entry.title} · 예정일 {latest.entry.plannedDate ?? '날짜 미정'} ·{' '}
                {statuses[latest.entry.status]} · 버전 {latest.entry.version}
              </p>
              <p>
                {latest.membership
                  ? `${latest.membership.isoYear}년 ${latest.membership.isoWeek}주 · 소속 버전 ${latest.membership.sourceVersion} · ${latest.membership.isCarriedOver ? '이월 표시 있음' : '이월 표시 없음'} · ${latest.membership.finalized ? '확정' : '미확정'}`
                  : '현재 예정 주 소속을 확인할 수 없습니다.'}
              </p>
              {verified === 'different' && (
                <button
                  type="button"
                  disabled={
                    busy ||
                    !latest.entry.plannedDate ||
                    !['todo', 'doing', 'paused', 'planned'].includes(latest.entry.status)
                  }
                  onClick={() => {
                    setDraft((old) => ({
                      ...old,
                      source: latest.entry,
                      command: null,
                      result: null,
                    }));
                    setLatest(null);
                    setVerified(null);
                    setError('');
                    setNotice(
                      '입력을 유지하고 최신 버전을 선택했습니다. 현재 날짜와 상태를 다시 검토하고 직접 저장하세요.',
                    );
                  }}
                >
                  이월 입력 유지하고 최신 버전 선택
                </button>
              )}
            </section>
          )}
          {draft.result && (
            <>
              <p>
                확인한 이월 날짜: {draft.result.plannedDate} · {statuses[draft.result.status]} ·
                버전 {draft.result.version}
              </p>
              <button
                type="button"
                disabled={busy}
                onClick={() => draft.result?.plannedDate && onSelectDate(draft.result.plannedDate)}
              >
                이월 날짜 보기
              </button>
              <p>
                날짜를 열면 현재 목록과 해당 주 보고를 다시 조회할 수 있습니다. 이미 확정된 이전 주
                보고는 보존됩니다.
              </p>
            </>
          )}
          <button
            type="button"
            disabled={busy || !!draft.command}
            onClick={() => {
              setDraft(blank());
              setLatest(null);
              setVerified(null);
              setError('');
              setNotice('');
            }}
          >
            다른 이월 업무 선택 · 초안 비우기
          </button>
        </section>
      )}
    </>
  );
}
