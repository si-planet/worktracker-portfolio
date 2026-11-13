import { useEffect, useState, type FormEvent } from 'react';
import { zRequestPasswordReset, zResetPassword } from '../shared/schema/auth';

const accepted = '요청을 접수했습니다. 등록된 계정이라면 메일이 발송됩니다.';
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

/** Run once before rendering: fragments never enter server URLs; do not persist the token. */
export function takeResetToken() {
  const url = new URL(window.location.href);
  const fragment = new URLSearchParams(url.hash.slice(1));
  const value = fragment.get('token') ?? '';
  const valid = !url.search && [...fragment.keys()].length === 1 && /^[a-f0-9]{64}$/.test(value);
  window.history.replaceState(null, '', '/reset-password');
  return valid ? value : '';
}

export function ForgotPasswordPage() {
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [nextAt, setNextAt] = useState(0);
  const [now, setNow] = useState(Date.now);
  const remaining = Math.max(0, Math.ceil((nextAt - now) / 1000));
  useEffect(() => {
    if (!nextAt) return;
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [nextAt]);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending || Date.now() < nextAt) return;
    setMessage('');
    setError('');
    if (!navigator.onLine) {
      setError('오프라인에서는 요청할 수 없습니다. 연결 후 다시 시도해 주세요.');
      return;
    }
    const parsed = zRequestPasswordReset.safeParse(
      Object.fromEntries(new FormData(event.currentTarget)),
    );
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? '입력 내용을 확인해 주세요.');
      return;
    }
    setPending(true);
    try {
      const { response, data } = await post('/api/auth/request-password-reset', parsed.data);
      if ((response.status === 202 && data.accepted === true) || response.status === 429) {
        setMessage(accepted);
        const retry = Number(response.headers.get('Retry-After') ?? 60);
        const seconds = Number.isFinite(retry) ? Math.min(3600, Math.max(60, retry)) : 60;
        setNow(Date.now());
        setNextAt(Date.now() + seconds * 1000);
      } else
        setError(
          response.status === 503
            ? '이메일 발송 설정을 준비 중이거나 연결할 수 없습니다.'
            : '요청을 처리하지 못했습니다. 입력 내용을 확인해 주세요.',
        );
    } catch {
      setError('요청 결과를 확인할 수 없습니다. 잠시 후 다시 시도해 주세요.');
    } finally {
      setPending(false);
    }
  }
  return (
    <section className="auth-panel" aria-labelledby="forgot-title">
      <p className="eyebrow">계정 복구</p>
      <h1 id="forgot-title">비밀번호 찾기</h1>
      <p className="description">아이디와 가입할 때 인증한 이메일을 입력해 주세요.</p>
      <form noValidate onSubmit={(event) => void submit(event)}>
        <div className="form-field">
          <label htmlFor="recovery-username">아이디</label>
          <input
            id="recovery-username"
            name="username"
            autoComplete="username"
            autoCapitalize="none"
            spellCheck={false}
            maxLength={32}
            disabled={pending}
            required
          />
        </div>
        <div className="form-field">
          <label htmlFor="recovery-email">인증한 이메일</label>
          <input
            id="recovery-email"
            name="email"
            type="email"
            autoComplete="email"
            autoCapitalize="none"
            spellCheck={false}
            maxLength={254}
            disabled={pending}
            required
          />
        </div>
        <button className="button primary" disabled={pending || remaining > 0}>
          {pending
            ? '요청 중…'
            : remaining > 0
              ? `${remaining}초 후 다시 요청`
              : '비밀번호 재설정 메일 요청'}
        </button>
      </form>
      {message && (
        <>
          <p className="form-success" role="status">
            {message}
          </p>
          <p className="field-hint">
            5분 안에 오지 않으면 스팸함과 이메일 주소를 확인해 주세요. 링크는 1시간 동안 사용할 수
            있습니다.
          </p>
        </>
      )}
      {error && (
        <p className="form-message" role="alert">
          {error}
        </p>
      )}
      <nav className="auth-links" aria-label="계정 복구 메뉴">
        <a className="control-link" href="/login">
          로그인으로 돌아가기
        </a>
      </nav>
    </section>
  );
}

export function ResetPasswordPage({ initialToken }: { initialToken: string }) {
  const [token, setToken] = useState(initialToken);
  const [pending, setPending] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => {
    // A new mail link in this tab may be a fragment-only navigation. Reload
    // so it follows the same one-time extraction as a fresh document.
    const reopen = () => {
      if (window.location.hash) window.location.reload();
    };
    window.addEventListener('hashchange', reopen);
    return () => window.removeEventListener('hashchange', reopen);
  }, []);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending) return;
    setError('');
    if (!navigator.onLine) {
      setError('오프라인에서는 비밀번호를 변경할 수 없습니다.');
      return;
    }
    const form = new FormData(event.currentTarget);
    const newPassword = form.get('newPassword');
    if (newPassword !== form.get('confirmPassword')) {
      setError('새 비밀번호가 서로 일치하지 않습니다.');
      return;
    }
    const parsed = zResetPassword.safeParse({ token, newPassword });
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? '입력 내용을 확인해 주세요.');
      return;
    }
    setPending(true);
    try {
      const { response, data } = await post('/api/auth/reset-password', parsed.data);
      if (response.ok && data.success === true) {
        setToken('');
        setDone(true);
      } else if (response.status === 400 && data.code === 'AUTH_LINK_INVALID') {
        setToken('');
        setError('링크가 만료되었거나 이미 사용됐습니다. 새 메일을 요청해 주세요.');
      } else if (response.status === 429)
        setError('요청이 많습니다. 잠시 기다린 뒤 다시 시도해 주세요.');
      else
        setError(
          '변경 결과를 확인할 수 없습니다. 새 비밀번호로 로그인해 보거나 복구 메일을 다시 요청해 주세요.',
        );
    } catch {
      setError(
        '변경 결과를 확인할 수 없습니다. 새 비밀번호로 로그인해 보거나 복구 메일을 다시 요청해 주세요.',
      );
    } finally {
      setPending(false);
    }
  }
  return (
    <section className="auth-panel" aria-labelledby="reset-title">
      <p className="eyebrow">계정 복구</p>
      <h1 id="reset-title">{done ? '비밀번호를 변경했습니다.' : '새 비밀번호 설정'}</h1>
      {done ? (
        <p role="status">
          이전에 로그인한 모든 기기에서 로그아웃했습니다. 새 비밀번호로 로그인해 주세요.
        </p>
      ) : token ? (
        <>
          <p className="description">변경하면 이전에 로그인한 모든 기기에서 로그아웃됩니다.</p>
          <form noValidate onSubmit={(event) => void submit(event)}>
            <div className="form-field">
              <label htmlFor="new-password">새 비밀번호</label>
              <input
                id="new-password"
                name="newPassword"
                type="password"
                autoComplete="new-password"
                minLength={12}
                maxLength={128}
                disabled={pending}
                required
                aria-describedby="new-password-help"
              />
              <p id="new-password-help" className="field-hint">
                12~128자. 공백도 비밀번호에 포함됩니다.
              </p>
            </div>
            <div className="form-field">
              <label htmlFor="confirm-password">새 비밀번호 확인</label>
              <input
                id="confirm-password"
                name="confirmPassword"
                type="password"
                autoComplete="new-password"
                maxLength={128}
                disabled={pending}
                required
              />
            </div>
            <button className="button primary" disabled={pending}>
              {pending ? '변경 중…' : '비밀번호 변경'}
            </button>
          </form>
        </>
      ) : (
        <p>
          메일의 비밀번호 재설정 링크를 열어 주세요. 새로고침했다면 메일에서 다시 열 수 있습니다.
        </p>
      )}
      {error && (
        <p className="form-message" role="alert">
          {error}
        </p>
      )}
      <nav className="auth-links" aria-label="계정 복구 메뉴">
        <a className="control-link" href="/login">
          로그인으로 이동
        </a>
        {!done && (
          <a className="control-link" href="/forgot-password">
            복구 메일 다시 요청
          </a>
        )}
      </nav>
    </section>
  );
}
