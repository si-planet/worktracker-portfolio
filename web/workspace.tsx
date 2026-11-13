import { HelpHint } from './help-hint';
import { RealWorklogReview } from './real-worklog-review';
import { RefreshButton } from './ui-controls';
import { LeaveLedgerPage } from './leave-ledger';
import { ledgerReturnTo } from './leave-ledger-api';
import { RecurrencePage } from './recurrence';
import { recurrenceReturnTo } from './recurrence-api';
import { NotesFeed } from './notes-feed';
import { noteReturnTo } from './notes-api';
import { workspaceHasUnsavedChanges } from './workspace-draft-state';
import { useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { z } from 'zod';
import { TagManagement } from './tag-admin';
import { ProjectManagement } from './project-admin';
import { MonthView } from './month-view';
import { SearchView } from './search-view';
import { WbsPage } from './wbs';
import { WorklogImportPage } from './worklog-import';
import { ExportPage } from './export';
import { WeeklyGoals } from './weekly-goals';
import { WorkspaceShell } from './workspace-shell';
import { WorkspaceLoading } from './workspace-loading';
import { currentCompanyWeek, COMPANY_MANAGEMENT_PATH } from '../shared/workspace-landing';
import { parseSearchFilters, searchParameters } from '../shared/search-filter';
import { isCalendarMonth } from '../shared/month-calendar';
import { kstDate } from '../shared/work-entry-rules';
import { WorkEntriesPanel } from './work-entries';
import { zWorkEntryDate } from '../shared/schema/work-entry';
import {
  workspaceDefaultYear,
  zCompanyCreate,
  zWorkspaceCompany,
  zWorkspaceId,
  zWorkspaceProject,
  zWorkspaceSettings,
  zWorkspaceTag,
  zWorkspaceYear,
  type WorkspaceCompany,
  type WorkspaceProject,
  type WorkspaceSettings,
  type WorkspaceTag,
} from '../shared/schema/workspace';

const zProfile = z.strictObject({
  userId: z.string().min(1).max(128),
  username: z.string().min(1).max(32),
  email: z.email(),
  emailVerified: z.literal(true),
  lastCompanyId: zWorkspaceId.nullable(),
  capabilities: z.strictObject({ manageSignup: z.boolean() }).optional(),
});
type Profile = z.infer<typeof zProfile>;
class WorkspaceFailure extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
  ) {
    super(code);
  }
}
async function api<T extends z.ZodType>(
  path: string,
  schema: T,
  method = 'GET',
  body?: unknown,
): Promise<z.output<T>> {
  if (method !== 'GET' && !navigator.onLine) throw new WorkspaceFailure(0, 'OFFLINE');
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), 15_000);
  try {
    const response = await fetch(path, {
      method,
      credentials: 'same-origin',
      cache: 'no-store',
      signal: controller.signal,
      ...(body === undefined
        ? {}
        : { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }),
    });
    if (response.status === 401) throw new WorkspaceFailure(401, 'UNAUTHENTICATED');
    const raw: unknown = await response.json();
    if (!response.ok) {
      const code =
        raw && typeof raw === 'object' && 'code' in raw && typeof raw.code === 'string'
          ? raw.code
          : 'UNKNOWN';
      throw new WorkspaceFailure(response.status, code);
    }
    const parsed = schema.safeParse(raw);
    if (!parsed.success) throw new WorkspaceFailure(0, 'INVALID_RESPONSE');
    return parsed.data;
  } finally {
    window.clearTimeout(timeout);
  }
}
function failureMessage(error: unknown) {
  if (error instanceof WorkspaceFailure) {
    if (error.code === 'OFFLINE')
      return '오프라인에서는 저장할 수 없습니다. 연결 후 다시 시도해 주세요.';
    if (error.status === 403)
      return '접근할 수 없는 회사 또는 프로젝트입니다. 회사 선택에서 다시 확인해 주세요.';
    if (error.status === 409) return '같은 이름이나 코드가 이미 있습니다. 목록을 확인해 주세요.';
    if (error.status === 400) return '입력 내용과 선택한 태그를 확인해 주세요.';
  }
  return '서버 응답을 확인할 수 없습니다. 연결 상태를 확인한 뒤 다시 조회해 주세요.';
}
const uncertain = (error: unknown) =>
  !(error instanceof WorkspaceFailure) || error.status >= 500 || error.code === 'INVALID_RESPONSE';

/** Only fixed local workspace routes and known scalar query values may survive login. */
export function workspaceReturnTo(value: string | null): string {
  if (!value || !value.startsWith('/') || value.startsWith('//') || value.includes('\\'))
    return '/';
  try {
    const url = new URL(value, window.location.origin);
    if (url.origin !== window.location.origin || url.hash) return '/';
    if (url.pathname === '/') return '/';
    if (url.pathname === '/worklog-review') {
      const values = url.searchParams.getAll('range');
      if (
        [...url.searchParams.keys()].some((key) => key !== 'range') ||
        values.length > 1 ||
        (values.length === 1 && !['aug-sep', 'sep-oct'].includes(values[0]!))
      )
        return '/';
      return url.pathname + (values[0] ? `?${new URLSearchParams({ range: values[0] })}` : '');
    }
    if (url.pathname === COMPANY_MANAGEMENT_PATH) return url.search ? '/' : url.pathname;
    if (url.pathname === '/account-transfer/source') return url.search ? '/' : url.pathname;
    if (url.pathname === '/account-transfer') {
      const keys = [...url.searchParams.keys()],
        transferId = url.searchParams.get('transferId');
      if (
        keys.length > 1 ||
        keys.some((k) => k !== 'transferId') ||
        (transferId !== null && !zWorkspaceId.safeParse(transferId).success)
      )
        return '/';
      return url.pathname + (transferId ? `?${new URLSearchParams({ transferId })}` : '');
    }
    const match =
      /^\/c\/([^/]+)(?:\/(?:week|day|month|search|notes|recurrence|goals|wbs|worklog-import|export|unscheduled|settings\/(?:projects|tags|leave)))?$/.exec(
        url.pathname,
      );
    if (/\/settings\/(?:projects|tags)$/.test(url.pathname) && url.search) return '/';
    if (!match || !zWorkspaceId.safeParse(match[1]).success) return '/';
    if (url.pathname.endsWith('/settings/leave'))
      return ledgerReturnTo(url.pathname + url.search, match[1]!);
    if (url.pathname.endsWith('/recurrence'))
      return recurrenceReturnTo(url.pathname + url.search, match[1]!);
    if (url.pathname.endsWith('/notes')) return noteReturnTo(url.pathname + url.search, match[1]!);
    if (url.pathname.endsWith('/export')) return url.search ? '/' : url.pathname;
    if (url.pathname.endsWith('/worklog-import')) {
      const keys = [...url.searchParams.keys()],
        id = url.searchParams.get('runId');
      if (
        keys.length > 1 ||
        keys.some((k) => k !== 'runId') ||
        (id !== null && !zWorkspaceId.safeParse(id).success)
      )
        return '/';
      return url.pathname + (id ? `?${new URLSearchParams({ runId: id })}` : '');
    }
    if (url.pathname.endsWith('/search')) {
      const filters = parseSearchFilters(url.searchParams);
      return `${url.pathname}?${searchParameters(filters)}`;
    }
    const keys = [...url.searchParams.keys()];
    if (
      new Set(keys).size !== keys.length ||
      keys.some((key) => !['year', 'projectId', 'date', 'month', 'itemId', 'entryId'].includes(key))
    )
      return '/';
    const itemId = url.searchParams.get('itemId'),
      entryId = url.searchParams.get('entryId');
    if (
      itemId !== null &&
      (!url.pathname.endsWith('/wbs') || !zWorkspaceId.safeParse(itemId).success)
    )
      return '/';
    if (
      entryId !== null &&
      (!/\/(day|unscheduled)$/.test(url.pathname) || !zWorkspaceId.safeParse(entryId).success)
    )
      return '/';
    const year = url.searchParams.get('year');
    if (
      year !== null &&
      (!/^[0-9]{1,4}$/.test(year) || !zWorkspaceYear.safeParse(Number(year)).success)
    )
      return '/';
    const month = url.searchParams.get('month');
    if (url.pathname.endsWith('/month')) {
      if (url.searchParams.has('date') || (month !== null && !isCalendarMonth(month))) return '/';
    } else if (month !== null) return '/';
    const date = url.searchParams.get('date');
    if (date !== null && !zWorkEntryDate.safeParse(date).success) return '/';
    if (url.pathname.endsWith('/unscheduled') && (date !== null || year !== null)) return '/';
    const project = url.searchParams.get('projectId');
    if (project !== null && !zWorkspaceId.safeParse(project).success) return '/';
    return url.pathname + url.search;
  } catch {
    return '/';
  }
}
function login() {
  const target = workspaceReturnTo(window.location.pathname + window.location.search);
  window.location.assign(`/login?${new URLSearchParams({ returnTo: target })}`);
}
const zCompanyDraft = z.strictObject({
  name: z.string().max(100),
  startedOn: z.string().max(10),
  endedOn: z.string().max(10),
  isCurrent: z.boolean(),
});
const blankCompany: z.infer<typeof zCompanyDraft> = {
  name: '',
  startedOn: '',
  endedOn: '',
  isCurrent: false,
};
const draftKey = (user: string, company = 'new-company') =>
  `work-tracker:draft:${encodeURIComponent(user)}:${encodeURIComponent(company)}`;
function readDraft<T extends z.ZodType>(
  key: string,
  schema: T,
  fallback: z.output<T>,
): z.output<T> {
  try {
    const raw = sessionStorage.getItem(key);
    if (!raw) return fallback;
    const parsed = schema.safeParse(JSON.parse(raw));
    if (parsed.success) return parsed.data;
    sessionStorage.removeItem(key);
  } catch {
    /* Unavailable storage must not prevent the form from opening. */
  }
  return fallback;
}
function saveDraft(key: string, value: unknown) {
  try {
    sessionStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* The current form stays in memory until navigation. */
  }
}
function clearDraft(key: string) {
  try {
    sessionStorage.removeItem(key);
  } catch {
    /* Optional tab storage. */
  }
}
function fieldError(result: z.ZodSafeParseError<unknown>) {
  return result.error.issues[0]?.message ?? '입력 내용을 확인해 주세요.';
}
function WorkspaceNav({ company = false }: { company?: boolean }) {
  return (
    <nav className="workspace-nav" aria-label="회사 메뉴">
      {company && (
        <a className="control-link" href={COMPANY_MANAGEMENT_PATH}>
          회사 설정 · 관리
        </a>
      )}
      <a className="control-link" href="/settings">
        계정 설정
      </a>
      <a className="control-link" href="/account-transfer">
        계정 연결 구성 확인
      </a>
    </nav>
  );
}

export function WorkspacePage({
  fallback,
  realWorklogReview = false,
  companyManagement = false,
  companyId,
  unscheduled = false,
  dayView = false,
  monthView = false,
  searchView = false,
  notesView = false,
  recurrenceView = false,
  leaveLedgerView = false,
  goalsView = false,
  wbsView = false,
  importView = false,
  exportView = false,
  projectAdmin = false,
  tagAdmin = false,
}: {
  fallback: ReactNode;
  realWorklogReview?: boolean;
  companyManagement?: boolean;
  companyId?: string;
  unscheduled?: boolean;
  dayView?: boolean;
  monthView?: boolean;
  searchView?: boolean;
  notesView?: boolean;
  recurrenceView?: boolean;
  leaveLedgerView?: boolean;
  goalsView?: boolean;
  wbsView?: boolean;
  importView?: boolean;
  exportView?: boolean;
  projectAdmin?: boolean;
  tagAdmin?: boolean;
}) {
  const [profile, setProfile] = useState<Profile | null>(null);
  const [publicHome, setPublicHome] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => {
    let active = true;
    void api('/api/me', zProfile)
      .then((value) => {
        if (active) setProfile(value);
      })
      .catch((failure: unknown) => {
        if (!active) return;
        if (
          failure instanceof WorkspaceFailure &&
          failure.status === 401 &&
          (companyId || realWorklogReview || companyManagement)
        ) {
          login();
          return;
        }
        if (
          !companyId &&
          !realWorklogReview &&
          !companyManagement &&
          failure instanceof WorkspaceFailure &&
          [401, 403, 503].includes(failure.status)
        )
          setPublicHome(true);
        else setError(failureMessage(failure));
      });
    return () => {
      active = false;
    };
  }, [companyId, realWorklogReview, companyManagement]);
  if (publicHome) return fallback;
  if (error)
    return (
      <section className="workspace">
        <h1>회사 정보를 확인할 수 없습니다.</h1>
        <p className="form-message" role="alert">
          {error}
        </p>
        <a className="control-link" href="/">
          회사 선택으로 이동
        </a>
      </section>
    );
  if (!profile) return <WorkspaceLoading />;
  if (companyId && !zWorkspaceId.safeParse(companyId).success)
    return (
      <section className="workspace">
        <h1>회사 주소를 확인해 주세요.</h1>
        <a className="control-link" href="/">
          회사 선택으로 이동
        </a>
      </section>
    );
  if (realWorklogReview) {
    const range =
      new URLSearchParams(window.location.search).get('range') === 'sep-oct'
        ? 'sep-oct'
        : 'aug-sep';
    return (
      <WorkspaceShell
        key={profile.userId}
        profile={profile}
        onExpired={login}
        contextLabel="로컬 검토 예시"
        viewLabel="실제 업무일지 검토"
      >
        <RealWorklogReview key={profile.userId} userId={profile.userId} initialRange={range} />
      </WorkspaceShell>
    );
  }
  function withShell(content: ReactNode) {
    return companyId && profile ? (
      <WorkspaceShell
        key={`${profile.userId}:${companyId}`}
        companyId={companyId}
        profile={profile}
        onExpired={login}
      >
        {content}
      </WorkspaceShell>
    ) : (
      content
    );
  }
  if (companyId && leaveLedgerView)
    return withShell(
      <LeaveLedgerPage
        key={`${profile.userId}:${companyId}`}
        companyId={companyId}
        userId={profile.userId}
      />,
    );
  if (companyId && recurrenceView)
    return withShell(
      <RecurrencePage
        key={`${profile.userId}:${companyId}`}
        companyId={companyId}
        userId={profile.userId}
      />,
    );
  if (companyId && notesView)
    return withShell(
      <NotesFeed
        key={`${profile.userId}:${companyId}`}
        companyId={companyId}
        userId={profile.userId}
      />,
    );
  if (companyId && exportView)
    return withShell(
      <ExportPage
        key={`${profile.userId}:${companyId}`}
        companyId={companyId}
        userId={profile.userId}
      />,
    );
  if (companyId && importView)
    return withShell(
      <WorklogImportPage
        key={`${profile.userId}:${companyId}`}
        companyId={companyId}
        userId={profile.userId}
      />,
    );
  if (companyId && wbsView)
    return withShell(
      <WbsPage
        key={`${profile.userId}:${companyId}`}
        companyId={companyId}
        userId={profile.userId}
      />,
    );
  if (companyId && goalsView)
    return withShell(
      <WeeklyGoals
        key={`${profile.userId}:${companyId}`}
        companyId={companyId}
        userId={profile.userId}
      />,
    );
  if (companyId && searchView)
    return withShell(
      <SearchView
        key={`${profile.userId}:${companyId}`}
        companyId={companyId}
        userId={profile.userId}
      />,
    );
  if (companyId && tagAdmin)
    return withShell(
      <TagManagement
        key={`${profile.userId}:${companyId}`}
        companyId={companyId}
        userId={profile.userId}
        onExpired={login}
      />,
    );
  if (companyId && projectAdmin)
    return withShell(
      <ProjectManagement
        key={`${profile.userId}:${companyId}`}
        companyId={companyId}
        userId={profile.userId}
        onExpired={login}
      />,
    );
  return withShell(
    companyId ? (
      <CompanyWorkspace
        key={`${profile.userId}:${companyId}`}
        profile={profile}
        companyId={companyId}
        unscheduled={unscheduled}
        dayView={dayView}
        monthView={monthView}
      />
    ) : (
      <CompanyPicker key={profile.userId} profile={profile} management={companyManagement} />
    ),
  );
}

function CompanyPicker({
  profile,
  management = false,
}: {
  profile: Profile;
  management?: boolean;
}) {
  const [companies, setCompanies] = useState<WorkspaceCompany[] | null>(null);
  const [settings, setSettings] = useState<WorkspaceSettings | null>(null);
  const [draft, setDraft] = useState(() =>
    readDraft(draftKey(profile.userId), zCompanyDraft, blankCompany),
  );
  const [yearMode, setYearMode] = useState<'company' | 'current'>('company');
  const [pending, setPending] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [unknownCreate, setUnknownCreate] = useState(false);
  const lock = useRef(false);
  const revision = useRef(0);
  function expired(failure: unknown) {
    if (failure instanceof WorkspaceFailure && failure.status === 401) {
      saveDraft(draftKey(profile.userId), draft);
      login();
      return true;
    }
    return false;
  }
  async function reload() {
    const ticket = ++revision.current;
    setLoading(true);
    try {
      const [list, value] = await Promise.all([
        api('/api/companies', z.array(zWorkspaceCompany)),
        api('/api/settings', zWorkspaceSettings),
      ]);
      if (ticket !== revision.current) return;
      const landing = currentCompanyWeek(list);
      if (!management && landing !== '/') {
        window.location.replace(landing);
        return;
      }
      setCompanies(list);
      setSettings(value);
      setYearMode(value.defaultYearMode.value);
      setUnknownCreate(false);
    } catch (failure) {
      if (ticket === revision.current && !expired(failure)) setError(failureMessage(failure));
    } finally {
      if (ticket === revision.current) setLoading(false);
    }
  }
  useEffect(() => {
    void reload();
    return () => {
      revision.current++;
    };
  }, []); // Initial request only; mutations explicitly refresh.
  async function refreshSettings() {
    setSettings(null);
    const value = await api('/api/settings', zWorkspaceSettings);
    setSettings(value);
    setYearMode(value.defaultYearMode.value);
    return value;
  }
  async function changeSetting(key: 'last_company_id' | 'default_year_mode', value: string) {
    if (lock.current || !settings) return;
    lock.current = true;
    setPending(true);
    setError('');
    setNotice('');
    try {
      const version =
        key === 'last_company_id'
          ? settings.lastCompanyId.version
          : settings.defaultYearMode.version;
      const saved = await api('/api/settings', zWorkspaceSettings, 'PUT', { key, value, version });
      setSettings(saved);
      setYearMode(saved.defaultYearMode.value);
      if (key === 'last_company_id') window.location.assign(`/c/${value}`);
      else setNotice('기본 연도 설정을 저장했습니다.');
    } catch (failure) {
      if (expired(failure)) return;
      if ((failure instanceof WorkspaceFailure && failure.status === 409) || uncertain(failure)) {
        try {
          await refreshSettings();
          setError(
            '최신 설정을 다시 확인했습니다. 표시된 값을 확인한 뒤 원하시는 설정이나 회사를 다시 선택해 주세요.',
          );
        } catch (refreshFailure) {
          if (!expired(refreshFailure))
            setError('설정의 저장 결과를 확인할 수 없습니다. 다시 조회한 뒤 선택해 주세요.');
        }
      } else setError(failureMessage(failure));
    } finally {
      lock.current = false;
      setPending(false);
    }
  }
  async function create(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (lock.current || unknownCreate) return;
    const parsed = zCompanyCreate.safeParse({
      ...draft,
      startedOn: draft.startedOn || null,
      endedOn: draft.endedOn || null,
    });
    if (!parsed.success) {
      setError(fieldError(parsed));
      return;
    }
    lock.current = true;
    setPending(true);
    setError('');
    setNotice('');
    try {
      const value = await api('/api/companies', zWorkspaceCompany, 'POST', parsed.data);
      clearDraft(draftKey(profile.userId));
      window.location.assign(`/c/${value.id}`);
    } catch (failure) {
      if (expired(failure)) return;
      if (uncertain(failure) || (failure instanceof WorkspaceFailure && failure.status === 409)) {
        setUnknownCreate(true);
        try {
          setCompanies(await api('/api/companies', z.array(zWorkspaceCompany)));
          setUnknownCreate(false);
          setError(
            '저장 결과를 확인하기 위해 회사 목록을 다시 조회했습니다. 같은 회사가 있는지 확인한 뒤 열거나 다시 시도해 주세요.',
          );
        } catch (refreshFailure) {
          if (!expired(refreshFailure))
            setError(
              '회사 저장 결과를 확인할 수 없습니다. 다시 조회하기 전에는 같은 요청을 보내지 않습니다.',
            );
        }
      } else setError(failureMessage(failure));
    } finally {
      lock.current = false;
      setPending(false);
    }
  }
  const disabled = pending || loading;
  if (companies === null && !error) return <WorkspaceLoading />;
  return (
    <section className="workspace" aria-labelledby="workspace-title">
      <WorkspaceNav />
      <p className="eyebrow">{profile.username}님의 작업공간</p>
      <h1 id="workspace-title">{management ? '회사 설정 · 관리' : '회사 시작 안내'}</h1>
      <p className="description">
        {management
          ? '회사 추가와 기록할 회사 선택, 기본 연도를 관리합니다.'
          : companies?.filter((company) => company.isCurrent).length
            ? '재직 회사가 여러 곳입니다. 이번에 볼 회사를 선택해 주세요.'
            : '재직으로 표시된 회사가 없습니다. 기록할 회사를 선택하거나 새 회사를 추가해 주세요.'}
      </p>
      {error && (
        <p className="form-message" role="alert">
          {error}
        </p>
      )}
      {notice && (
        <p className="form-success" role="status">
          {notice}
        </p>
      )}
      <div className="section-heading">
        <h2>내 회사</h2>
        <RefreshButton
          className="text-button"
          onClick={() => {
            setError('');
            void reload();
          }}
          disabled={disabled}
          busy={loading || pending}
        >
          다시 조회
        </RefreshButton>
      </div>
      {loading && <WorkspaceLoading inline />}
      {companies?.length === 0 && (
        <p className="workspace-empty">아직 회사가 없습니다. 아래에서 첫 회사를 만들어 주세요.</p>
      )}
      {companies && (
        <ul className="workspace-list">
          {companies.map((company) => (
            <li className="workspace-card" key={company.id}>
              <div>
                <h3>{company.name}</h3>
                <p>
                  {company.startedOn ?? '입사일 미입력'} ·{' '}
                  {company.isCurrent ? '재직 중' : (company.endedOn ?? '재직 상태 미지정')}
                </p>
                {settings?.lastCompanyId.value === company.id && (
                  <span className="workspace-badge">최근 선택</span>
                )}
              </div>
              <button
                className="button secondary"
                disabled={disabled || !settings}
                onClick={() => void changeSetting('last_company_id', company.id)}
                aria-label={`${company.name} 열기`}
              >
                회사 열기
              </button>
            </li>
          ))}
        </ul>
      )}
      <section className="workspace-block" aria-labelledby="year-mode-title">
        <h2 id="year-mode-title">회사에 들어갈 때 기본 연도</h2>
        <HelpHint label="기본 연도">
          회사 기준은 재직 중이면 올해, 퇴사한 회사는 퇴사 연도입니다. 주소에서 고른 연도가 있으면
          그 값을 사용합니다.
        </HelpHint>
        <div className="workspace-inline">
          <label htmlFor="year-mode">기본 연도</label>
          <select
            id="year-mode"
            value={yearMode}
            disabled={disabled || !settings}
            onChange={(event) => setYearMode(event.target.value as 'company' | 'current')}
          >
            <option value="company">회사 기준</option>
            <option value="current">항상 올해</option>
          </select>
          <button
            className="button secondary"
            disabled={disabled || !settings}
            onClick={() => void changeSetting('default_year_mode', yearMode)}
          >
            연도 설정 저장
          </button>
        </div>
      </section>
      <section className="workspace-block" aria-labelledby="new-company-title">
        <h2 id="new-company-title">새 회사 만들기</h2>
        <form onSubmit={(event) => void create(event)} noValidate>
          <div className="form-field">
            <label htmlFor="company-name">회사명</label>
            <input
              id="company-name"
              value={draft.name}
              maxLength={100}
              disabled={disabled}
              onChange={(event) => setDraft({ ...draft, name: event.target.value })}
              required
            />
          </div>
          <div className="workspace-columns">
            <div className="form-field">
              <label htmlFor="company-start">입사일 (선택)</label>
              <input
                id="company-start"
                type="date"
                value={draft.startedOn}
                disabled={disabled}
                onChange={(event) => setDraft({ ...draft, startedOn: event.target.value })}
              />
            </div>
            <div className="form-field">
              <label htmlFor="company-end">퇴사일 (선택)</label>
              <input
                id="company-end"
                type="date"
                value={draft.endedOn}
                disabled={disabled}
                onChange={(event) => setDraft({ ...draft, endedOn: event.target.value })}
              />
            </div>
          </div>
          <label className="workspace-check">
            <input
              type="checkbox"
              checked={draft.isCurrent}
              disabled={disabled}
              onChange={(event) => setDraft({ ...draft, isCurrent: event.target.checked })}
            />
            현재 회사로 표시
          </label>
          <button className="button primary" disabled={disabled || unknownCreate}>
            {pending ? '처리 중…' : '회사 만들기'}
          </button>
        </form>
      </section>
    </section>
  );
}

function CompanyWorkspace({
  profile,
  companyId,
  unscheduled,
  dayView,
  monthView,
}: {
  profile: Profile;
  companyId: string;
  unscheduled: boolean;
  dayView: boolean;
  monthView: boolean;
}) {
  const [company, setCompany] = useState<WorkspaceCompany | null>(null);
  const [projects, setProjects] = useState<WorkspaceProject[]>([]);
  const [tags, setTags] = useState<WorkspaceTag[]>([]);
  const [activeYear, setActiveYear] = useState(0);
  const [selected, setSelected] = useState('');
  const [loading, setLoading] = useState(true);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  const [settings, setSettings] = useState<WorkspaceSettings | null>(null);
  const lock = useRef(false);
  const revision = useRef(0);
  const remembered = useRef(false);
  const appliedYear = useRef(0);
  const projectsSchema = z
    .array(zWorkspaceProject)
    .refine((list) => list.every((project) => project.companyId === companyId));
  const tagsSchema = z
    .array(zWorkspaceTag)
    .refine((list) =>
      list.every((tag) => tag.isActive && (tag.companyId === null || tag.companyId === companyId)),
    );
  function expired(failure: unknown) {
    if (failure instanceof WorkspaceFailure && failure.status === 401) {
      login();
      return true;
    }
    return false;
  }
  function changeUrl(nextYear: number, project = selected) {
    if (!zWorkspaceYear.safeParse(nextYear).success) return;
    appliedYear.current = nextYear;
    setActiveYear(nextYear);
    const params = new URLSearchParams(unscheduled ? {} : { year: String(nextYear) });
    if (monthView) {
      const current = new URLSearchParams(window.location.search).get('month');
      params.set(
        'month',
        `${String(nextYear).padStart(4, '0')}-${current && isCalendarMonth(current) ? current.slice(5) : kstDate(Date.now()).slice(5, 7)}`,
      );
    }
    const date = new URLSearchParams(window.location.search).get('date');
    if (
      !unscheduled &&
      date &&
      (!monthView || date.startsWith(params.get('month') ?? 'invalid')) &&
      zWorkEntryDate.safeParse(date).success &&
      Number(date.slice(0, 4)) === nextYear
    )
      params.set('date', date);
    if (project) params.set('projectId', project);
    window.history.replaceState(
      null,
      '',
      `/c/${companyId}/${unscheduled ? 'unscheduled' : monthView ? 'month' : dayView ? 'day' : 'week'}?${params}`,
    );
  }
  async function reload() {
    const ticket = ++revision.current;
    setLoading(true);
    try {
      const [value, list, choices, preferences] = await Promise.all([
        api(
          `/api/companies/${companyId}`,
          zWorkspaceCompany.refine((row) => row.id === companyId),
        ),
        api(`/api/companies/${companyId}/projects`, projectsSchema),
        api(`/api/companies/${companyId}/work-tags`, tagsSchema),
        api('/api/settings', zWorkspaceSettings),
      ]);
      if (ticket !== revision.current) return;
      const url = new URL(window.location.href);
      const rawYear = url.searchParams.get('year');
      const validYear =
        rawYear !== null &&
        /^[0-9]{1,4}$/.test(rawYear) &&
        zWorkspaceYear.safeParse(Number(rawYear)).success;
      const requestedMonth = url.searchParams.get('month');
      const monthYear =
        monthView && requestedMonth && isCalendarMonth(requestedMonth)
          ? Number(requestedMonth.slice(0, 4))
          : null;
      const requestedDate = url.searchParams.get('date');
      const dateYear =
        !unscheduled && requestedDate && zWorkEntryDate.safeParse(requestedDate).success
          ? Number(requestedDate.slice(0, 4))
          : null;
      const nextYear =
        monthYear ??
        dateYear ??
        (validYear
          ? Number(rawYear)
          : workspaceDefaultYear(value, preferences.defaultYearMode.value));
      const requestedProject = url.searchParams.get('projectId');
      const nextProject =
        list.find((project) => project.id === requestedProject && project.isActive)?.id ?? '';
      setCompany(value);
      setProjects(list);
      setTags(choices);
      setSettings(preferences);
      appliedYear.current = nextYear;
      setActiveYear(nextYear);
      setSelected(nextProject);
      const params = new URLSearchParams(unscheduled ? {} : { year: String(nextYear) });
      if (
        !unscheduled &&
        requestedDate &&
        zWorkEntryDate.safeParse(requestedDate).success &&
        (!monthView || (requestedMonth && requestedDate.startsWith(requestedMonth)))
      )
        params.set('date', requestedDate);
      if (monthView)
        params.set(
          'month',
          requestedMonth && isCalendarMonth(requestedMonth)
            ? requestedMonth
            : `${String(nextYear).padStart(4, '0')}-${kstDate(Date.now()).slice(5, 7)}`,
        );
      if (nextProject) params.set('projectId', nextProject);
      const requestedEntryId = url.searchParams.get('entryId');
      if ((unscheduled || dayView) && zWorkspaceId.safeParse(requestedEntryId).success)
        params.set('entryId', requestedEntryId!);
      window.history.replaceState(
        null,
        '',
        `/c/${companyId}/${unscheduled ? 'unscheduled' : monthView ? 'month' : dayView ? 'day' : 'week'}?${params}`,
      );
      if (!remembered.current) {
        remembered.current = true;
        if (preferences.lastCompanyId.value !== companyId) void remember(preferences);
      }
    } catch (failure) {
      if (ticket === revision.current && !expired(failure)) setError(failureMessage(failure));
    } finally {
      if (ticket === revision.current) setLoading(false);
    }
  }
  useEffect(() => {
    void reload();
    return () => {
      revision.current++;
    };
  }, []);
  async function remember(preferences = settings) {
    if (lock.current || !preferences) return;
    lock.current = true;
    setPending(true);
    setError('');
    try {
      setSettings(
        await api('/api/settings', zWorkspaceSettings, 'PUT', {
          key: 'last_company_id',
          value: companyId,
          version: preferences.lastCompanyId.version,
        }),
      );
    } catch (failure) {
      if (expired(failure)) return;
      if ((failure instanceof WorkspaceFailure && failure.status === 409) || uncertain(failure)) {
        setSettings(null);
        try {
          setSettings(await api('/api/settings', zWorkspaceSettings));
          setError('최근 선택 설정을 다시 확인했습니다. 필요한 경우 다시 저장해 주세요.');
        } catch (refreshFailure) {
          if (!expired(refreshFailure))
            setError('최근 선택 설정을 확인할 수 없습니다. 다시 조회해 주세요.');
        }
      } else setError(failureMessage(failure));
    } finally {
      lock.current = false;
      setPending(false);
    }
  }
  const disabled = loading || pending;
  if (loading && !company && !error) return <WorkspaceLoading />;
  return (
    <section className="workspace" aria-labelledby="company-title">
      <h1 id="company-title" className="workspace-context-title">
        {monthView
          ? '월간 달력'
          : unscheduled
            ? '날짜 미정 업무'
            : dayView
              ? '일간 기록'
              : '주간 기록'}
      </h1>
      {error && (
        <p className="form-message" role="alert">
          {error}
        </p>
      )}
      {loading && <WorkspaceLoading inline />}
      {(!company || !!error) && (
        <RefreshButton
          className="text-button"
          disabled={disabled}
          onClick={() => {
            setError('');
            void reload();
          }}
          busy={loading || pending}
        >
          다시 조회
        </RefreshButton>
      )}
      {company && (
        <>
          <section
            className="workspace-block workspace-project-filter"
            aria-labelledby="project-list-title"
          >
            <h2 id="project-list-title" className="visually-hidden">
              {monthView ? '프로젝트 필터' : '프로젝트 선택'}
            </h2>
            {projects.filter((project) => project.isActive).length === 0 ? (
              <p className="workspace-empty">
                활성 프로젝트가 없습니다. 회사 설정의 프로젝트 관리에서 추가해 주세요.
              </p>
            ) : (
              <div className="form-field">
                <label htmlFor="selected-project">프로젝트</label>
                <select
                  id="selected-project"
                  title={
                    monthView
                      ? '선택한 프로젝트로 월간 목록을 조회합니다.'
                      : '새 기록의 기본 선택과 보기 이동에 사용합니다. 목록 범위는 조회 검색에서 선택합니다.'
                  }
                  value={selected}
                  disabled={disabled}
                  onChange={(event) => {
                    if (
                      workspaceHasUnsavedChanges() &&
                      !window.confirm(
                        monthView
                          ? '저장 전 입력을 보관하고 프로젝트 필터를 변경할까요?'
                          : '저장 전 입력을 보관하고 선택 프로젝트를 변경할까요?',
                      )
                    )
                      return;
                    setSelected(event.target.value);
                    changeUrl(appliedYear.current, event.target.value);
                  }}
                >
                  <option value="">모든 프로젝트</option>
                  {projects
                    .filter((project) => project.isActive)
                    .map((project) => (
                      <option key={project.id} value={project.id}>
                        {project.code}
                      </option>
                    ))}
                </select>
              </div>
            )}
          </section>
          {monthView ? (
            <MonthView
              creationContext={{ userId: profile.userId, projects, tags }}
              refreshBusy={disabled}
              onRefresh={() => {
                setError('');
                void reload();
              }}
              companyId={companyId}
              projectId={selected}
              year={activeYear}
              onSelect={(month) => {
                const nextYear = Number(month.slice(0, 4));
                setActiveYear(nextYear);
                appliedYear.current = nextYear;
                const params = new URLSearchParams({ year: String(nextYear), month });
                const keptDate = new URLSearchParams(window.location.search).get('date');
                if (
                  keptDate &&
                  keptDate.startsWith(month) &&
                  zWorkEntryDate.safeParse(keptDate).success
                )
                  params.set('date', keptDate);
                if (selected) params.set('projectId', selected);
                window.history.replaceState(null, '', `/c/${companyId}/month?${params}`);
              }}
            />
          ) : (
            <WorkEntriesPanel
              userId={profile.userId}
              companyId={companyId}
              projects={projects}
              tags={tags}
              selectedProjectId={selected}
              year={activeYear}
              unscheduled={unscheduled}
              dayView={dayView}
              onDateSelect={(date) => {
                const nextYear = Number(date.slice(0, 4));
                setActiveYear(nextYear);
                appliedYear.current = nextYear;
                const params = new URLSearchParams({ year: String(nextYear), date });
                if (selected) params.set('projectId', selected);
                window.history.replaceState(
                  null,
                  '',
                  `/c/${companyId}/${dayView ? 'day' : 'week'}?${params}`,
                );
              }}
            />
          )}
        </>
      )}
    </section>
  );
}
