import { z } from 'zod';
import { zWbsYear } from '../shared/schema/wbs';
import { zWbsPlanner } from '../shared/schema/wbs-planner';
import { workApi } from './work-entry-api';

/** One company/year snapshot. Display filters never become API parameters. */
export async function readWbsPlanner(companyId: string, year: number) {
  const company = z.uuid().parse(companyId);
  const selectedYear = zWbsYear.parse(year);
  return workApi(
    `/api/companies/${company}/planner?year=${selectedYear}`,
    zWbsPlanner.refine((value) => value.companyId === company && value.year === selectedYear),
  );
}
