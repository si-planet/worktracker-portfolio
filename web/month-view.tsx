import { HelpHint } from './help-hint';
import { editableDailyNotes } from './daily-sheet-model';
import { useWorkSourceLabels, WorkSourceBadges, WorkSourceNotice } from './work-source-labels';
import { RefreshButton, ViewNavigation } from './ui-controls';
import { Fragment, useEffect, useRef, useState } from 'react';
import { isCalendarMonth, monthCalendar, shiftCalendarMonthValue } from '../shared/month-calendar';
import {
  getKoreanHoliday,
  isDefaultNonWorkingDay,
  KR_HOLIDAY_YEARS,
} from '../shared/korean-holidays';
import { kstDate } from '../shared/work-entry-rules';
import { zWorkEntryDate } from '../shared/schema/work-entry';
import type { CalendarWorkEntry } from '../shared/schema/confirmed-worklog-recovery';
import { calendarEntryOnDate } from './confirmed-period-model';
import { monthPeriodLanes } from './month-period-model';
import { WorkFailure, workError } from './work-entry-api';
import {
  calendarWorkParameters,
  readCalendarWorkPage,
  mergeCalendarEntries,
} from './calendar-work-api';
import './week-view.css';
import './month-view.css';
import { MonthlyFocus } from './monthly-focus';
import { WbsMonthReference } from './wbs-month-reference';
import { dayHref } from './week-hub-model';
import { MonthScheduleCreate } from './month-schedule-create';
import type { WorkspaceProject, WorkspaceTag } from '../shared/schema/workspace';
import { displayMonthWeeks, sundayWeekdays } from './calendar-display';
import { categoryAppearance, categoryKey, readCategoryColors } from './category-colors';
import { CategoryColorControl } from './category-color-control';
import type { CategoryColorItem } from '../shared/schema/category-color';

const weekdays = sundayWeekdays;
const kinds = {
  task: '업무',
  meeting: '회의',
  field: '외근',
  event: '회사 행사',
  leave: '휴가',
  etc: '기타',
};
const statuses = {
  todo: '미진행',
  doing: '진행 중',
  paused: '중단',
  planned: '예정',
  done: '완료',
  canceled: '취소',
};
function adjacent(month: string, offset: number) {
  try {
    return shiftCalendarMonthValue(month, offset);
  } catch {
    return null;
  }
}
export function MonthView({
  companyId,
  projectId,
  year,
  onSelect,
  creationContext,
  onRefresh,
  refreshBusy = false,
}: {
  companyId: string;
  projectId: string;
  year: number;
  onSelect: (month: string) => void;
  creationContext?: { userId: string; projects: WorkspaceProject[]; tags: WorkspaceTag[] };
  onRefresh?: () => void;
  refreshBusy?: boolean;
}) {
  const initialMonth = () => {
    const requested = new URLSearchParams(window.location.search).get('month');
    return requested && isCalendarMonth(requested)
      ? requested
      : `${String(year).padStart(4, '0')}-${kstDate(Date.now()).slice(5, 7)}`;
  };
  const [month, setMonth] = useState(initialMonth);
  const [input, setInput] = useState(initialMonth);
  const [items, setItems] = useState<CalendarWorkEntry[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState('');
  const [online, setOnline] = useState(navigator.onLine);
  const [reload, setReload] = useState(0);
  const [status, setStatus] = useState('active');
  const [denied, setDenied] = useState(false);
  const [today, setToday] = useState(() => kstDate(Date.now()));
  const [selection, setSelection] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const revision = useRef(0);
  const displayed = useRef<string | null>(null);
  const seen = useRef(new Set<string>());
  const lock = useRef(false);
  const calendar = monthCalendar(month);
  const requestedDate = new URLSearchParams(window.location.search).get('date');
  const navigationDate =
    requestedDate &&
    requestedDate.startsWith(month) &&
    zWorkEntryDate.safeParse(requestedDate).success
      ? requestedDate
      : today.startsWith(month)
        ? today
        : calendar.firstDate;
  const selectedDate = selection?.startsWith(month) ? selection : navigationDate;
  const calendarQuery = {
    from: calendar.firstDate,
    to: calendar.lastDate,
    projectId,
    status: status === 'canceled' ? ('canceled' as const) : ('active' as const),
  };
  const parameters = calendarWorkParameters(calendarQuery);
  const scope = `${companyId}?${parameters}`;
  const shown = displayed.current === scope;
  const sourceLabels = useWorkSourceLabels(
    companyId,
    items,
    `${creationContext?.userId ?? ''}:${scope}:${reload}`,
    shown && online && !denied,
  );
  const [categoryColors, setCategoryColors] = useState<{
    companyId: string;
    items: Record<string, CategoryColorItem>;
    ready: boolean;
    error: boolean;
  }>({ companyId: '', items: {}, ready: false, error: false });
  const [colorReload, setColorReload] = useState(0);
  useEffect(() => {
    let current = true;
    setCategoryColors((prior) => ({ ...prior, ready: false }));
    void readCategoryColors(companyId)
      .then((result) => {
        if (current) setCategoryColors({ companyId, items: result, ready: true, error: false });
      })
      .catch(() => {
        if (current)
          setCategoryColors((prior) => ({
            companyId,
            items: prior.companyId === companyId ? prior.items : {},
            ready: false,
            error: true,
          }));
      });
    return () => {
      current = false;
    };
  }, [companyId, reload, colorReload]);
  const currentColors = categoryColors.companyId === companyId ? categoryColors.items : {};
  const appearance = (entry: CalendarWorkEntry) =>
    categoryAppearance(
      entry,
      creationContext?.projects ?? [],
      creationContext?.tags ?? [],
      currentColors,
    );
  function select(next: string) {
    setMonth(next);
    setInput(next);
    setError('');
    onSelect(next);
  }
  async function load(more = false) {
    if (more && (lock.current || !cursor)) return;
    const ticket = ++revision.current;
    const requested = scope;
    lock.current = true;
    setError('');
    if (displayed.current !== requested) {
      displayed.current = null;
      setItems([]);
      setCursor(null);
      setReady(false);
      setDenied(false);
    }
    if (!navigator.onLine) {
      lock.current = false;
      setLoading(false);
      return;
    }
    setLoading(true);
    if (!more) seen.current.clear();
    try {
      const result = await readCalendarWorkPage(companyId, calendarQuery, more ? cursor : null);
      if (ticket !== revision.current) return;
      if (
        result.nextCursor &&
        ((result.nextCursor === cursor && more) || seen.current.has(result.nextCursor))
      )
        throw new WorkFailure(0, 'INVALID_RESPONSE');
      if (result.nextCursor) seen.current.add(result.nextCursor);
      setItems((previous) => mergeCalendarEntries(more ? previous : [], result.items));
      setCursor(result.nextCursor);
      setReady(true);
      setDenied(false);
      displayed.current = requested;
    } catch (failure) {
      if (ticket !== revision.current) return;
      if (failure instanceof WorkFailure && failure.status === 401) {
        const params = new URLSearchParams({ year: String(year), month });
        if (projectId) params.set('projectId', projectId);
        window.location.assign(
          `/login?${new URLSearchParams({ returnTo: `/c/${companyId}/month?${params}` })}`,
        );
        return;
      }
      if (failure instanceof WorkFailure && failure.status === 403) {
        displayed.current = null;
        setItems([]);
        setCursor(null);
        setReady(false);
        setDenied(true);
      }
      setError(workError(failure));
    } finally {
      if (ticket === revision.current) {
        lock.current = false;
        setLoading(false);
      }
    }
  }
  useEffect(() => {
    void load();
    return () => {
      revision.current++;
      lock.current = false;
    };
  }, [scope, reload, online]);
  useEffect(() => {
    if (Number(month.slice(0, 4)) !== year) {
      const next = `${String(year).padStart(4, '0')}${month.slice(4)}`;
      setMonth(next);
      setInput(next);
    }
  }, [year]);
  useEffect(() => {
    const update = () => setOnline(navigator.onLine);
    const awake = () => {
      if (document.visibilityState === 'visible' && navigator.onLine)
        setReload((value) => value + 1);
    };
    window.addEventListener('online', update);
    window.addEventListener('offline', update);
    document.addEventListener('visibilitychange', awake);
    let previousDay = kstDate(Date.now());
    const timer = window.setInterval(() => {
      const value = kstDate(Date.now());
      if (previousDay !== value) {
        previousDay = value;
        setToday(value);
        if (navigator.onLine) setReload((count) => count + 1);
      }
    }, 30_000);
    return () => {
      window.removeEventListener('online', update);
      window.removeEventListener('offline', update);
      document.removeEventListener('visibilitychange', awake);
      window.clearInterval(timer);
    };
  }, []);
  const previous = adjacent(month, -1),
    next = adjacent(month, 1);
  const weeks = displayMonthWeeks(month);
  function selectDay(date: string) {
    const params = new URLSearchParams(window.location.search);
    const historyState = window.history.state;
    const hash = window.location.hash;
    params.set('year', String(Number(date.slice(0, 4))));
    params.set('month', date.slice(0, 7));
    params.set('date', date);
    if (projectId) params.set('projectId', projectId);
    else params.delete('projectId');
    setSelection(date);
    if (!date.startsWith(month)) select(date.slice(0, 7));
    window.history.replaceState(historyState, '', `/c/${companyId}/month?${params}${hash}`);
  }
  const selectedDay = calendar.days.find((day) => day.date === selectedDate)!;
  const selectedHoliday = getKoreanHoliday(selectedDate);
  const selectedEntries = shown
    ? items.filter((entry) => calendarEntryOnDate(entry, selectedDate))
    : [];
  const selectedHref = dayHref(companyId, selectedDate, projectId);
  const monthEntryCount = shown
    ? items.filter((entry) => calendar.days.some((day) => calendarEntryOnDate(entry, day.date)))
        .length
    : 0;
  function entryLabels(entry: CalendarWorkEntry) {
    const project = creationContext?.projects.find((value) => value.id === entry.projectId);
    const tags = entry.tagIds.flatMap((id) => {
      const tag = creationContext?.tags.find((value) => value.id === id);
      return tag ? [tag.label] : [];
    });
    return {
      project: project?.code ?? (entry.projectId ? '프로젝트 확인 필요' : '프로젝트 없음'),
      tags,
    };
  }
  return (
    <section className="week-view month-view" aria-label="월간 기록">
      {categoryColors.error && (
        <p role="status" className="field-hint">
          저장한 분류 색상을 불러오지 못했습니다. 프로젝트 기본색으로 표시될 수 있습니다.
        </p>
      )}
      {creationContext && (
        <CategoryColorControl
          companyId={companyId}
          projects={creationContext.projects}
          tags={creationContext.tags}
          colors={currentColors}
          ready={categoryColors.companyId === companyId && categoryColors.ready}
          error={categoryColors.error}
          disabled={!online || denied}
          onReload={() => setColorReload((value) => value + 1)}
          onSaved={(item) =>
            setCategoryColors((prior) =>
              prior.companyId === companyId
                ? {
                    ...prior,
                    items: { ...prior.items, [categoryKey(item.kind, item.targetId)]: item },
                  }
                : prior,
            )
          }
        />
      )}
      <div className="month-calendar-toolbar">
        <div className="month-period-controls" role="group" aria-label="조회 월 이동">
          <button
            type="button"
            aria-label="이전 월"
            disabled={!online || !previous}
            onClick={() => previous && select(previous)}
          >
            ‹
          </button>
          <h2 id="month-calendar-title" aria-live="polite">
            {Number(month.slice(0, 4))}년 {Number(month.slice(5))}월
          </h2>
          <button
            type="button"
            aria-label="다음 월"
            disabled={!online || !next}
            onClick={() => next && select(next)}
          >
            ›
          </button>
        </div>
        <div className="month-toolbar-actions">
          <RefreshButton
            type="button"
            disabled={!online || loading || refreshBusy}
            title="회사·프로젝트·태그·설정과 월간 기록 다시 조회"
            onClick={() => {
              onRefresh?.();
              setReload((value) => value + 1);
            }}
            busy={loading || refreshBusy}
          >
            월간 다시 조회
          </RefreshButton>
          {creationContext && (
            <button
              className="month-add-button"
              type="button"
              aria-label="일정 추가"
              aria-haspopup="dialog"
              title={`${selectedDate} · 1회성 또는 반복 일정 추가`}
              disabled={!online || denied}
              onClick={() => setAdding(true)}
            >
              <span aria-hidden="true">+</span>
            </button>
          )}
        </div>
      </div>
      {adding && creationContext && (
        <MonthScheduleCreate
          companyId={companyId}
          userId={creationContext.userId}
          date={selectedDate}
          projectId={projectId}
          projects={creationContext.projects}
          tags={creationContext.tags}
          onDateChange={selectDay}
          onChanged={() => setReload((value) => value + 1)}
          onClose={() => {
            setAdding(false);
            setReload((value) => value + 1);
          }}
        />
      )}
      <div className="month-aux-controls">
        <button type="button" disabled={!online} onClick={() => selectDay(kstDate(Date.now()))}>
          오늘
        </button>
        <details className="month-query-options">
          <summary>보기·조회</summary>
          <div className="month-view-options">
            <ViewNavigation
              companyId={companyId}
              date={selectedDate}
              projectId={projectId}
              current="month"
            />
            <a className="month-list-link" href={`/c/${companyId}/search?${parameters}`}>
              목록
            </a>
          </div>
          <form
            className="work-date-filter"
            onSubmit={(event) => {
              event.preventDefault();
              if (!online) return;
              if (isCalendarMonth(input)) select(input);
              else setError('실제 달력 월을 선택해 주세요.');
            }}
          >
            <label>
              조회 월
              <input
                type="month"
                min="0001-01"
                max="9999-12"
                value={input}
                disabled={!online}
                onChange={(event) => setInput(event.target.value)}
              />
            </label>
            <button type="submit" disabled={!online}>
              월 조회
            </button>
            <label>
              월간 목록 상태
              <select
                value={status}
                disabled={!online}
                onChange={(event) => setStatus(event.target.value)}
              >
                <option value="active">활성 기록</option>
                <option value="canceled">취소 기록</option>
              </select>
            </label>
          </form>

          <p className="month-range">
            {calendar.firstDate} ~ {calendar.lastDate} · 일요일 시작 · 한국 시간
          </p>
          <p className="month-coverage">
            {getKoreanHoliday(calendar.firstDate).status === 'verified'
              ? '대한민국 공휴일 · 2026년 공식 발표 기준'
              : `공휴일 미확인 연도: ${Number(month.slice(0, 4))}년 · 현재 지원: ${KR_HOLIDAY_YEARS.join(', ')}년 · 주말만 구분합니다.`}
          </p>
          <p>현재 프로젝트·목록 상태 기준입니다. 기간 기록은 중복 없이 한 건으로 셉니다.</p>
        </details>
      </div>
      {status === 'canceled' && (
        <div className="month-applied-filter" role="status">
          <span>취소 기록 조회 중</span>
          <button type="button" disabled={!online} onClick={() => setStatus('active')}>
            활성 기록으로
          </button>
        </div>
      )}
      {!online && <p role="status">오프라인 · 마지막 조회 기록이며 최신 상태가 아닙니다.</p>}
      {error && <p role="alert">{error}</p>}
      {error && shown && ready && (
        <p>마지막으로 조회한 기록을 표시합니다. 다시 조회해 최신 상태를 확인하세요.</p>
      )}
      {loading && <p role="status">월간 기록을 불러오고 있습니다.</p>}
      {denied ? (
        <a className="control-link" href="/">
          회사 선택으로 돌아가기
        </a>
      ) : (
        <>
          <p className="month-record-summary" role="status" aria-live="polite">
            {shown && ready
              ? `이번 달 ${cursor ? '불러온' : '전체'} 기록 ${monthEntryCount}개${cursor ? ' · 추가 조회 필요' : ''}${!online || loading || error ? ' · 마지막 조회 기준' : ''}`
              : '월간 기록을 조회하면 이번 달 건수를 표시합니다.'}
            <span>현재 프로젝트·목록 상태 기준 · 기간 기록은 중복 없이 한 건으로 셉니다.</span>
          </p>
          {shown && ready && cursor && (
            <div className="month-load-more">
              <p>일부 기록만 조회했습니다. 빈 날짜도 추가 조회가 필요할 수 있습니다.</p>
              <button type="button" disabled={!online || loading} onClick={() => void load(true)}>
                월간 기록 더 보기
              </button>
            </div>
          )}
          <div
            className="month-calendar"
            role="region"
            tabIndex={0}
            aria-label="일요일부터 토요일까지 월간 달력"
          >
            <table className="month-calendar-grid">
              <caption>
                {month} 일요일 시작 업무 달력. 날짜를 선택하면 아래에서 전체 기록을 볼 수 있습니다.
              </caption>
              <thead>
                <tr>
                  {weekdays.map((weekday, index) => (
                    <th
                      key={weekday}
                      scope="col"
                      className={index === 0 || index === 6 ? 'is-nonworking' : ''}
                    >
                      {weekday}
                      <span className="month-weekday-suffix">요일</span>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {weeks.map((week, index) => {
                  const lanes = monthPeriodLanes(week, shown ? items : []);
                  return (
                    <tr key={index}>
                      {week.map((day, offset) => {
                        if (!day)
                          return (
                            <td
                              className="month-outside"
                              key={`empty-${offset}`}
                              aria-label="이 월에 포함되지 않는 날짜"
                            />
                          );
                        const holiday = getKoreanHoliday(day.date);
                        const entries = day.isOutside
                          ? []
                          : lanes.filter(
                              (row) => row.firstDate <= day.date && row.lastDate >= day.date,
                            );
                        const visible = entries.filter((row) => row.lane < 3);
                        const hiddenCount = entries.length - visible.length;
                        return (
                          <td
                            key={day.date}
                            className={`month-day${day.isOutside ? ' month-outside' : ''}${day.date === selectedDate ? ' is-selected' : ''}${day.date === today ? ' is-today' : ''}${isDefaultNonWorkingDay(day.date) ? ' is-nonworking' : ''}`}
                          >
                            <button
                              className="month-date-select"
                              type="button"
                              onClick={() => selectDay(day.date)}
                              aria-pressed={day.date === selectedDate}
                              aria-controls="month-selected-day"
                              aria-label={`${day.date} ${weekdays[day.weekday % 7]}요일${holiday.name ? ` · ${holiday.name}` : ''} · ${day.isOutside ? '인접 월로 이동하여 조회' : `기록 ${entries.length}개 · 날짜 상세 선택`}`}
                            >
                              <strong>{Number(day.date.slice(8))}</strong>
                              {day.date === today && (
                                <span className="month-today-label">오늘</span>
                              )}
                              {entries.length > 0 && (
                                <span className="month-day-count">
                                  {entries.length}
                                  <span className="month-count-unit">건</span>
                                </span>
                              )}
                            </button>
                            <span className="month-cell-holiday" title={holiday.name ?? ''}>
                              {holiday.name ?? (day.isWeekend ? '주말' : ' ')}
                            </span>
                            <div className="month-event-stack" aria-label={`${day.date} 업무 요약`}>
                              {Array.from({ length: 3 }, (_, lane) => {
                                const row = visible.find((value) => value.lane === lane);
                                if (!row)
                                  return (
                                    <span
                                      className="month-event-space"
                                      key={lane}
                                      aria-hidden="true"
                                    />
                                  );
                                const continuedBefore =
                                  row.firstDate < day.date &&
                                  offset > 0 &&
                                  !week[offset - 1]?.isOutside;
                                const continuedAfter =
                                  row.lastDate > day.date &&
                                  offset < 6 &&
                                  !week[offset + 1]?.isOutside;
                                const labels = entryLabels(row.entry);
                                const description = [
                                  labels.project,
                                  kinds[row.entry.kind],
                                  ...labels.tags,
                                  ...sourceLabels
                                    .categories(row.entry)
                                    .map((value) => `구분: ${value}`),
                                  statuses[row.entry.status],
                                ].join(' · ');
                                return (
                                  <Fragment key={lane}>
                                    <button
                                      type="button"
                                      className={`month-event status-${row.entry.status}${continuedBefore ? ' continues-before' : ''}${continuedAfter ? ' continues-after' : ''}${day.date === row.segmentStart ? ' has-segment-label' : ''}`}
                                      style={appearance(row.entry)}
                                      data-work-entry-id={row.entry.id}
                                      onClick={() => selectDay(day.date)}
                                      title={`${row.entry.title} · ${description} · ${row.firstDate} ~ ${row.lastDate}`}
                                      aria-label={`${row.entry.title} · ${description} · ${day.date} 날짜 상세에서 보기`}
                                    >
                                      <span className="month-event-title">
                                        {day.date === row.segmentStart ? row.entry.title : '↔'}
                                      </span>
                                    </button>
                                    <span
                                      aria-hidden="true"
                                      className={`month-event month-compact-marker status-${row.entry.status}${continuedBefore ? ' continues-before' : ''}${continuedAfter ? ' continues-after' : ''}`}
                                      style={appearance(row.entry)}
                                      data-work-entry-id={row.entry.id}
                                    />
                                  </Fragment>
                                );
                              })}
                            </div>
                            {entries.length > 0 ? (
                              <button
                                className="month-more"
                                type="button"
                                onClick={() => selectDay(day.date)}
                                aria-label={`${day.date} 기록 전체 보기`}
                              >
                                {hiddenCount > 0 ? `+${hiddenCount}개 더` : '상세 보기'}
                              </button>
                            ) : (
                              <span
                                className="month-more"
                                aria-label={
                                  day.isOutside
                                    ? '인접 월로 이동하여 조회'
                                    : shown && ready && !cursor
                                      ? '조회된 기록 없음'
                                      : cursor
                                        ? '추가 조회 전 · 기록 유무 미확정'
                                        : '조회 전'
                                }
                              >
                                {day.isOutside ? '' : shown && ready && !cursor ? '-' : '…'}
                              </span>
                            )}
                          </td>
                        );
                      })}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <HelpHint label="월간 달력">
            날짜를 눌러 제목과 상세를 확인하세요. 같은 프로젝트·태그는 같은 색입니다. 위에서 분류
            색상을 지정할 수 있습니다.
          </HelpHint>
          <section
            id="month-selected-day"
            className="month-selected-day"
            aria-label="선택 날짜 기록"
          >
            <div className="month-selected-heading">
              <div>
                <p className="month-detail-eyebrow">선택 날짜</p>
                <h3>
                  {selectedDate.slice(5).replace('-', '.')} {weekdays[selectedDay.weekday % 7]}요일
                </h3>
                {isDefaultNonWorkingDay(selectedDate) && (
                  <p>{selectedHoliday.name ?? '주말'} · 기본 비활성</p>
                )}
              </div>
              {isDefaultNonWorkingDay(selectedDate) ? (
                <details className="month-nonworking-open">
                  <summary>
                    {selectedEntries.length
                      ? `기록 ${selectedEntries.length}개 열기`
                      : '이 날짜 열기'}
                  </summary>
                  <a className="control-link" href={selectedHref}>
                    일간 기록 열기
                  </a>
                </details>
              ) : (
                <a className="control-link" href={selectedHref}>
                  일간 기록 열기 ↗
                </a>
              )}
            </div>
            <p className="month-detail-count">
              {shown && ready
                ? `${selectedDate} 선택일 기록 ${selectedEntries.length}개`
                : `${selectedDate} 선택일 기록 조회 전`}
              {cursor ? ' · 현재 불러온 목록 기준' : ''}
            </p>
            <WorkSourceNotice status={sourceLabels.status} />
            {selectedEntries.length > 0 ? (
              <ul className="month-detail-list">
                {selectedEntries.map((entry) => {
                  const labels = entryLabels(entry);
                  return (
                    <li
                      key={entry.id}
                      className={`status-${entry.status}`}
                      style={appearance(entry)}
                      data-work-entry-id={entry.id}
                    >
                      <div className="month-detail-entry-heading">
                        <span className="month-work-swatch" aria-hidden="true" />
                        <span className={`month-detail-status status-${entry.status}`}>
                          {statuses[entry.status]}
                        </span>
                        <span>{kinds[entry.kind]}</span>
                        <a
                          href={selectedHref}
                          aria-label={`${entry.title} · ${selectedDate} 일간 기록에서 보기`}
                        >
                          <strong>{entry.title}</strong>
                        </a>
                      </div>
                      <p className="month-entry-labels">
                        <span className="month-entry-project">{labels.project}</span>
                        <WorkSourceBadges categories={sourceLabels.categories(entry)} />
                        {labels.tags.map((label, index) => (
                          <span className="month-entry-tag" key={index}>
                            {label}
                          </span>
                        ))}
                      </p>
                      <p className="month-entry-period">
                        {entry.confirmedPerformedDates
                          ? `확인된 수행일: ${entry.confirmedPerformedDates.join(', ')}`
                          : `${entry.plannedDate}${entry.endDate ? ` ~ ${entry.endDate}` : ''}`}
                      </p>
                      {entry.content && (
                        <p className="month-entry-content">{editableDailyNotes(entry.content)}</p>
                      )}
                      {entry.timeMode === 'exact' &&
                        entry.startAt !== null &&
                        entry.endAt !== null && (
                          <p className="month-entry-period">
                            {new Date(entry.startAt).toLocaleString('ko-KR', {
                              timeZone: 'Asia/Seoul',
                            })}{' '}
                            ~{' '}
                            {new Date(entry.endAt).toLocaleString('ko-KR', {
                              timeZone: 'Asia/Seoul',
                            })}
                          </p>
                        )}
                    </li>
                  );
                })}
              </ul>
            ) : (
              <p className="month-empty">
                {loading
                  ? '기록을 불러오고 있습니다.'
                  : shown && ready
                    ? cursor
                      ? '현재 조회된 기록이 없습니다. 추가 기록을 조회해 주세요.'
                      : '기록이 없습니다.'
                    : '기록을 조회하면 선택일의 전체 내용을 볼 수 있습니다.'}
              </p>
            )}
          </section>
        </>
      )}
      {shown && ready && !cursor && (
        <p className="field-hint">
          이 월의 조회를 마쳤습니다. 날짜 미정 기록은 달력에 포함하지 않습니다.
        </p>
      )}
      {!denied && (
        <details className="month-focus-disclosure">
          <summary>월간 주요사항 · 메모</summary>
          <MonthlyFocus
            key={companyId}
            companyId={companyId}
            month={month}
            online={online}
            onExpired={(failure) => {
              if (!(failure instanceof WorkFailure) || failure.status !== 401) return false;
              const params = new URLSearchParams({ year: String(year), month });
              if (projectId) params.set('projectId', projectId);
              window.location.assign(
                `/login?${new URLSearchParams({ returnTo: `/c/${companyId}/month?${params}` })}`,
              );
              return true;
            }}
            context="month"
          />
        </details>
      )}
      {!denied && (
        <details className="month-reference-disclosure">
          <summary>WBS 참고</summary>
          <a
            className="control-link"
            href={`/c/${companyId}/wbs?${new URLSearchParams({ year: month.slice(0, 4), ...(projectId ? { projectId } : {}) })}`}
          >
            WBS 계획 관리 열기 ↗
          </a>
          <WbsMonthReference
            companyId={companyId}
            month={month}
            projectId={projectId}
            online={online}
            refresh={reload}
            onExpired={(failure) => {
              if (!(failure instanceof WorkFailure) || failure.status !== 401) return false;
              const params = new URLSearchParams({ year: String(year), month });
              if (projectId) params.set('projectId', projectId);
              window.location.assign(
                `/login?${new URLSearchParams({ returnTo: `/c/${companyId}/month?${params}` })}`,
              );
              return true;
            }}
          />
        </details>
      )}
    </section>
  );
}
