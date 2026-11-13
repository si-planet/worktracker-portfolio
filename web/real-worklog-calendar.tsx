import { useRef, useState } from 'react';
import { shiftCalendarDay } from '../shared/day-calendar';
import { getKoreanHoliday } from '../shared/korean-holidays';
import { kstDate } from '../shared/work-entry-rules';
import { displayMonthWeeks, displayWeekLabel, sundayWeekdays } from './calendar-display';
import {
  realReviewMonths,
  realReviewProjection,
  realReviewWeek,
  type RealReviewCalendarView,
  type RealReviewMonth,
} from './real-worklog-calendar-model';
import type { LocalReviewRecord, LocalWorklogReview } from './real-worklog-review-api';
import './real-worklog-calendar.css';

const weekdays = ['월', '화', '수', '목', '금', '토', '일'];
export const originalCell = (value: string | number | boolean | null | undefined) =>
  value === null ? '— (빈 셀)' : value === undefined ? '— (셀 없음)' : String(value);

export function ReviewSourceDetail({ row }: { row: LocalReviewRecord }) {
  return (
    <details className="real-review-provenance">
      <summary>
        {row.sourceTab} · {row.sourceTitleCell} · 출처와 날짜 근거
      </summary>
      <dl>
        <dt>원문 식별자</dt>
        <dd>{row.sourceRecordId}</dd>
        <dt>원문 행 · 셀</dt>
        <dd>
          {row.sourceRow}행 · {row.sourceCells.join(', ')}
        </dd>
        <dt>원문 구분 표시</dt>
        <dd className="real-review-text">{row.categoryDisplayValue}</dd>
        <dt>프로젝트 문맥 원문</dt>
        <dd className="real-review-text">{row.normalized.projectContextOriginal}</dd>
        <dt>원문 날짜 머리글</dt>
        <dd>{originalCell(row.originalDayHeader)}</dd>
        <dt>명시된 날짜 · 주 시작</dt>
        <dd>
          {row.activityDate ?? '없음'} · {row.explicitWeekStart ?? '없음'}
        </dd>
        <dt>날짜 근거 · 원문 요일 칸</dt>
        <dd>
          {row.dateBasis} · {row.weekdaySlot ?? '없음'}
        </dd>
        <dt>미확정 날짜 후보 · 주 시작 후보</dt>
        <dd>
          {row.candidateActivityDate ?? '없음'} · {row.candidateWeekStart ?? '없음'}
        </dd>
        <dt>기한 원문 · 해석 후보</dt>
        <dd>
          {originalCell(row.fields.due)} · {row.dueDateParsed ?? '검토 필요'}
        </dd>
        <dt>원문 체크 · 해석 표시</dt>
        <dd className="real-review-text">
          {originalCell(row.fields.completion)} · {row.normalized.sourceStatusLabel}
        </dd>
        <dt>검토 코드</dt>
        <dd>{row.issueCodes.join(', ') || '없음'}</dd>
        <dt>업무 상태 · 프로젝트 연결</dt>
        <dd>미정 · 연결하지 않음 · DB 미반영</dd>
        <dt>원문 지문</dt>
        <dd>{row.sourceFileSha256}</dd>
      </dl>
    </details>
  );
}

function SourceMark({ row }: { row: LocalReviewRecord }) {
  const label = { checked: '체크 있음', unchecked: '체크 해제', blank: '체크 빈 셀' }[
    row.sourceCompletionState
  ];
  return <span className="real-calendar-source-mark">원문 {label} · 상태 미정</span>;
}

export function ReviewRecordCards({
  records,
  value,
}: {
  records: LocalReviewRecord[];
  value: LocalWorklogReview;
}) {
  const overlaps = new Set(value.overlapGroups.flatMap((group) => group.recordIds));
  if (!records.length)
    return <p className="real-calendar-empty">이 영역에 배치할 원문이 없습니다.</p>;
  return (
    <ul className="real-calendar-record-list">
      {records.map((row) => (
        <li className="real-calendar-record" key={row.sourceRecordId}>
          <div className="real-calendar-record-heading">
            <span className="real-calendar-source-number">원문 {row.fields.number}</span>
            <SourceMark row={row} />
            {overlaps.has(row.sourceRecordId) && (
              <span className="real-calendar-overlap">겹침 후보 · 별도 보존</span>
            )}
          </div>
          <strong className="real-review-text">{row.fields.title}</strong>
          <dl className="real-calendar-record-fields">
            <div>
              <dt>구분</dt>
              <dd className="real-review-text">{originalCell(row.fields.category)}</dd>
            </div>
            <div>
              <dt>우선순위</dt>
              <dd className="real-review-text">{originalCell(row.fields.priority)}</dd>
            </div>
            <div>
              <dt>비고</dt>
              <dd className="real-review-text">{originalCell(row.fields.remarks)}</dd>
            </div>
          </dl>
          <ReviewSourceDetail row={row} />
        </li>
      ))}
    </ul>
  );
}

function DayHeader({
  date,
  count,
  selected,
  outside = false,
  onSelect,
}: {
  date: string;
  count: number;
  selected: boolean;
  outside?: boolean;
  onSelect: () => void;
}) {
  const holiday = getKoreanHoliday(date);
  return (
    <button
      type="button"
      className="real-calendar-date"
      aria-pressed={selected}
      onClick={onSelect}
      aria-label={`${date} · ${outside ? '인접 월로 이동하여 조회' : `원문 ${count}행 · 선택일 상세 보기`}`}
    >
      <time dateTime={date}>{Number(date.slice(8))}</time>
      <span className="real-calendar-day-count">{outside ? '' : count ? `${count}행` : '-'}</span>
      {holiday.name && <span className="real-calendar-holiday">{holiday.name}</span>}
    </button>
  );
}

export function RealWorklogCalendar({
  value,
  month,
  selectedDate,
  view,
  onMonthChange,
  onDateChange,
}: {
  value: LocalWorklogReview;
  month: RealReviewMonth;
  selectedDate: string | null;
  view: RealReviewCalendarView;
  onMonthChange: (month: RealReviewMonth) => void;
  onDateChange: (date: string) => void;
}) {
  const [showWeekends, setShowWeekends] = useState(false);
  const summaryTitle = useRef<HTMLHeadingElement>(null);
  const projection = realReviewProjection(value, month);
  const selected = selectedDate ?? projection.monthDates[0] ?? projection.calendar.firstDate;
  const week = realReviewWeek(selected);
  const monthIndex = realReviewMonths.indexOf(month);
  const previousWeek = shiftCalendarDay(week.weekStart, -7);
  const nextWeek = shiftCalendarDay(week.weekStart, 7);
  const canPreviousWeek = shiftCalendarDay(previousWeek, 6) >= `${realReviewMonths[0]}-01`;
  const canNextWeek = nextWeek <= '2026-10-31';
  const selectDate = (date: string) => {
    if (date < '2026-08-01' || date > '2026-10-31') return;
    onDateChange(date);
  };
  const moveWeek = (date: string) => selectDate(date < '2026-08-01' ? '2026-08-01' : date);
  const monthWeeks = displayMonthWeeks(month);
  const today = kstDate(Date.now());
  const todayAvailable = today >= '2026-08-01' && today <= '2026-10-31';
  const selectedRows = projection.days.get(selected) ?? [];
  const summaryRows = projection.summaries.get(week.weekStart) ?? [];

  function renderDay(
    day: { date: string; weekday: number; isWeekend: boolean } | null,
    index: number,
  ) {
    if (!day)
      return <div className="real-calendar-padding" aria-hidden="true" key={`empty-${index}`} />;
    const outsideMonth = view === 'month' && !day.date.startsWith(month);
    const rows = outsideMonth ? [] : (projection.days.get(day.date) ?? []);
    const holiday = getKoreanHoliday(day.date);
    const visible = view === 'month' ? rows.slice(0, 2) : rows;
    const available = day.date >= '2026-08-01' && day.date <= '2026-10-31';
    return (
      <article
        className={`real-calendar-cell${selected === day.date ? ' is-selected' : ''}${day.isWeekend ? ' is-weekend' : ''}${holiday.name ? ' is-holiday' : ''}${!available || outsideMonth ? ' is-outside' : ''}`}
        key={day.date}
        aria-label={`${day.date} ${weekdays[day.weekday - 1]}요일`}
      >
        {view === 'week' && (
          <span className="real-calendar-week-date">
            {Number(day.date.slice(5, 7))}월 {weekdays[day.weekday - 1]}요일
          </span>
        )}
        {available ? (
          <DayHeader
            date={day.date}
            count={rows.length}
            selected={selected === day.date}
            outside={outsideMonth}
            onSelect={() => selectDate(day.date)}
          />
        ) : (
          <time dateTime={day.date}>{Number(day.date.slice(8))} · 검토 범위 밖</time>
        )}
        <ul className="real-calendar-cell-records">
          {visible.map((row) => (
            <li key={row.sourceRecordId}>
              <button
                type="button"
                className="real-calendar-preview"
                title={`${row.fields.title} · ${row.sourceTitleCell} · 상태 미정`}
                onClick={() => selectDate(day.date)}
              >
                <span className="real-review-text">{row.fields.title}</span>
                <small>{row.sourceTitleCell} · 상태 미정</small>
              </button>
            </li>
          ))}
        </ul>
        {rows.length > visible.length && (
          <button className="real-calendar-more" type="button" onClick={() => selectDate(day.date)}>
            +{rows.length - visible.length}행 · 상세 보기
          </button>
        )}
      </article>
    );
  }

  return (
    <section
      className={`real-calendar real-calendar-${view}`}
      aria-label={view === 'month' ? '실제 원문 월간 달력' : '실제 원문 주간 달력'}
    >
      <div className="real-calendar-period">
        <div
          className="real-calendar-period-actions"
          role="group"
          aria-label={view === 'month' ? '검토 월 이동' : '검토 주 이동'}
        >
          <button
            type="button"
            disabled={view === 'month' ? monthIndex === 0 : !canPreviousWeek}
            onClick={() =>
              view === 'month'
                ? onMonthChange(realReviewMonths[monthIndex - 1]!)
                : moveWeek(previousWeek)
            }
            aria-label={view === 'month' ? '이전 월' : '이전 주'}
          >
            ‹
          </button>
          <h2 aria-live="polite">
            {view === 'month'
              ? `${month.slice(0, 4)}년 ${Number(month.slice(5))}월`
              : displayWeekLabel(selected)}
          </h2>
          <button
            type="button"
            disabled={view === 'month' ? monthIndex === realReviewMonths.length - 1 : !canNextWeek}
            onClick={() =>
              view === 'month'
                ? onMonthChange(realReviewMonths[monthIndex + 1]!)
                : moveWeek(nextWeek)
            }
            aria-label={view === 'month' ? '다음 월' : '다음 주'}
          >
            ›
          </button>
          <button
            type="button"
            disabled={!todayAvailable}
            onClick={() => selectDate(today)}
            title={todayAvailable ? '오늘 날짜 선택' : '오늘은 원문 검토 범위 밖입니다.'}
          >
            오늘
          </button>
        </div>
        <p>
          {view === 'month' ? '일요일 시작' : `${week.weekStart} ~ ${week.weekEnd} · 월요일 시작`} ·
          한국 시간 · 날짜 머리글이 명시된 일간 원문
        </p>
      </div>
      {projection.monthDaily.length === 0 && (
        <p className="real-calendar-date-notice" role="status">
          {Number(month.slice(5))}월 날짜가 명시된 일간 원문은 없습니다. 이 달 시트의 원문{' '}
          {projection.sourceMonthRecords.length}행은 주간 총괄·날짜 검토 목록에서 확인할 수
          있습니다.
        </p>
      )}
      <div
        className={view === 'month' ? 'real-calendar-scroll' : 'real-calendar-week-board'}
        role="region"
        aria-label={
          view === 'month'
            ? '일요일부터 토요일까지 7열 월간 달력 · 좌우로 이동'
            : '주간 원문 카드 · 총괄과 날짜별 원문'
        }
        tabIndex={view === 'month' ? 0 : undefined}
      >
        {view === 'month' ? (
          <table className="real-calendar-table">
            <caption>
              {month} 일요일 시작 원문 달력. 날짜를 선택하면 아래에서 원문 전체와 출처를 확인할 수
              있습니다.
            </caption>
            <thead>
              <tr>
                {sundayWeekdays.map((day, index) => (
                  <th
                    key={day}
                    scope="col"
                    className={index === 0 || index === 6 ? 'is-weekend' : ''}
                  >
                    {day}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {monthWeeks.map((days, row) => (
                <tr key={row}>
                  {days.map((day, column) => (
                    <td key={day?.date ?? column}>{renderDay(day, row * 7 + column)}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <>
            <div className="real-calendar-week-toolbar">
              <button
                type="button"
                aria-pressed={showWeekends}
                onClick={() => setShowWeekends((value) => !value)}
              >
                {showWeekends ? '주말 숨기기' : '주말 보기'}
              </button>
              <p>
                주말 카드는 기본 숨김입니다. 숨겨도 원문은 보존되며 선택일 상세에서 확인할 수
                있습니다.
              </p>
            </div>
            <div className="real-calendar-week-cards">
              <a
                className="real-calendar-summary-card"
                href="#real-calendar-summary-title"
                onClick={() => requestAnimationFrame(() => summaryTitle.current?.focus())}
              >
                <span className="real-calendar-eyebrow">주간 총괄 원문</span>
                <h3>{week.weekStart} 시작 주</h3>
                <p>원문 {summaryRows.length}행 · 일간 원문과 별도 보존</p>
                <span>총괄 전체 원문과 출처 보기 ↗</span>
              </a>
              {week.days.filter((day) => showWeekends || !day.isWeekend).map(renderDay)}
            </div>
          </>
        )}
      </div>
      <p className="real-calendar-legend">
        날짜를 선택하면 원문 전체와 출처를 아래에서 확인할 수 있습니다. 원문이 없는 칸은 업무
        없음·미완료를 뜻하지 않습니다.
        {view === 'month' && ' 좁은 화면에서는 달력 안을 좌우로 이동하세요.'}
      </p>
      <section className="real-calendar-focus" aria-labelledby="real-calendar-focus-title">
        <div className="real-calendar-focus-heading">
          <div>
            <span className="real-calendar-eyebrow">선택일 원문</span>
            <h3 id="real-calendar-focus-title">
              {selected} <span>{selectedRows.length}행</span>
            </h3>
          </div>
          <div role="group" aria-label="선택일 이동" className="real-calendar-period-actions">
            <button
              type="button"
              disabled={selected <= '2026-08-01'}
              onClick={() => selectDate(shiftCalendarDay(selected, -1))}
              aria-label="이전 날짜"
            >
              ‹
            </button>
            <span>하루 이동</span>
            <button
              type="button"
              disabled={selected >= '2026-10-31'}
              onClick={() => selectDate(shiftCalendarDay(selected, 1))}
              aria-label="다음 날짜"
            >
              ›
            </button>
          </div>
        </div>
        <ReviewRecordCards records={selectedRows} value={value} />
      </section>
      <section className="real-calendar-summary" aria-labelledby="real-calendar-summary-title">
        <div className="real-calendar-focus-heading">
          <div>
            <span className="real-calendar-eyebrow">주간 총괄 원문 · 별도 목록</span>
            <h3
              id="real-calendar-summary-title"
              ref={summaryTitle}
              tabIndex={view === 'week' ? -1 : undefined}
            >
              {week.weekStart} 시작 주 <span>{summaryRows.length}행</span>
            </h3>
          </div>
        </div>
        <p className="real-calendar-legend">
          원문에 명시된 주 시작 날짜로만 연결했습니다. 일간 기록과 별도로 보존하며 날짜 칸이나 완료
          집계로 바꾸지 않습니다.
        </p>
        <ReviewRecordCards records={summaryRows} value={value} />
      </section>
      <details className="real-review-unresolved real-calendar-unresolved">
        <summary>
          {Number(month.slice(5))}월 시트 · 날짜 검토 필요 {projection.unresolved.length}행
        </summary>
        <p>
          날짜 후보만 있는 일간 원문과 주 시작이 비어 있는 총괄 원문입니다. 후보 날짜·빈 날짜를
          달력에 배치하지 않았습니다.
        </p>
        <ReviewRecordCards records={projection.unresolved} value={value} />
      </details>
    </section>
  );
}
