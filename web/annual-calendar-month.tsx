import type { DragEvent, ReactNode } from 'react';
import {
  annualMonthWeeks,
  type AnnualCalendarPeriod,
  type AnnualWeekSegment,
} from './annual-calendar-model';
import { sundayWeekdays } from './calendar-display';

/** A rendering-only month card. Editing and navigation remain with the existing parent. */
export function AnnualCalendarMonth<T>({
  year,
  month,
  headingId,
  periods,
  renderPeriod,
  onDayDragOver,
  onDayDrop,
}: {
  year: number;
  month: number;
  headingId: string;
  periods: readonly AnnualCalendarPeriod<T>[];
  renderPeriod: (segment: AnnualWeekSegment<T>) => ReactNode;
  onDayDragOver?: (date: string, event: DragEvent<HTMLSpanElement>) => void;
  onDayDrop?: (date: string, event: DragEvent<HTMLSpanElement>) => void;
}) {
  const weeks = annualMonthWeeks(year, month, periods);
  return (
    <section className="wbs-planner-month" aria-labelledby={headingId}>
      <h3 id={headingId} tabIndex={-1}>
        {month}월
      </h3>
      <div className="wbs-planner-weekdays" aria-hidden="true">
        {sundayWeekdays.map((day, index) => (
          <span key={day} data-weekend={index === 0 || index === 6 ? 'true' : undefined}>
            {day}
          </span>
        ))}
      </div>
      <div className="wbs-planner-weeks">
        {weeks.map((week, index) => (
          <div className="wbs-planner-week" key={index}>
            <div className="wbs-planner-days">
              {week.days.map((day, column) =>
                day ? (
                  <span
                    key={day.date}
                    className="wbs-planner-day"
                    data-move-date={day.date}
                    data-weekend={day.isWeekend ? 'true' : undefined}
                    aria-label={day.date}
                    onDragOver={(event) => onDayDragOver?.(day.date, event)}
                    onDrop={(event) => onDayDrop?.(day.date, event)}
                  >
                    {Number(day.date.slice(8))}
                  </span>
                ) : (
                  <span
                    key={`empty-${column}`}
                    className="wbs-planner-day wbs-planner-day-empty"
                    aria-hidden="true"
                  />
                ),
              )}
            </div>
            <div className="wbs-planner-tracks">
              {week.segments.map((segment) => (
                <div
                  key={segment.period.key}
                  className="wbs-planner-lane"
                  data-period-key={segment.period.key}
                  data-continues-before={segment.continuesBefore ? 'true' : undefined}
                  data-continues-after={segment.continuesAfter ? 'true' : undefined}
                  style={{
                    gridColumn: `${segment.startColumn} / ${segment.endColumn}`,
                    gridRow: segment.lane + 1,
                  }}
                >
                  {renderPeriod(segment)}
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}
