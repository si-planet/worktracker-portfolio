import { z } from 'zod';
import { zWorkspaceId, zWorkspaceVersion } from './workspace';

export const zCompanyEntityDelete = z.strictObject({ version: zWorkspaceVersion });
export const zCompanyEntityDeleted = z.strictObject({ id: zWorkspaceId, deleted: z.literal(true) });
