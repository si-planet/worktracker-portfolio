import { useEffect, useState, type FormEvent } from 'react';
import { zResendVerification, zSignIn, zSignUp } from '../shared/schema/auth';
import { SessionSettings, SignupSettings } from './account-settings';
import { EmailChangeSettings } from './email-change';
import { workspaceReturnTo } from './workspace';
import { defaultWorkspaceLanding } from './workspace-shell';
import { postLoginLanding } from '../shared/workspace-landing';

const accepted = '요청을 접수했습니다. 등록된 계정이라면 메일이 발송됩니다.';
type FieldErrors = Record<string, string[] | undefined>;
type PageMode = 'login' | 'signup';

async function request(path: string, body?: unknown) {
  const response = await fetch(path, {
    method: body === undefined ? 'GET' : 'POST',
    credentials: 'same-origin',
    cache: 'no-store',
    signal: AbortSignal.timeout(15_000),
    ...(body === undefined
      ? {}
      : { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }),
  });
  const data: unknown = await response.json();
  return {
    response,
    data: data && typeof data === 'object' ? (data as Record<string, unknown>) : {},
  };
}
function errorMessage(data: Record<string, unknown>) {
  const messages: Record<string, string> = {
    INVALID_CREDENTIALS: '아이디 또는 비밀번호를 확인해 주세요.',
    EMAIL_NOT_VERIFIED:
      '이메일 인증이 필요합니다. 계정 만들기에서 인증 메일을 다시 요청할 수 있습니다.',
    BOOTSTRAP_INCOMPLETE: '최초 계정 설정이 완료되지 않았습니다. 관리자에게 확인해 주세요.',
    BOOTSTRAP_KEY_INVALID: '최초 설정 키를 확인해 주세요.',
    USERNAME_UNAVAILABLE: '사용할 수 없는 아이디입니다.',
    SIGNUP_CLOSED: '현재 가입을 받지 않고 있습니다.',
    VALIDATION_FAILED: '입력 내용을 확인해 주세요.',
    RATE_LIMITED: '요청이 많습니다. 잠시 후 다시 시도해 주세요.',
    SERVICE_UNAVAILABLE:
      '인증 서비스를 준비 중이거나 연결할 수 없습니다. 잠시 후 다시 시도해 주세요.',
  };
  return typeof data.code === 'string'
    ? (messages[data.code] ?? '요청을 처리하지 못했습니다. 다시 시도해 주세요.')
    : '서버 응답을 확인할 수 없습니다.';
}

export function AuthPage({
  mode,
  initialVerification = false,
}: {
  mode: PageMode;
  initialVerification?: boolean;
}) {
  const [signupOpen, setSignupOpen] = useState<boolean | null>(null);
  const [stateFailed, setStateFailed] = useState(false);
  const [setup, setSetup] = useState(false);
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState('');
  const [succeeded, setSucceeded] = useState(false);
  const [errors, setErrors] = useState<FieldErrors>({});
  const [verificationStep, setVerificationStep] = useState(initialVerification);
  const [requestedEmail, setRequestedEmail] = useState('');
  const [retryAt, setRetryAt] = useState(0);
  const [verificationPending, setVerificationPending] = useState(false);
  const [showRecovery, setShowRecovery] = useState(false);
  useEffect(() => {
    if (mode !== 'signup') return;
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), 5000);
    let active = true;
    void fetch('/api/signup-state', { cache: 'no-store', signal: controller.signal })
      .then(async (response) => {
        const body: unknown = await response.json();
        if (
          !response.ok ||
          !body ||
          typeof body !== 'object' ||
          !('signupOpen' in body) ||
          typeof body.signupOpen !== 'boolean'
        )
          throw new Error('Unavailable');
        if (active) setSignupOpen(body.signupOpen);
      })
      .catch(() => {
        if (active) setStateFailed(true);
      })
      .finally(() => window.clearTimeout(timeout));
    return () => {
      active = false;
      controller.abort();
      window.clearTimeout(timeout);
    };
  }, [mode]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending) return;
    setShowRecovery(false);
    setMessage('');
    setErrors({});
    if (!navigator.onLine) {
      setMessage('오프라인에서는 요청할 수 없습니다. 연결 후 다시 시도해 주세요.');
      return;
    }
    const form = new FormData(event.currentTarget);
    const values = Object.fromEntries(form.entries());
    if (setup && mode === 'signup' && !values.bootstrapKey) {
      setErrors({ bootstrapKey: ['최초 설정 키를 입력해 주세요.'] });
      setMessage('입력 내용을 확인해 주세요.');
      return;
    }
    if (values.bootstrapKey === '') delete values.bootstrapKey;
    const parsed = (mode === 'signup' ? zSignUp : zSignIn).safeParse(values);
    if (!parsed.success) {
      const next: FieldErrors = {};
      for (const issue of parsed.error.issues) {
        const field = String(issue.path[0] ?? 'form');
        (next[field] ??= []).push(issue.message);
      }
      setErrors(next);
      setMessage('입력 내용을 확인해 주세요.');
      return;
    }
    setPending(true);
    try {
      const path = mode === 'login' ? 'sign-in/username' : 'sign-up/email';
      const { response, data } = await request(`/api/auth/${path}`, parsed.data);
      if (!response.ok) {
        setMessage(errorMessage(data));
        if (mode === 'login' && data.code === 'INVALID_CREDENTIALS') setShowRecovery(true);
        return;
      }
      if (mode === 'login') {
        if (typeof data.userId !== 'string' || data.emailVerified !== true) {
          setMessage('서버 응답을 확인할 수 없습니다.');
          return;
        }
        const parameters = new URLSearchParams(window.location.search);
        window.location.assign(
          await postLoginLanding(
            parameters.has('returnTo') ? workspaceReturnTo(parameters.get('returnTo')) : null,
            defaultWorkspaceLanding,
          ),
        );
      } else if (response.status === 202 && data.accepted === true) {
        setSucceeded(true);
        setMessage(accepted);
        if ('email' in parsed.data && typeof parsed.data.email === 'string')
          setRequestedEmail(parsed.data.email);
        setRetryAt(Date.now() + 60_000);
      } else setMessage('서버 응답을 확인할 수 없습니다.');
    } catch {
      setMessage('서버에 연결할 수 없습니다. 연결 상태를 확인해 주세요.');
    } finally {
      setPending(false);
    }
  }
  const title = mode === 'login' ? '로그인' : '계정 만들기';
  const field = (
    name: string,
    label: string,
    type: string,
    autocomplete: string,
    hint?: string,
  ) => (
    <div className="form-field">
      <label htmlFor={name}>{label}</label>
      <input
        id={name}
        name={name}
        type={type}
        autoComplete={autocomplete}
        autoCapitalize="none"
        spellCheck={false}
        required
        aria-invalid={Boolean(errors[name])}
        aria-describedby={`${name}-help`}
        disabled={pending}
        maxLength={
          name === 'password' ? 128 : name === 'username' ? 32 : name === 'bootstrapKey' ? 64 : 254
        }
      />
      <p id={`${name}-help`} className={errors[name] ? 'field-error' : 'field-hint'}>
        {errors[name]?.[0] ?? hint}
      </p>
    </div>
  );
  const available = mode !== 'signup' || signupOpen === true || (signupOpen === false && setup);
  return (
    <section className="auth-panel" aria-labelledby="auth-title">
      <p className="eyebrow">나의 업무 기록</p>
      <h1 id="auth-title">{title}</h1>
      {mode === 'signup' && (
        <p className="description">
          {succeeded || verificationStep
            ? '메일의 인증 링크를 눌러 가입을 마무리하세요.'
            : '가입 후 이메일 인증을 완료하면 로그인할 수 있습니다.'}
        </p>
      )}
      {mode === 'signup' && !verificationStep && !succeeded && signupOpen === null && (
        <p role="status">
          {stateFailed
            ? '가입 상태를 확인할 수 없습니다. 새로고침 후 다시 시도해 주세요.'
            : '가입 상태를 확인하고 있습니다.'}
        </p>
      )}
      {mode === 'signup' && !verificationStep && !succeeded && signupOpen === false && (
        <div className="auth-note">
          <p>현재 일반 가입을 받지 않고 있습니다.</p>
          <label className="setup-choice">
            <input
              type="checkbox"
              checked={setup}
              onChange={(event) => setSetup(event.target.checked)}
              disabled={pending || succeeded}
            />{' '}
            최초 계정 설정 키가 있습니다
          </label>
        </div>
      )}
      {available && !succeeded && !verificationStep && (
        <form onSubmit={(event) => void submit(event)} noValidate>
          {field('username', '아이디', 'text', 'username', '영문 소문자·숫자·_ . -로 3~32자')}
          {mode !== 'login' && field('email', '이메일', 'email', 'email')}
          {field(
            'password',
            '비밀번호',
            'password',
            mode === 'signup' ? 'new-password' : 'current-password',
            '12~128자. 공백도 비밀번호에 포함됩니다.',
          )}
          {mode === 'signup' &&
            setup &&
            field(
              'bootstrapKey',
              '최초 설정 키',
              'password',
              'off',
              '관리자가 발급한 설정 키를 입력하세요.',
            )}
          <button className="button primary" type="submit" disabled={pending}>
            {pending ? '처리 중…' : mode === 'signup' ? '가입 요청' : '로그인'}
          </button>
        </form>
      )}
      {message && (
        <p
          className={succeeded ? 'form-success' : 'form-message'}
          role={succeeded ? 'status' : 'alert'}
        >
          {message}
        </p>
      )}
      {mode === 'signup' && (succeeded || verificationStep) && (
        <SignupVerification
          email={requestedEmail}
          setEmail={setRequestedEmail}
          nextAt={retryAt}
          setNextAt={setRetryAt}
          pending={verificationPending}
          setPending={setVerificationPending}
        />
      )}
      {mode === 'login' && (
        <p>
          <a className="control-link" href="/account-transfer">
            계정 연결 구성 확인
          </a>{' '}
          · 고정 서버 구성이 확인된 경우에만 진행합니다.
        </p>
      )}
      {mode === 'login' && showRecovery && (
        <p>
          <a className="control-link" href="/forgot-password">
            비밀번호 찾기
          </a>
        </p>
      )}
      {mode === 'signup' && !succeeded && !verificationStep && (
        <button
          className="auth-help"
          type="button"
          onClick={() => {
            setMessage('');
            setVerificationStep(true);
          }}
          disabled={pending}
        >
          가입을 요청했지만 메일을 받지 못했나요?
        </button>
      )}
      <nav className="auth-links" aria-label="계정 메뉴">
        {mode !== 'login' && (
          <a className="control-link" href="/login">
            로그인
          </a>
        )}
        {mode !== 'signup' && (
          <a className="control-link" href="/signup">
            계정 만들기
          </a>
        )}
        {mode === 'signup' && verificationStep && !succeeded && (
          <button
            className="auth-help"
            type="button"
            onClick={() => setVerificationStep(false)}
            disabled={verificationPending}
          >
            가입 양식으로 돌아가기
          </button>
        )}
      </nav>
    </section>
  );
}

function SignupVerification({
  email,
  setEmail,
  nextAt,
  setNextAt,
  pending,
  setPending,
}: {
  email: string;
  setEmail: (value: string) => void;
  nextAt: number;
  setNextAt: (value: number) => void;
  pending: boolean;
  setPending: (value: boolean) => void;
}) {
  const [now, setNow] = useState(Date.now);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const remaining = Math.max(0, Math.ceil((nextAt - now) / 1000));
  useEffect(() => {
    if (!nextAt) return;
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [nextAt]);
  async function resend(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending || Date.now() < nextAt) return;
    setMessage('');
    setError('');
    if (!navigator.onLine) {
      setError('오프라인에서는 메일을 요청할 수 없습니다.');
      return;
    }
    const parsed = zResendVerification.safeParse({ email });
    if (!parsed.success) {
      setError('가입할 때 사용한 이메일 주소를 확인해 주세요.');
      return;
    }
    setPending(true);
    try {
      const { response, data } = await request('/api/auth/send-verification-email', parsed.data);
      if ((response.status === 202 && data.accepted === true) || response.status === 429) {
        setMessage(accepted);
        const seconds =
          response.status === 429 ? Number(response.headers.get('Retry-After') ?? '60') : 60;
        const wait = Number.isFinite(seconds) ? Math.max(60, Math.min(3600, seconds)) : 60;
        setNow(Date.now());
        setNextAt(Date.now() + wait * 1000);
      } else setError(errorMessage(data));
    } catch {
      setError('메일 요청 결과를 확인할 수 없습니다. 잠시 후 다시 시도해 주세요.');
    } finally {
      setPending(false);
    }
  }
  return (
    <section className="signup-verification" aria-labelledby="verification-step-title">
      <h2 id="verification-step-title">인증 메일 확인</h2>
      <p className="field-hint">
        메일이 5분 안에 오지 않으면 스팸함과 입력한 주소를 확인한 뒤 다시 요청해 주세요.
      </p>
      <form onSubmit={(event) => void resend(event)} noValidate>
        <div className="form-field">
          <label htmlFor="verification-email">가입 이메일</label>
          <input
            id="verification-email"
            name="email"
            type="email"
            autoComplete="email"
            maxLength={254}
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            disabled={pending}
            aria-describedby="verification-email-help"
          />
          <p id="verification-email-help" className="field-hint">
            가입을 요청한 이메일로만 인증 메일을 보낼 수 있습니다.
          </p>
        </div>
        <button className="button secondary" type="submit" disabled={pending || remaining > 0}>
          {pending
            ? '요청 중…'
            : remaining > 0
              ? `${remaining}초 후 다시 요청`
              : '인증 메일 다시 받기'}
        </button>
      </form>
      {message && (
        <p className="form-success" role="status">
          {message}
        </p>
      )}
      {error && (
        <p className="form-message" role="alert">
          {error}
        </p>
      )}
    </section>
  );
}

export function LegacyVerificationRedirect() {
  useEffect(() => {
    window.location.replace('/signup?step=verification');
  }, []);
  return <p role="status">가입 화면으로 이동하고 있습니다.</p>;
}

export function VerificationPage() {
  const status = new URLSearchParams(window.location.search).get('status');
  const verified = status === 'verified';
  return (
    <section className="auth-panel">
      <p className="eyebrow">이메일 인증</p>
      <h1>
        {verified
          ? '인증을 완료했습니다.'
          : status === 'unavailable'
            ? '인증을 완료하지 못했습니다.'
            : status === 'rate_limited'
              ? '잠시 후 다시 확인해 주세요.'
              : '인증 링크를 확인해 주세요.'}
      </h1>
      <p className="description">
        {verified
          ? '이제 아이디와 비밀번호로 로그인할 수 있습니다.'
          : status === 'unavailable'
            ? '잠시 후 메일의 링크를 다시 열어 주세요.'
            : status === 'rate_limited'
              ? '인증 요청이 많습니다. 잠시 기다린 뒤 메일의 링크를 다시 열어 주세요.'
              : '만료되었거나 사용할 수 없는 링크입니다. 인증 메일을 다시 요청해 주세요.'}
      </p>
      <a className="button primary" href={verified ? '/login' : '/signup?step=verification'}>
        {verified ? '로그인으로 이동' : '가입 이메일 확인하기'}
      </a>
    </section>
  );
}

export function AccountPage() {
  const [user, setUser] = useState<{
    username: string;
    email: string;
    manageSignup: boolean;
  } | null>(null);
  const [message, setMessage] = useState('계정을 확인하고 있습니다.');
  const [pending, setPending] = useState(false);
  useEffect(() => {
    let active = true;
    void request('/api/me')
      .then(({ response, data }) => {
        if (!active) return;
        if (response.status === 401) {
          window.location.assign('/login');
          return;
        }
        if (
          response.ok &&
          typeof data.username === 'string' &&
          typeof data.email === 'string' &&
          data.emailVerified === true
        ) {
          const capabilities = data.capabilities;
          const manageSignup = Boolean(
            capabilities &&
            typeof capabilities === 'object' &&
            'manageSignup' in capabilities &&
            capabilities.manageSignup === true,
          );
          setUser({ username: data.username, email: data.email, manageSignup });
          setMessage('');
        } else setMessage(errorMessage(data));
      })
      .catch(() => {
        if (active) setMessage('계정을 확인할 수 없습니다. 다시 접속해 주세요.');
      });
    return () => {
      active = false;
    };
  }, []);
  async function signOut() {
    if (pending) return;
    if (!navigator.onLine) {
      setMessage('오프라인에서는 로그아웃할 수 없습니다.');
      return;
    }
    setPending(true);
    try {
      const { response, data } = await request('/api/auth/sign-out', {});
      if (response.ok && data.success === true) window.location.assign('/login');
      else setMessage(errorMessage(data));
    } catch {
      setMessage('로그아웃하지 못했습니다. 다시 시도해 주세요.');
    } finally {
      setPending(false);
    }
  }
  return (
    <section className="auth-panel">
      <p className="eyebrow">내 계정</p>
      <h1>계정 확인</h1>
      {message && <p role="status">{message}</p>}
      {user ? (
        <>
          <dl className="account-details">
            <dt>아이디</dt>
            <dd>{user.username}</dd>
            <dt>이메일</dt>
            <dd>{user.email}</dd>
            <dt>인증 상태</dt>
            <dd>인증 완료</dd>
          </dl>
          <p className="auth-note">
            <a className="control-link" href="/">
              회사 선택으로 이동
            </a>
            하여 회사·프로젝트를 선택하고 업무를 기록할 수 있습니다.
          </p>
          <EmailChangeSettings />
          <SessionSettings />
          {user.manageSignup && <SignupSettings />}
        </>
      ) : (
        <a className="control-link" href="/login">
          로그인으로 이동
        </a>
      )}
      <div className="home-actions">
        <button className="button primary" onClick={() => void signOut()} disabled={pending}>
          {pending ? '처리 중…' : '로그아웃'}
        </button>
      </div>
    </section>
  );
}
