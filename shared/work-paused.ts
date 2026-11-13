import type { WorkEntryFinal, WorkEntryMerged } from './schema/work-entry';
import { zWorkEntryMerged } from './schema/work-entry';
export class WorkPauseError extends Error {}
export function pauseWorkEntry(entry: WorkEntryFinal): WorkEntryMerged {
  if (entry.kind !== 'task' || !['todo', 'doing'].includes(entry.status))
    throw new WorkPauseError('PAUSE_NOT_AVAILABLE');
  return zWorkEntryMerged.parse({
    ...editable(entry),
    status: 'paused',
    resumeStatus: entry.status,
  });
}
export function resumeWorkEntry(entry: WorkEntryFinal): WorkEntryMerged {
  if (entry.kind !== 'task' || entry.status !== 'paused' || entry.resumeStatus === null)
    throw new WorkPauseError('RESUME_NOT_AVAILABLE');
  return zWorkEntryMerged.parse({
    ...editable(entry),
    status: entry.resumeStatus,
    resumeStatus: null,
  });
}
function editable(entry: WorkEntryFinal) {
  const { id, companyId, createdAt, updatedAt, completedAt, version, ...data } = entry;
  void id;
  void companyId;
  void createdAt;
  void updatedAt;
  void completedAt;
  void version;
  return { ...data, leave: entry.leave ? { type: entry.leave.type } : null };
}
