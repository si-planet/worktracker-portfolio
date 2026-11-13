import { useEffect, useState } from 'react';
import { kstDate } from '../shared/work-entry-rules';
import './work-deadline.css';

type DeadlineEntry = { dueDate: string | null; mustFinishToday: boolean };
const dayMs = 24 * 60 * 60 * 1000;
const kstOffset = 9 * 60 * 60 * 1000;

/** Labels describe persisted fields, including those on completed or canceled records. */
export function workDeadlineLabels(entry: DeadlineEntry, today: string): string[] {
  return [
    ...(entry.dueDate === today ? ['오늘 마감'] : []),
    ...(entry.mustFinishToday ? ['당일 완료 필수'] : []),
  ];
}

export function millisecondsUntilKstMidnight(now: number): number {
  return dayMs - ((((now + kstOffset) % dayMs) + dayMs) % dayMs);
}

/** One display clock per work panel; this hook never fetches or writes data. */
export function useKstToday(): string {
  const [today, setToday] = useState(() => kstDate(Date.now()));
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>;
    const update = () => {
      clearTimeout(timer);
      const now = Date.now();
      setToday(kstDate(now));
      timer = setTimeout(update, millisecondsUntilKstMidnight(now));
    };
    const visible = () => {
      if (document.visibilityState === 'visible') update();
    };
    update();
    window.addEventListener('focus', update);
    document.addEventListener('visibilitychange', visible);
    return () => {
      clearTimeout(timer);
      window.removeEventListener('focus', update);
      document.removeEventListener('visibilitychange', visible);
    };
  }, []);
  return today;
}

export function WorkDeadlineBadges({
  entry,
  today,
  insideLink = false,
}: {
  entry: DeadlineEntry;
  today: string;
  insideLink?: boolean;
}) {
  const labels = workDeadlineLabels(entry, today);
  if (!labels.length) return null;
  return (
    <span
      className="work-deadline-badges"
      // A named group replaces its visible text when a parent link derives its name.
      role={insideLink ? undefined : 'group'}
      aria-label={insideLink ? undefined : '저장된 마감 정보'}
      title="마지막으로 조회·저장한 기록 기준입니다. 미저장 입력은 반영하지 않습니다. 오늘은 한국 시간 기준입니다."
    >
      {labels.map((label) => (
        <span className="work-deadline-badge" key={label}>
          {label}
        </span>
      ))}
    </span>
  );
}
