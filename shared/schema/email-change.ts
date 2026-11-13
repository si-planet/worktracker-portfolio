import { z } from 'zod';
import { zEmail, zPassword } from './auth';

export const zRequestEmailChange = z.strictObject({
  newEmail: zEmail,
  currentPassword: zPassword,
});
export const zConfirmEmailChange = z.strictObject({
  token: z
    .string()
    .max(4096)
    .regex(/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/, '이메일 변경 링크를 확인해 주세요.'),
});
export type RequestEmailChangeInput = z.infer<typeof zRequestEmailChange>;
export type ConfirmEmailChangeInput = z.infer<typeof zConfirmEmailChange>;
