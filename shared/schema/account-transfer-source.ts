import { z } from 'zod';
import { zTransferId, zTransferPublicStatus } from './account-transfer';
export const zTransferSourceRequest = z.strictObject({
  transferId: zTransferId,
  requestNonce: z.string().regex(/^[a-f0-9]{64}$/),
  browserAccessDigest: z.string().regex(/^[a-f0-9]{64}$/),
});
export const zTransferSourceReply = z.strictObject({
  requestNonce: z.string().regex(/^[a-f0-9]{64}$/),
  transfer: zTransferPublicStatus,
  approvalCode: z
    .string()
    .regex(/^[a-f0-9]{64}$/)
    .nullable(),
});
export type AccountTransferSourceRequest = z.infer<typeof zTransferSourceRequest>;
export type AccountTransferSourceResponse = z.infer<typeof zTransferSourceReply>;
