import { zWeeklySummary, type WeeklySummary } from '../shared/schema/weekly-summary';
import { weekCalendar } from '../shared/week-calendar';
import { workApi } from './work-entry-api';
export type WeeklySummaryData = WeeklySummary;
export function readWeeklySummary(company: string, year: number, week: number) {
  const calendar = weekCalendar(year, week);
  return workApi(
    `/api/companies/${company}/weeks/${year}/${week}/summary`,
    zWeeklySummary.refine((v) => {
      const r = v.report,
        h = v.history;
      if (
        r.companyId !== company ||
        r.isoYear !== year ||
        r.isoWeek !== week ||
        h.from !== calendar.startAt ||
        h.toExclusive !==
          Math.max(calendar.startAt, Math.min(r.asOf + 1, calendar.endAtExclusive)) ||
        !Number.isFinite(new Date(r.asOf).getTime())
      )
        return false;
      const sources = new Map(r.items.map((i) => [i.sourceEntryId, i]));
      if (sources.size !== r.items.length) return false;
      for (const ids of Object.values(v.groups))
        if (new Set(ids).size !== ids.length || ids.some((id) => !sources.has(id))) return false;
      if (
        v.groups.completed.some((id) => sources.get(id)!.status !== 'done') ||
        v.groups.canceled.some((id) => sources.get(id)!.status !== 'canceled') ||
        v.groups.incomplete.some((id) => ['done', 'canceled'].includes(sources.get(id)!.status)) ||
        v.groups.paused.length !== r.items.filter((i) => i.status === 'paused').length ||
        v.groups.paused.some(
          (id) => sources.get(id)!.status !== 'paused' || !v.groups.incomplete.includes(id),
        )
      )
        return false;
      if (
        new Set([...v.groups.completed, ...v.groups.incomplete, ...v.groups.canceled]).size !==
          r.items.length ||
        v.groups.completed.length + v.groups.incomplete.length + v.groups.canceled.length !==
          r.items.length
      )
        return false;
      if (
        new Set(v.tags.map((t) => JSON.stringify([t.id, t.label, t.isCore]))).size !== v.tags.length
      )
        return false;
      if (
        v.tags.some(
          (t) =>
            t.total > r.items.length ||
            t.counted > t.total ||
            t.paused > t.incomplete ||
            t.completed + t.incomplete + t.canceled !== t.total,
        )
      )
        return false;
      for (const ids of [h.missingSourceIds, h.legacySourceIds])
        if (new Set(ids).size !== ids.length || ids.some((id) => !sources.has(id))) return false;
      if (new Set(v.movements.map((m) => m.changeId)).size !== v.movements.length) return false;
      return v.movements.every(
        (m) =>
          sources.has(m.sourceEntryId) &&
          m.changedAt >= h.from &&
          m.changedAt < h.toExclusive &&
          m.changedAt <= r.asOf,
      );
    }),
  );
}
