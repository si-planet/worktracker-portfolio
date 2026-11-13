import { z } from 'zod';
import { zWorklogRun, type WorklogItem } from '../shared/schema/worklog-import';
import {
  zWorklogSourceItemPage,
  zWorklogSourceItemsQuery,
  zWorklogSourceRunPage,
  zWorklogSourceRunsQuery,
  type WorklogSourceItemPage,
  type WorklogSourceItemsQuery,
  type WorklogSourceRunPage,
} from '../shared/schema/worklog-source';
import { WorkFailure } from './work-entry-api';

export type SourceRun = z.output<typeof zWorklogRun>;
export type SourceKind = WorklogItem['kind'];
export type SourceFilter = { kind: SourceKind | ''; sheetId: string };
export const SOURCE_PAGE_SIZE = 24;
export const sourceLoginUrl = (companyId: string) =>
  `/login?${new URLSearchParams({ returnTo: `/c/${companyId}/worklog-import` })}`;
export function sourceAccessLossStatus(error: unknown): 401 | 403 | null {
  return error instanceof WorkFailure && (error.status === 401 || error.status === 403)
    ? error.status
    : null;
}

const invalid = () => new WorkFailure(0, 'SOURCE_INVALID_RESPONSE');
function unique(ids: string[], seen: readonly string[]) {
  return new Set(ids).size === ids.length && ids.every((id) => !seen.includes(id));
}
function validCursor(cursor: string | null, used: readonly string[]) {
  return cursor === null || (/^[A-Za-z0-9_-]{1,1024}$/.test(cursor) && !used.includes(cursor));
}
async function get<T extends z.ZodType>(path: string, schema: T, signal: AbortSignal) {
  const controller = new AbortController();
  const cancel = () => controller.abort();
  signal.addEventListener('abort', cancel, { once: true });
  if (signal.aborted) controller.abort();
  const timeout = globalThis.setTimeout(cancel, 15_000);
  try {
    const response = await fetch(path, {
      method: 'GET',
      credentials: 'same-origin',
      cache: 'no-store',
      redirect: 'error',
      headers: { Accept: 'application/json' },
      signal: controller.signal,
    });
    if (response.status === 401) throw new WorkFailure(401, 'UNAUTHENTICATED');
    if (!response.ok) throw new WorkFailure(response.status, 'SOURCE_READ_FAILED');
    const parsed = schema.safeParse(await response.json());
    if (!parsed.success) throw invalid();
    if (signal.aborted || controller.signal.aborted)
      throw new DOMException('Aborted', 'AbortError');
    return parsed.data;
  } finally {
    globalThis.clearTimeout(timeout);
    signal.removeEventListener('abort', cancel);
  }
}

export async function readSourceRuns(
  companyId: string,
  signal: AbortSignal,
  cursor?: string,
  seenIds: readonly string[] = [],
  usedCursors: readonly string[] = [],
): Promise<WorklogSourceRunPage> {
  z.uuid().parse(companyId);
  const query = zWorklogSourceRunsQuery.parse({
    limit: SOURCE_PAGE_SIZE,
    ...(cursor ? { cursor } : {}),
  });
  const params = new URLSearchParams({ limit: String(query.limit) });
  if (query.cursor) params.set('cursor', query.cursor);
  const page = await get(
    `/api/companies/${companyId}/worklog-imports?${params}`,
    zWorklogSourceRunPage,
    signal,
  );
  if (
    page.companyId !== companyId ||
    (page.items.length === 0 && page.nextCursor !== null) ||
    page.items.length > query.limit ||
    page.items.some((run) => run.companyId !== companyId) ||
    !unique(
      page.items.map((run) => run.id),
      seenIds,
    ) ||
    !validCursor(page.nextCursor, [...usedCursors, ...(cursor ? [cursor] : [])])
  )
    throw invalid();
  return page;
}

export async function readSourceItems(
  companyId: string,
  expected: SourceRun,
  filter: SourceFilter,
  signal: AbortSignal,
  cursor?: string,
  seenIds: readonly string[] = [],
  usedCursors: readonly string[] = [],
): Promise<WorklogSourceItemPage> {
  z.uuid().parse(companyId);
  const run = zWorklogRun.parse(expected);
  if (run.companyId !== companyId || run.state !== 'validated') throw invalid();
  const query: WorklogSourceItemsQuery = zWorklogSourceItemsQuery.parse({
    version: run.version,
    limit: SOURCE_PAGE_SIZE,
    ...(filter.kind ? { kind: filter.kind } : {}),
    ...(filter.sheetId ? { sheetId: filter.sheetId } : {}),
    ...(cursor ? { cursor } : {}),
  });
  const params = new URLSearchParams({
    version: String(query.version),
    limit: String(query.limit),
  });
  if (query.kind) params.set('kind', query.kind);
  if (query.sheetId) params.set('sheetId', query.sheetId);
  if (query.cursor) params.set('cursor', query.cursor);
  const page = await get(
    `/api/companies/${companyId}/worklog-imports/${run.id}/source-items?${params}`,
    zWorklogSourceItemPage,
    signal,
  );
  if (
    JSON.stringify(page.run) !== JSON.stringify(run) ||
    (page.items.length === 0 && page.nextCursor !== null) ||
    page.query.limit !== query.limit ||
    page.query.kind !== (query.kind ?? null) ||
    page.query.sheetId !== (query.sheetId ?? null) ||
    page.items.length > query.limit ||
    page.items.some(
      (item) =>
        (query.kind && item.kind !== query.kind) ||
        (query.sheetId && (!('sheetId' in item.data) || item.data.sheetId !== query.sheetId)),
    ) ||
    !unique(
      page.items.map((item) => item.id),
      seenIds,
    ) ||
    !validCursor(page.nextCursor, [...usedCursors, ...(cursor ? [cursor] : [])])
  )
    throw invalid();
  return page;
}

export async function readSourceSheets(companyId: string, run: SourceRun, signal: AbortSignal) {
  const sheets: Extract<WorklogItem, { kind: 'sheet' }>[] = [];
  const cursors: string[] = [];
  let cursor: string | undefined;
  do {
    const page = await readSourceItems(
      companyId,
      run,
      { kind: 'sheet', sheetId: '' },
      signal,
      cursor,
      sheets.map((sheet) => sheet.id),
      cursors,
    );
    for (const item of page.items) {
      if (item.kind !== 'sheet') throw invalid();
      sheets.push(item);
    }
    if (sheets.length > run.counts.sheet || (page.nextCursor && !page.items.length))
      throw invalid();
    cursor = page.nextCursor ?? undefined;
    if (cursor) cursors.push(cursor);
  } while (cursor);
  if (sheets.length !== run.counts.sheet) throw invalid();
  return sheets;
}

/** A request must still own this gate before it can expose any response. */
export function createSourceRequestGate() {
  let active: { signal: AbortSignal; controller: AbortController } | null = null;
  return {
    start() {
      if (active) return null;
      const controller = new AbortController();
      active = { signal: controller.signal, controller };
      return active;
    },
    current(request: { signal: AbortSignal }) {
      return active === request && !request.signal.aborted;
    },
    finish(request: { signal: AbortSignal }) {
      if (active !== request || request.signal.aborted) return false;
      active.controller.abort();
      active = null;
      return true;
    },
    cancel() {
      active?.controller.abort();
      active = null;
    },
  };
}
