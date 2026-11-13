import { useEffect, useRef, useState } from 'react';
import type { WorkEntryFinal } from '../shared/schema/work-entry';
import {
  calendarWorkParameters,
  readCalendarWorkPage,
  mergeCalendarEntries,
  assertCalendarCursor,
  type CalendarWorkQuery,
} from './calendar-work-api';
import { WorkFailure, workError } from './work-entry-api';

export function useAnnualWorkCalendar(
  companyId: string,
  query: CalendarWorkQuery,
  refresh: number,
  online: boolean,
  expired: (error: unknown) => boolean,
) {
  const scope = `${companyId}?${calendarWorkParameters(query)}`;
  const [snapshot, setSnapshot] = useState<{
    scope: string;
    entries: WorkEntryFinal[];
    cursor: string | null;
    seen: Set<string>;
  } | null>(null);
  const [loading, setLoading] = useState(false),
    [error, setError] = useState('');
  const current = useRef(snapshot),
    revision = useRef(0),
    locked = useRef(false),
    expiredRef = useRef(expired);
  current.current = snapshot;
  expiredRef.current = expired;
  async function load(more = false) {
    if (locked.current || !online) return;
    const previous = current.current?.scope === scope ? current.current : null;
    if (more && !previous?.cursor) return;
    const ticket = ++revision.current;
    locked.current = true;
    setLoading(true);
    setError('');
    try {
      const result = await readCalendarWorkPage(companyId, query, more ? previous!.cursor : null);
      if (ticket !== revision.current) return;
      const seen = new Set(more ? previous!.seen : []);
      assertCalendarCursor(result.nextCursor, seen);
      if (result.nextCursor) seen.add(result.nextCursor);
      const next = {
        scope,
        entries: mergeCalendarEntries(more ? previous!.entries : [], result.items),
        cursor: result.nextCursor,
        seen,
      };
      current.current = next;
      setSnapshot(next);
    } catch (failure) {
      if (ticket !== revision.current) return;
      if (failure instanceof WorkFailure && [401, 403].includes(failure.status)) {
        current.current = null;
        setSnapshot(null);
        expiredRef.current(failure);
      }
      setError(workError(failure));
    } finally {
      if (ticket === revision.current) {
        locked.current = false;
        setLoading(false);
      }
    }
  }
  useEffect(() => {
    if (!online) setLoading(false);
    void load();
    return () => {
      revision.current++;
      locked.current = false;
    };
  }, [scope, refresh, online]);
  const shown = snapshot?.scope === scope ? snapshot : null;
  return {
    entries: shown?.entries ?? [],
    ready: shown !== null,
    cursor: shown?.cursor ?? null,
    loading,
    error,
    load,
  };
}
