import { useEffect, useId, useRef, useState, type CSSProperties } from 'react';
import type { WbsPlanner, WbsPlannerItem, WbsPlannerProject } from '../shared/schema/wbs-planner';
import { WorkFailure, workError } from './work-entry-api';
import { readWbsPlanner } from './wbs-planner-api';
import { plannerMonths, plannerMonthSegment, plannerRangeText } from './wbs-planner-calendar';
import './wbs-planner.css';
import {
  baselineRange,
  annualWorkSegments,
  annualWorkHref,
  type AnnualCalendarPeriod,
} from './annual-calendar-model';
import { AnnualCalendarMonth } from './annual-calendar-month';
import type { WorkEntryFinal } from '../shared/schema/work-entry';
import { useAnnualWorkCalendar } from './use-annual-work-calendar';
import { useWbsPlannerMove } from './wbs-planner-move';

type Entry = { project: WbsPlannerProject; item: WbsPlannerItem };
type CalendarBar =
  | { kind: 'baseline' | 'plan' | 'actual'; entry: Entry }
  | { kind: 'personal'; entry: WorkEntryFinal };
const difference = (days: number | null) =>
  days === null ? '비교 미정' : days === 0 ? '0일' : `${days > 0 ? '+' : ''}${days}일`;
const colorStyle = (project: WbsPlannerProject) =>
  ({ '--planner-project': project.color ?? 'var(--accent)' }) as CSSProperties;

export function WbsPlanner({
  companyId,
  userId,
  moveGuard,
  onChanged,
  year,
  projectId,
  refresh,
  online,
  expired,
  onYearChange,
  onItemOpen,
}: {
  companyId: string;
  userId: string;
  moveGuard: { current: () => boolean };
  onChanged: () => void;
  year: number;
  projectId: string;
  refresh: number;
  online: boolean;
  expired: (error: unknown) => boolean;
  onYearChange: (year: number) => void;
  onItemOpen: (projectId: string, itemId: string) => boolean;
}) {
  const move = useWbsPlannerMove({
    companyId,
    userId,
    year,
    projectId,
    online,
    guard: moveGuard,
    expired,
    onChanged,
    onItemOpen,
  });
  const [dragToken] = useState(() => crypto.randomUUID());
  const dragged = useRef<Entry | null>(null);
  const dragMime = 'application/x-work-tracker-wbs-move';
  const id = useId();
  const expiredRef = useRef(expired);
  expiredRef.current = expired;
  const scope = `${companyId}/${year}`;
  const [snapshot, setSnapshot] = useState<{
    scope: string;
    value: WbsPlanner;
  } | null>(null);
  const [error, setError] = useState(''),
    [loading, setLoading] = useState(false);
  const [showBaseline, setShowBaseline] = useState(true),
    [showPersonal, setShowPersonal] = useState(true),
    [personalStatus, setPersonalStatus] = useState<'active' | 'canceled'>('active');
  const [showPlan, setShowPlan] = useState(false),
    [showActual, setShowActual] = useState(true);
  const [filter, setFilter] = useState({
    scope,
    contextProject: projectId,
    projectId,
  });
  const filterId =
    filter.scope === scope && filter.contextProject === projectId ? filter.projectId : projectId;
  const [selected, setSelected] = useState<{
    scope: string;
    itemId: string;
  } | null>(null);
  const revision = useRef(0),
    root = useRef<HTMLElement>(null),
    detail = useRef<HTMLElement>(null);
  const baselineControl = useRef<HTMLInputElement>(null),
    personalControl = useRef<HTMLInputElement>(null),
    planControl = useRef<HTMLInputElement>(null),
    actualControl = useRef<HTMLInputElement>(null),
    filterControl = useRef<HTMLSelectElement>(null);
  useEffect(() => {
    const ticket = ++revision.current;
    setError('');
    setLoading(false);
    if (!online) return;
    setLoading(true);
    void readWbsPlanner(companyId, year)
      .then((value) => {
        if (ticket === revision.current) setSnapshot({ scope, value });
      })
      .catch((failure) => {
        if (ticket !== revision.current) return;
        if (failure instanceof WorkFailure && [401, 403].includes(failure.status)) {
          setSnapshot(null);
          expiredRef.current(failure);
        }
        if (failure instanceof WorkFailure && failure.status === 401) {
          setError('로그인이 만료되었습니다. 다시 로그인해 연간 플래너를 조회해 주세요.');
          return;
        }
        setError(workError(failure));
      })
      .finally(() => {
        if (ticket === revision.current) setLoading(false);
      });
    return () => {
      revision.current++;
    };
  }, [scope, refresh, online]);
  const shown = snapshot?.scope === scope ? snapshot.value : null;
  const entries: Entry[] =
    shown?.projects
      .filter((p) => !filterId || p.id === filterId)
      .flatMap((project) =>
        project.plans.flatMap((plan) => plan.items.map((item) => ({ project, item }))),
      ) ?? [];
  const selectedEntry =
    selected?.scope === scope
      ? entries.find((entry) => entry.item.id === selected.itemId)
      : undefined;
  const months = plannerMonths(year);
  const personal = useAnnualWorkCalendar(
    companyId,
    {
      from: months[0]!.startOn,
      to: months[11]!.endOn,
      projectId: filterId,
      status: personalStatus,
    },
    refresh,
    online,
    expired,
  );

  function select(entry: Entry) {
    if (!move.confirmChange()) return;
    setSelected({ scope, itemId: entry.item.id });
    // Focus after the selected snapshot detail has rendered, including a new title.
    requestAnimationFrame(() => {
      detail.current?.focus({ preventScroll: true });
      detail.current?.scrollIntoView({ block: 'start' });
    });
  }
  function toggle(kind: 'baseline' | 'personal' | 'plan' | 'actual', checked: boolean) {
    if (
      !checked &&
      [...(root.current?.querySelectorAll(`[data-planner-kind="${kind}"]`) ?? [])].some((node) =>
        node.contains(document.activeElement),
      )
    )
      ({
        baseline: baselineControl,
        personal: personalControl,
        plan: planControl,
        actual: actualControl,
      })[kind].current?.focus();
    if (kind === 'baseline') setShowBaseline(checked);
    else if (kind === 'personal') setShowPersonal(checked);
    else if (kind === 'plan') setShowPlan(checked);
    else setShowActual(checked);
  }
  function drop(day: string, event: React.DragEvent) {
    event.preventDefault();
    const entry = dragged.current;
    dragged.current = null;
    if (
      !online ||
      !entry ||
      event.dataTransfer.getData(dragMime) !== `${dragToken}/${entry.item.id}` ||
      !entries.some(
        (e) =>
          e.item.id === entry.item.id &&
          e.item.version === entry.item.version &&
          e.item.actualPeriod.planVersion === entry.item.actualPeriod.planVersion,
      )
    )
      return;
    move.start(entry.project, entry.item, day);
  }
  return (
    <section className="wbs-planner" aria-label="연간 플래너" ref={root}>
      <div className="wbs-planner-toolbar">
        <strong>{String(year).padStart(4, '0')}년 · 연간 달력</strong>
        <button type="button" disabled={year <= 1} onClick={() => onYearChange(year - 1)}>
          이전 연도
        </button>
        <button type="button" disabled={year >= 9999} onClick={() => onYearChange(year + 1)}>
          다음 연도
        </button>
      </div>
      <div className="wbs-planner-toolbar">
        <label className="wbs-planner-check">
          <input
            ref={baselineControl}
            type="checkbox"
            checked={showBaseline}
            onChange={(e) => toggle('baseline', e.target.checked)}
          />
          정규 WBS · 원래 계획
        </label>
        <label className="wbs-planner-check">
          <input
            ref={personalControl}
            type="checkbox"
            checked={showPersonal}
            onChange={(e) => toggle('personal', e.target.checked)}
          />
          내 일정 · WBS 미연결 포함
        </label>
        <label className="wbs-planner-check">
          <input
            ref={planControl}
            type="checkbox"
            checked={showPlan}
            onChange={(e) => toggle('plan', e.target.checked)}
          />
          적용 WBS 계획 표시
        </label>
        <label className="wbs-planner-check">
          <input
            ref={actualControl}
            type="checkbox"
            checked={showActual}
            onChange={(e) => toggle('actual', e.target.checked)}
          />
          WBS 실제 기간 표시
        </label>
        <label>
          플래너 프로젝트 표시
          <select
            ref={filterControl}
            value={filterId}
            onChange={(e) => {
              if (!move.confirmChange()) return;
              if (root.current?.contains(document.activeElement)) filterControl.current?.focus();
              setFilter({
                scope,
                contextProject: projectId,
                projectId: e.target.value,
              });
            }}
          >
            <option value="">전체 프로젝트</option>
            {shown?.projects.map((p) => (
              <option key={p.id} value={p.id}>
                {p.code}
                {p.isActive ? '' : ' (비활성)'}
              </option>
            ))}
          </select>
        </label>
        <label>
          플래너 월 이동
          <select
            defaultValue=""
            onChange={(e) => {
              const month = document.getElementById(`${id}-month-${e.target.value}`);
              month?.scrollIntoView({ block: 'start' });
              month?.focus();
            }}
          >
            <option value="" disabled>
              월 선택
            </option>
            {months.map((m) => (
              <option key={m.month} value={m.month}>
                {m.month}월
              </option>
            ))}
          </select>
        </label>
      </div>
      <div className="wbs-planner-toolbar">
        <label>
          내 일정 상태
          <select
            value={personalStatus}
            onChange={(e) =>
              setPersonalStatus(e.target.value === 'canceled' ? 'canceled' : 'active')
            }
          >
            <option value="active">취소 제외</option>
            <option value="canceled">취소 일정</option>
          </select>
        </label>
        <button
          type="button"
          disabled={!online || personal.loading}
          onClick={() => void personal.load()}
        >
          내 일정 다시 조회
        </button>
        {personal.cursor && (
          <button
            type="button"
            disabled={!online || personal.loading}
            onClick={() => void personal.load(true)}
          >
            내 일정 더 불러오기
          </button>
        )}
      </div>
      {personal.loading && <p role="status">내 일정을 불러오고 있습니다.</p>}
      {personal.error && (
        <p role="alert">
          내 일정: {personal.error} {personal.ready ? '마지막 성공 조회를 표시합니다.' : ''}
        </p>
      )}
      {personal.ready && (
        <p role="status">
          내 일정 {personal.entries.length}건 ·{' '}
          {personal.cursor ? '일부 조회 · 더 불러오기로 나머지 확인' : '조회 완료'} · 월간·주간과
          같은 업무 기록입니다.
        </p>
      )}
      {loading && <p role="status">연간 플래너를 불러오고 있습니다.</p>}
      {!online && <p role="status">오프라인 · 연간 플래너를 새로 조회할 수 없습니다.</p>}
      {error && <p role="alert">{error}</p>}
      {shown && move.content}
      {(shown || personal.ready) && !move.denied && (
        <>
          <p className="wbs-planner-caption">
            {shown
              ? `정규 WBS 조회 기준 ${new Date(shown.asOf).toISOString()}`
              : '정규 WBS는 아직 조회되지 않았습니다.'}{' '}
            · {shown && (error || !online) ? 'WBS는 마지막 성공 조회 · ' : ''}내 일정은 별도로
            조회합니다. 완전한 기간만 막대 표시 · 정규 WBS 원래 기간은 내 일정 수정과 무관하게
            보존됩니다. 적용 WBS 계획의 이동은 별도 미리보기·저장으로 처리합니다. 내 일정 막대는
            같은 업무의 날짜별 상세를 엽니다.
          </p>
          <ul className="wbs-planner-legend" aria-label="플래너 프로젝트 범례">
            {shown?.projects.map((p) => (
              <li key={p.id} style={colorStyle(p)}>
                <span className="wbs-planner-swatch" aria-hidden="true" />
                {p.code}
                {p.isActive ? '' : ' (비활성)'}
                {p.plans.length ? '' : ' · 계획 없음'}
              </li>
            ))}
          </ul>
          {!showBaseline && !showPersonal && !showPlan && !showActual && (
            <p role="status">
              모든 막대를 숨겼습니다. 항목 상세는 아래 목록에서 확인할 수 있습니다.
            </p>
          )}
          {shown && !entries.length && (
            <p role="status">
              {filterId ? '선택한 프로젝트에' : '이 회사·연도에'} 표시할 WBS 항목이 없습니다.
            </p>
          )}
          <div className="wbs-planner-months">
            {months.map((month) => {
              const bars = entries.flatMap((entry) =>
                (['baseline', 'plan', 'actual'] as const).flatMap((kind) => {
                  if (
                    kind === 'baseline' ? !showBaseline : kind === 'plan' ? !showPlan : !showActual
                  )
                    return [];
                  const range =
                    kind === 'baseline'
                      ? baselineRange(entry.item)
                      : kind === 'plan'
                        ? entry.item.actualPeriod.effectivePlan
                        : entry.item.actualPeriod.actual;
                  const segment = plannerMonthSegment(range, year, month.month);
                  return segment ? [{ entry, kind, range, segment }] : [];
                }),
              );
              const personalBars = showPersonal
                ? annualWorkSegments(personal.entries, year, month.month)
                : [];
              const periods: AnnualCalendarPeriod<CalendarBar>[] = [
                ...bars.map(({ entry, kind, range }) => ({
                  key: `wbs-${entry.item.id}-${kind}`,
                  range,
                  value: { kind, entry },
                })),
                ...personalBars.map(({ sourceId, entry, range }) => ({
                  key: `work-${sourceId}-${range.startOn}-${range.endOn}`,
                  range,
                  value: { kind: 'personal' as const, entry },
                })),
              ];
              return (
                <AnnualCalendarMonth
                  key={month.month}
                  year={year}
                  month={month.month}
                  headingId={`${id}-month-${month.month}`}
                  periods={periods}
                  onDayDragOver={(_, event) => {
                    if (online && dragged.current && event.dataTransfer.types.includes(dragMime)) {
                      event.preventDefault();
                      event.dataTransfer.dropEffect = 'move';
                    }
                  }}
                  onDayDrop={(day, event) => drop(day, event)}
                  renderPeriod={({ period, startOn }) => {
                    const bar = period.value;
                    if (bar.kind === 'personal')
                      return (
                        <a
                          className="wbs-planner-bar wbs-planner-personal"
                          data-planner-kind="personal"
                          href={annualWorkHref(companyId, bar.entry, startOn)}
                          title={`내 일정 · ${bar.entry.title} · ${plannerRangeText(period.range)}`}
                          aria-label={`${month.month}월 내 일정 · ${bar.entry.title} · ${plannerRangeText(period.range)} 같은 업무 상세`}
                          onClick={(event) => {
                            if (!move.confirmChange()) event.preventDefault();
                          }}
                        >
                          <span>내 일정 · {bar.entry.title}</span>
                        </a>
                      );
                    const { entry, kind } = bar;
                    const label =
                      kind === 'baseline' ? '정규 기준' : kind === 'plan' ? '적용 계획' : '실제';
                    return (
                      <button
                        type="button"
                        className={`wbs-planner-bar wbs-planner-${kind}`}
                        data-planner-kind={kind}
                        style={colorStyle(entry.project)}
                        draggable={kind === 'plan' && online}
                        onDragStart={(event) => {
                          if (kind !== 'plan' || !online) {
                            event.preventDefault();
                            return;
                          }
                          dragged.current = entry;
                          event.dataTransfer.clearData();
                          event.dataTransfer.setData(dragMime, `${dragToken}/${entry.item.id}`);
                          event.dataTransfer.effectAllowed = 'move';
                        }}
                        onDragEnd={() => {
                          dragged.current = null;
                        }}
                        onClick={() => select(entry)}
                        title={`${entry.project.code} · ${entry.item.title} · ${label} ${plannerRangeText(period.range)}`}
                        aria-label={`${month.month}월 ${entry.project.code} · ${entry.item.title} · ${label} ${plannerRangeText(period.range)} 상세`}
                      >
                        <span>
                          {label} · {entry.project.code} · {entry.item.title}
                        </span>
                      </button>
                    );
                  }}
                />
              );
            })}
          </div>
          <details className="wbs-planner-index" open>
            <summary>항목별 기간·미정 확인 ({entries.length})</summary>
            <ul>
              {entries.map((entry) => {
                const a = entry.item.actualPeriod;
                const outside =
                  a.effectivePlan.startOn &&
                  a.effectivePlan.endOn &&
                  !months.some((m) => plannerMonthSegment(a.effectivePlan, year, m.month));
                return (
                  <li key={entry.item.id} style={colorStyle(entry.project)}>
                    <button type="button" onClick={() => select(entry)}>
                      {entry.project.code} · {entry.item.title} 상세
                    </button>
                    <button
                      type="button"
                      disabled={!online}
                      onClick={() => move.start(entry.project, entry.item)}
                    >
                      계획 일정 이동: {entry.item.title}
                    </button>
                    {(!a.effectivePlan.startOn || !a.effectivePlan.endOn) && (
                      <p>
                        적용 계획의 양끝 날짜가 없어 이동할 수 없습니다.{' '}
                        <button
                          type="button"
                          onClick={() => onItemOpen(entry.project.id, entry.item.id)}
                        >
                          WBS 상세에서 날짜 명시 편집: {entry.item.title}
                        </button>
                      </p>
                    )}
                    <span>
                      계획 ({a.effectivePlan.source === 'revised' ? '변경' : '원래'}){' '}
                      {plannerRangeText(a.effectivePlan)}
                      {outside ? ' · 선택 연도 밖' : ''}
                    </span>
                    <span>
                      실제 {a.eligibleCount === 0 ? '대상 없음' : plannerRangeText(a.actual)}
                    </span>
                  </li>
                );
              })}
            </ul>
          </details>
          {selectedEntry && shown && (
            <section
              className="wbs-planner-detail"
              ref={detail}
              tabIndex={-1}
              aria-label="플래너 읽기 상세"
            >
              <h3>
                {selectedEntry.project.code} · {selectedEntry.item.title}
              </h3>
              <p className="wbs-planner-text">{selectedEntry.item.description ?? '설명 미등록'}</p>
              <dl>
                <dt>원래 계획</dt>
                <dd>{plannerRangeText(selectedEntry.item.actualPeriod.originalPlan)}</dd>
                <dt>변경 계획</dt>
                <dd>
                  {selectedEntry.item.hasRevisedSchedule
                    ? plannerRangeText({
                        startOn: selectedEntry.item.revisedStartOn,
                        endOn: selectedEntry.item.revisedEndOn,
                      })
                    : '변경 계획 미등록'}
                </dd>
                <dt>
                  적용 계획 (
                  {selectedEntry.item.actualPeriod.effectivePlan.source === 'revised'
                    ? '변경'
                    : '원래'}
                  )
                </dt>
                <dd>{plannerRangeText(selectedEntry.item.actualPeriod.effectivePlan)}</dd>
                <dt>실제 기간</dt>
                <dd>
                  {plannerRangeText(selectedEntry.item.actualPeriod.actual)}
                  {selectedEntry.item.actualPeriod.eligibleCount === 0 ? ' · 실제 대상 없음' : ''}
                </dd>
                <dt>원래 계획 대비 차이</dt>
                <dd>
                  시작 {difference(selectedEntry.item.actualPeriod.difference.original.startDays)} ·
                  종료 {difference(selectedEntry.item.actualPeriod.difference.original.endDays)}
                </dd>
                <dt>적용 계획 대비 차이</dt>
                <dd>
                  시작 {difference(selectedEntry.item.actualPeriod.difference.effective.startDays)}{' '}
                  · 종료 {difference(selectedEntry.item.actualPeriod.difference.effective.endDays)}
                </dd>
                <dt>연결 / 실제 대상</dt>
                <dd>
                  {selectedEntry.item.actualPeriod.linkedCount}건 /{' '}
                  {selectedEntry.item.actualPeriod.eligibleCount}건
                </dd>
                <dt>응답 버전·기준</dt>
                <dd>
                  항목 {selectedEntry.item.version} · 계획{' '}
                  {selectedEntry.item.actualPeriod.planVersion} ·{' '}
                  {new Date(shown.asOf).toISOString()}
                </dd>
              </dl>
              <button
                type="button"
                disabled={!online}
                onClick={() => move.start(selectedEntry.project, selectedEntry.item)}
              >
                계획 일정 이동: {selectedEntry.item.title}
              </button>
              <button
                type="button"
                onClick={() => onItemOpen(selectedEntry.project.id, selectedEntry.item.id)}
              >
                WBS 상세에서 연결 업무·완료 확인
              </button>
              <button
                type="button"
                onClick={() => {
                  setSelected(null);
                  filterControl.current?.focus();
                }}
              >
                플래너 상세 닫기
              </button>
            </section>
          )}
        </>
      )}
    </section>
  );
}
