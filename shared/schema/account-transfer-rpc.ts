import { z } from 'zod';
import { zTransferPublicStatus, zTransferReservation } from './account-transfer';
export const accountTransferRpcPolicy = Object.freeze({
  windowMs: 30_000,
  maxBodyBytes: 8192,
  timeoutMs: 10_000,
});
export const accountTransferRpcPaths = Object.freeze({
  reserve_or_resume: '/internal/account-transfer/reserve',
  consume_approval: '/internal/account-transfer/consume',
});
export type AccountTransferRpcOperation = keyof typeof accountTransferRpcPaths;
export const zRpcReserveInput = z.strictObject({
  reservation: zTransferReservation,
  browserAccessDigest: z.string().regex(/^[a-f0-9]{64}$/),
});
export const zRpcConsumeInput = z.strictObject({
  code: z.string().regex(/^[a-f0-9]{64}$/),
  reservation: zTransferReservation,
  browserAccessDigest: z.string().regex(/^[a-f0-9]{64}$/),
});
export const zRpcConsumeOutput = z.strictObject({
  approvalId: z.string().min(1).max(128),
  approvedAt: z.number().int().nonnegative(),
  reservation: zTransferReservation,
});
export const accountTransferRpcSchemas = {
  reserve_or_resume: { input: zRpcReserveInput, output: zTransferPublicStatus },
  consume_approval: { input: zRpcConsumeInput, output: zRpcConsumeOutput },
} as const;
export type AccountTransferRpcInputs = {
  reserve_or_resume: z.infer<typeof zRpcReserveInput>;
  consume_approval: z.infer<typeof zRpcConsumeInput>;
};
export type AccountTransferRpcOutputs = {
  reserve_or_resume: z.infer<typeof zTransferPublicStatus>;
  consume_approval: z.infer<typeof zRpcConsumeOutput>;
};
