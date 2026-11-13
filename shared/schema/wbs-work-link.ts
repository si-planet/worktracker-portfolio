import { z } from 'zod';
import {
  zWorkEntryId as id,
  zWorkEntryVersion as version,
  zWorkEntryEpoch as epoch,
  zWorkEntryFinal,
  zWorkEntryDate,
} from './work-entry';
const count = z.number().int().min(0).max(Number.MAX_SAFE_INTEGER);
export const zLinkTarget = z.strictObject({
  itemId: id,
  itemVersion: version,
  planId: id,
  planVersion: version,
});
export const zExpectedLink = z.strictObject({ id, version, itemId: id });
export const zLinkPut = z
  .strictObject({
    linkId: id,
    sourceEntryVersion: version,
    expectedLink: zExpectedLink.nullable(),
    previousTarget: zLinkTarget.nullable(),
    target: zLinkTarget,
  })
  .superRefine((v, c) => {
    if ((v.expectedLink === null) !== (v.previousTarget === null))
      c.addIssue({ code: 'custom', message: 'PREVIOUS_TARGET_REQUIRED' });
    if (
      v.previousTarget?.planId === v.target.planId &&
      v.previousTarget.planVersion !== v.target.planVersion
    )
      c.addIssue({ code: 'custom', message: 'INCONSISTENT_PLAN_VERSION' });
    if (
      v.expectedLink &&
      (v.linkId !== v.expectedLink.id || v.expectedLink.itemId !== v.previousTarget?.itemId)
    )
      c.addIssue({ code: 'custom', message: 'LINK_IDENTITY_MISMATCH' });
  });
export const zLinkDelete = z
  .strictObject({ sourceEntryVersion: version, expectedLink: zExpectedLink, target: zLinkTarget })
  .refine((v) => v.expectedLink.itemId === v.target.itemId);
export const zLink = z.strictObject({
  id,
  companyId: id,
  entryId: id,
  itemId: id,
  version,
  createdAt: epoch,
  updatedAt: epoch,
});
export const zLinkSnapshot = z
  .strictObject({
    entryId: id,
    sourceEntryVersion: version,
    link: zLink.nullable(),
    target: zLinkTarget.nullable(),
  })
  .refine(
    (v) =>
      (v.link === null) === (v.target === null) &&
      (!v.link || (v.link.entryId === v.entryId && v.link.itemId === v.target?.itemId)),
  );
export const zLinkResult = z.strictObject({
  snapshot: zLinkSnapshot,
  affectedTargets: z.array(zLinkTarget),
});
export const zWbsWorkLinkQuery = z.strictObject({
  limit: z.number().int().min(1).max(100).default(50),
  cursor: z.string().min(1).max(8192).optional(),
});
export const zWbsWorkLinkRow = z.strictObject({ entry: zWorkEntryFinal, snapshot: zLinkSnapshot });
export const zWbsWorkLinkList = z
  .strictObject({
    companyId: id,
    projectId: id,
    itemId: id,
    target: zLinkTarget,
    mode: z.enum(['candidates', 'entries']),
    asOf: epoch,
    counts: z.strictObject({
      total: count,
      todo: count,
      doing: count,
      paused: count,
      done: count,
      canceled: count,
      lastCompletedOn: zWorkEntryDate.nullable(),
    }),
    items: z.array(zWbsWorkLinkRow),
    nextCursor: z.string().nullable(),
  })
  .refine(
    (v) =>
      v.target.itemId === v.itemId &&
      v.items.every(
        (r) =>
          r.entry.companyId === v.companyId &&
          r.entry.projectId === v.projectId &&
          r.entry.kind === 'task' &&
          r.snapshot.entryId === r.entry.id &&
          r.snapshot.sourceEntryVersion === r.entry.version &&
          (v.mode !== 'entries' || r.snapshot.link?.itemId === v.itemId),
      ),
  );
export function assertLinkBodyBytes(input: unknown) {
  if (new TextEncoder().encode(JSON.stringify(input)).byteLength > 8192)
    throw new Error('BODY_TOO_LARGE');
}
export type LinkTarget = z.infer<typeof zLinkTarget>;
export type Link = z.infer<typeof zLink>;
export type WbsWorkLinkSnapshot = z.infer<typeof zLinkSnapshot>;
export type WbsWorkLinkResult = z.infer<typeof zLinkResult>;
export type WbsWorkLinkList = z.infer<typeof zWbsWorkLinkList>;
