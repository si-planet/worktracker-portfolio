import { useEffect, useId, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import './help-hint.css';

/** Optional explanation only. Errors, warnings and save state stay in the page. */
export function HelpHint({
  children,
  label,
  id,
}: {
  children: ReactNode;
  label: string;
  id?: string | undefined;
}) {
  const generatedId = useId();
  const helpId = id ?? `help-${generatedId}`;
  const trigger = useRef<HTMLButtonElement>(null);
  const bubble = useRef<HTMLSpanElement>(null);
  const scrollNote = useRef<HTMLSpanElement>(null);
  const hideTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const wasOpen = useRef(false);
  const [hovered, setHovered] = useState(false);
  const [focused, setFocused] = useState(false);
  const [pinned, setPinned] = useState(false);
  const [dismissed, setDismissed] = useState(false);
  const [mounted, setMounted] = useState(false);
  const [portalTarget, setPortalTarget] = useState<HTMLElement | null>(null);
  const [scrollable, setScrollable] = useState(false);
  const [position, setPosition] = useState({ left: 12, top: 12 });
  const open = (hovered || focused || pinned) && !dismissed;

  const cancelHide = () => clearTimeout(hideTimer.current);
  const leave = () => {
    cancelHide();
    hideTimer.current = setTimeout(() => setHovered(false), 160);
  };
  const enter = () => {
    cancelHide();
    setHovered(true);
    setDismissed(false);
  };
  const close = () => {
    setPinned(false);
    setDismissed(true);
  };

  useEffect(() => {
    // A modal dialog makes the body inert; its help must share the top layer.
    setPortalTarget(trigger.current?.closest('dialog') ?? document.body);
    setMounted(true);
    return () => clearTimeout(hideTimer.current);
  }, []);

  useLayoutEffect(() => {
    if (!mounted || !open) return;
    if (bubble.current) bubble.current.scrollTop = 0;
    const place = () => {
      const anchor = trigger.current?.getBoundingClientRect();
      const tip = bubble.current;
      if (!anchor || !tip) return;
      // Exclude our own note so its height cannot cause a false overflow cycle.
      setScrollable(
        tip.scrollHeight - (scrollNote.current?.offsetHeight ?? 0) > tip.clientHeight + 1,
      );
      const viewportWidth = document.documentElement.clientWidth;
      const viewportHeight = window.innerHeight;
      const left = Math.max(12, Math.min(anchor.left, viewportWidth - tip.offsetWidth - 12));
      const below = anchor.bottom + 8;
      const top =
        below + tip.offsetHeight <= viewportHeight - 12
          ? below
          : Math.max(12, anchor.top - tip.offsetHeight - 8);
      setPosition({ left, top });
    };
    place();
    const observer = new ResizeObserver(place);
    if (bubble.current) observer.observe(bubble.current);
    window.addEventListener('resize', place);
    window.addEventListener('scroll', place, true);
    const outside = (event: PointerEvent) => {
      if (
        event.target instanceof Node &&
        !trigger.current?.contains(event.target) &&
        !bubble.current?.contains(event.target)
      )
        close();
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        // The first Escape dismisses help, not the surrounding edit dialog.
        event.preventDefault();
        event.stopPropagation();
        close();
      }
    };
    document.addEventListener('pointerdown', outside);
    document.addEventListener('keydown', escape, true);
    return () => {
      observer.disconnect();
      window.removeEventListener('resize', place);
      window.removeEventListener('scroll', place, true);
      document.removeEventListener('pointerdown', outside);
      document.removeEventListener('keydown', escape, true);
    };
  }, [mounted, open]);

  const content = (
    <span
      ref={bubble}
      id={helpId}
      className="help-hint-bubble"
      role="tooltip"
      hidden={!open}
      style={position}
      onPointerEnter={enter}
      onPointerLeave={leave}
    >
      {scrollable && (
        <span ref={scrollNote} className="help-hint-scroll-note">
          내용 이동: ↑↓ · PageUp/Down · Home/End · 닫기: Esc
        </span>
      )}
      {children}
    </span>
  );
  return (
    <span className="help-hint">
      <button
        ref={trigger}
        type="button"
        className="help-hint-trigger"
        aria-label={`${label} 도움말`}
        aria-describedby={helpId}
        aria-controls={helpId}
        aria-expanded={open}
        aria-keyshortcuts={
          open && scrollable ? 'ArrowDown ArrowUp PageDown PageUp Home End Escape' : undefined
        }
        onKeyDown={(event) => {
          const tip = bubble.current;
          if (!open || !scrollable || !tip) return;
          const step = Math.max(40, tip.clientHeight * 0.8);
          const next = {
            ArrowDown: tip.scrollTop + 40,
            ArrowUp: tip.scrollTop - 40,
            PageDown: tip.scrollTop + step,
            PageUp: tip.scrollTop - step,
            Home: 0,
            End: tip.scrollHeight,
          }[event.key];
          if (next === undefined) return;
          event.preventDefault();
          event.stopPropagation();
          tip.scrollTop = next;
        }}
        onPointerEnter={(event) => {
          if (event.pointerType !== 'touch') enter();
        }}
        onPointerLeave={leave}
        onPointerDown={() => {
          wasOpen.current = open;
        }}
        onFocus={() => {
          setFocused(true);
          setDismissed(false);
        }}
        onBlur={() => {
          setFocused(false);
        }}
        onClick={(event) => {
          if (event.detail === 0 ? open : wasOpen.current) close();
          else {
            setPinned(true);
            setDismissed(false);
          }
        }}
      >
        <span aria-hidden="true">?</span>
      </button>
      {mounted && portalTarget ? createPortal(content, portalTarget) : content}
    </span>
  );
}
