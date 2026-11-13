import {
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactNode,
  type SyntheticEvent,
} from 'react';
import { pwaSnapshot, reloadFromOffline, restartForUpdate, subscribePwa } from './pwa-runtime';
import './pwa.css';

type InstallEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
};
export function PwaShell({ children }: { children: ReactNode }) {
  const state = useSyncExternalStore(subscribePwa, pwaSnapshot);
  const content = useRef<HTMLFieldSetElement>(null);
  const edited = useRef(false);
  const [confirm, setConfirm] = useState<'update' | 'reload' | null>(null);
  const [hiddenUpdate, setHiddenUpdate] = useState(false);
  const [install, setInstall] = useState<InstallEvent | null>(null);
  const confirmation = useRef<HTMLDivElement>(null);
  const restartTrigger = useRef<HTMLElement | null>(null);
  useEffect(() => {
    const available = (event: Event) => {
      event.preventDefault();
      setInstall(event as InstallEvent);
    };
    window.addEventListener('beforeinstallprompt', available);
    const installed = () => setInstall(null);
    window.addEventListener('appinstalled', installed);
    return () => {
      window.removeEventListener('beforeinstallprompt', available);
      window.removeEventListener('appinstalled', installed);
    };
  }, []);
  useEffect(() => {
    if (state.online || !content.current) return;
    const previous = new Map<HTMLInputElement | HTMLTextAreaElement, boolean>();
    const readonly = () => {
      for (const field of content.current!.querySelectorAll<HTMLInputElement | HTMLTextAreaElement>(
        'input,textarea',
      )) {
        if (!previous.has(field)) previous.set(field, field.readOnly);
        field.readOnly = true;
      }
    };
    readonly();
    const observer = new MutationObserver(readonly);
    observer.observe(content.current, { childList: true, subtree: true });
    return () => {
      observer.disconnect();
      for (const [field, value] of previous) field.readOnly = value;
    };
  }, [state.online]);
  useEffect(() => {
    confirmation.current?.focus();
  }, [confirm]);
  function blockOffline(event: SyntheticEvent) {
    if (!navigator.onLine) {
      event.preventDefault();
      event.stopPropagation();
    }
  }
  function restart(action: 'update' | 'reload') {
    if (!navigator.onLine) return;
    if (edited.current) {
      restartTrigger.current = document.activeElement as HTMLElement | null;
      setConfirm(action);
    } else if (action === 'update') void restartForUpdate();
    else reloadFromOffline();
  }
  return (
    <>
      {(!state.online || state.reconnected) && !state.startupOffline && (
        <aside className="pwa-banner" role="status" aria-live="polite">
          <strong>{state.online ? '연결이 복구되었습니다.' : '오프라인 · 읽기 전용'}</strong>
          <span>
            {state.online
              ? '최신 내용을 확인하려면 직접 다시 조회해 주세요.'
              : '열린 기록과 입력을 유지합니다. 저장·수정·삭제는 연결 후 사용할 수 있습니다.'}
          </span>
          {state.online && (
            <button type="button" className="button secondary" onClick={() => restart('reload')}>
              최신 화면 다시 불러오기
            </button>
          )}
        </aside>
      )}
      {state.updateAvailable && (
        <aside className="pwa-update" aria-label="앱 업데이트" role="status">
          {hiddenUpdate ? (
            <button type="button" className="text-button" onClick={() => setHiddenUpdate(false)}>
              새 버전이 있습니다
            </button>
          ) : (
            <>
              <strong>새 버전이 있습니다.</strong>
              <p>입력 중인 내용은 먼저 저장해 주세요. 자동으로 다시 시작하지 않습니다.</p>
              <div className="pwa-actions">
                <button
                  type="button"
                  className="button primary"
                  disabled={!state.online}
                  onClick={() => restart('update')}
                >
                  다시 시작
                </button>
                <button
                  type="button"
                  className="button secondary"
                  onClick={() => setHiddenUpdate(true)}
                >
                  나중에
                </button>
              </div>
            </>
          )}
        </aside>
      )}
      {confirm && (
        <div
          className="pwa-confirm"
          role="alertdialog"
          aria-labelledby="pwa-confirm-title"
          tabIndex={-1}
          ref={confirmation}
        >
          <h2 id="pwa-confirm-title">입력한 내용을 확인해 주세요.</h2>
          <p>
            아직 저장하지 않은 내용이 있다면 돌아가서 먼저 저장하세요. 다시 시작하면 저장하지 않은
            입력을 잃을 수 있습니다.
          </p>
          <div className="pwa-actions">
            <button
              type="button"
              className="button secondary"
              onClick={() => {
                setConfirm(null);
                restartTrigger.current?.focus();
              }}
            >
              돌아가기
            </button>
            <button
              type="button"
              className="button primary"
              disabled={!state.online}
              onClick={() => {
                const action = confirm;
                setConfirm(null);
                if (action === 'update') void restartForUpdate();
                else reloadFromOffline();
              }}
            >
              확인했고 다시 시작
            </button>
          </div>
        </div>
      )}
      {state.startupOffline ? (
        <main className="pwa-offline">
          <span className="brand-mark" aria-hidden="true">
            W
          </span>
          <h1>연결 후 사용할 수 있습니다.</h1>
          <p>
            {state.online
              ? '연결이 복구되었습니다. 서버에서 최신 기록을 불러올 수 있습니다.'
              : '오프라인에서는 저장된 업무 기록을 새로 불러올 수 없습니다.'}
          </p>
          <p>이 화면에는 업무 데이터가 없습니다. 인터넷 연결을 확인한 뒤 다시 시작해 주세요.</p>
          <button
            type="button"
            className="button primary"
            disabled={!state.online}
            onClick={reloadFromOffline}
          >
            연결 후 다시 불러오기
          </button>
        </main>
      ) : (
        <fieldset
          className="pwa-content"
          disabled={!state.online}
          ref={content}
          onSubmitCapture={blockOffline}
          onClickCapture={blockOffline}
          onInputCapture={() => {
            edited.current = true;
          }}
          onChangeCapture={() => {
            edited.current = true;
          }}
        >
          {children}
        </fieldset>
      )}
      {install && state.online && (
        <aside className="pwa-install" aria-label="앱 설치">
          <button
            type="button"
            className="button secondary"
            onClick={() => {
              const event = install;
              setInstall(null);
              void event.prompt().catch(() => {});
            }}
          >
            앱 설치
          </button>
          <details className="pwa-install-guide">
            <summary>설치 안내</summary>
            <p>
              홈 화면에서 Work Tracker를 열 수 있습니다. 설치하지 않아도 웹에서 계속 사용할 수
              있습니다.
            </p>
          </details>
        </aside>
      )}
      {state.registrationFailed && (
        <p className="pwa-help" role="status">
          앱 설치·업데이트 준비를 확인하지 못했습니다. 연결 후 페이지를 다시 열어 주세요.
        </p>
      )}
    </>
  );
}
