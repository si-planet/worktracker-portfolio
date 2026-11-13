import { HelpHint } from './help-hint';
import { useWorkSourceLabels, WorkSourceBadges, WorkSourceNotice } from './work-source-labels';
import { RefreshButton } from './ui-controls';
import { PeriodDocument } from './period-document';
import { WeeklyWorkList } from './weekly-work-list';
import { WorkDeadlineBadges } from './work-deadline';
import {
  getKoreanHoliday,
  isDefaultNonWorkingDay,
  KR_HOLIDAY_YEARS,
} from '../shared/korean-holidays';
import type { WorkspaceProject, WorkspaceTag } from '../shared/schema/workspace';
import type { WorkEntryFinal } from '../shared/schema/work-entry';
import { weeklyEntries, dayHref } from './week-hub-model';
import { useEffect, useMemo, useRef, useState } from 'react';
import { zWeekView, type WeekView as WeekData } from '../shared/schema/week-view';
import { isoWeekForDate, shiftIsoWeek, weekCalendar } from '../shared/week-calendar';
import { WorkFailure, workApi, workError, workListSchema } from './work-entry-api';
import './week-view.css';
import { WeeklySummary } from './weekly-summary';
import { WeekReport } from './week-report';
import { WorkCarryover } from './work-carryover';
import { DeadlinePlacement } from './deadline-placement';
import { WeekSupportPanel } from './week-support-panel';
import { displayWeekLabel } from './calendar-display';

const weekdays = ['월', '화', '수', '목', '금', '토', '일'];
type Filter = { keyword: string; projectId: string; status: string };

function calendarFor(date: string) {
  try {
    const week = isoWeekForDate(date);
    return weekCalendar(week.isoYear, week.isoWeek);
  } catch {
    return null;
  }
}
function adjacent(date: string, offset: number) {
  try {
    const week = shiftIsoWeek(isoWeekForDate(date), offset);
    return weekCalendar(week.isoYear, week.isoWeek).weekStart;
  } catch {
    return null;
  }
}

export function WeekView({
  today,
  companyId,
  navigationProjectId,
  userId,
  projects,
  tags,
  onChanged,
  date,
  filter,
  refresh,
  disabled,
  online,
  onSelect: selectDate,
  onExpired,
  onStatusChange,
  onDetailChange,
}: {
  today: string;
  companyId: string;
  navigationProjectId?: string | undefined;
  userId: string;
  projects: WorkspaceProject[];
  tags: WorkspaceTag[];
  onChanged: () => void;
  date: string;
  filter: Filter;
  refresh: number;
  disabled: boolean;
  online: boolean;
  onSelect: (date: string) => void;
  onExpired: (failure: unknown) => boolean;
  editing?: boolean;
  onStatusChange?: (entry: WorkEntryFinal, status: WorkEntryFinal['status']) => void;
  onDetailChange?: (detail: boolean) => void;
  onEditingChange?: (editing: boolean) => void;
}) {
  const calendar = calendarFor(date);

  function onSelect(next: string) {
    selectDate(next);
  }
  const weekendKey = `wt:weekend-added:${userId}:${companyId}:${calendar?.weekStart ?? ''}`;
  const [weekendAdded, setWeekendAdded] = useState<Set<string>>(() => new Set());
  let storedWeekend = false;
  try {
    storedWeekend = localStorage.getItem(weekendKey) === 'added';
  } catch {
    /* Optional view preference. */
  }
  const includeWeekend = weekendAdded.has(weekendKey) || storedWeekend;
  function rememberWeekend(key: string) {
    setWeekendAdded((previous) => new Set([...previous, key]));
    try {
      localStorage.setItem(key, 'added');
    } catch {
      /* In-memory choice remains. */
    }
  }
  function addWeekend() {
    rememberWeekend(weekendKey);
  }
  const [detail, setDetail] = useState(false);
  const [creating, setCreating] = useState(false);
  const [createSlot, setCreateSlot] = useState<HTMLDivElement | null>(null);
  const createButton = useRef<HTMLButtonElement>(null);
  useEffect(() => setCreating(false), [companyId, calendar?.weekStart]);
  function closeCreate() {
    setCreating(false);
    requestAnimationFrame(() => createButton.current?.focus());
  }
  const overviewButton = useRef<HTMLButtonElement>(null);
  const detailTitle = useRef<HTMLHeadingElement>(null);
  function openDetail(next: boolean) {
    setDetail(next);
    onDetailChange?.(next);
    requestAnimationFrame(() => (next ? detailTitle.current : overviewButton.current)?.focus());
  }
  const editing = detail;
  const [unassigned, setUnassigned] = useState<{
    scope: string;
    entries: WorkEntryFinal[];
    more: boolean;
  }>({ scope: '', entries: [], more: false });
  const [unassignedError, setUnassignedError] = useState('');
  const [value, setValue] = useState<WeekData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [reload, setReload] = useState(0);
  const [reportMounted, setReportMounted] = useState(false);
  const [carryoverMounted, setCarryoverMounted] = useState(false);
  const [showReport, setShowReport] = useState(false);
  const [showCarryover, setShowCarryover] = useState(false);
  const [carryoverRefresh, setCarryoverRefresh] = useState(0);
  const revision = useRef(0);
  const displayed = useRef<string | null>(null);
  const cursors = useRef(new Set<string>());
  const parameters = new URLSearchParams({
    limit: '100',
    projection: 'working',
  });
  if (filter.keyword) parameters.set('keyword', filter.keyword);
  if (filter.projectId) parameters.append('projectIds', filter.projectId);
  for (const status of filter.status === 'canceled'
    ? ['canceled']
    : ['todo', 'doing', 'paused', 'planned', 'done'])
    parameters.append('statuses', status);
  const scope = calendar
    ? `${companyId}/${calendar.isoYear}/${calendar.isoWeek}?${parameters}`
    : '';

  useEffect(() => {
    let current = true;
    setUnassignedError('');
    const query = new URLSearchParams({ limit: '100', dateState: 'unscheduled', kinds: 'task' });
    query.append('statuses', 'todo');
    query.append('statuses', 'paused');
    if (filter.projectId) query.append('projectIds', filter.projectId);
    if (filter.keyword) query.set('keyword', filter.keyword);
    if (!online) return;
    void (async () => {
      const entries: WorkEntryFinal[] = [];
      const cursors = new Set<string>();
      let cursor: string | null = null;
      do {
        if (cursor) query.set('cursor', cursor);
        const result = await workApi(
          `/api/companies/${companyId}/work-entries?${query}`,
          workListSchema(companyId).refine((data) =>
            data.items.every(
              (entry) =>
                entry.kind === 'task' &&
                entry.plannedDate === null &&
                ['todo', 'paused'].includes(entry.status),
            ),
          ),
        );
        if (!current) return;
        entries.push(...result.items);
        cursor = result.nextCursor;
        if (cursor && cursors.has(cursor)) throw new WorkFailure(0, 'INVALID_RESPONSE');
        if (cursor) cursors.add(cursor);
      } while (cursor && entries.length < 1000);
      if (current)
        setUnassigned({
          scope,
          entries: [...new Map(entries.map((entry) => [entry.id, entry])).values()],
          more: cursor !== null,
        });
    })().catch((failure: unknown) => {
      if (current && !onExpired(failure))
        setUnassignedError('미배정 업무를 불러오지 못했습니다. 다시 조회해 주세요.');
    });
    return () => {
      current = false;
    };
  }, [scope, online, refresh, reload, carryoverRefresh]);
  const waiting = useMemo(
    () => (unassigned.scope === scope ? unassigned.entries : []),
    [unassigned, scope],
  );

  async function load(more = false) {
    const ticket = ++revision.current;
    const requested = scope;
    setError('');
    if (displayed.current !== requested) {
      setValue(null);
      displayed.current = null;
    }
    if (!calendar || !navigator.onLine || (more && !value?.nextCursor)) {
      setLoading(false);
      return;
    }
    setLoading(true);
    if (!more) cursors.current.clear();
    const query = new URLSearchParams(parameters);
    if (more && value?.nextCursor) query.set('cursor', value.nextCursor);
    try {
      const result = await workApi(
        `/api/companies/${companyId}/weeks/${calendar.isoYear}/${calendar.isoWeek}?${query}`,
        zWeekView.refine(
          (data) =>
            data.projection === 'working' &&
            data.companyId === companyId &&
            data.isoYear === calendar.isoYear &&
            data.isoWeek === calendar.isoWeek &&
            data.weekStart === calendar.weekStart &&
            data.weekEnd === calendar.weekEnd,
        ),
      );
      if (ticket !== revision.current) return;
      if (
        result.nextCursor &&
        ((result.nextCursor === value?.nextCursor && more) ||
          cursors.current.has(result.nextCursor))
      )
        throw new WorkFailure(0, 'INVALID_RESPONSE');
      if (result.nextCursor) cursors.current.add(result.nextCursor);
      setValue((previous) =>
        !more || !previous
          ? result
          : {
              ...result,
              days: result.days.map((day) => {
                const prior = previous.days.find((old) => old.date === day.date)?.entries ?? [];
                const rows = new Map(prior.map((entry) => [entry.id, entry]));
                for (const entry of day.entries) rows.set(entry.id, entry);
                return { ...day, entries: [...rows.values()] };
              }),
            },
      );
      displayed.current = requested;
    } catch (failure) {
      if (ticket !== revision.current || onExpired(failure)) return;
      if (failure instanceof WorkFailure && failure.status === 403) setValue(null);
      setError(workError(failure));
    } finally {
      if (ticket === revision.current) setLoading(false);
    }
  }
  useEffect(() => {
    void load();
    return () => {
      revision.current++;
    };
  }, [scope, refresh, reload, carryoverRefresh]);
  const previous = adjacent(date, -1),
    next = adjacent(date, 1);
  const shown = displayed.current === scope ? value : null;
  const rows = useMemo(() => weeklyEntries(shown?.days ?? []), [shown?.days]);
  const allRows = useMemo(
    () => [...new Map([...waiting, ...rows].map((entry) => [entry.id, entry])).values()],
    [rows, waiting],
  );
  const sourceLabels = useWorkSourceLabels(
    companyId,
    allRows,
    `${userId}:${scope}:${refresh}:${reload}:${carryoverRefresh}`,
    online && !!shown,
  );
  return (
    <section className={`week-view ${detail ? 'is-detail' : 'is-hub'}`} aria-label="주간 기록">
      <div className="week-heading week-sheet-heading">
        <nav className="week-sheet-period" aria-label="주간 날짜 이동">
          <button
            type="button"
            aria-label="이전 주"
            title="이전 주"
            disabled={disabled || !previous}
            onClick={() => previous && onSelect(previous)}
          >
            ◀
          </button>
          <h3>
            {calendar
              ? displayWeekLabel(date).replace('년 ', ' ').replace(/주\)$/, '주차)')
              : '주간 범위를 표시할 수 없습니다.'}
          </h3>
          <button
            type="button"
            aria-label="다음 주"
            title="다음 주"
            disabled={disabled || !next}
            onClick={() => next && onSelect(next)}
          >
            ▶
          </button>
        </nav>
        <div className="work-actions">
          <button
            type="button"
            className="week-add-button"
            ref={createButton}
            aria-label="업무 추가"
            title="업무 추가"
            disabled={disabled || !calendar}
            aria-expanded={creating}
            aria-controls="week-quick-create"
            onClick={() => setCreating(true)}
          >
            +
          </button>
          <RefreshButton
            type="button"
            disabled={!online || loading}
            onClick={() => setReload((count) => count + 1)}
            busy={loading}
          >
            주간 다시 조회
          </RefreshButton>
        </div>
      </div>
      <div id="week-quick-create" ref={setCreateSlot} />
      {creating && !includeWeekend && (
        <button type="button" className="week-add-weekend" disabled={disabled} onClick={addWeekend}>
          이 주에 주말 추가
        </button>
      )}
      {error && !detail && <p role="alert">{error}</p>}
      {loading && !detail && <p role="status">주간 카드를 불러오고 있습니다.</p>}
      <WorkSourceNotice status={sourceLabels.status} />
      <div className="week-hub" hidden={detail} aria-label="주간 카드 허브">
        <button
          type="button"
          ref={overviewButton}
          className="week-hub-card week-overview-card"
          disabled={disabled}
          onClick={() => openDetail(true)}
        >
          <h4>주간 총괄</h4>
          <p>이번 주 목표·업무 전체 목록</p>
          <span className="week-card-metrics">
            <span>
              <strong>{shown ? rows.length : '…'}</strong>이번 주 업무
            </span>
            <span>
              <strong>
                {shown ? rows.filter((entry) => entry.status === 'todo').length : '…'}
              </strong>
              미진행
            </span>
            <span>
              <strong>
                {shown ? rows.filter((entry) => entry.status === 'done').length : '…'}
              </strong>
              완료
            </span>
          </span>
          <span className="week-unassigned-count">
            {unassignedError
              ? '미배정 조회 실패'
              : unassigned.scope !== scope
                ? '미배정 조회 중'
                : `미배정 ${waiting.length}${unassigned.more ? '+' : ''}개 · 요일 배정`}
          </span>
          <span className="week-card-open">
            총괄 상세 보기 <span aria-hidden="true">↗</span>
          </span>
        </button>
        {(calendar?.days ?? []).map((day) => {
          const entries = shown
            ? (shown.days.find((value) => value.date === day.date)?.entries ?? [])
            : null;
          if (day.isWeekend && !includeWeekend) return null;
          const holiday = getKoreanHoliday(day.date);
          if (!day.isWeekend && isDefaultNonWorkingDay(day.date))
            return (
              <div
                className={`week-hub-card is-nonworking${day.date === today ? ' is-current-date' : ''}`}
                key={day.date}
              >
                <span className="week-card-date">{day.date.slice(5).replace('-', '.')}</span>
                <h4>{weekdays[day.weekday - 1]}요일</h4>
                <p>{holiday.name ?? '주말'} · 기본 비활성</p>
                <details>
                  <summary>
                    {entries?.length ? `기록 ${entries.length}개 열기` : '이 날짜 열기'}
                  </summary>
                  <a
                    className="control-link"
                    href={dayHref(companyId, day.date, navigationProjectId ?? filter.projectId)}
                  >
                    일간 기록 열기
                  </a>
                </details>
              </div>
            );
          return (
            <a
              className={`week-hub-card${day.date === today ? ' is-current-date' : ''}`}
              key={day.date}
              href={dayHref(companyId, day.date, navigationProjectId ?? filter.projectId)}
            >
              <span className="week-card-date">{day.date.slice(5).replace('-', '.')}</span>
              <h4>
                {weekdays[day.weekday - 1]}요일 <span aria-hidden="true">↗</span>
              </h4>
              <p>
                {entries
                  ? `${entries.filter((e) => e.status !== 'canceled').length}개 기록 · ${entries.filter((e) => e.status === 'done').length}개 완료`
                  : '기록 조회 중'}
              </p>
              <ul>
                {entries?.slice(0, 3).map((entry) => (
                  <li key={entry.id}>
                    <span className={`week-status-dot status-${entry.status}`} aria-hidden="true" />
                    <span className="week-card-title">{entry.title}</span>
                    <WorkSourceBadges categories={sourceLabels.categories(entry)} />
                    <WorkDeadlineBadges entry={entry} today={today} insideLink />
                  </li>
                ))}
              </ul>
              {entries && entries.length === 0 && <span className="week-card-empty">-</span>}
              {entries && entries.length > 3 && (
                <span className="field-hint">외 {entries.length - 3}개 · 일간 상세에서 확인</span>
              )}
              <span className="week-card-open">일간 상세 보기</span>
            </a>
          );
        })}
      </div>
      {!detail && (
        <>
          {shown?.nextCursor && (
            <div className="week-more">
              <p>추가 기록이 있어 전체 조회 전입니다.</p>
              <button type="button" disabled={!online || loading} onClick={() => void load(true)}>
                주간 기록 더 보기
              </button>
            </div>
          )}
          <HelpHint label="주간 달력과 집계">
            공휴일 확인 범위: {KR_HOLIDAY_YEARS.join(', ')}년. 그 밖의 연도는 주말만 확인합니다.
            주말은 직접 추가한 경우에 표시됩니다. 요일을 누르면 일간 상세를 엽니다. 카드 수치는
            조회된 고유 업무 기준이며 보고 달성률과 다릅니다.
          </HelpHint>
        </>
      )}
      {detail && (
        <div className="week-detail-heading">
          <button type="button" className="button secondary" onClick={() => openDetail(false)}>
            ← 주간 전체로
          </button>
          <h3 ref={detailTitle} tabIndex={-1}>
            총괄 상세 · 목표·업무 목록
          </h3>
        </div>
      )}
      <div className="week-layout" key={companyId} hidden={!detail}>
        <div className="week-calendar-column" aria-label="주간 달력 영역">
          <h4 className="week-column-title">이번 주 목표·업무</h4>
          {error && <p role="alert">{error}</p>}
          {error && shown && (
            <p>마지막으로 조회한 기록을 표시합니다. 다시 조회해 최신 상태를 확인하세요.</p>
          )}
          {loading && <p role="status">주간 기록을 불러오고 있습니다.</p>}
          {unassignedError && <p role="alert">{unassignedError}</p>}
          {unassigned.scope === scope && unassigned.more && (
            <p role="status">미배정 업무는 현재 1,000개까지 조회했습니다.</p>
          )}
          <WeeklyWorkList
            today={today}
            companyId={companyId}
            userId={userId}
            date={date}
            entries={allRows}
            placementDates={(calendar?.days ?? [])
              .filter((day) => !day.isWeekend || includeWeekend)
              .map((day) => day.date)}
            sourceCategories={sourceLabels.categories}
            projects={projects}
            tags={tags}
            editing={editing}
            online={online}
            disabled={disabled}
            onExpired={onExpired}
            onChanged={onChanged}
            onEntrySaved={(entry) => {
              if (entry.companyId !== companyId || !entry.plannedDate) return;
              const savedWeek = calendarFor(entry.plannedDate);
              if (savedWeek?.days.some((day) => day.isWeekend && day.date === entry.plannedDate))
                rememberWeekend(`wt:weekend-added:${userId}:${companyId}:${savedWeek.weekStart}`);
            }}
            createSlot={createSlot}
            creating={creating}
            onCreateClose={closeCreate}
            {...(onStatusChange ? { onStatusChange } : {})}
          />
          {shown && (
            <>
              {shown.nextCursor ? (
                <div className="week-more">
                  <p>추가 기록이 있습니다. 모든 날짜의 조회가 아직 끝나지 않았습니다.</p>
                  <button
                    type="button"
                    disabled={!online || loading}
                    onClick={() => void load(true)}
                  >
                    주간 기록 더 보기
                  </button>
                </div>
              ) : (
                <p className="field-hint">
                  진행 중 업무는 같은 ID로 다음 날짜에도 표시됩니다. 목록 입력은 저장 버튼으로
                  반영합니다.
                </p>
              )}
            </>
          )}
          <a className="control-link" href={`/c/${companyId}/goals?date=${date}`}>
            이 주 목표 관리로 이동
          </a>
        </div>
        <aside className="week-right-column">
          <div className="week-plan-column">
            <WeekSupportPanel title="미결사항 · 마감예정" online={online}>
              <div hidden={!editing}>
                {' '}
                {calendar && (
                  <DeadlinePlacement
                    key={companyId}
                    companyId={companyId}
                    date={date}
                    online={online}
                    disabled={disabled}
                    refresh={refresh + carryoverRefresh}
                    onExpired={onExpired}
                    onChanged={() => setCarryoverRefresh((n) => n + 1)}
                    onSelectDate={onSelect}
                  />
                )}
              </div>
            </WeekSupportPanel>
            <WeekSupportPanel title="주간 메모" online={online}>
              {calendar && (
                <PeriodDocument
                  companyId={companyId}
                  userId={userId}
                  kind="weekly_note"
                  periodStart={calendar.weekStart}
                  editing={editing}
                  online={online}
                  onExpired={onExpired}
                />
              )}
            </WeekSupportPanel>
            <div hidden={!editing}>
              <WeekSupportPanel title="미완료 이월" online={online}>
                {' '}
                <button
                  type="button"
                  aria-expanded={showCarryover}
                  disabled={disabled}
                  onClick={() => {
                    setCarryoverMounted(true);
                    setShowCarryover((v) => !v);
                  }}
                >
                  {showCarryover ? '이월 검토 닫기 · 초안 유지' : '미완료 이월 검토'}
                </button>
                <div hidden={!showCarryover}>
                  {' '}
                  {carryoverMounted && (
                    <WorkCarryover
                      key={companyId}
                      companyId={companyId}
                      date={date}
                      online={online}
                      disabled={disabled}
                      onExpired={onExpired}
                      onChanged={() => setCarryoverRefresh((n) => n + 1)}
                      onSelectDate={onSelect}
                    />
                  )}
                </div>
              </WeekSupportPanel>
            </div>
          </div>
          <div className="week-report-column">
            <WeekSupportPanel title="과거 집계" online={online} collapsible>
              {' '}
              <button
                type="button"
                aria-expanded={showReport}
                disabled={disabled}
                onClick={() => {
                  setReportMounted(true);
                  setShowReport((value) => !value);
                }}
              >
                {showReport ? '계획 집계 닫기' : '계획 집계 열기'}
              </button>
              <div hidden={!showReport}>
                {' '}
                {reportMounted && calendar && (
                  <WeekReport
                    companyId={companyId}
                    isoYear={calendar.isoYear}
                    isoWeek={calendar.isoWeek}
                    referenceDate={date}
                    online={online}
                    refresh={refresh + carryoverRefresh}
                    onExpired={onExpired}
                  />
                )}
              </div>{' '}
              {calendar && (
                <WeeklySummary
                  key={companyId}
                  companyId={companyId}
                  isoYear={calendar.isoYear}
                  isoWeek={calendar.isoWeek}
                  referenceDate={date}
                  online={online}
                  refresh={refresh + carryoverRefresh}
                  onExpired={onExpired}
                />
              )}
            </WeekSupportPanel>
          </div>
        </aside>
      </div>
    </section>
  );
}
