import { useEffect, useRef, useState, type ReactNode } from 'react';
import { zWorkspaceCompany, type WorkspaceCompany } from '../shared/schema/workspace';
import { currentCompanyWeek, COMPANY_MANAGEMENT_PATH } from '../shared/workspace-landing';
export { currentCompanyWeek } from '../shared/workspace-landing';
import './workspace-shell.css';
import { WorkspaceLoading } from './workspace-loading';

class CompanySessionExpired extends Error {}

async function readCompanies(signal: AbortSignal) {
  const response = await fetch('/api/companies', {
    credentials: 'same-origin',
    cache: 'no-store',
    signal,
  });
  if (response.status === 401) throw new CompanySessionExpired('UNAUTHENTICATED');
  if (!response.ok) throw new Error('Company list unavailable');
  return zWorkspaceCompany.array().parse(await response.json());
}

export async function defaultWorkspaceLanding() {
  try {
    return currentCompanyWeek(await readCompanies(AbortSignal.timeout(15_000)));
  } catch {
    return '/';
  }
}

type IconName =
  'week' | 'month' | 'all' | 'goals' | 'wbs' | 'import' | 'export' | 'project' | 'tag';
const iconPaths: Record<IconName, string> = {
  week: 'M4 5h16v15H4z M8 3v4 M16 3v4 M4 10h16 M8 14h3 M8 17h6',
  month: 'M4 5h16v15H4z M8 3v4 M16 3v4 M4 10h16 M8 14h1 M12 14h1 M16 14h1 M8 17h1 M12 17h1',
  all: 'M9 6h11 M9 12h11 M9 18h11 M4 6h1 M4 12h1 M4 18h1',
  goals: 'M20 11a8 8 0 1 1-7-7 M16 3h5v5 M21 3l-9 9 M15 12a3 3 0 1 1-3-3',
  wbs: 'M9 3h6v5H9z M3 16h6v5H3z M15 16h6v5h-6z M12 8v4 M6 16v-4h12v4',
  import: 'M5 3h10l4 4v14H5z M14 3v5h5 M12 11v7 M9 15l3 3 3-3',
  export: 'M5 3h10l4 4v14H5z M14 3v5h5 M12 18v-7 M9 14l3-3 3 3',
  project: 'M3 6h7l2 3h9v11H3z M3 6V4h7l2 2h7v3',
  tag: 'M3 4h9l9 9-8 8-10-10z M7 8h.01',
};

function MenuIcon({ name }: { name: IconName }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d={iconPaths[name]} />
    </svg>
  );
}

type ShellProfile = { username: string; email: string };

export function WorkspaceShell({
  companyId,
  contextLabel,
  viewLabel,
  profile,
  children,
  onExpired,
}: {
  companyId?: string;
  contextLabel?: string;
  viewLabel?: string;
  profile: ShellProfile;
  children: ReactNode;
  onExpired: () => void;
}) {
  const [companies, setCompanies] = useState<WorkspaceCompany[]>([]);
  const company = companies.find((row) => row.id === companyId) ?? null;
  const [expanded, setExpanded] = useState<Record<string, boolean>>(
    companyId ? { [companyId]: true } : {},
  );
  const [collapsed, setCollapsed] = useState(false);
  const [companyFailed, setCompanyFailed] = useState(false);
  const [companiesChecked, setCompaniesChecked] = useState(false);
  const [authExpired, setAuthExpired] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const menu = useRef<HTMLDialogElement>(null);
  const menuButton = useRef<HTMLButtonElement>(null);
  const closeButton = useRef<HTMLButtonElement>(null);
  const base = `/c/${companyId}`;
  const path = window.location.pathname;
  const exportCompany = company ?? companies.find((row) => row.isCurrent) ?? companies[0];
  const links: { label: string; suffix: string; icon: IconName; active: boolean }[] = [
    {
      label: '주간 보기',
      suffix: 'week',
      icon: 'week',
      active: path === base || path.endsWith('/week') || path.endsWith('/day'),
    },
    { label: '월간 보기', suffix: 'month', icon: 'month', active: path.endsWith('/month') },
    {
      label: '업무 전체',
      suffix: 'search',
      icon: 'all',
      active: path.endsWith('/search') || path.endsWith('/unscheduled'),
    },
    { label: '업무 노트', suffix: 'notes', icon: 'all', active: path.endsWith('/notes') },
    {
      label: '반복 일정',
      suffix: 'recurrence',
      icon: 'week',
      active: path.endsWith('/recurrence'),
    },
    { label: 'WBS 계획', suffix: 'wbs', icon: 'wbs', active: path.endsWith('/wbs') },
    {
      label: '연차 관리',
      suffix: 'settings/leave',
      icon: 'week',
      active: path.endsWith('/settings/leave'),
    },
    {
      label: '프로젝트 관리',
      suffix: 'settings/projects',
      icon: 'project',
      active: path.endsWith('/settings/projects'),
    },
    {
      label: '태그 관리',
      suffix: 'settings/tags',
      icon: 'tag',
      active: path.endsWith('/settings/tags'),
    },
  ];
  const routeLabel =
    viewLabel ??
    (path.endsWith('/worklog-import')
      ? '초기 자료 이전 · 전용 도구'
      : path.endsWith('/export')
        ? '기록 내보내기'
        : path.endsWith('/day')
          ? '일간 기록'
          : path.endsWith('/unscheduled')
            ? '날짜 미정 업무'
            : (links.find((link) => link.active)?.label ?? '주간 보기'));
  const companyName =
    contextLabel ?? company?.name ?? (companyFailed ? '회사 정보 확인 필요' : '회사 확인 중');

  useEffect(() => {
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), 15_000);
    let active = true;
    setCompanies([]);
    setCompanyFailed(false);
    setCompaniesChecked(false);
    void readCompanies(controller.signal)
      .then((companies) => {
        if (!active) return;
        const selected = companies.find((candidate) => candidate.id === companyId);
        setCompanies(companies);
        setCompanyFailed(Boolean(companyId) && !selected);
      })
      .catch((failure: unknown) => {
        if (!active) return;
        if (failure instanceof CompanySessionExpired) {
          setAuthExpired(true);
          onExpired();
        } else setCompanyFailed(true);
      })
      .finally(() => {
        window.clearTimeout(timeout);
        if (active) setCompaniesChecked(true);
      });
    return () => {
      active = false;
      window.clearTimeout(timeout);
      controller.abort();
    };
  }, [companyId, onExpired]);

  useEffect(() => {
    const dialog = menu.current;
    if (!dialog) return;
    if (!menuOpen) {
      if (dialog.open) {
        dialog.close();
        if (menuButton.current?.getClientRects().length) menuButton.current.focus();
      }
      return;
    }
    if (!dialog.open) dialog.showModal();
    closeButton.current?.focus();
    const overflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = overflow;
    };
  }, [menuOpen]);

  useEffect(() => {
    const desktop = window.matchMedia('(min-width: 960px)');
    const closeOnDesktop = () => {
      if (desktop.matches) setMenuOpen(false);
    };
    desktop.addEventListener('change', closeOnDesktop);
    return () => desktop.removeEventListener('change', closeOnDesktop);
  }, []);

  function navigation() {
    return (
      <>
        <a className="workspace-shell-logo" href="/">
          <span aria-hidden="true">W</span> Work Tracker
        </a>
        <nav className="workspace-shell-companies" aria-label="회사 목록">
          {companies.map((row) => {
            const open = expanded[row.id] ?? row.id === companyId;
            return (
              <div className="workspace-company-group" key={row.id}>
                <button
                  type="button"
                  className="workspace-company-toggle"
                  aria-expanded={open}
                  aria-label={`${row.name} 메뉴 ${open ? '접기' : '펼치기'}`}
                  onClick={() => setExpanded((previous) => ({ ...previous, [row.id]: !open }))}
                >
                  <span aria-hidden="true">{open ? '▾' : '▸'}</span>
                  <strong>{row.name}</strong>
                  {row.isCurrent && <span className="workspace-shell-current">재직</span>}
                </button>
                <div className="workspace-shell-nav" hidden={!open}>
                  {links
                    .filter((link) => !link.suffix.startsWith('settings/'))
                    .map((link) => (
                      <a
                        key={link.suffix}
                        href={`/c/${row.id}/${link.suffix}`}
                        aria-current={row.id === companyId && link.active ? 'page' : undefined}
                      >
                        <MenuIcon name={link.icon} />
                        <span>{link.label}</span>
                      </a>
                    ))}
                  <details
                    className="workspace-company-settings"
                    open={row.id === companyId && path.includes('/settings/')}
                  >
                    <summary>회사 설정</summary>
                    {links
                      .filter((link) => link.suffix.startsWith('settings/'))
                      .map((link) => (
                        <a
                          key={link.suffix}
                          href={`/c/${row.id}/${link.suffix}`}
                          aria-current={row.id === companyId && link.active ? 'page' : undefined}
                        >
                          <MenuIcon name={link.icon} />
                          <span>{link.label}</span>
                        </a>
                      ))}
                  </details>
                </div>
              </div>
            );
          })}
          {companyFailed && <p role="alert">회사 목록을 불러오지 못했습니다.</p>}
        </nav>
        <nav className="workspace-shell-tools" aria-label="공통 도구">
          {exportCompany && (
            <a
              href={`/c/${exportCompany.id}/export`}
              aria-current={path.endsWith('/export') ? 'page' : undefined}
            >
              <MenuIcon name="export" />
              <span>기록 내보내기</span>
            </a>
          )}
          <a className="workspace-company-manage" href={COMPANY_MANAGEMENT_PATH}>
            회사 추가 · 관리
          </a>
        </nav>
        <div className="workspace-shell-footer">
          <a href="/settings">계정 설정</a>
          <a href="/account-transfer">계정 연결 구성</a>
          <span className="workspace-shell-caption">{profile.email}</span>
        </div>
      </>
    );
  }

  if (authExpired) return <p role="alert">로그인 상태가 만료되었습니다. 다시 로그인해 주세요.</p>;
  if (!companiesChecked) return <WorkspaceLoading />;

  return (
    <div className={`workspace-shell${collapsed ? ' is-collapsed' : ''}`}>
      <a className="workspace-shell-skip" href="#workspace-main-content">
        본문으로 이동
      </a>
      <aside className="workspace-shell-sidebar" aria-label="회사 사이드바">
        {navigation()}
      </aside>
      <div className="workspace-shell-main">
        <header className="workspace-shell-topbar">
          <button
            ref={menuButton}
            className="workspace-shell-menu-button"
            type="button"
            aria-label="회사 메뉴 접기·펼치기"
            aria-haspopup="dialog"
            aria-controls="workspace-mobile-menu"
            aria-expanded={window.matchMedia('(min-width: 960px)').matches ? !collapsed : menuOpen}
            onClick={() => {
              if (window.matchMedia('(min-width: 960px)').matches) setCollapsed((value) => !value);
              else setMenuOpen(true);
            }}
          >
            <svg
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.8"
              strokeLinecap="round"
              aria-hidden="true"
            >
              <path d="M4 6h16 M4 12h16 M4 18h16" />
            </svg>
          </button>
          <div className="workspace-shell-breadcrumb" aria-label="현재 위치">
            <span>{companyName}</span>
            <span aria-hidden="true">/</span>
            <strong>{routeLabel}</strong>
          </div>
          <a
            className="workspace-shell-account"
            href="/settings"
            aria-label={`${profile.username} 계정 설정`}
          >
            <span className="workspace-shell-avatar" aria-hidden="true">
              {profile.username.slice(0, 1).toUpperCase()}
            </span>
            <span>{profile.username}</span>
          </a>
        </header>
        <div id="workspace-main-content" className="workspace-shell-content" tabIndex={-1}>
          {children}
        </div>
      </div>
      <dialog
        ref={menu}
        id="workspace-mobile-menu"
        className="workspace-shell-mobile-menu"
        aria-labelledby="workspace-mobile-menu-title"
        onCancel={(event) => {
          event.preventDefault();
          setMenuOpen(false);
        }}
        onClose={(event) => {
          // Native close is queued; a later reopen must not be undone by the old event.
          if (!event.currentTarget.open) setMenuOpen(false);
        }}
        onClick={(event) => {
          if (event.target !== event.currentTarget) return;
          const bounds = event.currentTarget.getBoundingClientRect();
          if (
            event.clientX < bounds.left ||
            event.clientX > bounds.right ||
            event.clientY < bounds.top ||
            event.clientY > bounds.bottom
          )
            setMenuOpen(false);
        }}
      >
        <div className="workspace-shell-mobile-heading">
          <strong id="workspace-mobile-menu-title">회사 메뉴</strong>
          <button
            ref={closeButton}
            type="button"
            aria-label="회사 메뉴 닫기"
            onClick={() => setMenuOpen(false)}
          >
            ×
          </button>
        </div>
        <div
          className="workspace-shell-mobile-links"
          onClick={(event) => {
            if (event.target instanceof Element && event.target.closest('a[href]'))
              setMenuOpen(false);
          }}
        >
          {navigation()}
        </div>
      </dialog>
    </div>
  );
}
