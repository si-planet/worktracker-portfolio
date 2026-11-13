import { StrictMode, useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import './styles.css';
import './workspace.css';
import { AccountPage, AuthPage, LegacyVerificationRedirect, VerificationPage } from './auth';
import { ForgotPasswordPage, ResetPasswordPage, takeResetToken } from './password-recovery';
import { ConfirmEmailChangePage, takeEmailChangeToken } from './email-change';
import { WorkspacePage } from './workspace';
import { WorkspaceLoading } from './workspace-loading';
import { AccountTransferPage } from './account-transfer';
import { PwaShell } from './pwa';
import { initializePwa, pwaSnapshot } from './pwa-runtime';

const startupReady = initializePwa();

let initialResetToken = '';
let initialEmailChangeToken = '';

type Connection = 'checking' | 'ready' | 'unavailable';

function Home() {
  const [connection, setConnection] = useState<Connection>('checking');

  useEffect(() => {
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), 5000);
    let active = true;

    async function checkConnection() {
      try {
        const response = await fetch('/api/health', {
          signal: controller.signal,
          cache: 'no-store',
        });
        const body: unknown = await response.json();
        const ready =
          response.ok &&
          body !== null &&
          typeof body === 'object' &&
          'status' in body &&
          body.status === 'ok';
        if (active) setConnection(ready ? 'ready' : 'unavailable');
      } catch {
        if (active) setConnection('unavailable');
      } finally {
        window.clearTimeout(timeout);
      }
    }

    void checkConnection();
    return () => {
      active = false;
      window.clearTimeout(timeout);
      controller.abort();
    };
  }, []);

  const statusLabel = {
    checking: '연결 확인 중',
    ready: '서버 연결됨',
    unavailable: '서버 연결을 확인해 주세요',
  }[connection];

  return (
    <>
      <section className="welcome" aria-labelledby="welcome-title">
        <p className="eyebrow">업무 기록의 시작</p>
        <h1 id="welcome-title">
          업무와 일정을
          <br />한 곳에서 관리하세요.
        </h1>
        <p className="description">일정을 정하기 전의 업무부터, 하루의 기록과 휴가까지.</p>
        <div className={`connection ${connection}`} role="status" aria-live="polite">
          <span className="dot" aria-hidden="true" />
          {statusLabel}
        </div>
      </section>
      <section className="notice" aria-label="계정 시작 안내">
        <h2>계정으로 시작하세요.</h2>
        <p>로그인 후 회사를 선택하고 프로젝트를 관리할 수 있습니다.</p>
        <div className="home-actions">
          <a className="button primary" href="/login">
            로그인 화면 보기
          </a>
          <a className="button secondary" href="/signup">
            계정 만들기
          </a>
        </div>
      </section>
    </>
  );
}

function App() {
  const path = window.location.pathname;
  const realReview = path === '/worklog-review';
  const company =
    /^\/c\/([^/]+)(?:\/(?:week|day|month|search|notes|recurrence|goals|wbs|worklog-import|export|unscheduled|settings\/(?:projects|tags|leave)))?$/.exec(
      path,
    )?.[1];
  const page =
    path === '/account-transfer' || path === '/account-transfer/source' ? (
      <AccountTransferPage mode={path.endsWith('/source') ? 'source' : 'target'} />
    ) : path === '/login' ? (
      <AuthPage mode="login" />
    ) : path === '/signup' ? (
      <AuthPage
        mode="signup"
        initialVerification={
          new URLSearchParams(window.location.search).get('step') === 'verification'
        }
      />
    ) : path === '/resend-verification' ? (
      <LegacyVerificationRedirect />
    ) : path === '/verify-email' ? (
      <VerificationPage />
    ) : path === '/settings/companies' ? (
      <WorkspacePage companyManagement fallback={<Home />} />
    ) : path === '/settings' ? (
      <AccountPage />
    ) : path === '/forgot-password' ? (
      <ForgotPasswordPage />
    ) : path === '/reset-password' ? (
      <ResetPasswordPage initialToken={initialResetToken} />
    ) : path === '/confirm-email-change' ? (
      <ConfirmEmailChangePage initialToken={initialEmailChangeToken} />
    ) : realReview ? (
      <WorkspacePage realWorklogReview fallback={<Home />} />
    ) : path === '/' ? (
      <WorkspacePage fallback={<Home />} />
    ) : company ? (
      <WorkspacePage
        companyId={company}
        dayView={path.endsWith('/day')}
        monthView={path.endsWith('/month')}
        searchView={path.endsWith('/search')}
        notesView={path.endsWith('/notes')}
        recurrenceView={path.endsWith('/recurrence')}
        goalsView={path.endsWith('/goals')}
        wbsView={path.endsWith('/wbs')}
        importView={path.endsWith('/worklog-import')}
        exportView={path.endsWith('/export')}
        unscheduled={path.endsWith('/unscheduled')}
        projectAdmin={path.endsWith('/settings/projects')}
        tagAdmin={path.endsWith('/settings/tags')}
        leaveLedgerView={path.endsWith('/settings/leave')}
        fallback={<Home />}
      />
    ) : (
      <Home />
    );
  return (
    <main className={`page${company || realReview ? ' page-company' : ''}`}>
      {!company && !realReview && (
        <header className="brand">
          <a href="/" className="brand-link">
            <span className="brand-mark" aria-hidden="true">
              W
            </span>{' '}
            Work Tracker
          </a>
        </header>
      )}
      {page}
    </main>
  );
}

const root = document.getElementById('root');
if (!root) throw new Error('Root element is missing.');
const appRoot = createRoot(root);
function renderApp() {
  // Auth links stay in memory/URL until the startup update can no longer reload this page.
  initialResetToken =
    !pwaSnapshot().startupOffline && window.location.pathname === '/reset-password'
      ? takeResetToken()
      : '';
  initialEmailChangeToken =
    !pwaSnapshot().startupOffline && window.location.pathname === '/confirm-email-change'
      ? takeEmailChangeToken()
      : '';
  appRoot.render(
    <StrictMode>
      <PwaShell>
        <App />
      </PwaShell>
    </StrictMode>,
  );
}
if (startupReady) {
  appRoot.render(
    <main className="page">
      <WorkspaceLoading />
    </main>,
  );
  void startupReady.then(renderApp);
} else renderApp();
