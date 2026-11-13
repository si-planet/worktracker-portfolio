import { displayWeekLabel } from './calendar-display';
import { RefreshButton } from './ui-controls';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { z } from 'zod';
import { zWorkEntryFinal, type WorkEntryFinal } from '../shared/schema/work-entry';
import {
  zDeadlinePlacement,
  type DeadlinePlacement as PlacementInput,
  type DeadlinePlacementSnapshot,
  type DeadlineList,
} from '../shared/schema/deadline-placement';
import { isoWeekForDate, weekCalendar } from '../shared/week-calendar';
import { kstDate } from '../shared/work-entry-rules';
import {
  WorkFailure,
  workApi,
  workError,
  unchangedWorkFields,
  deadlineList,
  deadlinePlacementMatches,
  readDeadlinePlacement,
  saveDeadlinePlacement,
} from './work-entry-api';

const statuses = {
  todo: '미진행',
  doing: '진행 중',
  paused: '중단',
  planned: '예정',
  done: '완료',
  canceled: '취소',
};
const weekdays = ['월', '화', '수', '목', '금', '토', '일'];
const eligible = (entry: WorkEntryFinal) =>
  entry.kind === 'task' &&
  ['todo', 'doing', 'paused'].includes(entry.status) &&
  entry.dueDate !== null;
function calendar(date: string) {
  try {
    const w = isoWeekForDate(date);
    return weekCalendar(w.isoYear, w.isoWeek);
  } catch {
    return null;
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
function store(key: string, value: unknown) {
  try {
    sessionStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* Optional storage. */
  }
}
const zDraft = z.strictObject({
  source: zWorkEntryFinal.nullable(),
  date: z.string().max(10),
  command: zDeadlinePlacement.nullable(),
  result: zWorkEntryFinal.nullable(),
});
const blank = () => ({ source: null, date: '', command: null, result: null });
function readDraft(key: string, company: string): z.output<typeof zDraft> {
  try {
    const r = zDraft.safeParse(JSON.parse(sessionStorage.getItem(key) ?? 'null'));
    if (
      r.success &&
      (!r.data.source || r.data.source.companyId === company) &&
      (!r.data.result || r.data.result.companyId === company)
    )
      return r.data;
  } catch {
    /* Invalid drafts never replace a record. */
  }
  return blank();
}

export function DeadlinePlacement({
  companyId,
  date,
  online,
  disabled,
  refresh,
  onExpired,
  onChanged,
  onSelectDate,
}: {
  companyId: string;
  date: string;
  online: boolean;
  disabled: boolean;
  refresh: number;
  onExpired: (e: unknown) => boolean;
  onChanged: () => void;
  onSelectDate: (date: string) => void;
}) {
  const [userId, setUserId] = useState<string | null>(null),
    [error, setError] = useState(''),
    [retry, setRetry] = useState(0);
  useEffect(() => {
    let active = true;
    if (!online) return;
    setError('');
    void workApi('/api/me', zProfile)
      .then((v) => {
        if (active) setUserId(v.userId);
      })
      .catch((e) => {
        if (active && !onExpired(e)) setError(workError(e));
      });
    return () => {
      active = false;
    };
  }, [companyId, online, retry]);
  return (
    <section className="deadline-placement" aria-label="마감예정">
      <h3>마감예정</h3>
      <p>
        기한이 이 주에 속하는 업무를 자동으로 표시합니다. 조회만으로 업무를 복제하거나
        날짜·계획·이력·집계 분모를 추가하지 않습니다. 이미 계획된 업무는 기존 집계 규칙을 따릅니다.
      </p>
      {error && <p role="alert">{error}</p>}
      {!userId && (
        <>
          <p>마감예정과 계정별 배치 초안을 준비하고 있습니다.</p>
          <RefreshButton type="button" disabled={!online} onClick={() => setRetry((n) => n + 1)}>
            마감예정 본인 정보 다시 확인
          </RefreshButton>
        </>
      )}
      {userId && (
        <DeadlineEditor
          key={`${userId}:${companyId}`}
          companyId={companyId}
          userId={userId}
          date={date}
          online={online}
          disabled={disabled}
          refresh={refresh}
          onExpired={onExpired}
          onChanged={onChanged}
          onSelectDate={onSelectDate}
        />
      )}
    </section>
  );
}
function DeadlineEditor({
  companyId,
  userId,
  date,
  online,
  disabled,
  refresh,
  onExpired,
  onChanged,
  onSelectDate,
}: {
  companyId: string;
  userId: string;
  date: string;
  online: boolean;
  disabled: boolean;
  refresh: number;
  onExpired: (e: unknown) => boolean;
  onChanged: () => void;
  onSelectDate: (date: string) => void;
}) {
  const key = `wt:deadline-placement:v1:${encodeURIComponent(userId)}:${companyId}`;
  const [draft, setDraft] = useState(() => readDraft(key, companyId)),
    [rows, setRows] = useState<DeadlineList['items']>([]),
    [cursor, setCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(false),
    [pending, setPending] = useState(false),
    [denied, setDenied] = useState(false),
    [error, setError] = useState(''),
    [notice, setNotice] = useState(''),
    [reload, setReload] = useState(0),
    [filter, setFilter] = useState<'active' | 'canceled'>('active');
  const [latest, setLatest] = useState<DeadlinePlacementSnapshot | null>(null),
    [verified, setVerified] = useState<'matched' | 'unchanged' | 'different' | null>(null);
  const revision = useRef(0),
    operation = useRef(0),
    lock = useRef(false),
    seen = useRef(new Set<string>()),
    heading = useRef<HTMLHeadingElement>(null),
    current = useRef(draft);
  current.current = draft;
  const scope = calendar(date),
    scopeKey = scope ? `${companyId}/${scope.isoYear}/${scope.isoWeek}/${filter}` : '';
  const [displayed, setDisplayed] = useState('');
  const shown = displayed === scopeKey ? rows : [];
  useEffect(() => {
    store(key, draft);
  }, [key, draft]);
  useEffect(
    () => () => {
      operation.current++;
    },
    [],
  );
  useEffect(() => {
    if (draft.source) heading.current?.focus();
  }, [draft.source?.id]);
  function fail(value: unknown) {
    store(key, current.current);
    if (onExpired(value)) return true;
    if (value instanceof WorkFailure && value.status === 403) {
      revision.current++;
      setDenied(true);
      setRows([]);
      setLatest(null);
      setError('이 회사의 마감예정 기록에 접근할 수 없습니다. 입력은 계정별 초안에 보관합니다.');
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
      setRows([]);
      setCursor(null);
      setDisplayed('');
      seen.current.clear();
    }
    const query = new URLSearchParams({ limit: '50' });
    if (filter === 'canceled') query.append('statuses', 'canceled');
    if (more && cursor) query.set('cursor', cursor);
    try {
      const value = await deadlineList(companyId, scope.isoYear, scope.isoWeek, query);
      if (ticket !== revision.current) return;
      if (value.nextCursor && seen.current.has(value.nextCursor))
        throw new WorkFailure(0, 'INVALID_RESPONSE');
      if (value.nextCursor) seen.current.add(value.nextCursor);
      setRows((old) =>
        more
          ? [...old, ...value.items.filter((i) => !old.some((x) => x.entry.id === i.entry.id))]
          : value.items,
      );
      setCursor(value.nextCursor);
      setDisplayed(scopeKey);
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
  }, [scopeKey, reload, refresh, online]);
  const source = draft.source,
    selectedWeek = source?.dueDate ? calendar(source.dueDate) : null;
  function reflect(snapshot: DeadlinePlacementSnapshot, command: PlacementInput) {
    if (!source) return;
    setLatest(snapshot);
    const w = isoWeekForDate(command.plannedDate),
      m = snapshot.membership;
    if (
      deadlinePlacementMatches(source, snapshot.entry, command) &&
      m &&
      m.isoYear === w.isoYear &&
      m.isoWeek === w.isoWeek &&
      m.sourceVersion === snapshot.entry.version &&
      !m.finalized
    ) {
      setVerified('matched');
      setDraft((old) => ({ ...old, command: null, result: snapshot.entry }));
      setNotice(
        '현재 업무의 요청 날짜와 목적 주 계획 소속이 반영된 것을 확인했습니다. 명령 영수증이 아니며 저장 주체를 단정하지 않습니다.',
      );
    } else if (
      snapshot.entry.version === source.version &&
      unchangedWorkFields(source, snapshot.entry) &&
      snapshot.entry.plannedDate === source.plannedDate &&
      snapshot.entry.dueDate === source.dueDate
    ) {
      setVerified('unchanged');
      setNotice(
        '현재 업무와 버전이 변경 전과 같습니다. 원래 입력과 버전을 보관하며 자동 재전송하지 않습니다.',
      );
    } else {
      setVerified('different');
      setNotice(
        '후속 버전이나 목적 주 계획 소속이 다르거나 확정되었습니다. 이 요청의 성공 여부를 단정하지 않습니다. 입력과 최신 상태를 비교해 주세요.',
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
      const value = await readDeadlinePlacement(companyId, source.id);
      if (ticket === operation.current) reflect(value, draft.command);
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
    let input: PlacementInput;
    try {
      input = zDeadlinePlacement.parse({ version: source.version, plannedDate: draft.date });
      if (
        !selectedWeek ||
        input.plannedDate < selectedWeek.weekStart ||
        input.plannedDate > selectedWeek.weekEnd
      )
        throw new Error('마감기한이 속한 주 안의 날짜를 선택해 주세요.');
      if (input.plannedDate === source.plannedDate)
        throw new Error('이미 같은 날짜에 배치되어 있습니다. 다른 요일을 선택해 주세요.');
    } catch (e) {
      setError(
        e instanceof z.ZodError
          ? '실제 달력 날짜를 확인해 주세요.'
          : e instanceof Error
            ? e.message
            : '배치 날짜를 확인해 주세요.',
      );
      return;
    }
    const next = { ...draft, command: input };
    setDraft(next);
    current.current = next;
    store(key, next);
    lock.current = true;
    setPending(true);
    setLatest(null);
    setVerified(null);
    setError('');
    setNotice('');
    const ticket = operation.current;
    try {
      const result = await saveDeadlinePlacement(companyId, source, input);
      if (ticket !== operation.current) return;
      setDraft((old) => ({ ...old, command: null, result: result.entry }));
      setNotice(
        '마감예정 업무를 해당 주 계획에 배치했습니다. 같은 ID·상태·마감기한을 유지하며 이전 주 결과를 보존합니다.',
      );
      onChanged();
      setReload((n) => n + 1);
    } catch (e) {
      if (ticket !== operation.current || fail(e)) return;
      setError(workError(e));
      if (e instanceof WorkFailure && [400, 422].includes(e.status))
        setDraft((old) => ({ ...old, command: null }));
      else {
        try {
          const snapshot = await readDeadlinePlacement(companyId, source.id);
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
      <p>
        {scope
          ? `${displayWeekLabel(date)} · ${scope.weekStart} ~ ${scope.weekEnd}`
          : '조회 주를 확인해 주세요.'}{' '}
        · 한국 시간 · 회사 전체 마감예정 · 달력 검색 조건과 별개
      </p>
      {!online && (
        <p role="status">오프라인 읽기 전용입니다. 배치 초안을 유지하고 자동 저장하지 않습니다.</p>
      )}
      {error && <p role="alert">{error}</p>}
      {notice && <p role="status">{notice}</p>}
      <label>
        마감예정 상태
        <select
          value={filter}
          disabled={busy || loading || !!draft.command}
          onChange={(e) => setFilter(e.target.value as 'active' | 'canceled')}
        >
          <option value="active">활성·완료 업무</option>
          <option value="canceled">취소 업무</option>
        </select>
      </label>
      <RefreshButton
        type="button"
        disabled={busy || loading || !!draft.command}
        onClick={() => setReload((n) => n + 1)}
        busy={loading || !!busy}
      >
        마감예정 다시 조회
      </RefreshButton>
      {loading && <p role="status">마감예정을 불러오고 있습니다.</p>}
      {!loading && displayed === scopeKey && !shown.length && !cursor && (
        <p>이 주의 마감예정 업무가 없습니다.</p>
      )}
      <ul aria-label="마감예정 목록" className="work-list">
        {shown.map(({ entry, membership, isPlannedInWeek }) => (
          <li
            className={`work-card${entry.dueDate === kstDate(Date.now()) ? ' deadline-today' : ''}`}
            key={entry.id}
          >
            <h4>{entry.title}</h4>
            <p>
              마감기한 {entry.dueDate} · 기존 예정일 {entry.plannedDate ?? '날짜 미정'} ·{' '}
              {statuses[entry.status]} · 버전 {entry.version}
            </p>
            {entry.dueDate === kstDate(Date.now()) && (
              <p>
                <strong>오늘 마감</strong> · 한국 시간 기준
              </p>
            )}
            {entry.mustFinishToday && (
              <p>
                <strong>당일 완료 필수</strong>
              </p>
            )}
            <p>
              {isPlannedInWeek
                ? '현재 이 주 계획에 배치됨 · 기존 계획 집계 규칙 적용'
                : '현재 이 주에 미배치 · 자동 노출만으로 분모 추가 없음'}
            </p>
            {membership && (
              <p>
                이 주 계획 소속 버전 {membership.sourceVersion} ·{' '}
                {membership.finalized ? '확정된 당시 소속' : '미확정 소속'}
                {membership.isCarriedOver ? ' · 이월 표시 있음' : ''}
              </p>
            )}
            {entry.status === 'paused' && (
              <p>
                중단 유지 · {entry.resumeStatus === 'doing' ? '진행 중' : '미진행'}으로 명시 재개
                가능 · 자동 재개 없음
              </p>
            )}
            {!eligible(entry) && (
              <p>{statuses[entry.status]} 업무는 표시만 하며 요일을 배치할 수 없습니다.</p>
            )}
            <button
              type="button"
              aria-label={`요일 배치 선택: ${entry.title}`}
              disabled={busy || !!source || !eligible(entry)}
              onClick={() => {
                setDraft({ ...blank(), source: entry });
                setLatest(null);
                setVerified(null);
                setError('');
                setNotice('');
              }}
            >
              요일 배치 선택
            </button>
          </li>
        ))}
      </ul>
      {cursor && displayed === scopeKey && (
        <button
          type="button"
          disabled={busy || loading || !!draft.command}
          onClick={() => void load(true)}
        >
          마감예정 더 보기
        </button>
      )}
      {source && (
        <section aria-label="마감예정 요일 배치 검토" className="deadline-review">
          <h4 ref={heading} tabIndex={-1}>
            {source.title} · 요일 배치 검토
          </h4>
          <dl>
            <dt>현재 마감기한</dt>
            <dd>{source.dueDate ?? '없음'}</dd>
            <dt>기존 예정일</dt>
            <dd>{source.plannedDate ?? '날짜 미정'}</dd>
            <dt>현재 상태</dt>
            <dd>
              {statuses[source.status]}
              {source.status === 'paused'
                ? ` · ${source.resumeStatus === 'doing' ? '진행 중' : '미진행'}으로 명시 재개 가능 · 자동 재개 없음`
                : ''}
            </dd>
            <dt>기준 버전</dt>
            <dd>{source.version}</dd>
            <dt>배치 대상 주</dt>
            <dd>
              {selectedWeek ? `${selectedWeek.isoYear}년 ${selectedWeek.isoWeek}주` : '확인 불가'}
            </dd>
          </dl>
          <p>
            마감기한과 상태를 유지하며 같은 업무의 예정일만 배치합니다. 기간 종료일·정확 시각은 자동
            이동하지 않으며 기존 일정·휴가 입력 제한을 따릅니다. 이미 끝났거나 확정된 주에는 새로
            배치할 수 없습니다.
          </p>
          <form onSubmit={submit}>
            <fieldset disabled={locked}>
              <legend>해당 주의 요일 선택</legend>
              <div className="deadline-weekdays">
                {selectedWeek?.days.map((day) => (
                  <button
                    key={day.date}
                    type="button"
                    aria-label={`${day.date} ${weekdays[day.weekday - 1]}요일 배치 선택`}
                    onClick={() => setDraft({ ...draft, date: day.date })}
                  >
                    {weekdays[day.weekday - 1]} {day.date.slice(5)}
                  </button>
                ))}
              </div>
              <p>요일 선택은 입력만 바꾸며 저장하지 않습니다.</p>
              <label>
                배치할 날짜
                <input
                  type="date"
                  required
                  min={selectedWeek?.weekStart}
                  max={selectedWeek?.weekEnd}
                  value={draft.date}
                  onChange={(e) => setDraft({ ...draft, date: e.target.value })}
                />
              </label>
              <button type="submit">마감예정 업무 배치 저장</button>
            </fieldset>
          </form>
          {draft.command && (
            <section aria-label="요일 배치 결과 확인">
              <p>불명 결과의 원래 ID·버전·날짜를 보관하고 재제출을 잠급니다.</p>
              <RefreshButton
                type="button"
                disabled={busy}
                onClick={() => void check()}
                busy={!!busy}
                showLabel
              >
                요일 배치 결과 다시 확인
              </RefreshButton>
              {verified === 'unchanged' && (
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => {
                    setDraft((old) => ({ ...old, command: null }));
                    setVerified(null);
                    setError('');
                    setNotice('원래 버전과 배치 날짜를 유지했습니다. 검토한 뒤 직접 저장하세요.');
                  }}
                >
                  같은 버전으로 요일 배치 재시도 준비
                </button>
              )}
            </section>
          )}
          {latest && (
            <section aria-label="최신 요일 배치 상태">
              <h4>최신 업무·계획 소속</h4>
              <p>
                {latest.entry.title} · 예정일 {latest.entry.plannedDate ?? '날짜 미정'} · 기한{' '}
                {latest.entry.dueDate ?? '없음'} · {statuses[latest.entry.status]} · 버전{' '}
                {latest.entry.version}
              </p>
              <p>
                {latest.membership
                  ? `${latest.membership.isoYear}년 ${latest.membership.isoWeek}주 · 소속 버전 ${latest.membership.sourceVersion} · ${latest.membership.finalized ? '확정' : '미확정'}`
                  : '현재 예정 주 소속을 확인할 수 없습니다.'}
              </p>
              {verified === 'different' && (
                <button
                  type="button"
                  disabled={busy || !eligible(latest.entry)}
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
                      '입력을 유지하고 최신 버전을 선택했습니다. 기한 주와 날짜·상태를 다시 검토한 뒤 직접 저장하세요.',
                    );
                  }}
                >
                  배치 날짜 유지하고 최신 버전 선택
                </button>
              )}
            </section>
          )}
          {draft.result && (
            <>
              <p>
                확인한 배치 날짜: {draft.result.plannedDate} · {statuses[draft.result.status]} ·
                버전 {draft.result.version}
              </p>
              <button
                type="button"
                disabled={busy}
                onClick={() => draft.result?.plannedDate && onSelectDate(draft.result.plannedDate)}
              >
                배치 날짜 보기
              </button>
              <p>
                해당 날짜를 열어 현재 목록과 주간 보고를 다시 조회할 수 있습니다. 이전 주 결과는
                보존됩니다.
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
            요일 배치 검토 닫기 · 초안 비우기
          </button>
        </section>
      )}
    </>
  );
}
