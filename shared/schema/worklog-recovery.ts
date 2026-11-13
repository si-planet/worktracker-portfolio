import { z } from 'zod';
import { zWorkEntryFinal, zWorkEntryId, zWorkEntryVersion } from './work-entry';

const command = {
  id: zWorkEntryId,
  receiptId: zWorkEntryId,
  expectedVersion: zWorkEntryVersion,
};
/** One receipt per atomic command; callers retain IDs when retrying a batch. */
export const zWorklogRecovery = z.discriminatedUnion('action', [
  z.strictObject({ ...command, action: z.literal('cancel') }),
  z.strictObject({
    ...command,
    action: z.literal('restore'),
    cancellationId: zWorkEntryId,
  }),
]);
export const zWorklogRecoveryResult = z.strictObject({
  id: zWorkEntryId,
  runId: zWorkEntryId,
  receiptId: zWorkEntryId,
  action: z.enum(['cancel', 'restore']),
  appliedEntry: zWorkEntryFinal,
});
