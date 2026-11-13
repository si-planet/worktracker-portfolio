import { z } from 'zod';
import { parseWorkListQuery } from './schema/work-query';
import {
  zWorkEntryId,
  zWorkEntryKind,
  zWorkEntryStatusValue,
  type WorkEntryFinal,
} from './schema/work-entry';
import { placementRange } from './week-placement';

export const zSearchFiltersDraft = z.strictObject({
  dateState: z.enum(['all', 'scheduled', 'unscheduled']),
  from: z.string().max(10),
  to: z.string().max(10),
  year: z.string().max(4),
  keyword: z.string().max(100),
  kinds: z.array(zWorkEntryKind).max(100),
  statuses: z.array(zWorkEntryStatusValue).max(100),
  projectIds: z.array(zWorkEntryId).max(100),
  tagIds: z.array(zWorkEntryId).max(100),
  limit: z.number().int().min(1).max(200),
});
export type SearchFilters = z.output<typeof zSearchFiltersDraft>;
export function defaultSearchFilters(): SearchFilters {
  return {
    dateState: 'all',
    from: '',
    to: '',
    year: '',
    keyword: '',
    kinds: [],
    statuses: ['todo', 'doing', 'paused', 'planned', 'done'],
    projectIds: [],
    tagIds: [],
    limit: 50,
  };
}
function parameters(filters: SearchFilters): URLSearchParams {
  const value = zSearchFiltersDraft.parse(filters);
  const params = new URLSearchParams({ dateState: value.dateState, limit: String(value.limit) });
  for (const key of ['from', 'to', 'year', 'keyword'] as const)
    if (value[key] !== '') params.set(key, value[key]);
  for (const key of ['kinds', 'statuses', 'projectIds', 'tagIds'] as const)
    for (const item of [...new Set(value[key])].sort()) params.append(key, item);
  return params;
}
export function searchParameters(filters: SearchFilters): URLSearchParams {
  const params = parameters(filters);
  parseWorkListQuery(params);
  return params;
}
export function parseSearchFilters(params: URLSearchParams): SearchFilters {
  if (params.has('cursor')) throw new RangeError('SEARCH_CURSOR_NOT_BOOKMARKABLE');
  if (!params.size) return defaultSearchFilters();
  const query = parseWorkListQuery(params);
  return {
    dateState: query.dateState,
    from: query.from ?? '',
    to: query.to ?? '',
    year: query.year === undefined ? '' : String(query.year),
    keyword: query.keyword ?? '',
    kinds: query.kinds ?? [],
    statuses: query.statuses ?? [],
    projectIds: query.projectIds ?? [],
    tagIds: query.tagIds ?? [],
    limit: params.has('limit') ? query.limit : 50,
  };
}
const asciiLower = (value: string) => value.replace(/[A-Z]/g, (letter) => letter.toLowerCase());
/** Keep response validation aligned with SQLite literal substring/ASCII-only folding. */
export function searchFiltersMatch(entry: WorkEntryFinal, filters: SearchFilters): boolean {
  if (filters.dateState === 'scheduled' && entry.plannedDate === null) return false;
  if (
    filters.dateState === 'unscheduled' &&
    (entry.plannedDate !== null ||
      entry.kind !== 'task' ||
      !['todo', 'paused', 'canceled'].includes(entry.status))
  )
    return false;
  if (filters.kinds.length && !filters.kinds.includes(entry.kind)) return false;
  if (filters.statuses.length && !filters.statuses.includes(entry.status)) return false;
  if (
    filters.projectIds.length &&
    (entry.projectId === null || !filters.projectIds.includes(entry.projectId))
  )
    return false;
  if (filters.tagIds.length && !filters.tagIds.some((id) => entry.tagIds.includes(id)))
    return false;
  const range = placementRange(entry);
  if ((filters.from || filters.to || filters.year) && !range) return false;
  if (range) {
    if (
      (filters.from && range.lastDate < filters.from) ||
      (filters.to && range.firstDate > filters.to)
    )
      return false;
    if (filters.year) {
      const year = String(Number(filters.year)).padStart(4, '0');
      if (range.lastDate < `${year}-01-01` || range.firstDate > `${year}-12-31`) return false;
    }
  }
  return (
    !filters.keyword ||
    [entry.title, entry.content ?? ''].some((value) =>
      asciiLower(value).includes(asciiLower(filters.keyword)),
    )
  );
}
