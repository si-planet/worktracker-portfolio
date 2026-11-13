import { z } from 'zod';
import { workApi } from './work-entry-api';
import {
  zTransferPublicStatus,
  zTransferSourceApproval,
  zTransferStatus,
  zTransferComplete,
  zTransferConfirmEmail,
  type TransferPublicStatus,
} from '../shared/schema/account-transfer';
import {
  zTransferSourceReply,
  zTransferSourceRequest,
} from '../shared/schema/account-transfer-source';
export type TransferConfiguration = { sourceOrigin: string; targetOrigin: string };
/** Same-origin public readiness only. No hardcoded origins or client configuration fallback. */
export const zTransferPublicConfiguration = z
  .strictObject({
    sourceOrigin: z.string().refine((value) => {
      try {
        const u = new URL(value);
        return u.origin === value && (u.protocol === 'https:' || value === 'http://127.0.0.1:4187');
      } catch {
        return false;
      }
    }),
    targetOrigin: z.string().refine((value) => {
      try {
        const u = new URL(value);
        return u.origin === value && u.protocol === 'https:';
      } catch {
        return false;
      }
    }),
  })
  .refine((c) => c.sourceOrigin !== c.targetOrigin);
export function readTransferConfiguration(origin = location.origin) {
  return workApi(
    '/api/auth/account-transfer/configuration',
    zTransferPublicConfiguration.refine(
      (c) => c.sourceOrigin === origin || c.targetOrigin === origin,
    ),
  );
}
function targetSchema(id: string, origin: string) {
  return zTransferPublicStatus.refine(
    (s) =>
      s.transferId === id &&
      s.targetOrigin === origin &&
      Number.isSafeInteger(s.version) &&
      [
        s.expiresAt,
        s.deadlines.sourceInitiationExpiresAt,
        s.deadlines.roundExpiresAt,
        ...(s.deadlines.mailExpiresAt === null ? [] : [s.deadlines.mailExpiresAt]),
      ].every((at) => Number.isSafeInteger(at) && Number.isFinite(new Date(at).getTime())) &&
      (s.phase === 'complete') === (s.receiptId !== null) &&
      s.allowedActions.every((a) =>
        (
          ({
            reserved: ['approve_source'],
            email_pending: ['confirm_email'],
            email_verified: ['set_password'],
            complete: ['observe_receipt'],
            expired: [],
            failed: [],
          }) as Record<string, string[]>
        )[s.phase]!.includes(a),
      ) &&
      new Set(s.allowedActions).size === s.allowedActions.length,
  );
}
export function targetTransferRequest(
  action: 'source-approval' | 'status' | 'confirm-email' | 'complete',
  input: unknown,
  origin: string,
) {
  if (location.origin !== origin) throw new Error('TRANSFER_ORIGIN');
  const schema = {
    'source-approval': zTransferSourceApproval,
    status: zTransferStatus,
    'confirm-email': zTransferConfirmEmail,
    complete: zTransferComplete,
  }[action];
  const body = schema.parse(input);
  return workApi(
    `/api/auth/account-transfer/${action}`,
    targetSchema(body.transferId, origin),
    'POST',
    body,
  );
}
export function approveTransferSource(input: unknown, config: TransferConfiguration) {
  if (location.origin !== config.sourceOrigin) throw new Error('TRANSFER_ORIGIN');
  const body = zTransferSourceRequest.parse(input);
  return workApi(
    '/api/auth/account-transfer/source/approve',
    zTransferSourceReply.refine(
      (v) =>
        v.requestNonce === body.requestNonce &&
        v.transfer.transferId === body.transferId &&
        v.transfer.targetOrigin === config.targetOrigin,
    ),
    'POST',
    body,
  );
}
export function sourceTransferProfile() {
  return workApi('/api/me', z.object({ username: z.string().min(1).max(32) }));
}
export function transferPhase(s: TransferPublicStatus) {
  return {
    reserved: '출처 승인 대기',
    email_pending: '새 목적 이메일 확인 대기',
    email_verified: '새 목적 비밀번호 설정 대기',
    complete: '목적 환경 완료 확인',
    expired: '회차 만료',
    failed: '회차 실패',
  }[s.phase];
}
