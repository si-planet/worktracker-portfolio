import { useEffect, useId, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import './week-support-panel.css';
export function WeekSupportPanel({
  title,
  online,
  children,
  collapsible = false,
}: {
  title: string;
  online: boolean;
  children: ReactNode;
  collapsible?: boolean;
}) {
  const id = useId(),
    button = useRef<HTMLButtonElement>(null),
    body = useRef<HTMLDivElement>(null);
  const [narrow, setNarrow] = useState(() => window.matchMedia('(max-width: 1023px)').matches);
  const [mobileOpen, setMobileOpen] = useState(false),
    [notice, setNotice] = useState('');
  const expanded = (!narrow && !collapsible) || mobileOpen;
  const focusNeeded = useRef(false);
  useEffect(() => {
    const media = window.matchMedia('(max-width: 1023px)');
    const change = () => {
      if (media.matches && body.current?.contains(document.activeElement))
        focusNeeded.current = true;
      setNarrow(media.matches);
    };
    media.addEventListener('change', change);
    change();
    return () => media.removeEventListener('change', change);
  }, []);
  useLayoutEffect(() => {
    if (!expanded && (focusNeeded.current || body.current?.contains(document.activeElement)))
      button.current?.focus();
    focusNeeded.current = false;
  }, [expanded]);
  useEffect(() => {
    const node = body.current;
    if (!node) return;
    const update = () => {
      const alerts = Array.from(node.querySelectorAll('[role="alert"]'))
        .map((n) => n.textContent?.trim())
        .filter(Boolean);
      const statuses = Array.from(node.querySelectorAll('[role="status"]'))
        .map((n) => n.textContent?.trim())
        .filter(Boolean);
      setNotice(
        alerts.length
          ? `확인 필요: ${alerts.join(' ')}`
          : statuses.length
            ? `처리 상태: ${statuses.join(' ')}`
            : '',
      );
    };
    const observer = new MutationObserver(update);
    observer.observe(node, { subtree: true, childList: true, characterData: true });
    update();
    return () => observer.disconnect();
  }, []);
  return (
    <div className="week-support-panel">
      <h4 className="week-support-heading">
        <button
          ref={button}
          type="button"
          aria-expanded={expanded}
          aria-controls={id}
          disabled={!narrow && !collapsible}
          onClick={() => setMobileOpen((v) => !v)}
        >
          {title} {expanded ? '접기' : '펼치기'}
        </button>
      </h4>
      {!expanded && notice && <p className="week-support-notice">{notice}</p>}
      {!expanded && !online && (
        <p className="week-support-notice">
          오프라인 · 입력 초안은 유지되며 새 조회·저장은 제한됩니다.
        </p>
      )}
      <div id={id} ref={body} hidden={!expanded} className="week-support-body">
        {children}
      </div>
    </div>
  );
}
