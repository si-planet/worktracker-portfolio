import { z } from 'zod';
import type { WorkEntryFinal } from '../shared/schema/work-entry';
import { zWorkEntryId } from '../shared/schema/work-entry';
/** Navigation only: this never changes a task's date, project or WBS relation. */
export function workLinkEntryHref(entry: WorkEntryFinal) {
  const query = new URLSearchParams();
  if (entry.plannedDate) {
    query.set('year', entry.plannedDate.slice(0, 4));
    query.set('date', entry.plannedDate);
  }
  if (entry.projectId) query.set('projectId', entry.projectId);
  query.set('entryId', zWorkEntryId.parse(entry.id));
  return `/c/${zWorkEntryId.parse(entry.companyId)}/${entry.plannedDate ? 'day' : 'unscheduled'}?${query}`;
}
export function workLinkItemHref(
  companyId: string,
  projectId: string,
  year: number,
  itemId: string,
) {
  const query = new URLSearchParams({
    year: String(z.number().int().min(1).max(9999).parse(year)),
    projectId: zWorkEntryId.parse(projectId),
    itemId: zWorkEntryId.parse(itemId),
  });
  return `/c/${zWorkEntryId.parse(companyId)}/wbs?${query}`;
}

import {
  zLinkPut,
  zLinkDelete,
  zLinkSnapshot,
  zLinkResult,
  zWbsWorkLinkList,
  assertLinkBodyBytes,
  type WbsWorkLinkSnapshot,
  type LinkTarget,
  type WbsWorkLinkList,
} from '../shared/schema/wbs-work-link';
import { zWbsPlan } from '../shared/schema/wbs';
import { workApi, WorkFailure } from './work-entry-api';
export const zWorkLinkCommand = z.discriminatedUnion('method', [
  z.strictObject({
    method: z.literal('PUT'),
    companyId: zWorkEntryId,
    entryId: zWorkEntryId,
    body: zLinkPut,
  }),
  z.strictObject({
    method: z.literal('DELETE'),
    companyId: zWorkEntryId,
    entryId: zWorkEntryId,
    body: zLinkDelete,
  }),
]);
export type WorkLinkCommand = z.output<typeof zWorkLinkCommand>;
export type { WbsWorkLinkSnapshot, LinkTarget, WbsWorkLinkList };
export function linkSnapshotSchema(companyId: string, entryId: string) {
  return zLinkSnapshot.refine(
    (v) => v.entryId === entryId && (!v.link || v.link.companyId === companyId),
  );
}
async function linkApi<T extends z.ZodType>(
  path: string,
  schema: T,
  method = 'GET',
  body?: unknown,
): Promise<z.output<T>> {
  if (!navigator.onLine) throw new WorkFailure(0, 'OFFLINE');
  const controller = new AbortController(),
    timer = window.setTimeout(() => controller.abort(), 15_000);
  try {
    const response = await fetch(path, {
      method,
      credentials: 'same-origin',
      cache: 'no-store',
      signal: controller.signal,
      ...(body === undefined
        ? {}
        : { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }),
    });
    if (response.status === 401) throw new WorkFailure(401, 'UNAUTHENTICATED');
    if (!response.ok) {
      let code = 'REQUEST_FAILED',
        reason: string | undefined;
      try {
        const text = await response.text();
        if (text.length <= 4096) {
          const v = z
            .strictObject({
              code: z.enum([
                'VALIDATION_FAILED',
                'FORBIDDEN',
                'VERSION_CONFLICT',
                'CONSTRAINT_VIOLATION',
                'WORK_UNAVAILABLE',
              ]),
              message: z.string().max(500),
              traceId: z.uuid(),
              reason: z.string().max(64).optional(),
            })
            .safeParse(JSON.parse(text));
          if (v.success) {
            code = v.data.code;
            if (
              v.data.reason &&
              [
                'SOURCE_CHANGED',
                'TARGET_CHANGED',
                'LINK_CHANGED',
                'LINK_UNCHANGED',
                'LINK_SCOPE',
                'WBS_LINK_REQUIRES_UNLINK',
              ].includes(v.data.reason)
            )
              reason = v.data.reason;
          }
        }
      } catch {
        /* Never expose an arbitrary response. */
      }
      throw new WorkFailure(response.status, code, reason);
    }
    const result = schema.safeParse(await response.json());
    if (!result.success) throw new WorkFailure(0, 'INVALID_RESPONSE');
    return result.data;
  } finally {
    window.clearTimeout(timer);
  }
}

export function readWorkLink(companyId: string, entryId: string) {
  return linkApi(`/api/work-entries/${entryId}/wbs-link`, linkSnapshotSchema(companyId, entryId));
}
export function readWorkLinks(
  companyId: string,
  projectId: string,
  itemId: string,
  mode: 'candidates' | 'entries',
  cursor?: string,
) {
  const q = new URLSearchParams({ limit: '50' });
  if (cursor) q.set('cursor', cursor);
  return linkApi(
    `/api/wbs-items/${itemId}/${mode === 'candidates' ? 'work-candidates' : 'entries'}?${q}`,
    zWbsWorkLinkList.refine(
      (v) =>
        v.companyId === companyId &&
        v.projectId === projectId &&
        v.itemId === itemId &&
        v.mode === mode &&
        new Set(v.items.map((r) => r.entry.id)).size === v.items.length &&
        v.items.every((r) => !r.snapshot.link || r.snapshot.link.companyId === companyId) &&
        v.counts.total ===
          v.counts.todo + v.counts.doing + v.counts.paused + v.counts.done + v.counts.canceled &&
        v.items.length <= 50,
    ),
  );
}
export async function readWorkLinkTarget(companyId: string, t: LinkTarget) {
  const p = await workApi(
    `/api/wbs/${t.planId}`,
    zWbsPlan.refine((p) => p.companyId === companyId && p.id === t.planId),
  );
  const i = p.items.find((i) => i.id === t.itemId);
  if (!i) throw new WorkFailure(0, 'INVALID_RESPONSE');
  return {
    projectId: p.projectId,
    year: p.year,
    title: i.title,
    planId: p.id,
    itemId: i.id,
    itemVersion: i.version,
    planVersion: p.version,
  };
}
export function matchesWorkLink(c: WorkLinkCommand, s: WbsWorkLinkSnapshot) {
  if (s.entryId !== c.entryId) return false;
  if (c.method === 'DELETE') return s.link === null && s.target === null;
  if (s.sourceEntryVersion !== c.body.sourceEntryVersion) return false;
  return (
    s.link?.companyId === c.companyId &&
    s.link.id === c.body.linkId &&
    s.link.itemId === c.body.target.itemId &&
    s.link.version === (c.body.expectedLink ? c.body.expectedLink.version + 1 : 1) &&
    s.target?.itemId === c.body.target.itemId &&
    s.target.itemVersion === c.body.target.itemVersion + 1 &&
    s.target.planId === c.body.target.planId &&
    s.target.planVersion === c.body.target.planVersion + 1
  );
}
function affectedTargetsMatch(c: WorkLinkCommand, result: { affectedTargets: LinkTarget[] }) {
  const targets =
    c.method === 'DELETE'
      ? [c.body.target]
      : [c.body.target, ...(c.body.previousTarget ? [c.body.previousTarget] : [])];
  const unique = [...new Map(targets.map((t) => [t.itemId, t])).values()];
  return (
    result.affectedTargets.length === unique.length &&
    unique.every((t) =>
      result.affectedTargets.some(
        (v) =>
          v.itemId === t.itemId &&
          v.planId === t.planId &&
          v.itemVersion === t.itemVersion + 1 &&
          v.planVersion === t.planVersion + 1,
      ),
    )
  );
}
export function sendWorkLink(input: WorkLinkCommand) {
  const c = zWorkLinkCommand.parse(input);
  assertLinkBodyBytes(c.body);
  return linkApi(
    `/api/work-entries/${c.entryId}/wbs-link`,
    zLinkResult.refine(
      (r) =>
        linkSnapshotSchema(c.companyId, c.entryId).safeParse(r.snapshot).success &&
        matchesWorkLink(c, r.snapshot) &&
        affectedTargetsMatch(c, r) &&
        new Set(r.affectedTargets.map((t) => t.itemId)).size === r.affectedTargets.length,
    ),
    c.method,
    c.body,
  );
}
