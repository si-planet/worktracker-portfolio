import { z } from 'zod';
import {
  zTransferComplete,
  zTransferId,
  zTransferSourceApproval,
  zTransferStatus,
} from './schema/account-transfer';
import { zTransferSourceReply, zTransferSourceRequest } from './schema/account-transfer-source';

const request = zTransferSourceRequest.extend({
  kind: z.literal('worktracker.account-transfer.request.v1'),
});
const reply = zTransferSourceReply.extend({
  kind: z.literal('worktracker.account-transfer.reply.v1'),
});
export interface TransferMessagePort {
  postMessage(message: unknown, targetOrigin: string): void;
}
export interface TransferMessageEvent {
  origin: string;
  source: unknown;
  data: unknown;
}
function exactOrigin(value: string) {
  const u = new URL(value);
  if (
    u.origin !== value ||
    (u.protocol !== 'https:' &&
      !(u.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(u.hostname)))
  )
    throw new Error('TRANSFER_CHANNEL_ORIGIN');
  return value;
}
const random = () =>
  Array.from(crypto.getRandomValues(new Uint8Array(32)), (b) =>
    b.toString(16).padStart(2, '0'),
  ).join('');

/** Target-browser capability lives only in this closure. No URL/storage/network side effects.
 * A source reply is a handoff, never proof that the target committed a password/receipt.
 * Reload requires explicit source authentication again using the same public transfer ID. */
export async function createAccountTransferChannel(options: {
  sourceOrigin: string;
  targetOrigin: string;
  sourceWindow: TransferMessagePort;
  transferId: string;
}) {
  const sourceOrigin = exactOrigin(options.sourceOrigin);
  const targetOrigin = exactOrigin(options.targetOrigin);
  if (sourceOrigin === targetOrigin) throw new Error('TRANSFER_CHANNEL_ORIGIN');
  const transferId = zTransferId.parse(options.transferId);
  let secret: string | null = random();
  const browserAccessDigest = Array.from(
    new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(secret))),
    (b) => b.toString(16).padStart(2, '0'),
  ).join('');
  let requestNonce = random();
  let accepted = false;
  let approvalCode: string | null = null;
  const active = () => {
    if (!secret) throw new Error('TRANSFER_CHANNEL_DISPOSED');
    return secret;
  };
  const requestMessage = () => {
    active();
    return request.parse({
      kind: 'worktracker.account-transfer.request.v1',
      transferId,
      requestNonce,
      browserAccessDigest,
    });
  };
  return {
    transferId,
    postRequest() {
      options.sourceWindow.postMessage(requestMessage(), sourceOrigin);
    },
    requestMessage,
    acceptReply(event: TransferMessageEvent) {
      active();
      if (accepted || event.origin !== sourceOrigin || event.source !== options.sourceWindow)
        return null;
      const parsed = reply.safeParse(event.data);
      if (
        !parsed.success ||
        parsed.data.requestNonce !== requestNonce ||
        parsed.data.transfer.transferId !== transferId ||
        parsed.data.transfer.targetOrigin !== targetOrigin ||
        (parsed.data.transfer.phase === 'reserved') !== (parsed.data.approvalCode !== null)
      )
        return null;
      accepted = true;
      approvalCode = parsed.data.approvalCode;
      // This information must still be confirmed through target status with our memory token.
      return parsed.data.transfer;
    },
    takeSourceApprovalRequest() {
      active();
      if (!approvalCode) return null;
      const body = zTransferSourceApproval.parse({ transferId, approvalCode });
      approvalCode = null;
      return body;
    },
    statusRequest() {
      return zTransferStatus.parse({ transferId, token: active() });
    },
    completeRequest(newPassword: string) {
      return zTransferComplete.parse({ transferId, token: active(), newPassword });
    },
    restartHandshake() {
      active();
      requestNonce = random();
      accepted = false;
      approvalCode = null;
      return requestMessage();
    },
    dispose() {
      secret = null;
      approvalCode = null;
      accepted = false;
    },
    toJSON() {
      return { transferId, disposed: secret === null };
    },
  };
}

/** Source popup accepts only its exact opener and configured target origin. The caller
 * explicitly POSTs approvalRequest() to the same-origin source endpoint with normal cookies.
 * No automatic approval, resend or message listener installation occurs. */
export function createAccountTransferSourceChannel(options: {
  sourceOrigin: string;
  targetOrigin: string;
  opener: TransferMessagePort;
}) {
  const sourceOrigin = exactOrigin(options.sourceOrigin);
  const targetOrigin = exactOrigin(options.targetOrigin);
  if (sourceOrigin === targetOrigin) throw new Error('TRANSFER_CHANNEL_ORIGIN');
  let pending: z.output<typeof request> | null = null;
  let sent = false;
  return {
    acceptRequest(event: TransferMessageEvent) {
      if (pending || event.origin !== targetOrigin || event.source !== options.opener) return false;
      const parsed = request.safeParse(event.data);
      if (!parsed.success) return false;
      pending = parsed.data;
      return true;
    },
    approvalRequest() {
      if (!pending || sent) throw new Error('TRANSFER_CHANNEL_NO_REQUEST');
      const { transferId, requestNonce, browserAccessDigest } = pending;
      return zTransferSourceRequest.parse({ transferId, requestNonce, browserAccessDigest });
    },
    postReply(raw: unknown) {
      if (!pending || sent) throw new Error('TRANSFER_CHANNEL_NO_REQUEST');
      const parsed = zTransferSourceReply.parse(raw);
      if (
        parsed.requestNonce !== pending.requestNonce ||
        parsed.transfer.transferId !== pending.transferId ||
        parsed.transfer.targetOrigin !== targetOrigin ||
        (parsed.transfer.phase === 'reserved') !== (parsed.approvalCode !== null)
      )
        throw new Error('TRANSFER_CHANNEL_BINDING');
      sent = true;
      options.opener.postMessage(
        reply.parse({ ...parsed, kind: 'worktracker.account-transfer.reply.v1' }),
        targetOrigin,
      );
    },
    reset() {
      pending = null;
      sent = false;
    },
    toJSON() {
      return { pending: pending !== null, sent };
    },
  };
}
