import { z } from 'zod';
import {
  zNoteCreate,
  zNotePatch,
  zNoteDelete,
  zNoteListResponse,
  zNoteReadResponse,
  zNoteWriteResponse,
  zNoteDeleteResponse,
  zNoteFeedResponse,
  zNoteFeedQuery,
  type Note,
  type NoteParent,
} from '../shared/schema/note';
import { zAdminNoteTag } from '../shared/schema/tags';
import { zWorkEntryDate } from '../shared/schema/work-entry';
import { workApi, WorkFailure } from './work-entry-api';
export type { Note, NoteParent };
export type NoteFilters = { year?: number; projectId?: string; tagIds: string[]; keyword?: string };
const validNote = (n: Note, company: string, work?: string) =>
  n.companyId === company && (!work || n.workEntryId === work) && n.updatedAt >= n.createdAt;
export const noteOrder = (a: Note, b: Note) =>
  b.createdAt - a.createdAt || (a.id < b.id ? 1 : a.id > b.id ? -1 : 0);
function validPage(items: Note[], cursor: string | null, requested?: string) {
  return (
    items.length <= 100 &&
    new Set(items.map((n) => n.id)).size === items.length &&
    items.every((n, i) => i === 0 || noteOrder(items[i - 1]!, n) <= 0) &&
    (cursor === null || (cursor.length > 0 && cursor.length <= 20000 && cursor !== requested))
  );
}
function parentPath(company: string, work: string) {
  return `/api/companies/${z.uuid().parse(company)}/work-entries/${z.uuid().parse(work)}/notes`;
}
function sameParent(p: NoteParent, company: string, work: string) {
  return p.companyId === company && p.id === work;
}
export function assertNoteBody(body: unknown) {
  if (new TextEncoder().encode(JSON.stringify(body)).byteLength > 8192)
    throw new WorkFailure(400, 'VALIDATION_FAILED');
}
export async function readWorkNotes(company: string, work: string, cursor?: string) {
  const params = new URLSearchParams({ limit: '100' });
  if (cursor) params.set('cursor', z.string().min(1).max(20000).parse(cursor));
  return workApi(
    `${parentPath(company, work)}?${params}`,
    zNoteListResponse.refine(
      (v) =>
        v.companyId === company &&
        v.workEntryId === work &&
        sameParent(v.parent, company, work) &&
        v.items.every((n) => validNote(n, company, work)) &&
        validPage(v.items, v.nextCursor, cursor),
    ),
  );
}
export async function readNote(company: string, work: string, id: string) {
  return workApi(
    `${parentPath(company, work)}/${z.uuid().parse(id)}`,
    zNoteReadResponse.refine(
      (v) =>
        v.companyId === company &&
        v.workEntryId === work &&
        sameParent(v.parent, company, work) &&
        (!v.note || (v.note.id === id && validNote(v.note, company, work))),
    ),
  );
}
export async function createNote(
  company: string,
  work: string,
  value: z.input<typeof zNoteCreate>,
) {
  const body = zNoteCreate.parse(value);
  assertNoteBody(body);
  return workApi(
    parentPath(company, work),
    zNoteWriteResponse.refine(
      (v) =>
        v.companyId === company &&
        v.workEntryId === work &&
        sameParent(v.parent, company, work) &&
        v.parent.version === body.workEntryVersion &&
        v.note.id === body.id &&
        v.note.version === 1 &&
        validNote(v.note, company, work) &&
        v.note.body === body.body &&
        v.note.tagIds.join() === body.tagIds.join(),
    ),
    'POST',
    body,
  );
}
export async function patchNote(
  company: string,
  work: string,
  id: string,
  value: z.input<typeof zNotePatch>,
) {
  const body = zNotePatch.parse(value);
  assertNoteBody(body);
  return workApi(
    `${parentPath(company, work)}/${z.uuid().parse(id)}`,
    zNoteWriteResponse.refine(
      (v) =>
        v.companyId === company &&
        v.workEntryId === work &&
        sameParent(v.parent, company, work) &&
        v.note.id === id &&
        v.note.version === body.version + 1 &&
        validNote(v.note, company, work) &&
        (body.body === undefined || v.note.body === body.body) &&
        (body.tagIds === undefined || v.note.tagIds.join() === body.tagIds.join()),
    ),
    'PATCH',
    body,
  );
}
export async function deleteNote(
  company: string,
  work: string,
  id: string,
  value: z.input<typeof zNoteDelete>,
) {
  const body = zNoteDelete.parse(value);
  assertNoteBody(body);
  return workApi(
    `${parentPath(company, work)}/${z.uuid().parse(id)}`,
    zNoteDeleteResponse.refine(
      (v) => v.companyId === company && v.workEntryId === work && v.id === id,
    ),
    'DELETE',
    body,
  );
}
export function readNoteTags(company: string) {
  z.uuid().parse(company);
  return workApi(
    `/api/companies/${company}/note-tags?includeInactive=true`,
    z
      .array(zAdminNoteTag)
      .refine(
        (rows) =>
          rows.every((t) => t.companyId === null || t.companyId === company) &&
          new Set(rows.map((t) => t.id)).size === rows.length,
      ),
  );
}
export function parseNoteFilters(params: URLSearchParams): NoteFilters {
  const allowed = ['year', 'projectId', 'tagIds', 'keyword'];
  if (
    [...params.keys()].some((k) => !allowed.includes(k)) ||
    ['year', 'projectId', 'keyword'].some((k) => params.getAll(k).length > 1)
  )
    throw new Error('INVALID_NOTE_FILTER');
  const year = params.get('year');
  if (year !== null && !/^[0-9]{1,4}$/.test(year)) throw new Error('INVALID_NOTE_YEAR');
  const parsed = zNoteFeedQuery.parse({
    ...(year === null ? {} : { year: Number(year) }),
    ...(params.has('projectId') ? { projectId: params.get('projectId') } : {}),
    tagIds: params.getAll('tagIds'),
    ...(params.has('keyword') ? { keyword: params.get('keyword') } : {}),
  });
  return {
    ...(parsed.year === undefined ? {} : { year: parsed.year }),
    ...(parsed.projectId === undefined ? {} : { projectId: parsed.projectId }),
    tagIds: parsed.tagIds,
    ...(parsed.keyword === undefined ? {} : { keyword: parsed.keyword }),
  };
}
export function noteFilterParams(filters: NoteFilters) {
  const params = new URLSearchParams();
  if (filters.year !== undefined) params.set('year', String(filters.year));
  if (filters.projectId) params.set('projectId', filters.projectId);
  for (const tag of [...filters.tagIds].sort()) params.append('tagIds', tag);
  if (filters.keyword !== undefined) params.set('keyword', filters.keyword);
  parseNoteFilters(params);
  return params;
}
export async function readNoteFeed(company: string, filters: NoteFilters, cursor?: string) {
  z.uuid().parse(company);
  const params = noteFilterParams(filters);
  params.set('limit', '100');
  if (cursor) params.set('cursor', z.string().min(1).max(20000).parse(cursor));
  return workApi(
    `/api/companies/${company}/notes?${params}`,
    zNoteFeedResponse.refine(
      (v) =>
        v.companyId === company &&
        v.items.every(
          ({ note, parent }) =>
            validNote(note, company) && sameParent(parent, company, note.workEntryId),
        ) &&
        validPage(
          v.items.map((v) => v.note),
          v.nextCursor,
          cursor,
        ),
    ),
  );
}
export function noteWorkURL(company: string, parent: NoteParent) {
  if (!z.uuid().safeParse(company).success || !sameParent(parent, company, parent.id)) return '/';
  const params = new URLSearchParams({ entryId: parent.id });
  if (parent.projectId) params.set('projectId', parent.projectId);
  if (parent.plannedDate) {
    params.set('year', String(Number(parent.plannedDate.slice(0, 4))));
    params.set('date', parent.plannedDate);
  }
  return `/c/${company}/${parent.plannedDate ? 'day' : 'unscheduled'}?${params}`;
}
export function noteReturnTo(value: string, company: string) {
  if (
    !z.uuid().safeParse(company).success ||
    !value.startsWith('/') ||
    value.startsWith('//') ||
    value.includes('\\')
  )
    return '/';
  try {
    const u = new URL(value, location.origin);
    if (u.origin !== location.origin || u.hash) return '/';
    if (u.pathname === `/c/${company}/notes`) {
      const p = noteFilterParams(parseNoteFilters(u.searchParams));
      return u.pathname + (p.size ? `?${p}` : '');
    }
    if (!new RegExp(`^/c/${company}/(day|week|unscheduled)$`).test(u.pathname)) return '/';
    const keys = [...u.searchParams.keys()];
    if (
      new Set(keys).size !== keys.length ||
      keys.some((k) => !['year', 'date', 'projectId', 'entryId'].includes(k))
    )
      return '/';
    for (const k of ['projectId', 'entryId'])
      if (u.searchParams.has(k) && !z.uuid().safeParse(u.searchParams.get(k)).success) return '/';
    const y = u.searchParams.get('year'),
      date = u.searchParams.get('date');
    if (y !== null && (!/^[0-9]{1,4}$/.test(y) || Number(y) < 1 || Number(y) > 9999)) return '/';
    if (date !== null && !zWorkEntryDate.safeParse(date).success) return '/';
    if (u.pathname.endsWith('/unscheduled') && (y !== null || date !== null)) return '/';
    return u.pathname + u.search;
  } catch {
    return '/';
  }
}
export function noteLogin(company: string) {
  location.assign(
    `/login?${new URLSearchParams({ returnTo: noteReturnTo(location.pathname + location.search, company) })}`,
  );
}
export function noteFailure(error: unknown) {
  if (error instanceof WorkFailure) {
    if (error.status === 409)
      return '노트 또는 원래 업무 버전이 바뀌었습니다. 초안을 유지하고 현재 기록을 확인해 주세요.';
    if (error.status === 400 || error.status === 422)
      return '본문·태그·버전과 8192바이트 요청 한도를 확인해 주세요.';
    if (error.status === 401) return '로그인이 만료되었습니다. 초안을 보존했습니다.';
    if (error.status === 403)
      return '원래 업무 또는 노트에 접근할 수 없습니다. 내용을 숨기고 초안을 보존했습니다.';
  }
  return '응답을 확인하지 못했습니다. 초안을 유지하고 같은 노트 ID의 현재 기록을 확인해 주세요.';
}
