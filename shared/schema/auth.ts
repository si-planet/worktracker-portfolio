import { z } from 'zod';

// Credentials are normalized only where the adopted contract permits it.
export const zUsername = z
  .string()
  .transform((value) => value.replace(/[A-Z]/g, (character) => character.toLowerCase()))
  .pipe(z.string().regex(/^[a-z0-9_.-]{3,32}$/, '아이디는 영문 소문자·숫자·_ . -로 3~32자입니다.'));
export const zPassword = z
  .string()
  .min(12, '비밀번호는 12자 이상입니다.')
  .max(128, '비밀번호는 128자 이하입니다.');
export const zEmail = z
  .string()
  .trim()
  .toLowerCase()
  .pipe(z.email('이메일 주소를 확인해 주세요.').max(254));
export const zSignUp = z.strictObject({
  username: zUsername,
  email: zEmail,
  password: zPassword,
  bootstrapKey: z
    .string()
    .regex(/^[a-f0-9]{64}$/, '최초 설정 키를 확인해 주세요.')
    .optional(),
});
export const zSignIn = z.strictObject({ username: zUsername, password: zPassword });
export const zResendVerification = z.strictObject({ email: zEmail });
export const zSignOut = z.strictObject({});
export const zRequestPasswordReset = z.strictObject({ username: zUsername, email: zEmail });
export const zResetPassword = z.strictObject({
  token: z.string().regex(/^[a-f0-9]{64}$/, '비밀번호 재설정 링크를 확인해 주세요.'),
  newPassword: zPassword,
});

export type SignUpInput = z.infer<typeof zSignUp>;
export type SignInInput = z.infer<typeof zSignIn>;
export type RequestPasswordResetInput = z.infer<typeof zRequestPasswordReset>;
export type ResetPasswordInput = z.infer<typeof zResetPassword>;
