import { useEffect, useRef, useState, type FormEvent } from 'react';
import { zConfirmEmailChange, zRequestEmailChange } from '../shared/schema/email-change';

const accepted = '요청을 접수했습니다. 변경할 수 있는 이메일이라면 인증 메일이 발송됩니다.';
const uncertain =
  '변경 결과를 확인할 수 없습니다. 계정 설정에서 현재 이메일을 확인해 주세요. 필요하면 새 인증 메일을 요청할 수 있습니다.';

async function post(path: string, body: unknown) {
  const response = await fetch(path, {
    method: 'POST',
    credentials: 'same-origin',
    cache: 'no-store',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(15_000),
  });
  const raw: unknown = await response.json();
  const data = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
  return { response, data };
}

function useRetryDelay() {
  const [nextAt, setNextAt] = useState(0);
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    if (!nextAt) return;
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [nextAt]);
  return {
    nextAt,
    remaining: Math.max(0, Math.ceil((nextAt - now) / 1000)),
    delay(response: Response) {
      const retry = Number(response.headers.get('Retry-After') ?? 60);
      const seconds = Number.isFinite(retry) ? Math.min(3600, Math.max(60, retry)) : 60;
      setNow(Date.now());
      setNextAt(Date.now() + seconds * 1000);
    },
  };
}

/** Extract before rendering; never put the bearer token in storage or server URLs. */
export function takeEmailChangeToken() {
  const url = new URL(window.location.href);
  const fragment = new URLSearchParams(url.hash.slice(1));
  const token = fragment.get('token') ?? '';
  const valid =
    !url.search &&
    [...fragment.keys()].length === 1 &&
    zConfirmEmailChange.safeParse({ token }).success;
  window.history.replaceState(null, '', '/confirm-email-change');
  return valid ? token : '';
}

export function EmailChangeSettings() {
  const busy = useRef(false);
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const retry = useRetryDelay();

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy.current || Date.now() < retry.nextAt) return;
    setMessage('');
    setError('');
    if (!navigator.onLine) {
      setError('오프라인에서는 이메일 변경을 요청할 수 없습니다. 연결 후 다시 시도해 주세요.');
      return;
    }
    const form = event.currentTarget;
    const parsed = zRequestEmailChange.safeParse(Object.fromEntries(new FormData(form)));
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? '입력 내용을 확인해 주세요.');
      return;
    }
    busy.current = true;
    setPending(true);
    const password = form.elements.namedItem('currentPassword');
    if (password instanceof HTMLInputElement) password.value = '';
    try {
      const { response, data } = await post('/api/auth/change-email', parsed.data);
      if (response.status === 202 && data.accepted === true) {
        setMessage(accepted);
        retry.delay(response);
      } else if (response.status === 401) window.location.assign('/login');
      else if (response.status === 403 && data.code === 'INVALID_CURRENT_PASSWORD')
        setError('현재 비밀번호를 확인해 주세요.');
      else if (response.status === 429) {
        retry.delay(response);
        setError('요청이 많습니다. 표시된 대기 시간이 지난 뒤 다시 시도해 주세요.');
      } else
        setError(
          response.status === 503
            ? '이메일 발송 설정을 준비 중이거나 연결할 수 없습니다.'
            : '요청을 처리하지 못했습니다. 입력 내용과 로그인 상태를 확인해 주세요.',
        );
    } catch {
      setError('요청 결과를 확인할 수 없습니다. 메일함을 확인하거나 잠시 후 다시 시도해 주세요.');
    } finally {
      busy.current = false;
      setPending(false);
    }
  }

  return (
    <section className="settings-section" aria-labelledby="email-change-title">
      <h2 id="email-change-title">이메일 변경</h2>
      <p className="field-hint">
        새 이메일의 인증을 마칠 때까지 현재 이메일과 비밀번호 복구 주소가 유지됩니다. 변경 후에도
        로그인한 기기는 유지됩니다.
      </p>
      <form noValidate onSubmit={(event) => void submit(event)}>
        <div className="form-field">
          <label htmlFor="change-email">새 이메일</label>
          <input
            id="change-email"
            name="newEmail"
            type="email"
            autoComplete="email"
            autoCapitalize="none"
            spellCheck={false}
            maxLength={254}
            disabled={pending}
            required
          />
        </div>
        <div className="form-field">
          <label htmlFor="email-change-password">현재 비밀번호</label>
          <input
            id="email-change-password"
            name="currentPassword"
            type="password"
            autoComplete="current-password"
            maxLength={128}
            disabled={pending}
            required
          />
        </div>
        <button className="button secondary" disabled={pending || retry.remaining > 0}>
          {pending
            ? '요청 중…'
            : retry.remaining > 0
              ? `${retry.remaining}초 후 다시 요청`
              : '이메일 변경 인증 메일 요청'}
        </button>
      </form>
      {message && (
        <>
          <p className="form-success" role="status">
            {message}
          </p>
          <p className="field-hint">
            새 이메일의 메일함과 스팸함을 확인해 주세요. 링크는 1시간 동안 사용할 수 있습니다.
            인증을 마친 뒤 계정을 새로고침하면 현재 이메일을 확인할 수 있습니다.
          </p>
          <a className="text-button" href="/settings">
            계정 새로고침
          </a>
        </>
      )}
      {error && (
        <p className="form-message" role="alert">
          {error}
        </p>
      )}
    </section>
  );
}

export function ConfirmEmailChangePage({ initialToken }: { initialToken: string }) {
  const [token, setToken] = useState(initialToken);
  const busy = useRef(false);
  const [pending, setPending] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState('');
  const retry = useRetryDelay();
  useEffect(() => {
    const reopen = () => {
      if (window.location.hash) window.location.reload();
    };
    window.addEventListener('hashchange', reopen);
    return () => window.removeEventListener('hashchange', reopen);
  }, []);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy.current || !token || Date.now() < retry.nextAt) return;
    setError('');
    if (!navigator.onLine) {
      setError('오프라인에서는 이메일 변경을 확인할 수 없습니다.');
      return;
    }
    busy.current = true;
    setPending(true);
    try {
      const { response, data } = await post('/api/auth/confirm-email-change', { token });
      if (response.ok && data.success === true) {
        setToken('');
        setDone(true);
      } else if (response.status === 400 && data.code === 'EMAIL_CHANGE_LINK_INVALID') {
        setToken('');
        setError(
          '링크가 만료되었거나 사용할 수 없습니다. 계정 설정에서 새 인증 메일을 요청해 주세요.',
        );
      } else if (response.status === 429) {
        retry.delay(response);
        setError('요청이 많습니다. 표시된 대기 시간이 지난 뒤 다시 시도해 주세요.');
      } else setError(uncertain);
    } catch {
      setError(uncertain);
    } finally {
      busy.current = false;
      setPending(false);
    }
  }
  return (
    <section className="auth-panel" aria-labelledby="confirm-email-title">
      <p className="eyebrow">내 계정</p>
      <h1 id="confirm-email-title">{done ? '이메일을 변경했습니다.' : '이메일 변경 확인'}</h1>
      {done ? (
        <p role="status">
          기존 로그인은 유지됩니다. 계정 설정에서 새 이메일을 확인해 주세요. 로그인하지 않은
          브라우저에서는 아이디와 비밀번호로 로그인할 수 있습니다.
        </p>
      ) : token ? (
        <>
          <p className="description">
            확인 버튼을 누르면 이 메일을 받은 주소로 계정 이메일을 변경합니다. 기존 로그인은
            유지됩니다.
          </p>
          <form onSubmit={(event) => void submit(event)}>
            <button className="button primary" disabled={pending || retry.remaining > 0}>
              {pending
                ? '확인 중…'
                : retry.remaining > 0
                  ? `${retry.remaining}초 후 다시 확인`
                  : '이메일 변경 확인'}
            </button>
          </form>
        </>
      ) : (
        <p>메일의 이메일 변경 링크를 열어 주세요. 새로고침했다면 메일에서 다시 열 수 있습니다.</p>
      )}
      {error && (
        <p className="form-message" role="alert">
          {error}
        </p>
      )}
      <nav className="auth-links" aria-label="이메일 변경 메뉴">
        <a className="control-link" href="/settings">
          계정 설정으로 이동
        </a>
        <a className="control-link" href="/login">
          로그인으로 이동
        </a>
      </nav>
    </section>
  );
}
