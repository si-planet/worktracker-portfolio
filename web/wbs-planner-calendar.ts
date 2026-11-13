import { zWbsYear } from '../shared/schema/wbs';
import { zWorkEntryDate } from '../shared/schema/work-entry';

export type PlannerRange = { startOn: string | null; endOn: string | null };
export type PlannerMonth = {
  month: number;
  startOn: string;
  endOn: string;
  days: number[];
};

/** Calendar arithmetic without Date's special handling of years 0 through 99. */
export function plannerMonths(year: number): PlannerMonth[] {
  zWbsYear.parse(year);
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const lengths = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  return lengths.map((length, index) => {
    const month = index + 1;
    const prefix = `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}`;
    return {
      month,
      startOn: `${prefix}-01`,
      endOn: `${prefix}-${length}`,
      days: Array.from({ length }, (_, day) => day + 1),
    };
  });
}

/** Only complete ranges receive a bar; clipping never changes the original dates. */
export function plannerMonthSegment(range: PlannerRange, year: number, month: number) {
  const target = plannerMonths(year)[month - 1];
  if (!Number.isInteger(month) || !target) throw new Error('INVALID_PLANNER_MONTH');
  if (range.startOn === null || range.endOn === null) return null;
  const start = zWorkEntryDate.parse(range.startOn),
    end = zWorkEntryDate.parse(range.endOn);
  if (start > end) throw new Error('INVALID_PLANNER_RANGE');
  if (start > target.endOn || end < target.startOn) return null;
  return {
    startDay: Number((start < target.startOn ? target.startOn : start).slice(8)),
    endDay: Number((end > target.endOn ? target.endOn : end).slice(8)),
  };
}

export function plannerRangeText(range: PlannerRange) {
  return `${range.startOn ?? '미정'} ~ ${range.endOn ?? '미정'}`;
}
