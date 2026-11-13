import { HelpHint } from './help-hint';
import { RefreshButton } from './ui-controls';
import { useEffect, useRef, useState } from 'react';
import { z } from 'zod';
import {
  createAccountTransferChannel,
  createAccountTransferSourceChannel,
} from '../shared/account-transfer-channel';
import { zTransferId, type TransferPublicStatus } from '../shared/schema/account-transfer';
import {
  approveTransferSource,
  readTransferConfiguration,
  sourceTransferProfile,
  targetTransferRequest,
  transferPhase,
  type TransferConfiguration,
} from './account-transfer-api';
import { WorkFailure, workError, uncertainWork } from './work-entry-api';
type TargetChannel = Awaited<ReturnType<typeof createAccountTransferChannel>>;
type SourceChannel = ReturnType<typeof createAccountTransferSourceChannel>;
function when(at: number) {
  return new Intl.DateTimeFormat('ko-KR', {
    timeZone: 'Asia/Seoul',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).format(at);
}
export function AccountTransferPage({ mode }: { mode: 'source' | 'target' }) {
  const [configuration, setConfiguration] = useState<TransferConfiguration | null>(null),
    [loading, setLoading] = useState(true),
    [online, setOnline] = useState(navigator.onLine);
  const revision = useRef(0),
    alive = useRef(true);
  async function read() {
    const ticket = ++revision.current;
    setConfiguration(null);
    setLoading(true);
    try {
      if (!navigator.onLine) return;
      const c = await readTransferConfiguration();
      if (alive.current && ticket === revision.current) setConfiguration(c);
    } catch {
      /* Unavailable or malformed readiness never enables a channel or exposes raw errors. */
    } finally {
      if (alive.current && ticket === revision.current) setLoading(false);
    }
  }
  useEffect(() => {
    alive.current = true;
    void read();
    const change = () => setOnline(navigator.onLine);
    window.addEventListener('online', change);
    window.addEventListener('offline', change);
    return () => {
      alive.current = false;
      revision.current++;
      window.removeEventListener('online', change);
      window.removeEventListener('offline', change);
    };
  }, [mode]);
  const allowed =
    configuration &&
    (mode === 'source'
      ? location.origin === configuration.sourceOrigin
      : location.origin === configuration.targetOrigin);
  if (!allowed)
    return (
      <section className="workspace">
        <h1>{loading ? '계정 연결 구성 확인 중' : '계정 연결 미연결'}</h1>
        <p>
          고정 서버 구성이 미설정·미승인 상태이거나 확인되지 않아 연결 기능을 닫았습니다.
          origin·키·메일·DB 설정을 브라우저에서 만들거나 대체하지 않습니다.
        </p>
        {!online && <p>오프라인입니다. 연결 후 구성 조회를 직접 다시 실행해 주세요.</p>}
        <RefreshButton
          type="button"
          disabled={loading || !online}
          onClick={() => void read()}
          busy={loading}
          showLabel
        >
          고정 서버 구성 다시 조회
        </RefreshButton>
        <a className="control-link" href="/login">
          로그인 화면
        </a>
      </section>
    );
  return mode === 'source' ? (
    <SourceTransfer config={configuration!} />
  ) : (
    <TargetTransfer config={configuration!} />
  );
}
function TargetTransfer({ config }: { config: TransferConfiguration }) {
  const [id, setId] = useState(() => {
      const v = new URLSearchParams(location.search).get('transferId');
      return zTransferId.safeParse(v).success ? v! : '';
    }),
    [activeId, setActiveId] = useState(''),
    [status, setStatus] = useState<TransferPublicStatus | null>(null),
    [reply, setReply] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [notice, setNotice] = useState(''),
    [online, setOnline] = useState(navigator.onLine),
    [ack, setAck] = useState(false),
    [connected, setConnected] = useState(false),
    [uncertain, setUncertain] = useState(false);
  const channel = useRef<TargetChannel | null>(null),
    popup = useRef<Window | null>(null),
    alive = useRef(true),
    revision = useRef(0),
    lock = useRef(false),
    mail = useRef<HTMLInputElement>(null),
    password = useRef<HTMLInputElement>(null),
    repeat = useRef<HTMLInputElement>(null);
  useEffect(() => {
    alive.current = true;
    const change = () => setOnline(navigator.onLine);
    const message = (e: MessageEvent) => {
      const accepted = channel.current?.acceptReply(e);
      if (accepted) {
        setReply(true);
        setNotice(
          '출처 창의 응답을 받았습니다. 목적 환경의 승인·상태 조회 전에는 완료로 판단하지 않습니다.',
        );
      }
    };
    window.addEventListener('online', change);
    window.addEventListener('offline', change);
    window.addEventListener('message', message);
    return () => {
      alive.current = false;
      revision.current++;
      channel.current?.dispose();
      channel.current = null;
      window.removeEventListener('online', change);
      window.removeEventListener('offline', change);
      window.removeEventListener('message', message);
      if (mail.current) mail.current.value = '';
      if (password.current) password.current.value = '';
      if (repeat.current) repeat.current.value = '';
    };
  }, []);
  const blocked = busy || !online;
  const terminal = status?.phase === 'expired' || status?.phase === 'failed';
  function clearSecrets() {
    for (const ref of [mail, password, repeat]) if (ref.current) ref.current.value = '';
    setAck(false);
  }
  function fail(e: unknown) {
    if (e instanceof WorkFailure && [401, 403].includes(e.status)) {
      setStatus(null);
      setReply(false);
      clearSecrets();
    }
    setError(
      e instanceof WorkFailure && e.status === 409
        ? '회차·nonce 또는 출처 승인이 달라졌습니다. 같은 공개 회차 ID를 유지하고 상태를 직접 조회하세요. 승인증명은 서버 기준 5분이며 필요하면 같은 회차로 새 nonce와 출처 승인을 직접 준비하세요.'
        : '계정 연결 요청을 확인하지 못했습니다. 승인증명은 서버 기준 5분이며 만료·유효성 거부를 클라이언트가 구분해 단정하지 않습니다. 같은 회차를 안전 조회하고 필요하면 명시 새 출처 승인을 준비하세요. ' +
            '확인값·비밀번호는 보관하지 않으며 다시 직접 입력해야 합니다.',
    );
  }
  async function act(fn: (t: number) => Promise<void>) {
    if (lock.current || !navigator.onLine) return;
    lock.current = true;
    setBusy(true);
    setError('');
    setNotice('');
    const t = ++revision.current;
    try {
      await fn(t);
    } catch (e) {
      if (alive.current && t === revision.current) fail(e);
    } finally {
      lock.current = false;
      if (alive.current && t === revision.current) setBusy(false);
    }
  }
  function live(t: number) {
    return alive.current && revision.current === t;
  }
  function open() {
    if (blocked || lock.current || terminal) return;
    const parsed = zTransferId.safeParse(id);
    if (!parsed.success) {
      setError('관리형 회차의 공개 UUID를 확인해 주세요. 새 계정이나 회차를 만들지 않습니다.');
      return;
    }
    // Open synchronously from this explicit click; the capability is never placed in the URL.
    const win = window.open(`${config.sourceOrigin}/account-transfer/source`, '_blank');
    if (!win) {
      setError('출처 창을 열 수 없습니다. 팝업 허용 뒤 직접 다시 실행해 주세요.');
      return;
    }
    popup.current = win;
    const transferId = parsed.data;
    void act(async (t) => {
      channel.current?.dispose();
      channel.current = null;
      setConnected(false);
      setUncertain(false);
      clearSecrets();
      setStatus(null);
      setReply(false);
      setAck(false);
      const c = await createAccountTransferChannel({ ...config, sourceWindow: win, transferId });
      if (!live(t)) {
        c.dispose();
        return;
      }
      channel.current = c;
      setConnected(true);
      setActiveId(transferId);
      setId(transferId);
      history.replaceState(null, '', `/account-transfer?${new URLSearchParams({ transferId })}`);
      setNotice(
        '서버 구성의 출처 창에서 기존 앱 정상 로그인을 확인하세요. 창 준비 후 승인 요청 전달을 직접 누르세요.',
      );
    });
  }
  function postRequest() {
    if (blocked || terminal || uncertain || !connected || !channel.current || !popup.current)
      return;
    if (popup.current.closed) {
      setError('출처 창이 닫혔습니다. 같은 회차로 출처 인증 창을 직접 다시 열어 주세요.');
      return;
    }
    try {
      channel.current.postRequest();
      setNotice(
        '서버 구성의 정확한 출처 창에 nonce·digest 요청만 전달했습니다. 출처 창에서 승인을 직접 실행하세요.',
      );
    } catch (e) {
      fail(e);
    }
  }
  async function mutate(action: 'source-approval' | 'confirm-email' | 'complete', input: unknown) {
    try {
      return await targetTransferRequest(action, input, config.targetOrigin);
    } catch (e) {
      if (uncertainWork(e)) setUncertain(true);
      throw e;
    }
  }
  function pause() {
    if (blocked) return;
    revision.current++;
    channel.current?.dispose();
    channel.current = null;
    setConnected(false);
    setUncertain(false);
    setReply(false);
    setStatus(null);
    clearSecrets();
    popup.current?.close();
    popup.current = null;
    setNotice(
      '연결 절차를 중단했습니다. 메모리 채널·확인값만 폐기했고 공개 회차 ID를 유지했습니다. 서버 요청의 취소·실패를 확정하지 않습니다. 재개할 때 같은 회차로 출처 정상 인증을 다시 진행해 주세요.',
    );
  }
  async function accept(t: number) {
    const c = channel.current;
    if (!c || !connected || uncertain || terminal || !reply) return;
    const proof = c.takeSourceApprovalRequest();
    const v = proof
      ? await mutate('source-approval', proof)
      : await targetTransferRequest('status', c.statusRequest(), config.targetOrigin);
    if (live(t)) {
      setStatus(v);
      setUncertain(false);
      setReply(false);
      setNotice(
        '목적 환경의 응답을 확인했습니다. 메일 재발송이나 비밀번호 설정은 자동 실행하지 않습니다.',
      );
    }
  }
  async function observe(t: number) {
    const c = channel.current;
    if (!c) return;
    const v = await targetTransferRequest('status', c.statusRequest(), config.targetOrigin);
    if (live(t)) {
      setStatus(v);
      setUncertain(false);
      setNotice(
        v.phase === 'complete'
          ? '목적 환경에서 인증된 완료 상태와 영수증을 확인했습니다.'
          : '목적 환경의 현재 상태를 확인했습니다. 자동 재제출하지 않습니다.',
      );
    }
  }
  async function confirmMail(t: number) {
    const c = channel.current,
      value = mail.current?.value ?? '';
    if (mail.current) mail.current.value = '';
    if (!c || !connected || uncertain || !status?.allowedActions.includes('confirm_email')) return;
    const token = z
      .string()
      .regex(/^[a-f0-9]{64}$/)
      .parse(value);
    const v = await mutate('confirm-email', { transferId: activeId, token });
    if (live(t)) {
      setStatus(v);
      setNotice('새 목적 이메일 확인 응답을 받았습니다. 비밀번호는 직접 설정해야 합니다.');
    }
  }
  async function complete(t: number) {
    const c = channel.current,
      a = password.current?.value ?? '',
      b = repeat.current?.value ?? '';
    if (password.current) password.current.value = '';
    if (repeat.current) repeat.current.value = '';
    if (!c || !connected || uncertain || !ack || !status?.allowedActions.includes('set_password'))
      return;
    if (a !== b) {
      setError('새 비밀번호와 확인이 다릅니다. 다시 직접 입력해 주세요.');
      return;
    }
    const body = c.completeRequest(a);
    const v = await mutate('complete', body);
    if (live(t)) {
      setStatus(v);
      setAck(false);
      setNotice(
        v.phase === 'complete'
          ? '목적 환경의 완료 응답을 확인했습니다. 기존 아이디로 로그인할 수 있는지 별도로 확인하세요.'
          : '목적 환경 응답을 확인했습니다. 완료 상태를 직접 조회해 주세요.',
      );
    }
  }
  return (
    <section className="workspace" aria-label="계정 연결 목적 화면">
      <nav className="workspace-nav">
        <a className="control-link" href="/login">
          기존 아이디 로그인
        </a>
        <a className="control-link" href="/">
          회사 선택
        </a>
      </nav>
      <h1>계정 연결</h1>
      <HelpHint label="계정 연결 구성">
        서버가 확인한 고정 구성에서 관리형 공개 회차를 사용하며 공개 가입을 열거나 새 회차 ID를
        발급하지 않습니다.
      </HelpHint>
      <p>
        순서: 출처 창 정상 로그인 → 요청 전달 → 출처에서 명시 승인 → 목적 환경 승인 확인 → 새 목적
        이메일 확인 → 새 목적 비밀번호 직접 설정 → 목적 완료 상태·기존 아이디 로그인 확인.
      </p>
      <p>
        고정 출처 {config.sourceOrigin} · 고정 목적 {config.targetOrigin}
      </p>
      <p>
        출처 승인증명은 서버 기준 5분입니다. 5분이 지나 거부되면 상태를 먼저 확인하고 같은 회차의
        nonce 갱신·출처 요청 폐기·재승인 순서로 복구합니다. 회차·메일 만료를 연장하지 않습니다.
      </p>
      <p>
        새로고침하면 메모리 채널이 사라집니다. 같은 공개 회차로 출처 정상 인증·승인을 다시 실행해야
        하며, 진행 중 메일은 자동 재발송하지 않습니다. 실제 환경의 조작 시간·만료 안내는 설치·정책
        검토 후 별도로 확정합니다.
      </p>
      {error && (
        <p role="alert" className="form-message">
          {error}
        </p>
      )}
      {notice && <p role="status">{notice}</p>}
      {busy && <p role="status">명시 연결 요청을 처리하고 있습니다.</p>}
      {!online && <p role="status">오프라인 읽기 전용 · 자동 재시도하지 않습니다.</p>}
      <label>
        공개 연결 회차 ID
        <input
          value={id}
          maxLength={36}
          disabled={blocked || !!activeId}
          onChange={(e) => setId(e.target.value)}
          autoComplete="off"
        />
      </label>
      <button type="button" disabled={blocked || terminal} onClick={open}>
        {activeId ? '같은 회차로 출처 인증 창 다시 열기' : '출처 인증 창 열기'}
      </button>
      <button
        type="button"
        disabled={blocked || terminal || uncertain || !connected}
        onClick={postRequest}
      >
        기존 앱에 승인 요청 전달
      </button>
      <button
        type="button"
        disabled={blocked || terminal || uncertain || !connected || !reply}
        onClick={() => void act(accept)}
      >
        목적 환경에서 출처 승인 확인
      </button>
      <RefreshButton
        type="button"
        disabled={blocked || !connected}
        onClick={() => void act(observe)}
        showLabel
      >
        목적 연결 상태 다시 조회
      </RefreshButton>
      <button
        type="button"
        disabled={blocked || terminal || uncertain || !connected}
        onClick={() => {
          try {
            channel.current?.restartHandshake();
            setReply(false);
            setNotice(
              '같은 회차의 nonce만 교체했습니다. 출처 창의 이전 요청을 먼저 명시 폐기한 뒤 요청 전달을 다시 누르세요.',
            );
          } catch (e) {
            fail(e);
          }
        }}
      >
        같은 회차 승인 요청 명시 갱신
      </button>
      <button type="button" disabled={blocked || !connected} onClick={pause}>
        연결 절차 중단 · 공개회차 유지
      </button>
      {uncertain && (
        <p role="status">
          응답이 확인되지 않았습니다. 메모리 채널의 상태 조회 전에는 승인·확인값·비밀번호를 다시
          제출하지 않습니다. 중단해도 서버 실패를 확정하지 않습니다.
        </p>
      )}
      {status && (
        <section aria-label="목적 환경 계정 연결 상태">
          <h2>{transferPhase(status)}</h2>
          <p>
            회차 {status.transferId} · 버전 {status.version}
          </p>
          <p>
            {status.maskedUsername} · {status.maskedEmail}
          </p>
          <p>목적 환경 {status.targetOrigin}</p>
          <p>
            회차 만료 {when(status.deadlines.roundExpiresAt)} KST · 출처 시작 만료{' '}
            {when(status.deadlines.sourceInitiationExpiresAt)} KST
          </p>
          {status.deadlines.mailExpiresAt !== null && (
            <p>목적 메일 만료 {when(status.deadlines.mailExpiresAt)} KST</p>
          )}
          {status.phase === 'complete' && (
            <>
              <p>목적 환경에서 확인한 완료 영수증 {status.receiptId}</p>
              <p>
                영수증 번호만으로 권한을 증명하지 않으며, 완료를 취소하거나 비밀번호를 다시 설정하지
                않습니다.
              </p>
              <a className="control-link" href="/login">
                기존 아이디로 목적 앱 로그인
              </a>
            </>
          )}
          {['expired', 'failed'].includes(status.phase) && (
            <p>이 회차는 더 진행하지 않습니다. 자동 재발송·초기화·새 계정 생성은 하지 않습니다.</p>
          )}
        </section>
      )}
      <fieldset
        disabled={
          blocked || uncertain || !connected || !status?.allowedActions.includes('confirm_email')
        }
      >
        <legend>새 목적 이메일 직접 확인</legend>
        <label>
          새 목적 이메일 확인값
          <input ref={mail} type="password" autoComplete="off" maxLength={64} />
        </label>
        <button type="button" onClick={() => void act(confirmMail)}>
          목적 이메일 확인값 제출
        </button>
        <p>확인값은 URL·storage·로그에 저장하지 않으며 제출 시 입력창에서 지웁니다.</p>
      </fieldset>
      <fieldset
        disabled={
          blocked || uncertain || !connected || !status?.allowedActions.includes('set_password')
        }
      >
        <legend>새 목적 비밀번호 직접 설정</legend>
        <p>
          비밀번호는 제출 즉시 입력창에서 지웁니다. 오류나 새로고침 뒤에는 직접 다시 입력해 주세요.
        </p>
        <label>
          새 목적 비밀번호
          <input ref={password} type="password" autoComplete="off" maxLength={128} />
        </label>
        <label>
          새 목적 비밀번호 확인
          <input ref={repeat} type="password" autoComplete="off" maxLength={128} />
        </label>
        <label className="workspace-check">
          <input type="checkbox" checked={ack} onChange={(e) => setAck(e.target.checked)} />
          목적 환경의 새 비밀번호를 직접 설정하며 기존 비밀번호 해시를 복사하지 않음을 확인했습니다
        </label>
        <button type="button" disabled={!ack} onClick={() => void act(complete)}>
          새 목적 비밀번호로 연결 확정
        </button>
      </fieldset>
    </section>
  );
}
function SourceTransfer({ config }: { config: TransferConfiguration }) {
  const [username, setUsername] = useState(''),
    [ready, setReady] = useState(false),
    [id, setId] = useState(''),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [notice, setNotice] = useState(''),
    [online, setOnline] = useState(navigator.onLine);
  const channel = useRef<SourceChannel | null>(null),
    alive = useRef(true),
    lock = useRef(false),
    revision = useRef(0);
  useEffect(() => {
    alive.current = true;
    const t = ++revision.current;
    if (window.opener)
      channel.current = createAccountTransferSourceChannel({ ...config, opener: window.opener });
    const message = (e: MessageEvent) => {
      if (channel.current?.acceptRequest(e)) {
        setReady(true);
        setId(channel.current.approvalRequest().transferId);
        setNotice(
          '정확한 목적 창의 요청을 받았습니다. 기존 정상 로그인 상태에서 승인 버튼을 직접 누르세요.',
        );
      }
    };
    const change = () => setOnline(navigator.onLine);
    window.addEventListener('message', message);
    window.addEventListener('online', change);
    window.addEventListener('offline', change);
    void sourceTransferProfile()
      .then((p) => {
        if (alive.current && t === revision.current) setUsername(p.username);
      })
      .catch((e) => {
        if (!alive.current || t !== revision.current) return;
        if (e instanceof WorkFailure && e.status === 401)
          location.assign(
            `/login?${new URLSearchParams({ returnTo: '/account-transfer/source' })}`,
          );
        else setError('출처 로그인 또는 권한을 확인할 수 없습니다. ' + workError(e));
      });
    return () => {
      alive.current = false;
      revision.current++;
      channel.current?.reset();
      channel.current = null;
      window.removeEventListener('message', message);
      window.removeEventListener('online', change);
      window.removeEventListener('offline', change);
    };
  }, []);
  async function approve() {
    if (lock.current || !online || !username || !ready || !channel.current) return;
    lock.current = true;
    setBusy(true);
    setError('');
    const t = ++revision.current;
    try {
      const reply = await approveTransferSource(channel.current.approvalRequest(), config);
      if (alive.current && t === revision.current) {
        channel.current?.postReply(reply);
        setReady(false);
        setNotice(
          '출처 승인 응답을 정확한 목적 창에 전달했습니다. 목적 환경의 상태 조회로 완료 여부를 확인해야 합니다.',
        );
      }
    } catch (e) {
      if (alive.current && t === revision.current) {
        if (e instanceof WorkFailure && [401, 403].includes(e.status)) setUsername('');
        setError(
          '출처 승인을 확인하지 못했습니다. 정상 로그인과 같은 회차를 다시 확인하세요. ' +
            workError(e),
        );
      }
    } finally {
      lock.current = false;
      if (alive.current && t === revision.current) setBusy(false);
    }
  }
  return (
    <section className="workspace" aria-label="계정 연결 출처 승인">
      <h1>기존 앱 출처 승인</h1>
      <p>현재 출처 로그인 {username || '확인 중'}</p>
      <p>
        목적 환경 {config.targetOrigin} · 공개 회차 {id || '요청 대기'}
      </p>
      <p>
        기존 세션·비밀번호·해시를 목적 창으로 보내지 않습니다. 승인 증명은 한 번 전달하며 완료
        토큰은 이 창이 받지 않습니다.
      </p>
      {!window.opener && (
        <p role="alert">정확한 목적 창에서 연 팝업이 아닙니다. 승인할 수 없습니다.</p>
      )}
      {error && <p role="alert">{error}</p>}
      {notice && <p role="status">{notice}</p>}
      {!online && <p role="status">오프라인 · 승인을 제출하지 않습니다.</p>}
      <button
        type="button"
        disabled={busy || !online || !ready || !username}
        onClick={() => void approve()}
      >
        정상 로그인한 출처 계정으로 명시 승인
      </button>
      <button
        type="button"
        disabled={busy}
        onClick={() => {
          channel.current?.reset();
          setReady(false);
          setId('');
          setNotice(
            '현재 창의 요청만 명시 폐기했습니다. 목적 창에서 같은 회차의 요청을 다시 전달해 주세요.',
          );
        }}
      >
        출처 창의 승인 요청 명시 폐기
      </button>
      <a
        className="control-link"
        href={`/login?${new URLSearchParams({ returnTo: '/account-transfer/source' })}`}
      >
        출처 정상 로그인 다시 확인
      </a>
    </section>
  );
}
