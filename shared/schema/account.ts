import { z } from 'zod';

const timestamp = z.number().int().nonnegative().max(8_640_000_000_000_000);
export const zAccountSession = z.object({
  id: z
    .string()
    .min(1)
    .max(128)
    .regex(/^[A-Za-z0-9_-]+$/),
  createdAt: timestamp,
  updatedAt: timestamp,
  expiresAt: timestamp,
  deviceLabel: z.string().min(1).max(80),
  current: z.boolean(),
});
export const zSessionList = z.object({ sessions: z.array(zAccountSession) });
export const zSessionRevocation = z.object({ revoked: z.literal(true), current: z.boolean() });
export type AccountSession = z.infer<typeof zAccountSession>;
export type AccountSessionsResponse = z.infer<typeof zSessionList>;
export type SessionRevocation = z.infer<typeof zSessionRevocation>;
