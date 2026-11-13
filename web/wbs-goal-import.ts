import { useEffect, useRef } from 'react';
import { z } from 'zod';
import { isoWeekForDate, weekCalendar } from '../shared/week-calendar';
import { zWorkEntryDate } from '../shared/schema/work-entry';

/** Navigation is an ISO-week context, never a new work plannedDate. */
export function goalWeekForDate(date: string) {
  const w = isoWeekForDate(zWorkEntryDate.parse(date));
  const calendar = weekCalendar(w.isoYear, w.isoWeek);
  return { isoYear: w.isoYear, isoWeek: w.isoWeek, date: calendar.weekStart };
}
export function inboundKey(userId: string, companyId: string, year: number, week: number) {
  z.uuid().parse(companyId);
  const calendar = weekCalendar(year, week);
  return `wt:wbs-goal-inbound:v1:${encodeURIComponent(userId)}:${companyId}/${calendar.isoYear}/${calendar.isoWeek}`;
}
export function writeInbound<T extends z.ZodType>(key: string, schema: T, value: unknown) {
  const parsed = schema.parse(value);
  const raw = JSON.stringify(parsed);
  sessionStorage.setItem(key, raw);
  if (sessionStorage.getItem(key) !== raw) throw new Error('DRAFT_NOT_SAVED');
  return parsed;
}
export function readInbound<T extends z.ZodType>(key: string, schema: T): z.output<T> | null {
  try {
    const v = schema.safeParse(JSON.parse(sessionStorage.getItem(key) ?? 'null'));
    return v.success ? v.data : null;
  } catch {
    return null;
  }
}
export function forgetInbound(key: string) {
  try {
    sessionStorage.removeItem(key);
  } catch {
    /* Never erase an in-memory draft on storage errors. */
  }
}
/** Use a real modal: initial cancel focus, Escape cancel and restore origin after close. */
export function useGoalImportDialog(open: boolean) {
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    if (!open) return;
    const node = dialog.current;
    const origin = document.activeElement as HTMLElement | null;
    if (node && !node.open) node.showModal();
    node?.querySelector<HTMLButtonElement>('[data-safe-cancel]')?.focus();
    return () => {
      if (node?.open) node.close();
      origin?.focus();
    };
  }, [open]);
  return dialog;
}

import { zWbsGoalDraftSource } from '../shared/schema/wbs-goal-import';
export const zWbsGoalInbound = z
  .strictObject({
    id: z.uuid(),
    companyId: z.uuid(),
    isoYear: z.number().int(),
    isoWeek: z.number().int(),
    source: zWbsGoalDraftSource,
  })
  .refine(
    (v) =>
      v.companyId === v.source.companyId &&
      (() => {
        try {
          weekCalendar(v.isoYear, v.isoWeek);
          return true;
        } catch {
          return false;
        }
      })(),
  );
export type WbsGoalInbound = z.output<typeof zWbsGoalInbound>;
/** Local v1 goals were saved before source became a required response field.
 * This adapter is for session drafts only, never for HTTP DTOs. */
export function loadCompatibleGoalDraft<T extends z.ZodType>(
  key: string,
  schema: T,
): z.output<T> | null {
  try {
    const raw = JSON.parse(sessionStorage.getItem(key) ?? 'null');
    function oldGoal(v: unknown) {
      if (!v || typeof v !== 'object' || Array.isArray(v)) return v;
      const g = v as Record<string, unknown>;
      if (!('source' in g) && 'sourceEntryId' in g && 'sourceDeleted' in g && 'placements' in g)
        return {
          ...g,
          source:
            g.sourceEntryId === null
              ? { type: 'manual' }
              : { type: 'workEntry', entryId: g.sourceEntryId, deleted: g.sourceDeleted },
        };
      return g;
    }
    const adapted =
      raw && typeof raw === 'object' && 'original' in raw
        ? { ...raw, original: oldGoal(raw.original) }
        : oldGoal(raw);
    const parsed = schema.safeParse(adapted);
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}
