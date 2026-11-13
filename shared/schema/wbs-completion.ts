import { z } from 'zod';
import {
  zWorkEntryId as id,
  zWorkEntryVersion as version,
  zWorkEntryEpoch as epoch,
} from './work-entry';
const count = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
export const zWbsCompletionCounts = z
  .strictObject({
    total: count,
    todo: count,
    doing: count,
    paused: count,
    done: count,
    canceled: count,
  })
  .refine((v) => v.total === v.todo + v.doing + v.paused + v.done + v.canceled);
export const zWbsCompletionStateToken = z.string().regex(/^[0-9a-f]{64}$/);
export const zWbsCompletionInput = z.strictObject({
  id,
  version,
  planVersion: version,
  expectedCounts: zWbsCompletionCounts,
  expectedStateToken: zWbsCompletionStateToken,
});
export const zWbsCompletionTuple = z
  .tuple([
    id,
    version,
    id,
    version,
    z.enum(['todo', 'doing', 'paused', 'done', 'canceled']),
    z.enum(['todo', 'doing']).nullable(),
    epoch.nullable(),
  ])
  .refine((v) => (v[4] === 'paused') === (v[5] !== null) && (v[4] === 'done' || v[6] === null));
export const zWbsCompletionEvent = z.strictObject({
  commandId: id,
  completedAt: epoch,
  itemVersion: version,
  planVersion: version,
  countsAtCompletion: zWbsCompletionCounts,
  stateTokenAtCompletion: zWbsCompletionStateToken,
});
export const zWbsCompletionSummary = z.strictObject({
  itemId: id,
  companyId: id,
  planId: id,
  projectId: id,
  itemVersion: version,
  planVersion: version,
  asOf: epoch,
  counts: zWbsCompletionCounts,
  stateToken: zWbsCompletionStateToken,
  completion: zWbsCompletionEvent.nullable(),
});
export const zWbsCompletionResult = z.strictObject({
  itemId: id,
  planId: id,
  itemVersion: version,
  planVersion: version,
  completion: z.strictObject({ commandId: id, completedAt: epoch }),
  countsAtCompletion: zWbsCompletionCounts,
  stateTokenAtCompletion: zWbsCompletionStateToken,
});
export type WbsCompletionCounts = z.output<typeof zWbsCompletionCounts>;
export type WbsCompletionSummary = z.output<typeof zWbsCompletionSummary>;
export function countsForWbsCompletion(raw: string) {
  const tuples = z.array(zWbsCompletionTuple).parse(JSON.parse(raw));
  const v = { total: tuples.length, todo: 0, doing: 0, paused: 0, done: 0, canceled: 0 };
  for (const t of tuples) v[t[4]]++;
  return zWbsCompletionCounts.parse(v);
}
export async function wbsCompletionStateToken(
  context: {
    companyId: string;
    itemId: string;
    planId: string;
    projectId: string;
    itemVersion: number;
    planVersion: number;
  },
  raw: string,
) {
  const data = JSON.stringify([
    'wbs-completion-v1',
    context.companyId,
    context.itemId,
    context.planId,
    context.projectId,
    context.itemVersion,
    context.planVersion,
    raw,
  ]);
  return digest(data);
}
export async function digest(raw: string) {
  return Array.from(
    new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(raw))),
  )
    .map((x) => x.toString(16).padStart(2, '0'))
    .join('');
}
export function assertWbsCompletionBytes(input: unknown) {
  if (new TextEncoder().encode(JSON.stringify(input)).length > 8192)
    throw new Error('BODY_TOO_LARGE');
}
export function observeWbsCompletion(
  scope: { companyId: string; itemId: string },
  input: unknown,
  current: WbsCompletionSummary | null,
) {
  id.parse(scope.companyId);
  id.parse(scope.itemId);
  const d = zWbsCompletionInput.parse(input);
  if (current === null) return 'unavailable' as const;
  const c = zWbsCompletionSummary.parse(current);
  if (c.companyId !== scope.companyId || c.itemId !== scope.itemId) return 'unavailable' as const;
  if (c.completion === null)
    return c.itemVersion === d.version &&
      c.planVersion === d.planVersion &&
      c.stateToken === d.expectedStateToken &&
      JSON.stringify(c.counts) === JSON.stringify(d.expectedCounts)
      ? ('currently-unapplied' as const)
      : ('changed-current' as const);
  const e = c.completion;
  if (e.commandId !== d.id) return 'different-command' as const;
  if (
    e.itemVersion !== d.version + 1 ||
    e.planVersion !== d.planVersion + 1 ||
    e.stateTokenAtCompletion !== d.expectedStateToken ||
    JSON.stringify(e.countsAtCompletion) !== JSON.stringify(d.expectedCounts)
  )
    return 'different-command' as const;
  return c.itemVersion === e.itemVersion && c.planVersion === e.planVersion
    ? ('matching-current' as const)
    : ('later-version' as const);
}
