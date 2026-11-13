import { getKoreanHoliday } from '../shared/korean-holidays';
import { dayCalendar, shiftCalendarDay } from '../shared/day-calendar';
import { zWorkEntryDate } from '../shared/schema/work-entry';

function adjacent(date: string, offset: number) {
  try {
    return shiftCalendarDay(date, offset);
  } catch {
    return null;
  }
}
export function DayNavigation({
  date,
  disabled,
  onSelect,
}: {
  date: string;
  disabled: boolean;
  onSelect: (date: string) => void;
}) {
  const calendar = dayCalendar(date);
  const holiday = getKoreanHoliday(date);
  return (
    <section className="daily-navigation" aria-label="일간 날짜 이동">
      <div className="daily-date-heading">
        <button
          type="button"
          aria-label="이전 날"
          disabled={disabled || !adjacent(date, -1)}
          onClick={() => {
            const next = adjacent(date, -1);
            if (next) onSelect(next);
          }}
        >
          ◀
        </button>
        <div>
          <h3 className="control-sr-only">
            {date} · {['월', '화', '수', '목', '금', '토', '일'][calendar.weekday - 1]}요일
          </h3>
          <label className="daily-date-picker">
            <input
              aria-label="조회 날짜"
              type="date"
              value={date}
              disabled={disabled}
              onChange={(event) => {
                if (zWorkEntryDate.safeParse(event.target.value).success)
                  onSelect(event.target.value);
              }}
            />
            <span>{['월', '화', '수', '목', '금', '토', '일'][calendar.weekday - 1]}요일</span>
          </label>
        </div>
        <button
          type="button"
          aria-label="다음 날"
          disabled={disabled || !adjacent(date, 1)}
          onClick={() => {
            const next = adjacent(date, 1);
            if (next) onSelect(next);
          }}
        >
          ▶
        </button>
      </div>
      <div className="daily-navigation-footer">
        <p className="field-hint">
          한국 시간 · {holiday.name ?? (calendar.isWeekend ? '주말' : '평일')}
          {holiday.status === 'unsupported' ? ' · 공휴일 미확인 연도' : ''}
        </p>
      </div>
    </section>
  );
}
