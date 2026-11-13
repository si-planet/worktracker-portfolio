import {
  forwardRef,
  useLayoutEffect,
  useRef,
  type ButtonHTMLAttributes,
  type ReactNode,
} from 'react';

type RefreshButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  busy?: boolean;
  showLabel?: boolean;
  children: ReactNode;
};

export const RefreshButton = forwardRef<HTMLButtonElement, RefreshButtonProps>(
  function RefreshButton(
    {
      children,
      busy = false,
      showLabel = false,
      disabled,
      title,
      className = '',
      type = 'button',
      ...props
    },
    ref,
  ) {
    const label = useRef<HTMLSpanElement>(null);
    const fallbackTitle =
      title ??
      props['aria-label'] ??
      (typeof children === 'string' ? children.trim() || '다시 조회' : '다시 조회');
    useLayoutEffect(() => {
      const node = label.current;
      if (node?.parentElement)
        node.parentElement.title =
          title ?? props['aria-label'] ?? (node.textContent?.trim() || '다시 조회');
    }, [children, title, props['aria-label']]);
    return (
      <button
        {...props}
        ref={ref}
        type={type}
        className={`text-button refresh-control${showLabel ? ' has-label' : ''} ${className}`}
        disabled={disabled || busy}
        aria-busy={busy || undefined}
        title={fallbackTitle}
      >
        <svg aria-hidden="true" focusable="false" viewBox="0 0 24 24" fill="none">
          <path d="M20 11a8 8 0 1 0-2.4 6M20 4v7h-7" />
        </svg>
        <span ref={label} className={showLabel ? 'control-label' : 'control-sr-only'}>
          {children}
        </span>
      </button>
    );
  },
);

export function ViewNavigation({
  companyId,
  date,
  projectId,
  current,
}: {
  companyId: string;
  date: string;
  projectId?: string | undefined;
  current: 'day' | 'week' | 'month';
}) {
  const daily = new URLSearchParams({ year: date.slice(0, 4), date });
  const monthly = new URLSearchParams({
    year: String(Number(date.slice(0, 4))),
    month: date.slice(0, 7),
    date,
  });
  if (projectId) {
    daily.set('projectId', projectId);
    monthly.set('projectId', projectId);
  }
  return (
    <nav className="view-navigation" aria-label="보기 전환">
      {(
        [
          ['day', '일간 보기'],
          ['week', '주간 보기'],
          ['month', '월간 보기'],
        ] as const
      ).map(([view, label]) => (
        <a
          key={view}
          className="view-navigation-link"
          href={`/c/${companyId}/${view}?${view === 'month' ? monthly : daily}`}
          aria-current={current === view ? 'page' : undefined}
        >
          {label}
        </a>
      ))}
    </nav>
  );
}
