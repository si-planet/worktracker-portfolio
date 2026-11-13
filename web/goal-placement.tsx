import { HelpHint } from './help-hint';
import { RefreshButton } from './ui-controls';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { z } from 'zod';
import {
  zWeeklyGoal,
  zGoalPlacementInput,
  zGoalPlacementResult,
  type WeeklyGoal,
  type GoalPlacementResult,
} from '../shared/schema/weekly-goal';
import { zWorkEntryFinal, type WorkEntryFinal } from '../shared/schema/work-entry';
import type { WorkspaceProject } from '../shared/schema/workspace';
import type { AdminWorkTag } from '../shared/schema/tags';
import { createWorkDuplicateDraft } from '../shared/work-duplicate';
import { weekCalendar } from '../shared/week-calendar';
import {
  WorkFailure,
  workApi,
  workError,
  readWorkDuplicate,
  leaveContextSchema,
  type LeaveContext,
} from './work-entry-api';
import {
  candidates,
  readGoal,
  readPlacement,
  placeGoal,
  loadGoalDraft,
  storeGoalDraft,
  clearGoalDraft,
  goalError,
} from './goal-api';

const statuses = {
  todo: '미진행',
  doing: '진행 중',
  paused: '중단',
  planned: '예정',
  done: '완료',
  canceled: '취소',
};
const kinds = { task: '업무', meeting: '회의', field: '외근', leave: '휴가', etc: '기타' };
const leaves = {
  full: '종일 휴가',
  am_half: '오전 반차',
  pm_half: '오후 반차',
  am_quarter: '오전 반반차',
  pm_quarter: '오후 반반차',
};
export function GoalSourcePicker({
  companyId,
  online,
  disabled,
  onSelect,
  onFailure,
}: {
  companyId: string;
  online: boolean;
  disabled: boolean;
  onSelect: (value: WorkEntryFinal) => void;
  onFailure: (error: unknown) => boolean;
}) {
  const [keyword, setKeyword] = useState(''),
    [applied, setApplied] = useState('');
  const [items, setItems] = useState<WorkEntryFinal[]>([]),
    [cursor, setCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(false),
    [error, setError] = useState(''),
    [reload, setReload] = useState(0);
  const revision = useRef(0),
    seen = useRef(new Set<string>());
  async function load(more = false) {
    const ticket = ++revision.current;
    setError('');
    if (!online || !navigator.onLine) return;
    setLoading(true);
    if (!more) {
      setItems([]);
      setCursor(null);
      seen.current.clear();
    }
    const query = new URLSearchParams({ limit: '50' });
    if (applied !== '') query.set('keyword', applied);
    for (const status of Object.keys(statuses)) query.append('statuses', status);
    if (more && cursor) query.set('cursor', cursor);
    try {
      const result = await candidates(companyId, query);
      if (ticket !== revision.current) return;
      if (result.nextCursor && seen.current.has(result.nextCursor))
        throw new WorkFailure(0, 'INVALID_RESPONSE');
      if (result.nextCursor) seen.current.add(result.nextCursor);
      setItems((old) =>
        more
          ? [...old, ...result.items.filter((i) => !old.some((x) => x.id === i.id))]
          : result.items,
      );
      setCursor(result.nextCursor);
    } catch (failure) {
      if (ticket !== revision.current || onFailure(failure)) return;
      setError(workError(failure));
    } finally {
      if (ticket === revision.current) setLoading(false);
    }
  }
  useEffect(() => {
    void load();
    return () => {
      revision.current++;
    };
  }, [companyId, applied, reload, online]);
  async function select(item: WorkEntryFinal) {
    const ticket = ++revision.current;
    setLoading(true);
    try {
      const snapshot = await readWorkDuplicate(companyId, item.id);
      if (ticket === revision.current) onSelect(snapshot.entry);
    } catch (failure) {
      if (ticket === revision.current && !onFailure(failure)) setError(workError(failure));
    } finally {
      if (ticket === revision.current) setLoading(false);
    }
  }
  return (
    <section className="goal-picker" aria-label="기존 업무 선택">
      <h3>기존 업무에서 가져오기</h3>
      <p>선택은 초안만 준비합니다. 목표 저장이나 업무 배치는 실행하지 않습니다.</p>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          setApplied(keyword);
          setReload((n) => n + 1);
        }}
      >
        <label>
          가져올 업무 검색
          <input value={keyword} maxLength={100} onChange={(e) => setKeyword(e.target.value)} />
        </label>
        <button disabled={disabled || loading || !online}>가져올 업무 검색</button>
      </form>
      {error && <p role="alert">{error}</p>}
      {loading && <p role="status">기존 업무를 확인하고 있습니다.</p>}
      <ul aria-label="가져올 업무 목록">
        {items.map((item) => (
          <li key={item.id}>
            <button
              type="button"
              disabled={disabled || loading || !online}
              onClick={() => void select(item)}
              aria-label={`기존 업무 선택: ${item.title}`}
            >
              {item.title} · {statuses[item.status]} · {item.plannedDate ?? '날짜 미정'}
            </button>
          </li>
        ))}
      </ul>
      {!loading && !items.length && <p>가져올 업무가 없습니다.</p>}
      {cursor && (
        <button
          type="button"
          disabled={disabled || loading || !online}
          onClick={() => void load(true)}
        >
          가져올 업무 더 보기
        </button>
      )}
    </section>
  );
}
const zPlacementDraft = z.strictObject({
  goal: zWeeklyGoal,
  placementId: z.uuid(),
  newId: z.uuid(),
  intent: z.enum(['continue', 'new']),
  source: zWorkEntryFinal.nullable(),
  title: z.string().max(200),
  content: z.string().max(5000),
  kind: z.enum(['task', 'meeting', 'field', 'leave', 'etc']),
  projectId: z.string().max(36),
  tagIds: z.array(z.uuid()).max(200),
  mustFinishToday: z.boolean(),
  date: z.string().max(10),
  endDate: z.string().max(10),
  dueDate: z.string().max(10),
  timeMode: z.enum(['date_only', 'exact']),
  start: z.string().max(16),
  end: z.string().max(16),
  leaveType: z.enum(['full', 'am_half', 'pm_half', 'am_quarter', 'pm_quarter']),
  pendingInput: zGoalPlacementInput.nullable(),
});
type Draft = z.output<typeof zPlacementDraft>;
function blank(goal: WeeklyGoal, projects: WorkspaceProject[], tags: AdminWorkTag[]): Draft {
  const project = projects.find((p) => p.isActive);
  return {
    goal,
    placementId: crypto.randomUUID(),
    newId: crypto.randomUUID(),
    intent: 'new',
    source: null,
    title: goal.title,
    content: goal.detail ?? '',
    kind: 'task',
    projectId: project?.id ?? '',
    tagIds: tags
      .filter((t) => t.isActive && (project?.defaultTagIds.includes(t.id) || t.isCore))
      .map((t) => t.id),
    mustFinishToday: false,
    date: '',
    endDate: '',
    dueDate: '',
    timeMode: 'date_only',
    start: '',
    end: '',
    leaveType: 'full',
    pendingInput: null,
  };
}
function fromSource(d: Draft, source: WorkEntryFinal): Draft {
  const fresh = createWorkDuplicateDraft(source, d.newId);
  return {
    ...d,
    source,
    intent: 'new',
    title: fresh.title,
    content: fresh.content ?? '',
    kind: fresh.kind === 'event' ? 'etc' : fresh.kind,
    projectId: fresh.projectId ?? '',
    tagIds: fresh.tagIds,
    mustFinishToday: fresh.mustFinishToday,
    date: '',
    endDate: '',
    dueDate: '',
    timeMode: 'date_only',
    start: '',
    end: '',
    leaveType: fresh.leave?.type ?? 'full',
  };
}
export function GoalPlacement({
  goal,
  companyId,
  userId,
  projects,
  tags,
  online,
  onFailure,
  onSaved,
  onClose,
}: {
  goal: WeeklyGoal;
  companyId: string;
  userId: string;
  projects: WorkspaceProject[];
  tags: AdminWorkTag[];
  online: boolean;
  onFailure: (e: unknown) => boolean;
  onSaved: (result: GoalPlacementResult) => void;
  onClose: () => void;
}) {
  const key = `wt:goal-placement:v1:${encodeURIComponent(userId)}:${companyId}:${goal.id}`;
  const [draft, setDraft] = useState(() => {
    const saved = loadGoalDraft(key, zPlacementDraft);
    return saved && saved.goal.id === goal.id && saved.goal.companyId === companyId
      ? saved
      : blank(goal, projects, tags);
  });
  const current = useRef(draft);
  current.current = draft;
  const [pending, setPending] = useState(false),
    [sourceLoading, setSourceLoading] = useState(
      !!goal.sourceEntryId && !draft.source && !draft.pendingInput,
    ),
    [error, setError] = useState(''),
    [notice, setNotice] = useState(''),
    [picker, setPicker] = useState(false),
    [conflict, setConflict] = useState(false),
    [missingReceipt, setMissingReceipt] = useState(false);
  const [latest, setLatest] = useState<{ goal: WeeklyGoal; source: WorkEntryFinal | null } | null>(
      null,
    ),
    [result, setResult] = useState<GoalPlacementResult | null>(() =>
      loadGoalDraft(`${key}:receipt`, zGoalPlacementResult),
    );
  const [sourceReplace, setSourceReplace] = useState<WorkEntryFinal | null>(null);
  const [preview, setPreview] = useState<LeaveContext | null>(null);
  const [previewReload, setPreviewReload] = useState(0);
  const [previewLoading, setPreviewLoading] = useState(false);
  const lock = useRef(false),
    revision = useRef(0);
  useEffect(() => {
    storeGoalDraft(key, draft);
  }, [key, draft]);
  useEffect(
    () => () => {
      revision.current++;
    },
    [],
  );
  function fail(failure: unknown) {
    storeGoalDraft(key, current.current);
    return onFailure(failure);
  }
  useEffect(() => {
    if (!goal.sourceEntryId || draft.source || draft.pendingInput) return;
    const ticket = revision.current;
    let active = true;
    setSourceLoading(true);
    void readWorkDuplicate(companyId, goal.sourceEntryId)
      .then((value) => {
        if (active && ticket === revision.current) setDraft((old) => fromSource(old, value.entry));
      })
      .catch((failure) => {
        if (active && !fail(failure))
          setError(
            '참조 원본을 확인할 수 없습니다. 다른 원본을 선택하거나 원본 없이 새 수행을 준비하세요.',
          );
      })
      .finally(() => {
        if (active) setSourceLoading(false);
      });
    return () => {
      active = false;
    };
  }, []);
  const effectiveKind = draft.intent === 'continue' ? draft.source?.kind : draft.kind;
  useEffect(() => {
    let active = true;
    setPreview(null);
    if (effectiveKind !== 'leave' || !draft.date || !online) {
      setPreviewLoading(false);
      return;
    }
    setPreviewLoading(true);
    void workApi(
      `/api/companies/${companyId}/days/${draft.date}/duplicate-leave-context`,
      leaveContextSchema(companyId, draft.date),
    )
      .then((value) => {
        if (active) setPreview(value);
      })
      .catch((failure) => {
        if (active && !fail(failure)) setError(workError(failure));
      })
      .finally(() => {
        if (active) setPreviewLoading(false);
      });
    return () => {
      active = false;
    };
  }, [companyId, effectiveKind, draft.date, online, previewReload]);
  function change(patch: Partial<Draft>) {
    setDraft((old) => ({ ...old, ...patch }));
    setError('');
  }
  function input() {
    const { source } = draft;
    const range =
      draft.timeMode === 'exact'
        ? (() => {
            if (!draft.start || !draft.end)
              throw new Error('한국 시각의 시작·종료 시각을 모두 입력하세요.');
            const startAt = Date.parse(`${draft.start}:00+09:00`),
              endAt = Date.parse(`${draft.end}:00+09:00`);
            return {
              plannedDate: draft.start.slice(0, 10),
              endDate: new Date(endAt - 1 + 9 * 3600000).toISOString().slice(0, 10),
              startAt,
              endAt,
              timeMode: 'exact' as const,
            };
          })()
        : {
            plannedDate: draft.date,
            endDate: draft.endDate || null,
            startAt: null,
            endAt: null,
            timeMode: 'date_only' as const,
          };
    const week = weekCalendar(draft.goal.isoYear, draft.goal.isoWeek);
    if (range.plannedDate < week.weekStart || range.plannedDate > week.weekEnd)
      throw new Error('선택한 목표 주 안의 배치 날짜를 지정해 주세요.');
    const basis = effectiveKind === 'leave' ? preview?.calculationBasis : undefined;
    if (effectiveKind === 'leave' && !basis)
      throw new Error('새 날짜의 휴가 계산 기준을 확인한 뒤 배치하세요.');
    if (draft.intent === 'continue') {
      if (!source) throw new Error('이어서 배치할 원본을 선택해 주세요.');
      if (source.status === 'done' || source.status === 'canceled')
        throw new Error('완료·취소 기록은 새 수행으로 준비하세요.');
      return zGoalPlacementInput.parse({
        id: draft.placementId,
        goalVersion: draft.goal.version,
        intent: 'continue',
        sourceEntryId: source.id,
        sourceVersion: source.version,
        patch: {
          version: source.version,
          ...range,
          dueDate: draft.dueDate || null,
          ...(basis ? { calculationBasis: basis } : {}),
        },
      });
    }
    if (source?.kind === 'event')
      throw new Error(
        '회사 행사 원본의 새 수행은 지원하지 않습니다. 원본 없이 지원되는 종류를 선택해 주세요.',
      );
    if (
      draft.kind !== 'leave' &&
      (!projects.some((p) => p.id === draft.projectId && p.isActive) ||
        draft.tagIds.some((id) => !tags.some((t) => t.id === id && t.isActive)))
    )
      throw new Error('새 수행은 활성 프로젝트·태그를 직접 다시 선택해 주세요.');
    return zGoalPlacementInput.parse({
      id: draft.placementId,
      goalVersion: draft.goal.version,
      intent: 'new',
      sourceEntryId: source?.id ?? null,
      sourceVersion: source?.version ?? null,
      entry: {
        id: draft.newId,
        kind: draft.kind,
        title: draft.title,
        content: draft.content || null,
        projectId: draft.kind === 'leave' ? null : draft.projectId || null,
        tagIds: draft.kind === 'leave' ? [] : draft.tagIds,
        mustFinishToday: draft.kind === 'task' && draft.mustFinishToday,
        status: draft.kind === 'task' ? 'todo' : 'planned',
        ...range,
        dueDate: draft.dueDate || null,
        ...(draft.kind === 'leave'
          ? { leave: { type: draft.leaveType }, calculationBasis: basis }
          : { allDay: range.timeMode === 'date_only' }),
      },
    });
  }
  function complete(value: GoalPlacementResult) {
    setResult(value);
    setDraft((old) => ({ ...old, pendingInput: null }));
    storeGoalDraft(`${key}:receipt`, value);
    setConflict(false);
    setMissingReceipt(false);
    setNotice(
      '배치 영수증으로 저장을 확인했습니다. 목표 메모와 원본의 자동 수정·삭제는 하지 않습니다.',
    );
    onSaved(value);
  }
  async function check() {
    if (lock.current || !online) return;
    lock.current = true;
    setPending(true);
    setMissingReceipt(false);
    const ticket = revision.current;
    try {
      const value = await readPlacement(companyId, draft.placementId, goal.id);
      if (ticket === revision.current) complete(value);
    } catch (failure) {
      if (ticket !== revision.current || fail(failure)) return;
      if (failure instanceof WorkFailure && failure.status === 404) {
        setMissingReceipt(true);
        setNotice('이 회사에서 해당 배치 영수증이 없음을 확인했습니다. 입력과 ID를 유지합니다.');
      } else setError(goalError(failure));
    } finally {
      if (ticket === revision.current) {
        lock.current = false;
        setPending(false);
      }
    }
  }
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (lock.current || !online || draft.pendingInput || result) return;
    let payload;
    try {
      payload = input();
    } catch (failure) {
      setError(
        failure instanceof z.ZodError
          ? (failure.issues[0]?.message ?? '입력을 확인하세요.')
          : failure instanceof Error
            ? failure.message
            : '입력을 확인하세요.',
      );
      return;
    }
    const next = { ...draft, pendingInput: payload };
    setDraft(next);
    current.current = next;
    storeGoalDraft(key, next);
    lock.current = true;
    setPending(true);
    setError('');
    setMissingReceipt(false);
    const ticket = revision.current;
    try {
      const value = await placeGoal(companyId, goal.id, payload);
      if (ticket === revision.current) complete(value);
    } catch (failure) {
      if (ticket !== revision.current || fail(failure)) return;
      setError(goalError(failure));
      if (failure instanceof WorkFailure && [400, 422].includes(failure.status)) {
        change({ pendingInput: null });
      } else {
        setConflict(failure instanceof WorkFailure && failure.status === 409);
        try {
          const receipt = await readPlacement(companyId, draft.placementId, goal.id);
          if (ticket === revision.current) complete(receipt);
        } catch (readFailure) {
          if (ticket !== revision.current || fail(readFailure)) return;
          if (readFailure instanceof WorkFailure && readFailure.status === 404)
            setMissingReceipt(true);
          else setError(goalError(readFailure));
        }
      }
    } finally {
      if (ticket === revision.current) {
        lock.current = false;
        setPending(false);
      }
    }
  }
  async function refresh() {
    if (lock.current || !online) return;
    lock.current = true;
    setPending(true);
    const ticket = revision.current;
    try {
      const g = await readGoal(companyId, goal.id);
      const source = draft.source
        ? (await readWorkDuplicate(companyId, draft.source.id)).entry
        : null;
      if (ticket === revision.current) setLatest({ goal: g, source });
    } catch (failure) {
      if (ticket === revision.current && !fail(failure)) setError(goalError(failure));
    } finally {
      if (ticket === revision.current) {
        lock.current = false;
        setPending(false);
      }
    }
  }
  const disabled = pending || !online || !!draft.pendingInput || !!result || sourceLoading;
  const week = weekCalendar(goal.isoYear, goal.isoWeek);
  return (
    <section className="goal-placement" aria-label="목표 명시 배치">
      <h2>목표를 일간에 배치</h2>
      <p>{goal.title} · 목표 메모는 달성률에서 제외됩니다. 저장된 배치 업무는 별개입니다.</p>
      <p>배치 ID: {draft.placementId}</p>
      {error && <p role="alert">{error}</p>}
      {notice && <p role="status">{notice}</p>}
      {sourceLoading && <p role="status">참조 원본을 확인하고 있습니다.</p>}
      {result ? (
        <>
          <p>
            배치 완료 · {result.placement.intent === 'continue' ? '동일 업무 이연' : '새 수행'} ·{' '}
            {result.placement.targetDate}
          </p>
          <p>
            업무 ID: {result.placement.workEntryId} · 배치 당시 버전{' '}
            {result.placement.workEntryVersion}
          </p>
          <p>
            {result.entry
              ? `현재 업무: ${result.entry.title} · ${statuses[result.entry.status]}`
              : '배치된 업무가 현재 삭제되어도 영수증은 보존됩니다.'}
          </p>
          <a
            className="control-link"
            href={`/c/${companyId}/day?date=${result.placement.targetDate}`}
          >
            배치 날짜의 일간 보기
          </a>
          <RefreshButton
            type="button"
            disabled={pending || !online}
            onClick={() => void check()}
            busy={pending}
            showLabel
          >
            저장된 배치 영수증 다시 확인
          </RefreshButton>
          <button
            type="button"
            disabled={pending || !online}
            onClick={async () => {
              if (lock.current) return;
              lock.current = true;
              setPending(true);
              const ticket = revision.current;
              try {
                const latest = await readGoal(companyId, goal.id);
                if (ticket !== revision.current) return;
                setDraft(blank(latest, projects, tags));
                setResult(null);
                clearGoalDraft(`${key}:receipt`);
                setNotice(
                  '저장된 배치와 별개의 새 배치 초안을 준비했습니다. 직접 검토하고 배치하세요.',
                );
              } catch (failure) {
                if (ticket === revision.current && !fail(failure)) setError(goalError(failure));
              } finally {
                if (ticket === revision.current) {
                  lock.current = false;
                  setPending(false);
                }
              }
            }}
          >
            같은 목표의 새 배치 초안
          </button>
        </>
      ) : (
        <>
          {draft.pendingInput && (
            <section aria-label="배치 결과 확인">
              <p>저장 결과를 확인하기 전에는 수정·새 ID 발급·자동 재전송하지 않습니다.</p>
              <RefreshButton
                type="button"
                disabled={pending || !online}
                onClick={() => void check()}
                busy={pending}
                showLabel
              >
                배치 결과 다시 확인
              </RefreshButton>
              {missingReceipt && (
                <>
                  <button
                    type="button"
                    disabled={pending || !online}
                    onClick={() => {
                      change({ pendingInput: null });
                      setMissingReceipt(false);
                      setNotice('동일 ID와 입력을 유지했습니다. 직접 배치를 실행해 재시도하세요.');
                    }}
                  >
                    같은 ID로 배치 재시도 준비
                  </button>
                  <RefreshButton
                    type="button"
                    disabled={pending || !online}
                    onClick={() => void refresh()}
                    busy={pending}
                    showLabel
                  >
                    최신 목표와 원본 확인
                  </RefreshButton>
                </>
              )}
            </section>
          )}
          {(conflict || latest) && (
            <p>충돌이 발생하면 초안을 유지하고 최신 목표·원본 버전을 직접 선택하세요.</p>
          )}
          {latest && (
            <div>
              <p>
                최신 목표 버전 {latest.goal.version}
                {latest.source ? ` · 원본 ${latest.source.version}` : ''}
              </p>
              <button
                type="button"
                disabled={pending || !online || !missingReceipt}
                onClick={() => {
                  change({ goal: latest.goal, source: latest.source, pendingInput: null });
                  setLatest(null);
                  setConflict(false);
                  setMissingReceipt(false);
                  setNotice(
                    '입력과 두 ID를 유지하고 최신 버전을 선택했습니다. 다시 검토한 뒤 직접 배치하세요.',
                  );
                }}
              >
                입력 유지하고 최신 목표·원본 버전 선택
              </button>
            </div>
          )}
          <form onSubmit={submit}>
            <fieldset disabled={disabled}>
              <legend>배치 검토</legend>
              <label>
                배치 의도
                <select
                  value={draft.intent}
                  onChange={(e) =>
                    change({
                      intent: e.target.value as Draft['intent'],
                      date: '',
                      endDate: '',
                      dueDate: '',
                      timeMode: 'date_only',
                      start: '',
                      end: '',
                    })
                  }
                >
                  <option value="new">새 수행 만들기 · 새 ID</option>
                  <option value="continue" disabled={!draft.source}>
                    같은 업무 이어서 배치 · 같은 ID
                  </option>
                </select>
              </label>
              <p>
                {draft.intent === 'continue'
                  ? '일정만 바꾸며 제목·종류·프로젝트·태그·상태를 유지합니다.'
                  : '원본의 일정·이력·완료·중단 상태를 복사하지 않습니다. 새 업무는 초기 상태로 만듭니다.'}
              </p>
              <p>
                원본:{' '}
                {draft.source
                  ? `${draft.source.title} · ${statuses[draft.source.status]} · 버전 ${draft.source.version}`
                  : '없음'}
              </p>
              {draft.source?.status === 'paused' && (
                <p>중단 원본은 동일 업무 배치에서도 중단을 유지하며 자동 재개하지 않습니다.</p>
              )}
              <div className="work-actions">
                <button type="button" onClick={() => setPicker((v) => !v)}>
                  배치 원본 선택
                </button>
                <button
                  type="button"
                  onClick={() => {
                    change({ source: null, intent: 'new' });
                    setPicker(false);
                  }}
                >
                  원본 없이 새 수행 준비
                </button>
              </div>
              {draft.intent === 'new' && (
                <>
                  <p>새 업무 ID: {draft.newId}</p>
                  <label>
                    새 수행 종류
                    <select
                      value={draft.kind}
                      onChange={(e) =>
                        change({
                          kind: e.target.value as Draft['kind'],
                          timeMode: 'date_only',
                          start: '',
                          end: '',
                        })
                      }
                    >
                      {Object.entries(kinds).map(([key, label]) => (
                        <option key={key} value={key}>
                          {label}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label>
                    새 수행 제목
                    <input
                      required
                      maxLength={200}
                      value={draft.title}
                      onChange={(e) => change({ title: e.target.value })}
                    />
                  </label>
                  <label>
                    새 수행 내용
                    <textarea
                      maxLength={5000}
                      value={draft.content}
                      onChange={(e) => change({ content: e.target.value })}
                    />
                  </label>
                  {draft.kind !== 'leave' && (
                    <>
                      <label>
                        새 수행 프로젝트
                        <select
                          required
                          value={draft.projectId}
                          onChange={(e) => change({ projectId: e.target.value })}
                        >
                          <option value="">프로젝트를 선택하세요</option>
                          {projects
                            .filter((p) => p.isActive || p.id === draft.projectId)
                            .map((p) => (
                              <option key={p.id} value={p.id}>
                                {p.code}
                                {p.isActive ? '' : ' (비활성 · 재선택 필요)'}
                              </option>
                            ))}
                        </select>
                      </label>
                      <fieldset className="workspace-tags">
                        <legend>새 수행 태그</legend>
                        <button type="button" onClick={() => change({ tagIds: [] })}>
                          새 수행 태그 선택 해제
                        </button>
                        {tags.map((t) => (
                          <label className="workspace-check" key={t.id}>
                            <input
                              type="checkbox"
                              checked={draft.tagIds.includes(t.id)}
                              disabled={!t.isActive && !draft.tagIds.includes(t.id)}
                              onChange={(e) =>
                                change({
                                  tagIds: e.target.checked
                                    ? [...draft.tagIds, t.id]
                                    : draft.tagIds.filter((id) => id !== t.id),
                                })
                              }
                            />
                            {t.label}
                            {t.isActive ? '' : ' (비활성 · 제거 후 재선택)'}
                          </label>
                        ))}
                      </fieldset>
                    </>
                  )}
                  {draft.kind === 'task' && (
                    <label className="workspace-check">
                      <input
                        type="checkbox"
                        checked={draft.mustFinishToday}
                        onChange={(e) => change({ mustFinishToday: e.target.checked })}
                      />
                      새 수행은 당일 완료 필수
                    </label>
                  )}
                </>
              )}
              <label>
                배치 날짜
                <input
                  type="date"
                  required
                  min={week.weekStart}
                  max={week.weekEnd}
                  value={draft.date}
                  onChange={(e) => change({ date: e.target.value })}
                />
              </label>
              {effectiveKind !== 'leave' && (
                <>
                  <label>
                    배치 시간 방식
                    <select
                      value={draft.timeMode}
                      onChange={(e) =>
                        change({
                          timeMode: e.target.value as Draft['timeMode'],
                          start: '',
                          end: '',
                        })
                      }
                    >
                      <option value="date_only">날짜만</option>
                      <option value="exact">정확 시각 · 한국 시간</option>
                    </select>
                  </label>
                  {draft.timeMode === 'exact' ? (
                    <>
                      <label>
                        배치 시작 시각
                        <input
                          type="datetime-local"
                          required
                          value={draft.start}
                          onChange={(e) =>
                            change({ start: e.target.value, date: e.target.value.slice(0, 10) })
                          }
                        />
                      </label>
                      <label>
                        배치 종료 시각
                        <input
                          type="datetime-local"
                          required
                          value={draft.end}
                          onChange={(e) => change({ end: e.target.value })}
                        />
                      </label>
                      <HelpHint label="일정 날짜 기준">
                        한국 시각 기준이며 종료 자정은 다음 날에 배치하지 않습니다.
                      </HelpHint>
                    </>
                  ) : (
                    <label>
                      배치 종료 날짜
                      <input
                        type="date"
                        min={draft.date}
                        value={draft.endDate}
                        onChange={(e) => change({ endDate: e.target.value })}
                      />
                    </label>
                  )}
                  <label>
                    배치 마감기한
                    <input
                      type="date"
                      value={draft.dueDate}
                      onChange={(e) => change({ dueDate: e.target.value })}
                    />
                  </label>
                </>
              )}
              {effectiveKind === 'leave' && (
                <>
                  <label>
                    배치 휴가 종류
                    <select
                      disabled={draft.intent === 'continue'}
                      value={
                        draft.intent === 'continue'
                          ? (draft.source?.leave?.type ?? 'full')
                          : draft.leaveType
                      }
                      onChange={(e) => change({ leaveType: e.target.value as Draft['leaveType'] })}
                    >
                      {Object.entries(leaves).map(([key, label]) => (
                        <option key={key} value={key}>
                          {label}
                        </option>
                      ))}
                    </select>
                  </label>
                  <RefreshButton
                    type="button"
                    disabled={pending || !online || previewLoading}
                    busy={previewLoading}
                    onClick={() => setPreviewReload((n) => n + 1)}
                    showLabel
                  >
                    배치 휴가 기준 다시 조회
                  </RefreshButton>
                  {preview ? (
                    <p>
                      새 날짜의 하루 근로시간 {preview.calculationBasis.workHoursPerDay}시간
                      기준으로 서버가 다시 계산합니다.
                    </p>
                  ) : (
                    <p>배치 날짜의 휴가 계산 기준을 확인해야 합니다.</p>
                  )}
                </>
              )}
              <button type="submit">목표 명시 배치</button>
            </fieldset>
          </form>
          {picker && (
            <GoalSourcePicker
              companyId={companyId}
              online={online}
              disabled={disabled}
              onFailure={fail}
              onSelect={(source) => {
                setSourceReplace(source);
              }}
            />
          )}
        </>
      )}
      {sourceReplace && (
        <section role="alertdialog" aria-modal="true" aria-label="배치 초안 교체 확인">
          <p>선택한 원본으로 배치 입력을 교체합니다. 배치 ID와 새 업무 ID는 유지합니다.</p>
          <button type="button" onClick={() => setSourceReplace(null)}>
            기존 배치 입력 유지
          </button>
          <button
            type="button"
            disabled={pending || !online}
            onClick={() => {
              setDraft((old) => fromSource(old, sourceReplace));
              setSourceReplace(null);
              setPicker(false);
            }}
          >
            배치 초안 교체 확인
          </button>
        </section>
      )}
      <button
        type="button"
        disabled={pending}
        onClick={() => {
          storeGoalDraft(key, current.current);
          onClose();
        }}
      >
        배치 검토 닫기 · 초안 유지
      </button>
    </section>
  );
}
