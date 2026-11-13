import { z } from 'zod';
import { zPlanReport } from './plan-report';
import { zNote, zNoteParent } from './note';
import { weekCalendar } from '../week-calendar';
import { zWorkEntryId, zWorkEntryDate, zWorkEntryEpoch, zWorkEntryVersion } from './work-entry';
const ids = z.array(zWorkEntryId);
const calendarEpoch = z.number().int().min(-Number.MAX_SAFE_INTEGER).max(Number.MAX_SAFE_INTEGER);
export const zWeeklySummaryGroups = z.strictObject({
  completed: ids,
  incomplete: ids,
  paused: ids,
  canceled: ids,
});
const n = z.number().int().nonnegative();
export const zWeeklySummaryTag = z.strictObject({
  id: zWorkEntryId,
  label: z.string().max(40),
  isCore: z.boolean(),
  total: n,
  counted: n,
  completed: n,
  incomplete: n,
  paused: n,
  canceled: n,
});
const schedule = z.strictObject({
  plannedDate: zWorkEntryDate.nullable(),
  dueDate: zWorkEntryDate.nullable(),
  endDate: zWorkEntryDate.nullable(),
  timeMode: z.enum(['date_only', 'exact']),
  startAt: zWorkEntryEpoch.nullable(),
  endAt: zWorkEntryEpoch.nullable(),
});
export const zWeeklySummaryMovement = z.strictObject({
  changeId: zWorkEntryId,
  sourceEntryId: zWorkEntryId,
  entryVersion: zWorkEntryVersion,
  schemaVersion: z.union([z.literal(1), z.literal(2), z.literal(3)]),
  changedAt: zWorkEntryEpoch,
  reason: z.string().max(5000).nullable(),
  before: schedule,
  after: schedule,
});
export const WEEKLY_SUMMARY_NOTE_LIMITS = {
  notes: 20000,
  noteSectionBytes: 5 * 1024 * 1024,
  responseBytes: 5 * 1024 * 1024,
} as const;
const noteObservation = {
  scope: z.literal('current_notes_created_in_week'),
  asOf: zWorkEntryEpoch,
  from: calendarEpoch,
  toExclusive: calendarEpoch,
};
// Zod strict objects skip __proto__; reject unknown prototype keys before projection.
function prototypeKey(value: unknown): boolean {
  if (value === null || typeof value !== 'object') return false;
  return Object.hasOwn(value, '__proto__') || Object.values(value).some(prototypeKey);
}
export const zWeeklySummaryNotes = z
  .preprocess(
    (value) => (prototypeKey(value) ? null : value),
    z.discriminatedUnion('status', [
      z.strictObject({
        ...noteObservation,
        status: z.literal('available'),
        items: z
          .array(z.strictObject({ note: zNote, parent: zNoteParent }))
          .max(WEEKLY_SUMMARY_NOTE_LIMITS.notes),
      }),
      z.strictObject({
        ...noteObservation,
        status: z.literal('unsupported'),
        reason: z.literal('SCHEMA_NOT_INSTALLED'),
      }),
    ]),
  )
  .superRefine((value, ctx) => {
    const issue = () => ctx.addIssue({ code: 'custom', message: 'INVALID_NOTE_OBSERVATION' });
    if (value.from >= value.toExclusive) issue();
    if (
      new TextEncoder().encode(JSON.stringify(value)).byteLength >
      WEEKLY_SUMMARY_NOTE_LIMITS.noteSectionBytes
    )
      issue();
    if (value.status === 'available') {
      const ids = new Set<string>();
      for (const [index, item] of value.items.entries()) {
        const { note, parent } = item,
          previous = value.items[index - 1]?.note;
        if (
          ids.has(note.id) ||
          note.workEntryId !== parent.id ||
          note.companyId !== parent.companyId ||
          note.createdAt < value.from ||
          note.createdAt >= value.toExclusive ||
          (previous &&
            (previous.createdAt < note.createdAt ||
              (previous.createdAt === note.createdAt && previous.id <= note.id)))
        )
          issue();
        ids.add(note.id);
      }
    }
  });
export type WeeklySummaryNotes = z.output<typeof zWeeklySummaryNotes>;
export const zWeeklySummary = z
  .strictObject({
    notes: zWeeklySummaryNotes.optional(),
    report: zPlanReport,
    groups: zWeeklySummaryGroups,
    tags: z.array(zWeeklySummaryTag),
    movements: z.array(zWeeklySummaryMovement),
    history: z.strictObject({
      coverage: z.enum(['complete', 'partial', 'unknown']),
      scope: z.literal('report_sources'),
      from: calendarEpoch,
      toExclusive: calendarEpoch,
      missingSourceIds: ids,
      legacySourceIds: ids,
    }),
  })
  .superRefine((value, ctx) => {
    if (value.notes === undefined) return;
    const n = value.notes;
    let c: ReturnType<typeof weekCalendar>;
    try {
      c = weekCalendar(value.report.isoYear, value.report.isoWeek);
    } catch {
      ctx.addIssue({ code: 'custom', message: 'INVALID_NOTE_WEEK' });
      return;
    }
    if (
      n.from !== c.startAt ||
      n.toExclusive !== c.endAtExclusive ||
      (n.status === 'available' &&
        n.items.some((item) => item.note.companyId !== value.report.companyId)) ||
      new TextEncoder().encode(JSON.stringify(value)).byteLength >
        WEEKLY_SUMMARY_NOTE_LIMITS.responseBytes
    )
      ctx.addIssue({ code: 'custom', message: 'INVALID_NOTE_SCOPE_OR_LIMIT' });
  });
export type WeeklySummary = z.output<typeof zWeeklySummary>;
export type WeeklySummaryMovement = z.output<typeof zWeeklySummaryMovement>;
