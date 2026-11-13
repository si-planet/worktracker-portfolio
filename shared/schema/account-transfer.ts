import { z } from 'zod';
import { zEmail, zPassword, zUsername } from './auth';
export const accountTransferPolicy = Object.freeze({
  sourceApprovalMs: 300_000,
  reservationMs: 3_600_000,
  sourceInitiationMs: 900_000,
  emailMs: 3_600_000,
});
export const zTransferId = z.uuid();
const token = z.string().regex(/^[a-f0-9]{64}$/);
export const zTransferIdentity = z.strictObject({
  sourceUserId: z.string().min(1).max(128),
  targetUserId: z.string().min(1).max(128),
  username: zUsername,
  email: zEmail,
  name: z.string().min(1).max(128),
});
export const zTransferReservation = z.strictObject({
  transferId: zTransferId,
  sourceOrigin: z.url(),
  targetOrigin: z.url(),
  targetDatabaseId: z.string().min(1).max(128),
  identity: zTransferIdentity,
});
export const zTransferSourceApproval = z.strictObject({
  transferId: zTransferId,
  approvalCode: token,
});
export const zTransferConfirmEmail = z.strictObject({ transferId: zTransferId, token });
export const zTransferComplete = z.strictObject({
  transferId: zTransferId,
  token,
  newPassword: zPassword,
});
export const zTransferStatus = z.strictObject({ transferId: zTransferId, token });
export const zTransferPublicStatus = z.strictObject({
  transferId: zTransferId,
  phase: z.enum(['reserved', 'email_pending', 'email_verified', 'complete', 'expired', 'failed']),
  version: z.number().int().positive(),
  expiresAt: z.number().int().nonnegative(),
  receiptId: z.uuid().nullable(),
  targetOrigin: z.url(),
  maskedUsername: z.string(),
  maskedEmail: z.string(),
  deadlines: z.strictObject({
    sourceInitiationExpiresAt: z.number().int().nonnegative(),
    mailExpiresAt: z.number().int().nonnegative().nullable(),
    roundExpiresAt: z.number().int().nonnegative(),
  }),
  allowedActions: z.array(
    z.enum(['approve_source', 'confirm_email', 'set_password', 'observe_receipt']),
  ),
});
export type TransferReservation = z.infer<typeof zTransferReservation>;
export type TransferPublicStatus = z.infer<typeof zTransferPublicStatus>;
