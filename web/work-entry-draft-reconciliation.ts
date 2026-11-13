import type { WorkEntryFinal } from '../shared/schema/work-entry';

/** A successful command can advance only the unchanged draft it was based on. */
export function reconcileWorkEntryDraft({
  original,
  incoming,
  changed,
  unresolved,
  confirmedSourceVersion,
}: {
  original: Pick<WorkEntryFinal, 'id' | 'companyId' | 'version'> | null;
  incoming: Pick<WorkEntryFinal, 'id' | 'companyId' | 'version'>;
  changed: boolean;
  unresolved: boolean;
  confirmedSourceVersion?: number | undefined;
}): 'ignore' | 'sync' | 'conflict' {
  if (
    !original ||
    original.id !== incoming.id ||
    original.companyId !== incoming.companyId ||
    incoming.version <= original.version
  )
    return 'ignore';
  return !changed &&
    !unresolved &&
    confirmedSourceVersion === original.version &&
    incoming.version === confirmedSourceVersion + 1
    ? 'sync'
    : 'conflict';
}
