import { HelpHint } from './help-hint';
import { RefreshButton } from './ui-controls';
import { useEffect, useRef, useState } from 'react';
import { z } from 'zod';
import { zWorkEntryDate } from '../shared/schema/work-entry';
import {
  zRecurrenceCreate,
  zRecurrenceSpec,
  zRecurrencePatch,
  zRecurrenceStop,
  zRecurrenceGenerate,
  type RecurrenceResolution,
} from '../shared/schema/recurrence';
import { zWorkspaceProject } from '../shared/schema/workspace';
import { zAdminWorkTag } from '../shared/schema/tags';
import { kstDate } from '../shared/work-entry-rules';
import { setWorkspaceDraftDirty } from './workspace-draft-state';
import { WorkFailure } from './work-entry-api';
import {
  zRule,
  zRecurrenceCommand,
  listRules,
  readRule,
  readRecurrenceChoices,
  readPreview,
  previewChange,
  submitRecurrence,
  recurrenceWeeks,
  recurrenceFailure,
  recurrenceRuleId,
  recurrenceLogin,
  type Rule,
  type Preview,
  type RecurrenceCommand,
  type Generation,
} from './recurrence-api';
import './recurrence.css';
const days = ['월', '화', '수', '목', '금', '토', '일'];
const zForm = z.strictObject({
  kind: z.enum(['task', 'meeting', 'field', 'etc']),
  projectId: z.string(),
  title: z.string().max(200),
  content: z.string().max(5000),
  tagIds: z.array(z.uuid()).max(100),
  startOn: z.string(),
  endOn: z.string(),
  freq: z.enum(['daily', 'weekly', 'monthly']).default('weekly'),
  interval: z.string(),
  byweekday: z.array(z.number().int().min(1).max(7)),
  bymonthday: z.string().default(''),
  invalidDayPolicy: z.enum(['', 'skip', 'last_day']).default(''),
  holiday: z.enum(['', 'ask']),
});
type Form = z.output<typeof zForm>;
const blank = (): Form => ({
  kind: 'task',
  projectId: '',
  title: '',
  content: '',
  tagIds: [],
  startOn: kstDate(Date.now()),
  endOn: '',
  freq: 'weekly',
  interval: '1',
  byweekday: [],
  bymonthday: '',
  invalidDayPolicy: '',
  holiday: '',
});
const formFor = (r: Rule): Form => ({
  kind: r.spec.kind,
  projectId: r.spec.projectId ?? '',
  title: r.spec.title,
  content: r.spec.content ?? '',
  tagIds: r.spec.tagIds,
  startOn: r.spec.startOn,
  endOn: r.spec.endOn ?? '',
  freq: r.spec.freq,
  interval: String(r.spec.interval),
  byweekday: r.spec.freq === 'weekly' ? r.spec.byweekday : [],
  bymonthday: r.spec.freq === 'monthly' ? String(r.spec.bymonthday) : '',
  invalidDayPolicy: r.spec.freq === 'monthly' ? r.spec.invalidDayPolicy : '',
  holiday: 'ask',
});
const frequencyNames = { daily: '일간', weekly: '주간', monthly: '월간' } as const;
const intervalUnits = { daily: '일', weekly: '주', monthly: '개월' } as const;
function ruleSummary(form: Form) {
  const interval = `${form.interval || '?'}${intervalUnits[form.freq]}마다`;
  if (form.freq === 'daily') return `${frequencyNames.daily} · ${interval}`;
  if (form.freq === 'weekly')
    return `${frequencyNames.weekly} · ${interval} · ${form.byweekday.map((d) => days[d - 1]).join('·') || '요일 선택 필요'}`;
  const policy =
    form.invalidDayPolicy === 'skip'
      ? '없는 날짜는 해당 월 건너뛰기'
      : form.invalidDayPolicy === 'last_day'
        ? '없는 날짜는 해당 월 마지막 날'
        : '없는 날짜 정책 선택 필요';
  return `${frequencyNames.monthly} · ${interval} · ${form.bymonthday || '?'}일 · ${policy}`;
}
function anchorSummary(form: Form) {
  if (form.freq === 'daily') return `최초 시작일 ${form.startOn}을 일 간격 기준으로 유지합니다.`;
  if (form.freq === 'monthly')
    return `최초 시작월 ${form.startOn.slice(0, 7)}을 월 간격 기준으로 유지합니다.`;
  return `최초 시작일 ${form.startOn}이 속한 ISO주를 주 간격 기준으로 유지합니다.`;
}
const zControl = z.strictObject({
  applyFrom: z.string(),
  stopMode: z.enum(['end', 'deactivate']),
  stopOn: z.string(),
  existingFuture: z.enum(['', 'preserve', 'cancel_untouched']),
});
const controls = (d: {
  applyFrom: string;
  stopMode: 'end' | 'deactivate';
  stopOn: string;
  existingFuture: '' | 'preserve' | 'cancel_untouched';
}) => ({
  applyFrom: d.applyFrom,
  stopMode: d.stopMode,
  stopOn: d.stopOn,
  existingFuture: d.existingFuture,
});
const zResolutions = z
  .record(
    zWorkEntryDate,
    z.strictObject({ action: z.enum(['', 'confirm', 'skip']), plannedDate: z.string() }),
  )
  .refine((v) => Object.keys(v).length <= 182);
const zDraft = z.strictObject({
  companyId: z.uuid(),
  id: z.uuid(),
  rule: zRule.nullable(),
  form: zForm,
  saved: zForm,
  applyFrom: z.string(),
  weekStart: z.string(),
  weekCount: z.string(),
  stopMode: z.enum(['end', 'deactivate']),
  stopOn: z.string(),
  existingFuture: z.enum(['', 'preserve', 'cancel_untouched']),
  controlBase: zControl,
  operation: z.enum(['generate', 'revise', 'stop']),
  resolutions: zResolutions,
  resolutionBase: zResolutions,
  resolutionScope: z.string().max(32768),
  command: zRecurrenceCommand.nullable(),
  receipt: z.strictObject({ commandId: z.uuid(), message: z.string().max(500) }).nullable(),
});
type Draft = z.output<typeof zDraft>;
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
const isDirty = (d: Draft) =>
  !same(d.form, d.saved) ||
  !same(controls(d), d.controlBase) ||
  !same(d.resolutions, d.resolutionBase) ||
  !!d.command;
function getStored<T extends z.ZodType>(key: string, schema: T) {
  try {
    const r = schema.safeParse(JSON.parse(sessionStorage.getItem(key) ?? 'null'));
    return r.success ? r.data : null;
  } catch {
    return null;
  }
}
function put(key: string, value: unknown) {
  try {
    sessionStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* The scoped in-memory draft remains. */
  }
}
function historyIndex() {
  const n = (window as Window & { navigation?: { currentEntry?: { index: number } } }).navigation
    ?.currentEntry?.index;
  return typeof n === 'number' && n >= 0 ? n : null;
}
function useOnline() {
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
export function RecurrencePage({ companyId, userId }: { companyId: string; userId: string }) {
  if (!z.uuid().safeParse(companyId).success || !userId)
    return (
      <section className="workspace">
        <h1>회사 주소를 확인해 주세요.</h1>
        <a className="control-link" href="/">
          회사 선택으로
        </a>
      </section>
    );
  return <CompanyRecurrence key={`${userId}:${companyId}`} companyId={companyId} userId={userId} />;
}
function CompanyRecurrence({ companyId, userId }: { companyId: string; userId: string }) {
  const [selected, setSelected] = useState(() => {
      try {
        return recurrenceRuleId(companyId) ?? '';
      } catch {
        return '!invalid';
      }
    }),
    [items, setItems] = useState<Rule[]>([]),
    [cursor, setCursor] = useState<string | null>(null),
    [choices, setChoices] = useState<Choices | null>(null),
    [busy, setBusy] = useState(false),
    [denied, setDenied] = useState(false),
    [error, setError] = useState('');
  const online = useOnline(),
    revision = useRef(0),
    lock = useRef(false),
    seen = useRef(new Set<string>()),
    activeDirty = useRef(false),
    currentURL = useRef(location.pathname + location.search),
    currentIndex = useRef(historyIndex()),
    currentState = useRef(history.state),
    restoring = useRef(false);
  function deny() {
    revision.current++;
    lock.current = false;
    setBusy(false);
    setDenied(true);
    setItems([]);
    setChoices(null);
    setCursor(null);
  }
  function fail(e: unknown) {
    if (e instanceof WorkFailure && [401, 403].includes(e.status)) deny();
    setError(recurrenceFailure(e));
    if (e instanceof WorkFailure && e.status === 401) recurrenceLogin(companyId);
  }
  async function load(more = false) {
    if (lock.current || !online) return;
    const ticket = ++revision.current;
    lock.current = true;
    setBusy(true);
    setError('');
    try {
      const [page, metadata] = await Promise.all([
        listRules(companyId, more ? (cursor ?? undefined) : undefined),
        readRecurrenceChoices(companyId),
      ]);
      if (ticket !== revision.current) return;
      if (
        more &&
        (page.items.some((r) => items.some((old) => old.id === r.id)) ||
          (page.nextCursor && seen.current.has(page.nextCursor)))
      )
        throw new WorkFailure(0, 'INVALID_RESPONSE');
      if (!more) seen.current.clear();
      if (page.nextCursor) seen.current.add(page.nextCursor);
      setItems(more ? [...items, ...page.items] : page.items);
      setCursor(page.nextCursor);
      setChoices({ projects: metadata[0], tags: metadata[1] });
      setDenied(false);
    } catch (e) {
      if (ticket === revision.current) fail(e);
    } finally {
      if (ticket === revision.current) {
        lock.current = false;
        setBusy(false);
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
  function allow() {
    return (
      !activeDirty.current ||
      confirm('반복 일정 초안과 미확인 명령을 이 회사에 보관하고 이동할까요?')
    );
  }
  function select(id: string, receipt = false) {
    if (id === selected || (!receipt && !allow())) return;
    currentState.current = history.state;
    const url = `/c/${companyId}/recurrence${id ? `?${new URLSearchParams({ ruleId: id })}` : ''}`;
    history.pushState(currentState.current, '', url);
    currentURL.current = url;
    currentIndex.current = historyIndex();
    setSelected(id);
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
      if (location.pathname === `/c/${companyId}/recurrence`) {
        try {
          setSelected(recurrenceRuleId(companyId) ?? '');
        } catch {
          setSelected('!invalid');
        }
        currentURL.current = location.pathname + location.search;
        currentIndex.current = historyIndex();
        currentState.current = history.state;
      }
    };
    addEventListener('popstate', pop, true);
    return () => removeEventListener('popstate', pop, true);
  }, [companyId]);
  return (
    <section className="workspace recurrence-page" aria-labelledby="recurrence-title">
      <h1 id="recurrence-title">반복 일정</h1>
      <p className="recurrence-hint">일간·주간·월간 · 날짜 전용 · 직접 미리 보고 생성</p>
      <details className="recurrence-support">
        <summary>지원 범위 · 휴무 처리</summary>
        <p>
          업무·회의·외근·기타의 일간·주간·월간 반복을 지원합니다. ‘회차마다 확인(ask)’을 직접
          선택해야 합니다. 제품 기본 정책인 이전 근무일 이동은 아직 저장하지 않습니다.
        </p>
        <p>
          월간은 지정한 날짜가 없는 달의 처리 방법도 직접 선택합니다. 정확 시각·휴가·행사·자동
          생성·자동 이월·휴무 자동 이동은 지원하지 않습니다. 휴일 정보가 미지원인 날짜도 직접 날짜
          확인 또는 건너뛰기를 선택해야 합니다.
        </p>
      </details>
      {error && <p role="alert">{error}</p>}
      {!online && <p role="status">오프라인 · 회사별 초안을 보존했습니다.</p>}
      <div className="recurrence-actions">
        <RefreshButton
          type="button"
          disabled={busy || !online}
          onClick={() => void load()}
          busy={!!busy}
        >
          규칙 조회
        </RefreshButton>
        <button type="button" onClick={() => select('')}>
          새 반복 규칙
        </button>
      </div>
      {busy && <p role="status">반복 규칙을 불러오고 있습니다.</p>}
      {!denied && (
        <ul className="recurrence-rules">
          {items.map((r) => (
            <li key={r.id}>
              <button
                type="button"
                aria-current={selected === r.id ? 'true' : undefined}
                onClick={() => select(r.id)}
              >
                {r.spec.title}
              </button>
              <span>
                {r.spec.isActive ? '활성' : '비활성'} · {ruleSummary(formFor(r))} · 버전 {r.version}
              </span>
            </li>
          ))}
        </ul>
      )}
      {cursor && !denied && (
        <button type="button" disabled={busy || !online} onClick={() => void load(true)}>
          규칙 더 보기
        </button>
      )}
      {selected === '!invalid' ? (
        <p role="alert">반복 일정 주소의 규칙 ID를 확인해 주세요.</p>
      ) : (
        <RuleEditor
          key={`${userId}:${companyId}:${selected || 'new'}`}
          companyId={companyId}
          userId={userId}
          selected={selected}
          initial={items.find((r) => r.id === selected) ?? null}
          choices={choices}
          allowed={!denied && !!choices}
          onDenied={deny}
          onCreated={(id) => select(id, true)}
          onChanged={() => void load()}
          onDirty={(v) => {
            activeDirty.current = v;
          }}
        />
      )}
    </section>
  );
}
export function NewRecurrenceSchedule({
  companyId,
  userId,
  date,
  projectId,
  onChanged,
  onPendingChange,
}: {
  companyId: string;
  userId: string;
  date: string;
  projectId: string;
  onChanged: () => void;
  onPendingChange: (pending: boolean) => void;
}) {
  const [choices, setChoices] = useState<Choices | null>(null);
  const [selected, setSelected] = useState('');
  const [error, setError] = useState('');
  const [denied, setDenied] = useState(false);
  useEffect(() => {
    let active = true;
    void readRecurrenceChoices(companyId)
      .then(([projects, tags]) => {
        if (active) setChoices({ projects, tags });
      })
      .catch((e) => {
        if (active) {
          setError(recurrenceFailure(e));
          setDenied(true);
        }
        if (e instanceof WorkFailure && e.status === 401) recurrenceLogin(companyId);
      });
    return () => {
      active = false;
    };
  }, [companyId]);
  return (
    <section className="recurrence-page" aria-label="반복 일정 추가">
      <h3>반복 일정 추가</h3>
      <p>
        규칙을 저장한 다음 회차를 미리 보고 직접 생성합니다. 기존 회사별 초안이 있으면 복구합니다.
      </p>
      {error && <p role="alert">{error}</p>}
      <RuleEditor
        key={`${userId}:${companyId}:${selected || 'new'}`}
        companyId={companyId}
        userId={userId}
        selected={selected}
        initial={null}
        choices={choices}
        allowed={!denied && !!choices}
        onDenied={() => setDenied(true)}
        onChanged={onChanged}
        onCreated={(id) => {
          setSelected(id);
          onChanged();
        }}
        onDirty={() => {}}
        initialValues={{ date, projectId }}
        onPendingChange={onPendingChange}
      />
    </section>
  );
}
type Choices = {
  projects: z.output<typeof zWorkspaceProject>[];
  tags: z.output<typeof zAdminWorkTag>[];
};
function RuleEditor({
  companyId,
  userId,
  selected,
  initial,
  choices,
  allowed,
  onDenied,
  onChanged,
  onCreated,
  onDirty,
  initialValues,
  onPendingChange,
}: {
  companyId: string;
  userId: string;
  selected: string;
  initial: Rule | null;
  choices: Choices | null;
  allowed: boolean;
  onDenied: () => void;
  onChanged: () => void;
  onCreated: (id: string) => void;
  onDirty: (v: boolean) => void;
  initialValues?: { date: string; projectId: string };
  onPendingChange?: (pending: boolean) => void;
}) {
  const key = `wt:recurrence:v1:${encodeURIComponent(userId)}:${companyId}:${selected || 'new'}`;
  const [draft, setDraft] = useState<Draft>(() => {
    const old = getStored(key, zDraft);
    if (
      old &&
      old.companyId === companyId &&
      (!selected || old.id === selected) &&
      (!old.rule || (old.rule.id === old.id && old.rule.companyId === companyId)) &&
      (!old.command || old.command.kind !== 'create' || old.command.body.id === old.id)
    ) {
      if (
        initialValues &&
        !old.rule &&
        !old.command &&
        !old.form.title &&
        !old.form.content &&
        !isDirty(old)
      ) {
        const form = {
          ...old.form,
          startOn: initialValues.date,
          projectId: initialValues.projectId,
        };
        return {
          ...old,
          form,
          saved: form,
          applyFrom: initialValues.date,
          weekStart: initialValues.date,
          stopOn: initialValues.date,
          controlBase: {
            ...old.controlBase,
            applyFrom: initialValues.date,
            stopOn: initialValues.date,
          },
        };
      }
      return old;
    }
    const form = initial
      ? formFor(initial)
      : {
          ...blank(),
          ...(initialValues
            ? { startOn: initialValues.date, projectId: initialValues.projectId }
            : {}),
        };
    const controlDate = initialValues?.date ?? kstDate(Date.now());
    return {
      companyId,
      id: selected || crypto.randomUUID(),
      rule: initial,
      form,
      saved: form,
      applyFrom: controlDate,
      weekStart: controlDate,
      weekCount: '4',
      stopMode: 'end',
      stopOn: controlDate,
      existingFuture: '',
      controlBase: {
        applyFrom: controlDate,
        stopMode: 'end',
        stopOn: controlDate,
        existingFuture: '',
      },
      operation: 'generate',
      resolutions: {},
      resolutionBase: {},
      resolutionScope: '',
      command: null,
      receipt: null,
    };
  });
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [message, setMessage] = useState(draft.receipt?.message ?? ''),
    [forbidden, setForbidden] = useState(false),
    [observed, setObserved] = useState<Rule | null>(null),
    [stale, setStale] = useState(false),
    [preview, setPreview] = useState<Preview | null>(null),
    [prepared, setPrepared] = useState<RecurrenceCommand | null>(null);
  const mode = draft.operation,
    resolutions = draft.resolutions;
  function setMode(value: Draft['operation']) {
    update({ ...current.current, operation: value });
  }
  function setResolutions(value: Draft['resolutions']) {
    update({ ...current.current, resolutions: value });
  }
  const online = useOnline(),
    current = useRef(draft),
    alive = useRef(false),
    readTicket = useRef(0),
    lock = useRef(false),
    heading = useRef<HTMLHeadingElement>(null);
  current.current = draft;
  useEffect(() => {
    onPendingChange?.(busy);
    return () => onPendingChange?.(false);
  }, [busy, onPendingChange]);
  const changed = isDirty(draft);
  function update(d: Draft) {
    current.current = d;
    setWorkspaceDraftDirty(key, isDirty(d));
    onDirty(isDirty(d));
    put(key, d);
    setDraft(d);
  }
  function invalidate() {
    setPreview(null);
    setPrepared(null);
    setMessage('');
  }
  function formChange(patch: Partial<Form>) {
    update({ ...current.current, form: { ...current.current.form, ...patch } });
    invalidate();
  }
  useEffect(() => {
    alive.current = true;
    put(key, current.current);
    return () => {
      alive.current = false;
      readTicket.current++;
    };
  }, [key]);
  useEffect(() => {
    setWorkspaceDraftDirty(key, changed);
    onDirty(changed);
    return () => {
      setWorkspaceDraftDirty(key, false);
      onDirty(false);
    };
  }, [key, changed]);
  useEffect(() => {
    const before = (e: BeforeUnloadEvent) => {
      if (!isDirty(current.current)) return;
      e.preventDefault();
      e.returnValue = '';
    };
    addEventListener('beforeunload', before);
    return () => removeEventListener('beforeunload', before);
  }, []);
  useEffect(() => {
    const frame = requestAnimationFrame(() => {
      heading.current?.focus({ preventScroll: true });
      heading.current?.scrollIntoView({ block: 'start' });
    });
    return () => cancelAnimationFrame(frame);
  }, []);
  function fail(e: unknown) {
    if (e instanceof WorkFailure && [401, 403].includes(e.status)) {
      setForbidden(true);
      setObserved(null);
      setPreview(null);
      onDenied();
    }
    setError(recurrenceFailure(e));
    if (e instanceof WorkFailure && e.status === 401) recurrenceLogin(companyId);
  }
  async function observe() {
    const ticket = ++readTicket.current;
    setError('');
    try {
      const result = await readRule(companyId, current.current.id);
      if (!alive.current || ticket !== readTicket.current) return;
      setObserved(result.rule);
      setForbidden(false);
      if (current.current.command) {
        setMessage(
          '이 ID의 현재 규칙을 관측했습니다. 과거 명령 성공은 단정하지 않습니다. 고정 명령과 원문을 보존했습니다.',
        );
      } else if (!current.current.rule) {
        const form = formFor(result.rule);
        update({
          ...current.current,
          rule: result.rule,
          ...(!isDirty(current.current) ? { form, saved: form } : {}),
        });
      } else if (current.current.rule.version !== result.rule.version) {
        setStale(true);
        setMessage('현재 규칙 버전이 달라졌습니다. 원문 초안과 기존 버전을 유지했습니다.');
      } else setMessage(current.current.receipt?.message ?? '현재 규칙을 확인했습니다.');
    } catch (e) {
      if (alive.current && ticket === readTicket.current) fail(e);
    }
  }
  useEffect(() => {
    if (allowed) {
      setForbidden(false);
      if (selected && !current.current.command) void observe();
    }
  }, [allowed]);
  function spec() {
    if (!draft.form.holiday) throw new Error('EXPLICIT_POLICY_REQUIRED');
    return zRecurrenceSpec.parse({
      kind: draft.form.kind,
      projectId: draft.form.projectId || null,
      title: draft.form.title,
      content:
        draft.rule && draft.form.content === draft.saved.content
          ? draft.rule.spec.content
          : draft.form.content === '' && !draft.rule
            ? null
            : draft.form.content,
      tagIds: draft.form.tagIds,
      freq: draft.form.freq,
      timeMode: 'date_only',
      startOn: draft.form.startOn,
      endOn: draft.form.endOn || null,
      interval: /^[0-9]+$/.test(draft.form.interval) ? Number(draft.form.interval) : NaN,
      ...(draft.form.freq === 'weekly'
        ? { byweekday: draft.form.byweekday, intervalAnchor: 'initial_start_week' }
        : draft.form.freq === 'daily'
          ? { intervalAnchor: 'initial_start_day' }
          : {
              bymonthday: /^[0-9]+$/.test(draft.form.bymonthday)
                ? Number(draft.form.bymonthday)
                : NaN,
              invalidDayPolicy: draft.form.invalidDayPolicy,
              intervalAnchor: 'initial_start_month',
            }),
      holidayPolicy: draft.form.holiday,
      dueOffsetDays: 0,
      isActive: draft.rule?.spec.isActive ?? true,
    });
  }
  async function plan() {
    if (lock.current || !online || !draft.rule || draft.command || !allowed || forbidden || stale)
      return;
    lock.current = true;
    setBusy(true);
    setError('');
    invalidate();
    const ticket = ++readTicket.current;
    try {
      const weeks = recurrenceWeeks(draft.weekStart, draft.weekCount),
        commandId = crypto.randomUUID();
      let command: RecurrenceCommand;
      let value: Preview;
      if (mode === 'generate') {
        if (!same(draft.form, draft.saved) || !same(controls(draft), draft.controlBase))
          throw new Error('SAVE_CHANGES_FIRST');
        command = {
          kind: 'generate',
          body: zRecurrenceGenerate.parse({
            commandId,
            version: draft.rule.version,
            weeks,
            resolutions: [],
          }),
        };
        value = await readPreview(companyId, draft.id, weeks);
      } else if (mode === 'revise') {
        const next = spec(),
          old = draft.rule.spec;
        if (next.freq !== old.freq) throw new Error('FREQUENCY_IMMUTABLE');
        const fields = [
          'kind',
          'projectId',
          'title',
          'content',
          'tagIds',
          'endOn',
          'interval',
        ] as const;
        const patch: Record<string, unknown> = Object.fromEntries(
          fields.filter((k) => !same(next[k], old[k])).map((k) => [k, next[k]]),
        );
        if (next.freq === 'weekly' && old.freq === 'weekly') {
          if (!same(next.byweekday, old.byweekday)) patch.byweekday = next.byweekday;
        } else if (next.freq === 'monthly' && old.freq === 'monthly') {
          if (next.bymonthday !== old.bymonthday) patch.bymonthday = next.bymonthday;
          if (next.invalidDayPolicy !== old.invalidDayPolicy)
            patch.invalidDayPolicy = next.invalidDayPolicy;
        }
        if (Object.keys(patch).length === 0) throw new Error('NO_CHANGE');
        command = {
          kind: 'revise',
          body: zRecurrencePatch.parse({
            commandId,
            version: draft.rule.version,
            applyFrom: draft.applyFrom,
            intervalAnchor: old.intervalAnchor,
            weeks,
            patch,
            resolutions: [],
          }),
        };
        value = await previewChange(companyId, draft.id, { intent: 'revise', ...command.body });
      } else {
        command = {
          kind: 'stop',
          body: zRecurrenceStop.parse({
            commandId,
            version: draft.rule.version,
            mode: draft.stopMode,
            on: draft.stopOn,
            existingFuture: draft.existingFuture,
            weeks,
          }),
        };
        value = await previewChange(companyId, draft.id, { intent: 'stop', ...command.body });
      }
      if (!alive.current || ticket !== readTicket.current) return;
      if (value.sourceVersion !== draft.rule.version)
        throw new WorkFailure(409, 'VERSION_CONFLICT');
      const { commandId: previewId, ...scopeBody } = command.body;
      void previewId;
      const scope = JSON.stringify({ ruleId: draft.id, kind: command.kind, body: scopeBody });
      const sameScope = current.current.resolutionScope === scope;
      if (
        !sameScope &&
        !same(current.current.resolutions, current.current.resolutionBase) &&
        !confirm('보존한 회차 날짜·선택을 지우고 다른 범위의 미리보기를 열까요?')
      ) {
        setError(
          '기존 회차 선택을 보존했습니다. 같은 범위로 돌아가거나 새 범위 전환을 직접 선택해 주세요.',
        );
        return;
      }
      const seed: Draft['resolutions'] = Object.fromEntries(
        value.occurrences
          .filter((x) => x.requiresResolution)
          .map((x) => [
            x.occurrenceDate,
            { action: '', plannedDate: x.plannedDate ?? x.occurrenceDate },
          ]),
      );
      update({
        ...current.current,
        resolutionScope: scope,
        resolutions: sameScope ? current.current.resolutions : seed,
        resolutionBase: sameScope ? current.current.resolutionBase : seed,
      });
      setPreview(value);
      setPrepared(command);
    } catch (e) {
      if (alive.current && ticket === readTicket.current) {
        setError(
          e instanceof WorkFailure
            ? recurrenceFailure(e)
            : '반복 조건·없는 날짜 정책·휴무 처리의 명시 선택·적용일·1~26주와 회차별 확인을 점검해 주세요.',
        );
      }
    } finally {
      lock.current = false;
      if (alive.current) setBusy(false);
    }
  }
  async function execute(command: RecurrenceCommand, retry = false) {
    if (lock.current || !online || (!retry && (!allowed || forbidden))) return;
    if (
      retry &&
      !confirm(
        '같은 명령 ID·같은 제출값을 다시 보냅니다. 아직 처리되지 않았다면 이 작업이 실행될 수 있습니다. 계속할까요?',
      )
    )
      return;
    lock.current = true;
    readTicket.current++;
    setBusy(true);
    setError('');
    setMessage('');
    update({ ...current.current, command, receipt: null });
    try {
      const result = await submitRecurrence(companyId, draft.id, command);
      if (!alive.current) return;
      const rule = result.rule ?? current.current.rule;
      if (!rule) throw new WorkFailure(0, 'INVALID_RESPONSE');
      const form = formFor(rule);
      const receipt = {
        commandId: command.body.commandId,
        message: result.generation
          ? generationMessage(result.generation)
          : '규칙을 저장했습니다. 회차는 미리보기 후 직접 생성하세요.',
      };
      const completed = {
        ...current.current,
        rule,
        form,
        saved: form,
        receipt,
        resolutions: {},
        resolutionBase: {},
        resolutionScope: '',
        command: null,
        controlBase: controls(current.current),
      };
      update(completed);
      if (command.kind === 'create') {
        put(`wt:recurrence:v1:${encodeURIComponent(userId)}:${companyId}:${rule.id}`, completed);
        try {
          sessionStorage.removeItem(key);
        } catch {
          /* The acknowledged rule remains in memory. */
        }
        onCreated(rule.id);
      }
      setStale(false);
      setForbidden(false);
      setObserved(rule);
      invalidate();
      setMessage(
        result.generation
          ? generationMessage(result.generation)
          : '규칙을 저장했습니다. 회차는 미리보기 후 직접 생성하세요.',
      );
      onChanged();
    } catch (e) {
      if (!alive.current) return;
      if (e instanceof WorkFailure && [400, 409, 422].includes(e.status)) {
        update({ ...current.current, command: null });
        if (e.status === 409) setStale(true);
      }
      fail(e);
    } finally {
      lock.current = false;
      if (alive.current) setBusy(false);
    }
  }
  function create() {
    try {
      const { isActive: _, ...value } = spec();
      void _;
      const command: RecurrenceCommand = {
        kind: 'create',
        body: zRecurrenceCreate.parse({ id: draft.id, commandId: crypto.randomUUID(), ...value }),
      };
      void execute(command);
    } catch {
      setError(
        '업무 종류·프로젝트·제목·시작일·반복 조건·1~12 간격과 휴무 처리의 명시 선택을 확인해 주세요. 월간은 없는 날짜 정책도 선택해야 합니다.',
      );
    }
  }
  function apply() {
    if (!prepared || !preview) return;
    try {
      let command = prepared;
      if (command.kind !== 'stop') {
        const selectedResolutions: RecurrenceResolution[] = preview.occurrences
          .filter((x) => x.requiresResolution)
          .map((x) => {
            const r = resolutions[x.occurrenceDate];
            if (!r?.action) throw new Error('CONFIRM');
            if (r.action === 'skip') {
              if (x.metadata) throw new Error('EXISTING_SKIP');
              return { occurrenceDate: x.occurrenceDate, action: 'skip' };
            }
            return {
              occurrenceDate: x.occurrenceDate,
              action: 'confirm',
              plannedDate: r.plannedDate,
            };
          });
        command = zRecurrenceCommand.parse({
          ...command,
          body: { ...command.body, resolutions: selectedResolutions },
        });
      }
      if (
        !confirm(
          '미리 본 범위와 회차별 선택을 적용할까요? 보존으로 표시한 기존 기록은 변경하지 않습니다.',
        )
      )
        return;
      void execute(command);
    } catch {
      setError(
        '미리보기에서 각 새 회차·재적용 회차를 직접 확인해 주세요. 기존 회차의 취소는 원래 업무 화면에서 실행하세요.',
      );
    }
  }
  const disabled = busy || !online || !!draft.command || stale || !allowed || forbidden;
  const hidden = !allowed || forbidden;
  return (
    <section className="recurrence-editor" aria-label="반복 규칙 편집">
      <h2 ref={heading} tabIndex={-1}>
        {draft.rule ? '반복 규칙 검토' : '새 반복 규칙'}
      </h2>
      {error && <p role="alert">{error}</p>}
      {message && <p role="status">{message}</p>}
      {draft.command && (
        <div className="recurrence-recovery">
          <p role="status">
            {busy ? '명령 처리 중' : '저장 결과 확인 필요'} · 고정 명령 ID{' '}
            {draft.command.body.commandId}
          </p>
          <p>조회는 현재 기록만 확인합니다. 같은 명령 재제출은 미처리 작업을 실행할 수 있습니다.</p>
          <RefreshButton
            type="button"
            disabled={busy || !online}
            onClick={() => void observe()}
            busy={!!busy}
            showLabel
          >
            현재 규칙 확인
          </RefreshButton>
          <button
            type="button"
            disabled={busy || !online}
            onClick={() => void execute(draft.command!, true)}
          >
            같은 명령으로 다시 제출
          </button>
        </div>
      )}
      {hidden && (
        <p>내용을 숨겼습니다. 사용자·회사·규칙 ID별 원문 초안과 미확인 명령은 보존됩니다.</p>
      )}
      <div hidden={hidden}>
        <p className="recurrence-hint">
          규칙 ID {draft.id}
          {draft.rule
            ? ` · 버전 ${draft.rule.version} · ${draft.rule.spec.isActive ? '활성' : '비활성'}`
            : ''}
        </p>
        {draft.rule && (
          <RefreshButton
            type="button"
            disabled={busy || !online}
            onClick={() => void observe()}
            busy={!!busy}
          >
            현재 규칙 조회
          </RefreshButton>
        )}
        {stale && observed && !draft.command && (
          <button
            type="button"
            disabled={busy || !online}
            onClick={() => {
              update({ ...current.current, rule: observed, saved: formFor(observed) });
              setStale(false);
              invalidate();
              setMessage(
                '현재 버전을 명시 선택했습니다. 보존한 원문 초안을 비교한 뒤 미리 보세요.',
              );
            }}
          >
            현재 버전으로 초안 검토
          </button>
        )}
        <fieldset disabled={disabled || (!!draft.rule && !draft.rule.spec.isActive)}>
          <legend>날짜 전용 반복 규칙</legend>
          <div className="recurrence-fields">
            <label>
              반복 종류
              <select
                value={draft.form.freq}
                disabled={!!draft.rule}
                onChange={(e) => formChange({ freq: e.target.value as Form['freq'] })}
              >
                <option value="daily">일간</option>
                <option value="weekly">주간</option>
                <option value="monthly">월간</option>
              </select>
            </label>
            <label>
              반복 업무 종류
              <select
                value={draft.form.kind}
                onChange={(e) => formChange({ kind: e.target.value as Form['kind'] })}
              >
                <option value="task">업무</option>
                <option value="meeting">회의</option>
                <option value="field">외근</option>
                <option value="etc">기타</option>
              </select>
            </label>
            <label>
              반복 프로젝트{draft.form.kind === 'task' ? ' (필수)' : ' (선택)'}
              <select
                value={draft.form.projectId}
                onChange={(e) => formChange({ projectId: e.target.value })}
              >
                <option value="">선택</option>
                {choices?.projects.map((p) => (
                  <option
                    value={p.id}
                    key={p.id}
                    disabled={!p.isActive && draft.form.projectId !== p.id}
                  >
                    {p.code}
                    {p.isActive ? '' : ' (비활성)'}
                  </option>
                ))}
              </select>
            </label>
            <label className="recurrence-wide">
              반복 제목
              <input
                maxLength={200}
                value={draft.form.title}
                onChange={(e) => formChange({ title: e.target.value })}
              />
            </label>
            <label className="recurrence-wide">
              반복 본문 (선택)
              <textarea
                maxLength={5000}
                value={draft.form.content}
                onChange={(e) => formChange({ content: e.target.value })}
              />
            </label>
            <label>
              반복 시작일
              <input
                type="date"
                value={draft.form.startOn}
                disabled={!!draft.rule}
                onChange={(e) => formChange({ startOn: e.target.value })}
              />
            </label>
            <label>
              반복 종료일 (선택)
              <input
                type="date"
                value={draft.form.endOn}
                onChange={(e) => formChange({ endOn: e.target.value })}
              />
            </label>
            <label>
              반복 간격 ({intervalUnits[draft.form.freq]})
              <input
                type="number"
                min={1}
                max={12}
                step={1}
                value={draft.form.interval}
                onChange={(e) => formChange({ interval: e.target.value })}
              />
            </label>
            {draft.form.freq === 'monthly' && (
              <>
                <label>
                  매월 반복 일자 (1~31일)
                  <input
                    type="number"
                    min={1}
                    max={31}
                    step={1}
                    value={draft.form.bymonthday}
                    onChange={(e) => formChange({ bymonthday: e.target.value })}
                  />
                </label>
                <label>
                  없는 날짜 처리 (명시 선택)
                  <select
                    value={draft.form.invalidDayPolicy}
                    onChange={(e) =>
                      formChange({ invalidDayPolicy: e.target.value as Form['invalidDayPolicy'] })
                    }
                  >
                    <option value="">선택해 주세요</option>
                    <option value="skip">해당 월 건너뛰기 (skip)</option>
                    <option value="last_day">해당 월 마지막 날 (last_day)</option>
                  </select>
                </label>
              </>
            )}
            <label>
              휴무 처리 (명시 선택)
              <select
                value={draft.form.holiday}
                disabled={!!draft.rule}
                onChange={(e) => formChange({ holiday: e.target.value as Form['holiday'] })}
              >
                <option value="">선택해 주세요</option>
                <option value="ask">회차마다 확인 (ask)</option>
              </select>
            </label>
          </div>
          {draft.form.freq === 'weekly' && (
            <fieldset>
              <legend>반복 요일</legend>
              {days.map((name, i) => (
                <label className="recurrence-check" key={name}>
                  <input
                    type="checkbox"
                    checked={draft.form.byweekday.includes(i + 1)}
                    onChange={(e) =>
                      formChange({
                        byweekday: e.target.checked
                          ? [...draft.form.byweekday, i + 1].sort((a, b) => a - b)
                          : draft.form.byweekday.filter((d) => d !== i + 1),
                      })
                    }
                  />
                  {name}요일
                </label>
              ))}
            </fieldset>
          )}
          <fieldset>
            <legend>반복 업무 태그 (선택 · 최대 100개)</legend>
            {choices?.tags.map((t) => (
              <label className="recurrence-check" key={t.id}>
                <input
                  type="checkbox"
                  checked={draft.form.tagIds.includes(t.id)}
                  disabled={
                    (!t.isActive || draft.form.tagIds.length >= 100) &&
                    !draft.form.tagIds.includes(t.id)
                  }
                  onChange={(e) =>
                    formChange({
                      tagIds: e.target.checked
                        ? [...draft.form.tagIds, t.id].sort()
                        : draft.form.tagIds.filter((id) => id !== t.id),
                    })
                  }
                />
                {t.label}
                {t.isActive ? '' : ' (비활성)'}
              </label>
            ))}
          </fieldset>
          <p className="recurrence-summary">{ruleSummary(draft.form)}</p>
          {draft.form.freq === 'monthly' && (
            <HelpHint label="월말 반복 정책">
              예: 31일이 없는 2월·4월은 선택한 정책에 따라 그 달을 건너뛰거나 마지막 날에
              배정됩니다. 휴무일 날짜 확인은 별도로 필요합니다.
            </HelpHint>
          )}
          <p className="recurrence-hint">
            {anchorSummary(draft.form)} 이후 변경 적용일에서 간격을 다시 시작하지 않습니다. 반복
            종류·시작일·휴무 정책을 바꾸려면 새 규칙을 만드세요.
          </p>
          {!draft.rule && (
            <button type="button" disabled={disabled || !isDirty(draft)} onClick={create}>
              규칙 저장
            </button>
          )}
        </fieldset>
        {draft.rule && (
          <>
            <fieldset disabled={disabled}>
              <legend>명시 작업 범위</legend>
              <div className="recurrence-fields">
                <label>
                  반복 작업
                  <select
                    value={mode}
                    onChange={(e) => {
                      setMode(e.target.value as typeof mode);
                      invalidate();
                    }}
                  >
                    <option value="generate">회차 생성</option>
                    <option value="revise">이 날짜부터 규칙 수정</option>
                    <option value="stop">종료 · 비활성</option>
                  </select>
                </label>
                <label>
                  조회할 주의 기준 날짜
                  <input
                    type="date"
                    value={draft.weekStart}
                    onChange={(e) => {
                      update({ ...draft, weekStart: e.target.value });
                      invalidate();
                    }}
                  />
                </label>
                <label>
                  요청 주 수 (최대 26)
                  <input
                    type="number"
                    min={1}
                    max={26}
                    value={draft.weekCount}
                    onChange={(e) => {
                      update({ ...draft, weekCount: e.target.value });
                      invalidate();
                    }}
                  />
                </label>
                {mode === 'revise' && (
                  <label>
                    수정 적용 시작일
                    <input
                      type="date"
                      value={draft.applyFrom}
                      onChange={(e) => {
                        update({ ...draft, applyFrom: e.target.value });
                        invalidate();
                      }}
                    />
                  </label>
                )}
                {mode === 'stop' && (
                  <>
                    <label>
                      중지 방식
                      <select
                        value={draft.stopMode}
                        onChange={(e) => {
                          update({
                            ...draft,
                            stopMode: e.target.value as Draft['stopMode'],
                          });
                          invalidate();
                        }}
                      >
                        <option value="end">종료일 포함 후 중지</option>
                        <option value="deactivate">지정일부터 비활성</option>
                      </select>
                    </label>
                    <label>
                      종료 · 비활성 기준일
                      <input
                        type="date"
                        value={draft.stopOn}
                        onChange={(e) => {
                          update({ ...draft, stopOn: e.target.value });
                          invalidate();
                        }}
                      />
                    </label>
                    <label>
                      이미 생성한 미래 회차
                      <select
                        value={draft.existingFuture}
                        onChange={(e) => {
                          update({
                            ...draft,
                            existingFuture: e.target.value as Draft['existingFuture'],
                          });
                          invalidate();
                        }}
                      >
                        <option value="">명시 선택</option>
                        <option value="preserve">기존 회차 보존</option>
                        <option value="cancel_untouched">수정되지 않은 회차 취소</option>
                      </select>
                    </label>
                  </>
                )}
              </div>
              <button type="button" onClick={() => void plan()}>
                회차 미리보기
              </button>
            </fieldset>
            {preview && prepared && (
              <section className="recurrence-preview" aria-label="반복 회차 미리보기">
                <h3>회차 미리보기</h3>
                <p className="recurrence-summary">{ruleSummary(formFor(preview.rule))}</p>
                <p>
                  원본 날짜별 회차를 유지합니다. 생성 전 확인을 모두 선택해 주세요. 이미
                  생성·삭제·건너뛴 회차는 새 회차로 만들지 않습니다.
                </p>
                {preview.monthlyDecisions && (
                  <div className="recurrence-monthly-decisions" aria-label="월별 날짜 처리 확인">
                    <h4>월별 날짜 처리 확인</h4>
                    <p className="recurrence-hint">
                      지정한 일자가 없는 달은 아래 정책대로 처리합니다. 요청한 ISO주에 포함된 실제
                      날짜만 회차 목록에 표시되며, 건너뛴 달의 업무는 생성하지 않습니다.
                    </p>
                    <ul>
                      {preview.monthlyDecisions.map((d) => (
                        <li key={`${d.revision}:${d.month}:${d.requestedDay}`}>
                          <strong>{d.month}</strong> · 개정 {d.revision} · 지정 {d.requestedDay}일 ·{' '}
                          {d.reason === 'skip_missing_day'
                            ? '없는 날짜: 해당 월 건너뛰기 (skip)'
                            : d.reason === 'last_day'
                              ? `없는 날짜: 해당 월 마지막 날 ${d.actualDate} (last_day)`
                              : `지정한 날짜 ${d.actualDate}`}
                          {!d.inRequestedWeeks && d.actualDate && ' · 실제 날짜는 요청 주 밖'}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
                {!preview.occurrences.length && <p>이 요청 범위의 회차가 없습니다.</p>}
                <ul>
                  {preview.occurrences.map((o) => (
                    <li key={o.occurrenceDate}>
                      <strong>{o.occurrenceDate}</strong> · {dispositionLabel[o.disposition]}
                      <span>
                        {' '}
                        ·{' '}
                        {o.calendar === 'unsupported'
                          ? '휴일 정보 미지원'
                          : (o.holidayName ?? (o.weekend ? '주말' : '휴일 아님'))}
                      </span>
                      {o.plannedDate && <span> · 현재 예정일 {o.plannedDate}</span>}
                      {o.metadata && (
                        <p className="recurrence-hint">
                          원래 업무 ID {o.metadata.originalWorkEntryId}
                          {o.metadata.liveWorkEntryId === null ? ' · 현재 연결 업무 없음' : ''}
                        </p>
                      )}
                      {o.metadata?.liveWorkEntryId && (
                        <a
                          className="control-link"
                          href={workURL(
                            companyId,
                            o.metadata.liveWorkEntryId,
                            o.plannedDate ?? o.occurrenceDate,
                          )}
                        >
                          원래 업무에서 회차 이동·취소
                        </a>
                      )}
                      {o.requiresResolution && (
                        <div className="recurrence-fields">
                          <label>
                            {o.occurrenceDate} 회차 확인
                            <select
                              value={resolutions[o.occurrenceDate]?.action ?? ''}
                              disabled={disabled}
                              onChange={(e) =>
                                setResolutions({
                                  ...resolutions,
                                  [o.occurrenceDate]: {
                                    action: e.target.value as '' | 'confirm' | 'skip',
                                    plannedDate:
                                      resolutions[o.occurrenceDate]?.plannedDate ??
                                      o.occurrenceDate,
                                  },
                                })
                              }
                            >
                              <option value="">선택해 주세요</option>
                              <option value="confirm">날짜를 직접 확인</option>
                              {!o.metadata && <option value="skip">이번 회차 건너뛰기</option>}
                            </select>
                          </label>
                          {resolutions[o.occurrenceDate]?.action === 'confirm' && (
                            <label>
                              {o.occurrenceDate} 확정 날짜
                              <input
                                type="date"
                                disabled={disabled}
                                value={resolutions[o.occurrenceDate]?.plannedDate ?? ''}
                                onChange={(e) =>
                                  setResolutions({
                                    ...resolutions,
                                    [o.occurrenceDate]: {
                                      action: 'confirm',
                                      plannedDate: e.target.value,
                                    },
                                  })
                                }
                              />
                            </label>
                          )}
                        </div>
                      )}
                    </li>
                  ))}
                </ul>
                {preview.pendingWeeks.length > 0 && (
                  <p>
                    아직 반영되지 않은 주:{' '}
                    {preview.pendingWeeks
                      .map((w) => `${w.isoYear}-W${String(w.isoWeek).padStart(2, '0')}`)
                      .join(', ')}
                  </p>
                )}
                <button type="button" disabled={disabled} onClick={apply}>
                  {prepared.kind === 'generate'
                    ? '선택한 회차 생성'
                    : prepared.kind === 'revise'
                      ? '미리 본 변경 적용'
                      : '미리 본 종료 적용'}
                </button>
              </section>
            )}
          </>
        )}
      </div>
    </section>
  );
}
const dispositionLabel: Record<Preview['occurrences'][number]['disposition'], string> = {
  new: '새 회차',
  unchanged: '변경 없음',
  reapply: '재적용 검토',
  removed: '규칙에서 제외',
  preserved: '기존 기록 보존',
  deleted: '삭제된 원래 업무',
  skipped: '건너뛴 회차',
  historical: '종료된 주 · 생성 불가',
};
function generationMessage(g: Generation) {
  return `명령 처리 확인 · 생성 ${g.created} · 수정 ${g.updated} · 취소 ${g.canceled} · 복원 ${g.restored} · 보존 ${g.preserved} · 건너뜀 ${g.skipped} · 변경 없음 ${g.unchanged}`;
}
function workURL(company: string, id: string, date: string) {
  return `/c/${company}/day?${new URLSearchParams({ year: String(Number(date.slice(0, 4))), date, entryId: id })}`;
}
