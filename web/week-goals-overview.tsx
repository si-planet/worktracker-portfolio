import { displayWeekLabel } from './calendar-display';
import { RefreshButton } from './ui-controls';
import { useEffect, useRef, useState } from 'react';
import { weekCalendar } from '../shared/week-calendar';
import { readGoals } from './goal-api';
import type { zWeeklyGoalList } from '../shared/schema/weekly-goal';
import type { z } from 'zod';
import { WorkFailure, workError } from './work-entry-api';
type Goals = z.output<typeof zWeeklyGoalList>;
export function WeekGoalsOverview({
  companyId,
  isoYear,
  isoWeek,
  referenceDate,
  online,
  onExpired,
}: {
  companyId: string;
  isoYear: number;
  isoWeek: number;
  referenceDate?: string;
  online: boolean;
  onExpired: (e: unknown) => boolean;
}) {
  const scope = `${companyId}/${isoYear}/${isoWeek}`,
    [value, setValue] = useState<{ scope: string; data: Goals } | null>(null),
    [error, setError] = useState<{ scope: string; text: string } | null>(null),
    [loading, setLoading] = useState(false),
    [reload, setReload] = useState(0);
  const revision = useRef(0);
  useEffect(() => {
    const ticket = ++revision.current;
    setError(null);
    setLoading(false);
    if (!online || !navigator.onLine) return;
    setLoading(true);
    void readGoals(companyId, isoYear, isoWeek)
      .then((data) => {
        if (ticket === revision.current) setValue({ scope, data });
      })
      .catch((e) => {
        if (ticket !== revision.current || onExpired(e)) return;
        if (e instanceof WorkFailure && e.status === 403) setValue(null);
        setError({ scope, text: workError(e) });
      })
      .finally(() => {
        if (ticket === revision.current) setLoading(false);
      });
    return () => {
      revision.current++;
    };
  }, [scope, online, reload]);
  const shown = value?.scope === scope ? value.data : null;
  return (
    <section aria-label="주간 목표 요약">
      <h4>{displayWeekLabel(referenceDate ?? weekCalendar(isoYear, isoWeek).weekStart)} 목표</h4>
      <p>
        목표는 업무 달성률의 분모에 자동으로 더하지 않습니다. 편집·배치는 전용 화면에서 명시합니다.
      </p>
      <a
        className="control-link"
        href={`/c/${companyId}/goals?date=${referenceDate ?? weekCalendar(isoYear, isoWeek).weekStart}`}
      >
        이 주 목표 관리로 이동
      </a>
      <RefreshButton
        type="button"
        disabled={!online || loading}
        onClick={() => setReload((n) => n + 1)}
        busy={loading}
      >
        목표 요약 다시 조회
      </RefreshButton>
      {loading && <p role="status">목표를 불러오고 있습니다.</p>}
      {error?.scope === scope && <p role="alert">{error.text}</p>}
      {!online && <p role="status">오프라인 · 마지막 조회가 있으면 참고용으로 표시합니다.</p>}
      {error?.scope === scope && shown && (
        <p>마지막 성공 조회입니다. 오류를 빈 목표 목록으로 해석하지 마세요.</p>
      )}
      {shown &&
        (shown.items.length ? (
          <ul aria-label="이 주 목표 목록">
            {shown.items.map((item) => (
              <li key={item.id}>
                <strong>{item.title}</strong>
                {item.detail && <p className="week-goal-detail">{item.detail}</p>}
                <p>
                  명시 배치 영수증 {item.placements.length}건 · 현재 완료 건수를 뜻하지 않습니다.
                </p>
              </li>
            ))}
          </ul>
        ) : (
          <p>이 주에 등록된 목표가 없습니다.</p>
        ))}
    </section>
  );
}
