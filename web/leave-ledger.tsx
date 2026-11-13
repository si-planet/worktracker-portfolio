import { HelpHint } from './help-hint';
import { RefreshButton } from './ui-controls';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { z } from 'zod';
import {
  zLeaveGrant,
  zLeavePolicy,
  zLeaveLedgerPreview,
  zLeaveLedgerWorkPreview,
  zLeaveWorkOperation,
  zLeaveWorkResult,
  type LeaveGrant,
  type LeavePolicy,
  type LeaveLedgerState,
  zLeaveLedgerSummary,
  type LeaveLedgerPreview,
  type LeaveAccountingMetadata,
  type LeaveWorkOperation,
} from '../shared/schema/leave-ledger';
import { zWorkEntryDate, type WorkEntryFinal } from '../shared/schema/work-entry';
import {
  workspaceDefaultYear,
  zWorkspaceCompany,
  zWorkspaceSettings,
  zWorkspaceYear,
} from '../shared/schema/workspace';
import { kstDate } from '../shared/work-entry-rules';
import { setWorkspaceDraftDirty, workspaceHasUnsavedChanges } from './workspace-draft-state';
import { WorkFailure, workApi, workEntrySchema, readWorkDuplicate } from './work-entry-api';
import {
  canonicalLedger,
  ledgerCommandId,
  ledgerFailure,
  ledgerGrants,
  ledgerMetadata,
  ledgerPolicies,
  ledgerPreview,
  ledgerReceipt,
  ledgerReturnTo,
  ledgerState,
  ledgerSubmit,
  ledgerSummary,
  zLedgerCommand,
  type LedgerCommand,
  type LedgerResult,
} from './leave-ledger-api';
import './leave-ledger.css';

type LeaveLedgerSummary = z.output<typeof zLeaveLedgerSummary>;
const same = (a: unknown, b: unknown) => canonicalLedger(a) === canonicalLedger(b);
function store(key: string, value: unknown) {
  try {
    sessionStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* The current draft remains in memory. */
  }
}
function read<T extends z.ZodType>(key: string, schema: T, fallback: z.output<T>) {
  try {
    const raw = sessionStorage.getItem(key);
    if (raw) {
      const value = schema.safeParse(JSON.parse(raw));
      if (value.success) return value.data;
    }
  } catch {
    /* Invalid or unavailable storage is not trusted. */
  }
  return fallback;
}
function useOnline() {
  const [online, set] = useState(navigator.onLine);
  useEffect(() => {
    const update = () => set(navigator.onLine);
    addEventListener('online', update);
    addEventListener('offline', update);
    return () => {
      removeEventListener('online', update);
      removeEventListener('offline', update);
    };
  }, []);
  return online;
}
function useDirty(key: string, dirty: boolean, beforeUnload = true) {
  const current = useRef(dirty);
  current.current = dirty;
  useEffect(() => {
    setWorkspaceDraftDirty(key, dirty);
    return () => setWorkspaceDraftDirty(key, false);
  }, [key, dirty]);
  useEffect(() => {
    const before = (e: BeforeUnloadEvent) => {
      if (beforeUnload && current.current) {
        e.preventDefault();
        e.returnValue = '';
      }
    };
    addEventListener('beforeunload', before);
    return () => removeEventListener('beforeunload', before);
  }, [beforeUnload]);
}
function useNavigationGuard() {
  useEffect(() => {
    const nav = () =>
      (window as Window & { navigation?: { currentEntry?: { index: number } } }).navigation
        ?.currentEntry?.index;
    let url = location.href,
      index = nav(),
      state: unknown = history.state,
      returning = false;
    const pop = (e: PopStateEvent) => {
      if (returning) {
        returning = false;
        e.stopImmediatePropagation();
        return;
      }
      if (
        workspaceHasUnsavedChanges() &&
        !confirm('연차 초안과 미확인 명령을 보관하고 이동할까요?')
      ) {
        e.stopImmediatePropagation();
        const next = nav();
        if (index !== undefined && next !== undefined && index !== next) {
          returning = true;
          history.go(index - next);
        } else history.replaceState(state, '', url);
      } else {
        url = location.href;
        index = nav();
        state = history.state;
      }
    };
    const remember = () => {
      url = location.href;
      index = nav();
      state = history.state;
    };
    addEventListener('wt:leave-context', remember);
    addEventListener('popstate', pop, true);
    return () => {
      removeEventListener('wt:leave-context', remember);
      removeEventListener('popstate', pop, true);
    };
  }, []);
}
function useCommandSession(
  key: string,
  onDone: (command: LedgerCommand, result: LedgerResult, historical: boolean) => void,
  onFailure: (e: unknown) => void,
  hostGuard = false,
) {
  const [command, setCommand] = useState(() => read(key, zLedgerCommand.nullable(), null));
  const ref = useRef(command);
  ref.current = command;
  const [busy, setBusy] = useState(false),
    [message, setMessage] = useState('');
  const lock = useRef(false),
    alive = useRef(true),
    done = useRef(onDone),
    fail = useRef(onFailure);
  done.current = onDone;
  fail.current = onFailure;
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  useDirty(key, !!command || busy, !hostGuard);
  function keep(value: LedgerCommand | null) {
    ref.current = value;
    store(key, value);
    setCommand(value);
  }
  async function historicalResult(company: string, command: LedgerCommand, result: LedgerResult) {
    try {
      if (command.kind === 'work' && command.request.sourceEntryId) {
        const source = await readWorkDuplicate(company, command.request.sourceEntryId);
        if (source.sourceVersion !== command.request.sourceVersion)
          return 'source_changed' as const;
      }
      const now = await ledgerState(company);
      const before =
        'input' in command.request
          ? command.request.input.ledgerVersion
          : command.request.ledgerVersion;
      const expected =
        'ledgerVersion' in result ? result.ledgerVersion : before === null ? null : before + 1;
      if (now.ledgerVersion !== expected) return true;
      if (command.kind === 'work' && 'entries' in result) {
        for (const value of result.entries) {
          if (!value.entry) continue;
          const current = command.request.sourceEntryId
            ? (await readWorkDuplicate(company, value.entryId)).entry
            : await workApi(
                `/api/work-entries/${value.entryId}`,
                workEntrySchema(company, value.entryId),
              );
          if (current.version !== value.entry.version) return true;
        }
      }
      return false;
    } catch (e) {
      fail.current(e);
      return true;
    }
  }
  async function execute(company: string, input: LedgerCommand, replay = false) {
    if (lock.current || !navigator.onLine) return;
    if (
      replay &&
      !confirm(
        '같은 명령 ID와 같은 제출값을 다시 보냅니다. 아직 처리되지 않았다면 실행될 수 있습니다. 계속할까요?',
      )
    )
      return;
    const parsed = zLedgerCommand.parse(input);
    lock.current = true;
    setBusy(true);
    setMessage('');
    keep(parsed);
    try {
      const result = await ledgerSubmit(company, parsed);
      if (!alive.current) return;
      const observation = await historicalResult(company, parsed, result);
      const historical = observation !== false;
      if (!alive.current) return;
      keep(null);
      setMessage(
        `${observation === 'source_changed' ? '명령의 과거 저장 확인 · 원본 버전이 이후 변경되었습니다. 입력을 보관하고 현재 원본을 확인하세요' : historical ? '명령의 과거 저장 확인 · 현재 자료는 다시 조회하세요' : '저장 응답 확인'} · ${ledgerCommandId(parsed)}`,
      );
      done.current(parsed, result, historical);
    } catch (e) {
      if (!alive.current) return;
      if (e instanceof WorkFailure && [400, 409, 422].includes(e.status)) keep(null);
      fail.current(e);
    } finally {
      lock.current = false;
      if (alive.current) setBusy(false);
    }
  }
  async function recover(company: string) {
    const pending = ref.current;
    if (!pending || lock.current || !navigator.onLine) return;
    lock.current = true;
    setBusy(true);
    try {
      const receipt = await ledgerReceipt(company, pending);
      if (!alive.current) return;
      const observation = await historicalResult(company, pending, receipt.result);
      const historical = observation !== false;
      if (!alive.current) return;
      keep(null);
      setMessage(
        `${observation === 'source_changed' ? '명령의 과거 저장 확인 · 원본 버전이 이후 변경되었습니다. 입력을 보관하고 현재 원본을 확인하세요' : historical ? '명령의 과거 저장 확인 · 현재 자료는 다시 조회하세요' : '명령 영수증 확인'} · ${receipt.id}`,
      );
      done.current(pending, receipt.result, historical);
    } catch (e) {
      if (alive.current) fail.current(e);
    } finally {
      lock.current = false;
      if (alive.current) setBusy(false);
    }
  }
  return { command, busy, message, execute, recover };
}
function Recovery({
  session,
  company,
}: {
  session: ReturnType<typeof useCommandSession>;
  company: string;
}) {
  return (
    <>
      {session.message && <p role="status">{session.message}</p>}
      {session.command && (
        <div className="leave-recovery">
          <p role="status">저장 결과 확인 필요 · 명령 {ledgerCommandId(session.command)}</p>
          <RefreshButton
            type="button"
            disabled={session.busy || !navigator.onLine}
            onClick={() => void session.recover(company)}
            busy={session.busy}
            showLabel
          >
            명령 영수증 확인
          </RefreshButton>
          <button
            type="button"
            disabled={session.busy || !navigator.onLine}
            onClick={() => void session.execute(company, session.command!, true)}
          >
            같은 연차 명령 다시 제출
          </button>
        </div>
      )}
    </>
  );
}
const orderLabels = {
  expires_first: '만료 빠른 순',
  carryover_first: '이전 발생연도 우선',
  granted_first: '부여일 빠른 순',
};
const phaseLabels = {
  unavailable: '장부 기능 미설치',
  not_started: '장부 미시작',
  draft: '장부 초안 · 아직 미관리',
  active: '장부 관리 중',
};
const blankGrant = () => ({
  id: crypto.randomUUID(),
  originYear: '',
  grantType: 'base',
  grantedHours: '',
  grantedOn: '',
  validFrom: '',
  expiresOn: '',
  workHoursPerDaySnapshot: '',
  basisNote: '',
  sourceReference: '',
  remainingAsOf: '',
});
const zGrantForm = z.strictObject({
  id: z.uuid(),
  originYear: z.string(),
  grantType: z.string(),
  grantedHours: z.string(),
  grantedOn: z.string(),
  validFrom: z.string(),
  expiresOn: z.string(),
  workHoursPerDaySnapshot: z.string(),
  basisNote: z.string(),
  sourceReference: z.string(),
  remainingAsOf: z.string(),
});
type GrantForm = z.output<typeof zGrantForm>;
const fromGrant = (g: LeaveGrant): GrantForm => ({
  id: g.id,
  originYear: String(g.originYear),
  grantType: g.grantType,
  grantedHours: String(g.grantedHours),
  grantedOn: g.grantedOn,
  validFrom: g.validFrom,
  expiresOn: g.expiresOn,
  workHoursPerDaySnapshot:
    g.workHoursPerDaySnapshot === null ? '' : String(g.workHoursPerDaySnapshot),
  basisNote: g.basisNote ?? '',
  sourceReference: g.sourceReference ?? '',
  remainingAsOf: g.remainingAsOf ?? '',
});
const zModel = z.strictObject({
  setup: z.strictObject({ cutover: z.string(), accepted: z.boolean() }),
  setupBase: z.string(),
  policy: z.strictObject({
    year: z.string(),
    order: z.string(),
    original: zLeavePolicy.nullable(),
  }),
  policyBase: z.string(),
  grant: zGrantForm,
  grantBase: z.string(),
  original: zLeaveGrant.nullable(),
});
function freshModel() {
  const setup = { cutover: '', accepted: false },
    policy = { year: '', order: 'expires_first', original: null },
    grant = blankGrant();
  return {
    setup,
    setupBase: canonicalLedger(setup),
    policy,
    policyBase: canonicalLedger(policy),
    grant,
    grantBase: canonicalLedger(grant),
    original: null,
  };
}
function originalLink(company: string, entry: { entryId: string; plannedDate: string | null }) {
  if (!entry.plannedDate) return null;
  return `/c/${company}/day?${new URLSearchParams({ year: entry.plannedDate.slice(0, 4), date: entry.plannedDate, entryId: entry.entryId })}`;
}
export function LeaveImpact({
  value,
  company,
  disabled,
  onApply,
  onCancel,
}: {
  value: LeaveLedgerPreview;
  company: string;
  disabled: boolean;
  onApply: () => void;
  onCancel: () => void;
}) {
  const heading = useRef<HTMLHeadingElement>(null);
  const [confirmed, setConfirmed] = useState(false);
  useEffect(() => {
    setConfirmed(false);
    const frame = requestAnimationFrame(() => {
      heading.current?.focus({ preventScroll: true });
      heading.current?.scrollIntoView({ block: 'start' });
    });
    return () => cancelAnimationFrame(frame);
  }, [value.previewFingerprint]);
  return (
    <section className="leave-impact" aria-label="연차 변경 미리보기">
      <h3 ref={heading} tabIndex={-1}>
        연차 변경 미리보기
      </h3>
      <p>
        평가일 {value.evaluationDate} · 장부 버전 {value.ledgerVersion} · 부족{' '}
        {value.insufficientHours}시간
      </p>
      <p>현재 확정 배분의 전후 결과입니다. 명시 적용 전에는 저장하지 않습니다.</p>
      <dl className="leave-amounts">
        {(
          ['accountedUsedHours', 'reservedHours', 'availableHours', 'expiredUnusedHours'] as const
        ).map((key) => (
          <div key={key}>
            <dt>
              {
                {
                  accountedUsedHours: '계상 사용',
                  reservedHours: '예약',
                  availableHours: '새 배정 가능',
                  expiredUnusedHours: '미사용 소멸',
                }[key]
              }
            </dt>
            <dd>
              {value.before.totals[key]} → {value.after.totals[key]}시간
            </dd>
          </div>
        ))}
      </dl>
      <ul>
        {value.after.entries.map((entry) => {
          const before = value.before.entries.find((e) => e.entryId === entry.entryId),
            href = originalLink(company, before ?? entry);
          return (
            <li key={entry.entryId}>
              <span>
                {entry.plannedDate ?? '삭제 후 날짜 없음'} · {entry.status ?? '삭제'} ·{' '}
                {entry.deductibleHours}시간{entry.automatic ? ' · 다른 휴가 자동완료 포함' : ''}
              </span>
              <small>
                업무 {entry.entryId} · 휴가 {entry.leaveEntryId ?? '신규 상세는 저장 시 생성'}
              </small>
              <span>
                배분{' '}
                {before?.allocations
                  .map((a) => `${a.grantId}: ${a.allocatedHours}시간`)
                  .join(', ') || '없음'}{' '}
                →{' '}
                {entry.allocations.map((a) => `${a.grantId}: ${a.allocatedHours}시간`).join(', ') ||
                  '없음'}
              </span>
              {href && (
                <a className="control-link" href={href}>
                  원래 휴가 보기
                </a>
              )}
            </li>
          );
        })}
      </ul>
      {value.requiredConfirmations.length > 0 && (
        <div className="leave-confirmation">
          <p>
            만료된 원부여분으로 반환합니다. 평가일의 새 가용량은 늘지 않고 소멸된 미배분량이 증가할
            수 있습니다.
          </p>
          {value.requiredConfirmations
            .flatMap((c) => c.grantIds)
            .map((id) => {
              const balance = value.before.grants.find((g) => g.grant.id === id);
              return (
                <p key={id}>
                  {id} · 마지막 사용 가능일 {balance?.grant.expiresOn ?? '미리보기 확인 필요'}
                </p>
              );
            })}
          <label>
            <input
              type="checkbox"
              checked={confirmed}
              disabled={disabled}
              onChange={(e) => setConfirmed(e.target.checked)}
            />
            표시된 정확 부여분으로 반환하는 영향을 확인했습니다
          </label>
        </div>
      )}
      {value.warnings.map((w) => (
        <p key={w} role="status">
          {w}
        </p>
      ))}
      <div className="leave-actions">
        <button
          type="button"
          disabled={
            disabled ||
            value.insufficientHours > 0 ||
            (value.requiredConfirmations.length > 0 && !confirmed)
          }
          onClick={onApply}
        >
          미리 본 연차 변경 적용
        </button>
        <button type="button" disabled={disabled} onClick={onCancel}>
          미리보기 닫기
        </button>
      </div>
    </section>
  );
}
export function LeaveLedgerPage({ companyId, userId }: { companyId: string; userId: string }) {
  useNavigationGuard();
  const key = `wt:leave-ledger:v1:${encodeURIComponent(userId)}:${companyId}:forms`;
  const [model, setModel] = useState(() =>
    read(
      key,
      zModel.refine(
        (v) =>
          (!v.original || v.original.companyId === companyId) &&
          (!v.policy.original || v.policy.original.companyId === companyId),
      ),
      freshModel(),
    ),
  );
  const current = useRef(model);
  current.current = model;
  function update(value: typeof model) {
    current.current = value;
    store(key, value);
    store(`${key}:grant:${value.grant.id}`, {
      grant: value.grant,
      grantBase: value.grantBase,
      original: value.original,
    });
    setModel(value);
  }
  const formDirty =
    canonicalLedger(model.setup) !== model.setupBase ||
    canonicalLedger(model.policy) !== model.policyBase ||
    canonicalLedger(model.grant) !== model.grantBase;
  useDirty(key, formDirty);
  const online = useOnline();
  const [state, setState] = useState<LeaveLedgerState | null>(null),
    [name, setName] = useState(''),
    [policies, setPolicies] = useState<LeavePolicy[]>([]),
    [grants, setGrants] = useState<LeaveGrant[]>([]),
    [summary, setSummary] = useState<LeaveLedgerSummary | null>(null);
  const [policyCursor, setPolicyCursor] = useState<number | null>(null),
    [grantCursor, setGrantCursor] = useState<string | null>(null);
  const [query, setQuery] = useState(() => {
      // Keep a usable retry context even when the initial ledger/company read fails.
      // A successful load still applies the company's configured default year.
      const today = kstDate(Date.now()),
        params = new URLSearchParams(location.search),
        year = params.get('year'),
        date = params.get('valuationDate');
      return {
        year:
          year && /^\d{1,4}$/.test(year) && zWorkspaceYear.safeParse(Number(year)).success
            ? String(Number(year))
            : today.slice(0, 4),
        date: zWorkEntryDate.safeParse(date).success ? date! : today,
      };
    }),
    [shown, setShown] = useState<{ year: number; date: string } | null>(null);
  const [error, setError] = useState(''),
    [busy, setBusy] = useState(false),
    [refresh, setRefresh] = useState(0),
    [denied, setDenied] = useState(false);
  const [preview, setPreview] = useState<LeaveLedgerPreview | null>(null);
  const ticket = useRef(0),
    alive = useRef(true),
    lock = useRef(false);
  const latestReturn = useRef(location.pathname + location.search);
  latestReturn.current = location.pathname + location.search;
  function fail(e: unknown) {
    setError(ledgerFailure(e));
    if (e instanceof WorkFailure && [401, 403].includes(e.status)) {
      setState(null);
      setGrants([]);
      setPolicies([]);
      setSummary(null);
      setPreview(null);
      setDenied(true);
    }
    if (e instanceof WorkFailure && e.status === 401)
      location.assign(
        `/login?${new URLSearchParams({ returnTo: ledgerReturnTo(latestReturn.current, companyId) })}`,
      );
  }
  function acknowledged(command: LedgerCommand, result: LedgerResult, historical: boolean) {
    if (historical) {
      setPreview(null);
      return;
    }
    const value = current.current;
    if (command.kind === 'setup' && 'setup' in result && result.setup) {
      const setup = { cutover: result.setup.cutoverOn, accepted: true };
      update({ ...value, setup, setupBase: canonicalLedger(setup) });
    }
    if (command.kind === 'policy_put' && 'deductionOrder' in result) {
      const policy = { year: String(result.year), order: result.deductionOrder, original: result };
      update({ ...value, policy, policyBase: canonicalLedger(policy) });
    }
    if (
      (command.kind === 'grant_create' || command.kind === 'grant_patch') &&
      'grantedHours' in result &&
      value.grant.id === result.id
    ) {
      const grant = fromGrant(result);
      update({ ...value, grant, grantBase: canonicalLedger(grant), original: result });
    }
    if (command.kind === 'grant_delete' && value.original?.id === command.request.id) {
      const grant = blankGrant();
      update({ ...value, grant, grantBase: canonicalLedger(grant), original: null });
    }
    if (command.kind === 'policy_delete' && value.policy.original?.year === command.request.year) {
      const policy = { year: value.policy.year, order: 'expires_first', original: null };
      update({ ...value, policy, policyBase: canonicalLedger(policy) });
    }
    setPreview(null);
    setRefresh((v) => v + 1);
  }
  const session = useCommandSession(`${key}:command`, acknowledged, fail);
  const disabled = busy || session.busy || !!session.command || !online || denied;
  async function load(next?: { year: number; date: string }) {
    const revision = ++ticket.current;
    setBusy(true);
    setError('');
    setPreview(null);
    try {
      const [s, company, settings] = await Promise.all([
        ledgerState(companyId),
        workApi(
          `/api/companies/${companyId}`,
          zWorkspaceCompany.refine((c) => c.id === companyId),
        ),
        workApi('/api/settings', zWorkspaceSettings),
      ]);
      const params = new URLSearchParams(location.search),
        rawYear = params.get('year'),
        rawDate = params.get('valuationDate');
      const context = next ?? {
        year:
          rawYear && /^\d{1,4}$/.test(rawYear) && zWorkspaceYear.safeParse(Number(rawYear)).success
            ? Number(rawYear)
            : workspaceDefaultYear(company, settings.defaultYearMode.value),
        date: zWorkEntryDate.safeParse(rawDate).success ? rawDate! : kstDate(Date.now()),
      };
      const [p, g, total] =
        s.ledgerVersion === null
          ? [null, null, null]
          : await Promise.all([
              ledgerPolicies(companyId),
              ledgerGrants(companyId),
              s.phase === 'active'
                ? ledgerSummary(companyId, context.date, context.year)
                : Promise.resolve(null),
            ]);
      if (!alive.current || revision !== ticket.current) return;
      setName(company.name);
      setState(s);
      setPolicies(p?.items ?? []);
      setPolicyCursor(p?.nextCursorYear ?? null);
      setGrants(g?.items ?? []);
      setGrantCursor(g?.nextCursor ?? null);
      setSummary(total);
      setShown(context);
      setQuery({ year: String(context.year), date: context.date });
      setDenied(false);
    } catch (e) {
      if (alive.current && revision === ticket.current) {
        setState(null);
        setSummary(null);
        setGrants([]);
        setPolicies([]);
        fail(e);
      }
    } finally {
      if (alive.current && revision === ticket.current) setBusy(false);
    }
  }
  useEffect(() => {
    alive.current = true;
    void load();
    return () => {
      alive.current = false;
      ticket.current++;
    };
  }, [companyId, refresh]);
  async function submit(kind: LedgerCommand['kind'], request: unknown) {
    if (disabled || lock.current) return;
    try {
      const command = zLedgerCommand.parse({ kind, request });
      await session.execute(companyId, command);
    } catch {
      setError('날짜·시간 정수·발생연도·명시 확인과 버전을 확인해 주세요.');
    }
  }
  function grantBody() {
    const f = current.current.grant;
    return {
      id: f.id,
      commandId: crypto.randomUUID(),
      ledgerVersion: state?.ledgerVersion,
      originYear: Number(f.originYear),
      grantType: f.grantType,
      grantedHours: Number(f.grantedHours),
      grantedOn: f.grantedOn,
      validFrom: f.validFrom,
      expiresOn: f.expiresOn,
      expiryBoundary: 'inclusive_kst_dates',
      workHoursPerDaySnapshot:
        f.workHoursPerDaySnapshot === '' ? null : Number(f.workHoursPerDaySnapshot),
      basisNote: f.basisNote === '' ? null : f.basisNote,
      sourceReference: f.sourceReference === '' ? null : f.sourceReference,
      remainingAsOf: f.remainingAsOf === '' ? null : f.remainingAsOf,
    };
  }
  function saveGrant() {
    if (!model.original) {
      void submit('grant_create', grantBody());
      return;
    }
    const baseline = fromGrant(model.original),
      patch: Record<string, unknown> = {};
    for (const field of ['grantedHours', 'validFrom', 'expiresOn', 'basisNote'] as const)
      if (model.grant[field] !== baseline[field])
        patch[field] =
          field === 'grantedHours'
            ? Number(model.grant[field])
            : field === 'basisNote' && model.grant[field] === ''
              ? null
              : model.grant[field];
    void submit('grant_patch', {
      id: model.original.id,
      input: {
        commandId: crypto.randomUUID(),
        ledgerVersion: state?.ledgerVersion,
        version: model.original.version,
        patch,
      },
    });
  }
  async function more(kind: 'grants' | 'policies' | 'summary') {
    if (disabled || lock.current) return;
    lock.current = true;
    setBusy(true);
    const revision = ticket.current;
    try {
      if (kind === 'grants' && grantCursor) {
        const value = await ledgerGrants(companyId, grantCursor);
        if (revision !== ticket.current) return;
        if (value.items.some((g) => grants.some((old) => old.id === g.id)))
          throw new WorkFailure(0, 'INVALID_RESPONSE');
        setGrants([...grants, ...value.items]);
        setGrantCursor(value.nextCursor);
      }
      if (kind === 'policies' && policyCursor !== null) {
        const value = await ledgerPolicies(companyId, policyCursor);
        if (revision !== ticket.current) return;
        if (value.items.some((p) => policies.some((old) => old.year === p.year)))
          throw new WorkFailure(0, 'INVALID_RESPONSE');
        setPolicies([...policies, ...value.items]);
        setPolicyCursor(value.nextCursorYear);
      }
      if (kind === 'summary' && summary?.nextGrantCursor && shown) {
        const value = await ledgerSummary(
          companyId,
          shown.date,
          shown.year,
          summary.nextGrantCursor,
        );
        if (revision !== ticket.current) return;
        if (
          value.ledgerVersion !== summary.ledgerVersion ||
          !same(value.totals, summary.totals) ||
          value.grants.some((g) => summary.grants.some((old) => old.grant.id === g.grant.id))
        )
          throw new WorkFailure(409, 'VERSION_CONFLICT');
        setSummary({ ...value, grants: [...summary.grants, ...value.grants] });
      }
    } catch (e) {
      if (alive.current && revision === ticket.current) fail(e);
    } finally {
      lock.current = false;
      if (alive.current) setBusy(false);
    }
  }
  function chooseGrant(g?: LeaveGrant) {
    if (
      canonicalLedger(model.grant) !== model.grantBase &&
      !confirm('현재 부여분 초안을 바꾸고 다른 부여분을 검토할까요?')
    )
      return;
    const grant = g ? fromGrant(g) : blankGrant();
    const selected = g
      ? read(
          `${key}:grant:${g.id}`,
          z
            .strictObject({ grant: zGrantForm, grantBase: z.string(), original: zLeaveGrant })
            .refine(
              (v) =>
                v.original.companyId === companyId && v.original.id === g.id && v.grant.id === g.id,
            ),
          { grant, grantBase: canonicalLedger(grant), original: g },
        )
      : { grant, grantBase: canonicalLedger(grant), original: null };
    update({ ...current.current, ...selected });
  }
  async function cutover() {
    if (!state?.ledgerVersion || disabled) return;
    setBusy(true);
    setError('');
    const revision = ticket.current;
    try {
      const value = await ledgerPreview(companyId, 'cutover', {
        commandId: crypto.randomUUID(),
        ledgerVersion: state.ledgerVersion,
        activate: true,
      });
      if (alive.current && revision === ticket.current) setPreview(value);
    } catch (e) {
      if (alive.current && revision === ticket.current) fail(e);
    } finally {
      if (alive.current && revision === ticket.current) setBusy(false);
    }
  }
  const g = model.grant;
  function grantInput(
    field: keyof GrantForm,
    label: string,
    type = 'text',
    immutable = false,
  ): ReactNode {
    return (
      <label>
        {label}
        <input
          type={type}
          value={g[field]}
          disabled={disabled || (immutable && !!model.original)}
          onChange={(e) =>
            update({
              ...current.current,
              grant: { ...current.current.grant, [field]: e.target.value },
            })
          }
        />
      </label>
    );
  }
  return (
    <section className="leave-ledger" aria-label="회사 연차 관리">
      <h1>연차 관리</h1>
      {name && (
        <p>
          {name}
          {shown ? ` · 휴가 사용연도 ${shown.year} · 유효성 평가일 ${shown.date}` : ''}
        </p>
      )}
      {!online && <p role="status">오프라인 · 저장할 수 없습니다. 초안은 유지됩니다.</p>}
      {error && <p role="alert">{error}</p>}
      <Recovery session={session} company={companyId} />
      <form
        className="leave-actions"
        onSubmit={(e) => {
          e.preventDefault();
          const context = { year: Number(query.year), date: query.date };
          if (
            !zWorkspaceYear.safeParse(context.year).success ||
            !zWorkEntryDate.safeParse(context.date).success
          ) {
            setError('조회연도와 실제 달력 날짜를 확인해 주세요.');
            return;
          }
          if (
            workspaceHasUnsavedChanges() &&
            !confirm('연차 초안은 유지하고 다른 연도·평가일을 조회할까요?')
          )
            return;
          history.replaceState(
            history.state,
            '',
            `/c/${companyId}/settings/leave?${new URLSearchParams({ year: String(context.year), valuationDate: context.date })}`,
          );
          void load(context);
        }}
      >
        <label>
          연차 조회연도
          <input
            type="number"
            min="1"
            max="9999"
            value={query.year}
            onChange={(e) => setQuery({ ...query, year: e.target.value })}
          />
        </label>
        <label>
          잔액 평가일 (KST)
          <input
            type="date"
            value={query.date}
            onChange={(e) => setQuery({ ...query, date: e.target.value })}
          />
        </label>
        <button disabled={busy || session.busy}>연차 조회</button>
      </form>
      {state && (
        <>
          <p role="status">
            {phaseLabels[state.phase]}
            {state.ledgerVersion ? ` · 장부 버전 ${state.ledgerVersion}` : ''}
          </p>
          <details>
            <summary>장부 지원 범위</summary>
            <p>
              기준일 이전 휴가는 미관리로 보존합니다. 부여량과 유효기간은 실제 근거를 직접
              입력하세요. 법정 자동 계산·과거 복원·무기한·기한 추측·자동 이월 부여는 제공하지
              않습니다.
            </p>
            <p>
              사용 가능 시작일과 마지막 사용 가능일을 KST 날짜 양 끝 포함으로 사용합니다. 이전
              발생연도 우선은 휴가 사용연도보다 앞선 발생분을 뜻합니다.
            </p>
          </details>
          {state.phase === 'unavailable' ? (
            <p>장부 기능이 설치되지 않았습니다. 잔여량을 0으로 계산하지 않습니다.</p>
          ) : (
            <>
              {state.phase !== 'active' && (
                <section aria-label="장부 시작 설정">
                  <h2>장부 시작</h2>
                  <form
                    onSubmit={(e) => {
                      e.preventDefault();
                      if (!model.setup.accepted) {
                        setError('장부 관리 범위를 명시 확인해 주세요.');
                        return;
                      }
                      void submit('setup', {
                        commandId: crypto.randomUUID(),
                        ledgerVersion: state.ledgerVersion,
                        cutoverOn: model.setup.cutover,
                        historyStrategy: 'forward_only',
                        validityBoundary: 'inclusive_kst_dates',
                        carryoverDefinition: 'origin_year_before_usage_year',
                        expiredCancellation: 'confirm_original_grant',
                      });
                    }}
                  >
                    <fieldset disabled={disabled}>
                      <label>
                        장부 관리 시작일
                        <input
                          type="date"
                          value={model.setup.cutover}
                          onChange={(e) =>
                            update({
                              ...current.current,
                              setup: { ...current.current.setup, cutover: e.target.value },
                            })
                          }
                        />
                      </label>
                      <label>
                        <input
                          type="checkbox"
                          checked={model.setup.accepted}
                          onChange={(e) =>
                            update({
                              ...current.current,
                              setup: { ...current.current.setup, accepted: e.target.checked },
                            })
                          }
                        />
                        기준일 전 미관리·날짜 양 끝 포함·만료 원부여 반환 확인을 사용합니다
                      </label>
                      <button>장부 초안 저장</button>
                    </fieldset>
                  </form>
                  <p>
                    초안 저장은 활성화가 아닙니다. 부여분과 해당 연도 정책을 저장한 뒤 기존 휴가
                    전체를 미리 확인하세요.
                  </p>
                  {state.phase === 'draft' && (
                    <button disabled={disabled} onClick={() => void cutover()}>
                      장부 활성화 미리보기
                    </button>
                  )}
                </section>
              )}
              {state.ledgerVersion !== null && (
                <>
                  <section aria-label="연도별 차감 정책">
                    <h2>연도별 차감 순서</h2>
                    <ul>
                      {policies.map((p) => (
                        <li key={p.year}>
                          <button
                            type="button"
                            disabled={disabled}
                            onClick={() => {
                              if (
                                canonicalLedger(model.policy) !== model.policyBase &&
                                !confirm('차감 정책 초안을 바꾸고 선택한 연도를 검토할까요?')
                              )
                                return;
                              const policy = {
                                year: String(p.year),
                                order: p.deductionOrder,
                                original: p,
                              };
                              update({
                                ...current.current,
                                policy,
                                policyBase: canonicalLedger(policy),
                              });
                            }}
                          >
                            {p.year} · {orderLabels[p.deductionOrder]}
                          </button>
                        </li>
                      ))}
                    </ul>
                    {policyCursor !== null && (
                      <button disabled={disabled} onClick={() => void more('policies')}>
                        차감 정책 더 보기
                      </button>
                    )}
                    <form
                      onSubmit={(e) => {
                        e.preventDefault();
                        void submit('policy_put', {
                          year: Number(model.policy.year),
                          input: {
                            commandId: crypto.randomUUID(),
                            ledgerVersion: state.ledgerVersion,
                            version: model.policy.original?.version ?? null,
                            deductionOrder: model.policy.order,
                          },
                        });
                      }}
                    >
                      <fieldset disabled={disabled}>
                        <label>
                          차감 정책 연도
                          <input
                            type="number"
                            min="1"
                            max="9999"
                            value={model.policy.year}
                            disabled={!!model.policy.original}
                            onChange={(e) =>
                              update({
                                ...current.current,
                                policy: { ...current.current.policy, year: e.target.value },
                              })
                            }
                          />
                        </label>
                        <label>
                          차감 순서
                          <select
                            value={model.policy.order}
                            onChange={(e) =>
                              update({
                                ...current.current,
                                policy: { ...current.current.policy, order: e.target.value },
                              })
                            }
                          >
                            {Object.entries(orderLabels).map(([id, text]) => (
                              <option key={id} value={id}>
                                {text}
                              </option>
                            ))}
                          </select>
                        </label>
                        <button>차감 정책 저장</button>
                        <button
                          type="button"
                          onClick={() => {
                            if (
                              canonicalLedger(model.policy) !== model.policyBase &&
                              !confirm('차감 정책 초안을 바꿀까요?')
                            )
                              return;
                            const policy = { year: '', order: 'expires_first', original: null };
                            update({
                              ...current.current,
                              policy,
                              policyBase: canonicalLedger(policy),
                            });
                          }}
                        >
                          새 연도 정책
                        </button>
                        {model.policy.original && (
                          <button
                            type="button"
                            onClick={() => {
                              if (
                                confirm(
                                  '선택한 연도 정책을 삭제할까요? 관리 이력이 있으면 서버가 거부합니다.',
                                )
                              )
                                void submit('policy_delete', {
                                  year: model.policy.original!.year,
                                  input: {
                                    commandId: crypto.randomUUID(),
                                    ledgerVersion: state.ledgerVersion,
                                    version: model.policy.original!.version,
                                  },
                                });
                            }}
                          >
                            차감 정책 삭제
                          </button>
                        )}
                      </fieldset>
                    </form>
                    <p>정책 저장은 기존 배분을 다시 정렬하지 않습니다.</p>
                  </section>
                  <section aria-label="연차 부여분">
                    <h2>부여분</h2>
                    <ul>
                      {grants.map((value) => (
                        <li key={value.id}>
                          <button
                            type="button"
                            disabled={disabled}
                            onClick={() => chooseGrant(value)}
                          >
                            {value.originYear} · {value.grantedHours}시간 · {value.validFrom}~
                            {value.expiresOn}
                          </button>
                          <small>
                            {value.id}
                            {value.everAllocated ? ' · 배분 이력 있음' : ''}
                          </small>
                        </li>
                      ))}
                    </ul>
                    {grantCursor && (
                      <button disabled={disabled} onClick={() => void more('grants')}>
                        부여분 더 보기
                      </button>
                    )}
                    <button type="button" disabled={disabled} onClick={() => chooseGrant()}>
                      새 부여분
                    </button>
                    <details>
                      <summary>{model.original ? '부여분 수정' : '부여분 입력'}</summary>
                      <form
                        onSubmit={(e) => {
                          e.preventDefault();
                          saveGrant();
                        }}
                      >
                        <fieldset disabled={disabled}>
                          <div className="leave-fields">
                            {grantInput('originYear', '부여 발생연도', 'number', true)}
                            <label>
                              부여 종류
                              <select
                                value={g.grantType}
                                disabled={!!model.original}
                                onChange={(e) =>
                                  update({
                                    ...current.current,
                                    grant: { ...current.current.grant, grantType: e.target.value },
                                  })
                                }
                              >
                                <option value="base">기본 부여</option>
                                <option value="carryover">승계 부여 (실제 근거)</option>
                                <option value="extra">추가 부여</option>
                                <option value="opening">기준일의 실제 남은 양</option>
                              </select>
                            </label>
                            {grantInput('grantedHours', '부여 시간', 'number')}
                            {grantInput('grantedOn', '실제 부여일', 'date', true)}
                            {grantInput('validFrom', '사용 가능 시작일 (포함)', 'date')}
                            {grantInput('expiresOn', '마지막 사용 가능일 (포함)', 'date')}
                            <label>
                              부여 당시 하루 근로시간
                              <select
                                disabled={!!model.original}
                                value={g.workHoursPerDaySnapshot}
                                onChange={(e) =>
                                  update({
                                    ...current.current,
                                    grant: {
                                      ...current.current.grant,
                                      workHoursPerDaySnapshot: e.target.value,
                                    },
                                  })
                                }
                              >
                                <option value="">근거 미확인 · 시간으로만 표시</option>
                                {[4, 8, 12, 16].map((h) => (
                                  <option key={h} value={h}>
                                    {h}시간
                                  </option>
                                ))}
                              </select>
                            </label>
                            {g.grantType === 'opening' &&
                              grantInput('remainingAsOf', '실제 잔액 기준일', 'date', true)}
                            {grantInput('sourceReference', '부여 자료 근거', 'text', true)}
                          </div>
                          <label>
                            부여 근거
                            <textarea
                              value={g.basisNote}
                              onChange={(e) =>
                                update({
                                  ...current.current,
                                  grant: { ...current.current.grant, basisNote: e.target.value },
                                })
                              }
                            />
                          </label>
                          <p>부여 ID {g.id} · 새해 조회로 복제하지 않습니다.</p>
                          <button>부여분 저장</button>
                          {model.original && (
                            <button
                              type="button"
                              onClick={() => {
                                if (
                                  confirm(
                                    '이 부여분을 삭제할까요? 배분 이력이 있으면 서버가 거부합니다.',
                                  )
                                )
                                  void submit('grant_delete', {
                                    id: model.original!.id,
                                    input: {
                                      commandId: crypto.randomUUID(),
                                      ledgerVersion: state.ledgerVersion,
                                      version: model.original!.version,
                                    },
                                  });
                              }}
                            >
                              부여분 삭제
                            </button>
                          )}
                        </fieldset>
                      </form>
                    </details>
                  </section>
                </>
              )}
              {summary && (
                <section aria-label="현재 확정 배분 요약">
                  <h2>현재 확정 배분</h2>
                  <p>
                    유효성 평가일 {summary.valuationDate} · 관측{' '}
                    {new Date(summary.observedAt).toLocaleString('ko-KR')} · 과거 당시 잔액 복원
                    아님
                  </p>
                  <dl className="leave-amounts">
                    {Object.entries({
                      부여: summary.totals.grantedHours,
                      '계상 사용': summary.totals.accountedUsedHours,
                      '전체 미사용 (예약·만료 포함)':
                        summary.totals.grantedHours - summary.totals.accountedUsedHours,
                      예약: summary.totals.reservedHours,
                      미배분: summary.totals.unallocatedHours,
                      '새 배정 가능': summary.totals.availableHours,
                      '미사용 소멸': summary.totals.expiredUnusedHours,
                      '유효 시작 전': summary.totals.notYetAvailableHours,
                    }).map(([label, hours]) => (
                      <div key={label}>
                        <dt>{label}</dt>
                        <dd>{hours}시간</dd>
                      </div>
                    ))}
                  </dl>
                  <HelpHint label="전체 미사용 계산">
                    전체 미사용은 부여에서 계상 사용을 뺀 양이며 예약·만료분을 포함합니다.
                  </HelpHint>
                  <p>
                    휴가 사용연도 {summary.usageYear}: 계상 사용 {summary.usage.usedHours}시간 ·
                    예약 {summary.usage.reservedHours}시간
                  </p>
                  <p>
                    미관리 {summary.coverage.unmanagedCount}건 · 자동완료 정리 대기{' '}
                    {summary.coverage.pendingAutomaticCompletionCount}건
                    {!summary.coverage.complete ? ' · 전체 과거 사용량은 확인되지 않았습니다.' : ''}
                  </p>
                  <ul>
                    {summary.grants.map((v) => (
                      <li key={v.grant.id}>
                        <span>
                          {v.grant.originYear} 발생 · {v.grant.id}
                        </span>
                        <span>
                          {v.grant.validFrom}~{v.grant.expiresOn} (포함)
                        </span>
                        <span>
                          사용 {v.usedHours} · 예약 {v.reservedHours} · 미배분 {v.unallocatedHours}{' '}
                          · 새 배정 가능 {v.availableHours} · 소멸 {v.expiredUnusedHours}시간
                        </span>
                      </li>
                    ))}
                  </ul>
                  {summary.nextGrantCursor && (
                    <button disabled={disabled} onClick={() => void more('summary')}>
                      배분 요약 더 보기
                    </button>
                  )}
                </section>
              )}
            </>
          )}
        </>
      )}
      {preview && (
        <LeaveImpact
          key={preview.previewFingerprint}
          company={companyId}
          value={preview}
          disabled={disabled}
          onCancel={() => setPreview(null)}
          onApply={() => {
            if (confirm('표시된 기존 휴가 전체와 명시 범위로 장부를 활성화할까요?'))
              void submit('cutover', {
                commandId: preview.commandId,
                ledgerVersion: preview.ledgerVersion,
                activate: true,
                evaluationDate: preview.evaluationDate,
                previewFingerprint: preview.previewFingerprint,
              });
          }}
        />
      )}
    </section>
  );
}

const zReview = z.strictObject({
  request: zLeaveLedgerWorkPreview,
  preview: zLeaveLedgerPreview.nullable(),
});
export function useLeaveWorkReview({
  userId,
  companyId,
  onExpired,
  onSaved,
}: {
  userId: string;
  companyId: string;
  onExpired: (error: unknown) => boolean;
  onSaved: (
    operation: LeaveWorkOperation,
    result: z.output<typeof zLeaveWorkResult>,
    historical: boolean,
  ) => void;
}) {
  const key = `wt:leave-work:v1:${encodeURIComponent(userId)}:${companyId}`;
  const [review, setReview] = useState(() =>
    read(
      key,
      zReview
        .nullable()
        .refine((value) => !value?.preview || value.preview.companyId === companyId),
      null,
    ),
  );
  const current = useRef(review);
  current.current = review;
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [hidden, setHidden] = useState(false);
  const online = useOnline(),
    alive = useRef(true),
    lock = useRef(false),
    scopeTicket = useRef(0);
  const saved = useRef(onSaved),
    expired = useRef(onExpired);
  saved.current = onSaved;
  expired.current = onExpired;
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      scopeTicket.current++;
    };
  }, []);
  function keep(value: typeof review) {
    current.current = value;
    store(key, value);
    setReview(value);
  }
  function fail(e: unknown) {
    setError(ledgerFailure(e));
    if (e instanceof WorkFailure && [401, 403].includes(e.status)) setHidden(true);
    expired.current(e);
  }
  const session = useCommandSession(
    `${key}:command`,
    (command, result, historical) => {
      if (command.kind !== 'work') return;
      const parsed = zLeaveWorkResult.safeParse(result);
      if (!parsed.success) {
        fail(new WorkFailure(0, 'INVALID_RESPONSE'));
        return;
      }
      keep(null);
      setHidden(false);
      saved.current(command.request.work[0]!, parsed.data, historical);
    },
    fail,
    true,
  );
  useDirty(key, !!review || busy, false);
  async function inspect(
    raw: unknown,
    entry?: WorkEntryFinal,
    duplicate?: { id: string; version: number },
  ) {
    if (lock.current || session.command || current.current)
      throw new WorkFailure(422, 'CONSTRAINT_VIOLATION', 'LEDGER_REVIEW_REQUIRED');
    if (!online) throw new WorkFailure(0, 'OFFLINE');
    lock.current = true;
    setBusy(true);
    setError('');
    const ticket = ++scopeTicket.current;
    try {
      const operation = zLeaveWorkOperation.parse(raw),
        state = await ledgerState(companyId);
      let dedicated = false;
      if (state.phase !== 'unavailable' && state.phase !== 'not_started') {
        const metadata =
          operation.intent === 'create'
            ? null
            : await ledgerMetadata(companyId, operation.entryId, entry);
        const targetDate =
          operation.intent === 'create'
            ? operation.input.plannedDate
            : operation.intent === 'patch'
              ? (operation.input.plannedDate ?? entry?.plannedDate)
              : entry?.plannedDate;
        const targetManaged = !!(state.setup && targetDate && targetDate >= state.setup.cutoverOn);
        dedicated = duplicate
          ? targetManaged
          : !!metadata?.managed || metadata?.lastAccountedWorkVersion != null || targetManaged;
      }
      if (!dedicated) return false;
      const request = zLeaveLedgerWorkPreview.parse({
        commandId: crypto.randomUUID(),
        ledgerVersion: state.ledgerVersion,
        work: [operation],
        ...(duplicate ? { sourceEntryId: duplicate.id, sourceVersion: duplicate.version } : {}),
        confirmations: [],
      });
      const value = await ledgerPreview(companyId, 'work', request);
      if (!alive.current || ticket !== scopeTicket.current) return true;
      keep({ request, preview: value });
      setHidden(false);
      return true;
    } catch (e) {
      if (alive.current && ticket === scopeTicket.current) fail(e);
      throw e;
    } finally {
      lock.current = false;
      if (alive.current) setBusy(false);
    }
  }
  async function apply() {
    const value = current.current;
    if (!value?.preview || busy || session.command || !online) return;
    if (!confirm('미리 본 휴가 변경과 정확 부여분 반환 선택을 적용할까요?')) return;
    await session.execute(companyId, {
      kind: 'work',
      request: {
        ...value.request,
        confirmations: value.preview.requiredConfirmations,
        evaluationDate: value.preview.evaluationDate,
        previewFingerprint: value.preview.previewFingerprint,
      },
    });
  }
  const panel = (
    <div className="leave-work-review">
      {error && <p role="alert">{error}</p>}
      <Recovery session={session} company={companyId} />
      {!hidden && review?.preview && (
        <LeaveImpact
          key={review.preview.previewFingerprint}
          company={companyId}
          value={review.preview}
          disabled={busy || session.busy || !!session.command || !online}
          onApply={() => void apply()}
          onCancel={() => keep(null)}
        />
      )}
    </div>
  );
  return { inspect, panel, blocked: busy || session.busy || !!review || !!session.command };
}
export function LeaveLedgerDetails({
  entry,
  companyId,
  onExpired,
}: {
  entry: WorkEntryFinal;
  companyId: string;
  onExpired: (e: unknown) => boolean;
}) {
  const online = useOnline();
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState(false),
    [value, setValue] = useState<LeaveAccountingMetadata | null>(null),
    [error, setError] = useState(''),
    [refresh, setRefresh] = useState(0);
  const expired = useRef(onExpired);
  expired.current = onExpired;
  useEffect(() => {
    let active = true;
    if (open && online) {
      setLoading(true);
      setValue(null);
      setError('');
      void ledgerMetadata(companyId, entry.id, entry)
        .then((v) => {
          if (active) setValue(v);
        })
        .catch((e: unknown) => {
          if (active) {
            setValue(null);
            setError(ledgerFailure(e));
            expired.current(e);
          }
        })
        .finally(() => {
          if (active) setLoading(false);
        });
    } else {
      setLoading(false);
    }
    return () => {
      active = false;
    };
  }, [open, companyId, entry.id, entry.version, refresh, online]);
  return (
    <details className="leave-entry-details" onToggle={(e) => setOpen(e.currentTarget.open)}>
      <summary>연차 장부 · {entry.title}</summary>
      {error && <p role="alert">{error}</p>}
      {value && (
        <>
          <p>
            {value.managed ? '장부 관리 대상' : '장부 미관리'} ·{' '}
            {
              { reserved: '예약', used: '사용', canceled: '취소', unaccounted: '미계상' }[
                value.usageClass
              ]
            }{' '}
            · {value.deductibleHours}시간
          </p>
          {value.pendingAutomaticCompletion && (
            <p role="status">자동완료 정리 대기 · 이 조회는 휴가를 변경하지 않습니다.</p>
          )}
          <p>
            휴가 {value.leaveEntryId} · 업무 버전 {value.workVersion} · 장부 버전{' '}
            {value.ledgerVersion ?? '없음'}
          </p>
          {value.allocations.length ? (
            <ul>
              {value.allocations.map((a) => (
                <li key={a.grantId}>
                  부여 {a.grantId} · {a.allocatedHours}시간
                </li>
              ))}
            </ul>
          ) : (
            <p>배분 없음 · 휴가 기록의 차감 대상량과 배분 완료는 다릅니다.</p>
          )}
          {value.reviewReasons.map((reason) => (
            <p key={reason}>
              {ledgerFailure(new WorkFailure(422, 'CONSTRAINT_VIOLATION', reason))}
            </p>
          ))}
        </>
      )}
      <RefreshButton
        type="button"
        busy={loading}
        disabled={!online || loading}
        onClick={() => setRefresh((v) => v + 1)}
      >
        이 휴가 장부 다시 조회
      </RefreshButton>
    </details>
  );
}
