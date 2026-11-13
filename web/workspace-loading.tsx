import { useEffect, useState } from 'react';
import './workspace-loading.css';

/** Presentation only: never starts, bypasses or reorders a workspace request. */
export function WorkspaceLoading({ inline = false }: { inline?: boolean }) {
  const [slow, setSlow] = useState(false);
  const [offline, setOffline] = useState(() =>
    typeof navigator === 'undefined' ? false : !navigator.onLine,
  );
  useEffect(() => {
    const timeout = window.setTimeout(() => setSlow(true), 4000);
    const connectionChanged = () => setOffline(!navigator.onLine);
    window.addEventListener('online', connectionChanged);
    window.addEventListener('offline', connectionChanged);
    return () => {
      window.clearTimeout(timeout);
      window.removeEventListener('online', connectionChanged);
      window.removeEventListener('offline', connectionChanged);
    };
  }, []);
  const detail = offline
    ? '오프라인입니다. 인터넷 연결을 확인해 주세요.'
    : slow
      ? '준비가 지연되고 있습니다. 잠시 기다려 주세요.'
      : '';
  return (
    <div className={`workspace-loading${inline ? ' workspace-loading-inline' : ''}`}>
      <div className="workspace-loading-status" role="status" aria-live="polite" aria-atomic="true">
        <span className="workspace-loading-mark" aria-hidden="true">
          W
        </span>
        <p className="workspace-loading-label">화면을 준비하고 있습니다.</p>
        <p className="workspace-loading-detail">{detail || '\u00a0'}</p>
      </div>
    </div>
  );
}
