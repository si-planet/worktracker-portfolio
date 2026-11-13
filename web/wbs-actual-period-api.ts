import { z } from 'zod';
import { zWorkEntryId, zWorkEntryVersion } from '../shared/schema/work-entry';
import { zWbsActualPeriod } from '../shared/schema/wbs-actual-period';
import { workApi, WorkFailure } from './work-entry-api';

const zScope = z.strictObject({
  companyId: zWorkEntryId,
  projectId: zWorkEntryId,
  planId: zWorkEntryId,
  itemId: zWorkEntryId,
  itemVersion: zWorkEntryVersion,
  planVersion: zWorkEntryVersion,
});
export type WbsActualPeriodScope = z.output<typeof zScope>;

export async function readWbsActualPeriod(scope: WbsActualPeriodScope) {
  const s = zScope.parse(scope);
  const result = await workApi(
    `/api/wbs-items/${s.itemId}/actual-period`,
    zWbsActualPeriod.refine(
      (v) =>
        v.companyId === s.companyId &&
        v.projectId === s.projectId &&
        v.planId === s.planId &&
        v.itemId === s.itemId,
    ),
  );
  if (result.itemVersion !== s.itemVersion || result.planVersion !== s.planVersion)
    throw new WorkFailure(409, 'ACTUAL_PERIOD_CHANGED');
  return result;
}
