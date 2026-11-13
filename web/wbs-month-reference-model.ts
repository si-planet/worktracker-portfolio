import type { WbsPlanner } from '../shared/schema/wbs-planner';
import { zWorkEntryId } from '../shared/schema/work-entry';
import { monthCalendar } from '../shared/month-calendar';
import { baselineRange } from './annual-calendar-model';
import { plannerMonthSegment } from './wbs-planner-calendar';

/** A selected calendar month within the selected year's plans; original dates only. */
export function monthlyWbsReference(
  snapshot: WbsPlanner,
  companyId: string,
  month: string,
  projectId = '',
) {
  zWorkEntryId.parse(companyId);
  if (projectId) zWorkEntryId.parse(projectId);
  const calendar = monthCalendar(month),
    year = Number(month.slice(0, 4));
  if (snapshot.companyId !== companyId || snapshot.year !== year)
    throw new Error('INVALID_REFERENCE_SCOPE');
  const rows = snapshot.projects
    .filter((project) => !projectId || project.id === projectId)
    .flatMap((project) =>
      project.plans.flatMap((plan) =>
        plan.items.map((item) => ({ project, item, range: baselineRange(item) })),
      ),
    );
  const uncertain = rows.filter((row) => row.range.startOn === null || row.range.endOn === null);
  const items = rows.filter(
    (row) =>
      row.range.startOn !== null &&
      row.range.endOn !== null &&
      plannerMonthSegment(row.range, year, Number(month.slice(5, 7))) !== null,
  );
  return { companyId, month, year, projectId, asOf: snapshot.asOf, calendar, items, uncertain };
}
export type MonthlyWbsReference = ReturnType<typeof monthlyWbsReference>;
