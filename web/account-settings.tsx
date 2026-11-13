import { HelpHint } from './help-hint';
import { RefreshButton } from './ui-controls';
import { useEffect, useState } from 'react';
import { zSessionList, zSessionRevocation, type AccountSession } from '../shared/schema/account';

async function api(path: string, method = 'GET', body?: unknown) {
  const response = await fetch(path, {
    method,
    credentials: 'same-origin',
    cache: 'no-store',
    signal: AbortSignal.timeout(15_000),
    ...(body === undefined
      ? {}
      : { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }),
  });
  if (response.status === 401) window.location.assign('/login');
  const data: unknown = await response.json();
  return { response, data };
}
function failure(response: Response) {
  if (response.status === 401) return '로그인 상태가 만료되었습니다. 다시 로그인해 주세요.';
  if (response.status === 403) return '이 작업을 수행할 권한이 없습니다.';
  if (response.status === 429) return '요청이 많습니다. 잠시 후 다시 시도해 주세요.';
  return '요청을 처리하지 못했습니다. 다시 시도해 주세요.';
}
function dateLabel(value: number) {
  return new Intl.DateTimeFormat('ko-KR', {
    timeZone: 'Asia/Seoul',
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(value);
}

export function SessionSettings() {
  const [sessions, setSessions] = useState<AccountSession[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    let active = true;
    void api('/api/auth/sessions')
      .then(({ response, data }) => {
        if (!active) return;
        const parsed = zSessionList.safeParse(data);
        if (!response.ok) setError(failure(response));
        else if (!parsed.success) setError('로그인 기기 목록을 확인할 수 없습니다.');
        else setSessions(parsed.data.sessions);
      })
      .catch(() => {
        if (active) setError('로그인 기기 목록을 불러오지 못했습니다.');
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [revision]);
  function reload() {
    setError('');
    setMessage('');
    setLoading(true);
    setRevision((value) => value + 1);
  }
  async function revoke(session: AccountSession) {
    if (busy || loading) return;
    setMessage('');
    setError('');
    if (!navigator.onLine) {
      setError('오프라인에서는 기기를 로그아웃할 수 없습니다.');
      return;
    }
    setBusy(session.id);
    try {
      const { response, data } = await api(
        `/api/auth/sessions/${encodeURIComponent(session.id)}`,
        'DELETE',
      );
      const parsed = zSessionRevocation.safeParse(data);
      if (response.status === 404) {
        // A failed actor check can also return 404 while the target still exists.
        // Let a fresh authenticated list determine the remaining sessions.
        reload();
        setError('로그아웃 결과를 확인할 수 없습니다. 목록을 다시 확인해 주세요.');
      } else if (!response.ok) setError(failure(response));
      else if (!parsed.success)
        setError('로그아웃 결과를 확인할 수 없습니다. 목록을 다시 확인해 주세요.');
      else if (parsed.data.current) window.location.assign('/login');
      else {
        setSessions((items) => items.filter((item) => item.id !== session.id));
        setMessage('선택한 기기에서 로그아웃했습니다.');
      }
    } catch {
      setError('로그아웃 결과를 확인할 수 없습니다. 목록을 다시 확인해 주세요.');
    } finally {
      setBusy(null);
    }
  }
  return (
    <section className="settings-section" aria-labelledby="sessions-title">
      <div className="section-heading">
        <h2 id="sessions-title">로그인한 기기</h2>
        <RefreshButton
          className="text-button"
          onClick={reload}
          disabled={loading || busy !== null}
          busy={loading || busy !== null}
        >
          새로고침
        </RefreshButton>
      </div>
      <HelpHint label="로그인 기기">
        사용하지 않는 기기는 로그아웃할 수 있습니다. 시각은 한국 시간입니다.
      </HelpHint>
      {loading ? (
        <p role="status">기기 목록을 불러오고 있습니다.</p>
      ) : (
        <ul className="session-list">
          {sessions.map((session) => (
            <li key={session.id} className="session-card">
              <div>
                <strong>{session.deviceLabel}</strong>
                {session.current && <span className="current-device">현재 기기</span>}
              </div>
              <p>
                로그인: {dateLabel(session.createdAt)}
                <br />
                최근 갱신: {dateLabel(session.updatedAt)}
                <br />
                만료 예정: {dateLabel(session.expiresAt)}
              </p>
              <button
                className="button secondary"
                disabled={busy !== null}
                onClick={() => void revoke(session)}
              >
                {busy === session.id
                  ? '처리 중…'
                  : session.current
                    ? '현재 기기 로그아웃'
                    : '이 기기 로그아웃'}
              </button>
            </li>
          ))}
          {!sessions.length && !error && <li>표시할 활성 세션이 없습니다.</li>}
        </ul>
      )}
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

export function SignupSettings() {
  const [open, setOpen] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    let active = true;
    void api('/api/signup-state')
      .then(({ response, data }) => {
        if (!active) return;
        if (
          response.ok &&
          data &&
          typeof data === 'object' &&
          'signupOpen' in data &&
          typeof data.signupOpen === 'boolean'
        )
          setOpen(data.signupOpen);
        else setError('가입 설정을 확인할 수 없습니다.');
      })
      .catch(() => {
        if (active) setError('가입 설정을 불러오지 못했습니다.');
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [revision]);
  async function change(next: boolean) {
    if (busy || loading) return;
    setError('');
    setMessage('');
    if (!navigator.onLine) {
      setError('오프라인에서는 가입 설정을 변경할 수 없습니다.');
      return;
    }
    setBusy(true);
    try {
      const { response, data } = await api('/api/signup-state', 'PUT', { signupOpen: next });
      if (response.status >= 500) {
        setOpen(null);
        setError('저장 결과를 확인할 수 없습니다. 새로고침해 주세요.');
      } else if (!response.ok) setError(failure(response));
      else if (
        data &&
        typeof data === 'object' &&
        'signupOpen' in data &&
        data.signupOpen === next
      ) {
        setOpen(next);
        setMessage(
          next ? '새로운 계정의 가입을 허용했습니다.' : '새로운 계정의 가입을 닫았습니다.',
        );
      } else {
        setOpen(null);
        setError('저장 결과를 확인할 수 없습니다. 새로고침해 주세요.');
      }
    } catch {
      setOpen(null);
      setError('저장 결과를 확인할 수 없습니다. 새로고침해 주세요.');
    } finally {
      setBusy(false);
    }
  }
  function reload() {
    setOpen(null);
    setError('');
    setMessage('');
    setLoading(true);
    setRevision((value) => value + 1);
  }
  return (
    <section className="settings-section" aria-labelledby="signup-settings-title">
      <div className="section-heading">
        <h2 id="signup-settings-title">회원가입 관리</h2>
        <RefreshButton
          className="text-button"
          onClick={reload}
          disabled={busy || loading}
          busy={loading || !!busy}
        >
          새로고침
        </RefreshButton>
      </div>
      <p className="field-hint">
        인스턴스 소유자 설정입니다. 가입을 닫아도 기존 계정과 이미 접수한 인증은 유지됩니다.
      </p>
      {loading ? (
        <p role="status">가입 설정을 불러오고 있습니다.</p>
      ) : (
        open !== null && (
          <label className="signup-switch">
            <input
              type="checkbox"
              checked={open}
              onChange={(event) => void change(event.target.checked)}
              disabled={busy}
            />
            새 계정 가입 허용<span>{busy ? '저장 중…' : open ? '열림' : '닫힘'}</span>
          </label>
        )
      )}
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
