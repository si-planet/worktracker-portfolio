import { z } from 'zod';
import { zWorkspaceId, zWorkspaceVersion } from './workspace';

export const zTagKind = z.enum(['work', 'note']);
export type TagKind = z.infer<typeof zTagKind>;
export const zTagScope = z.discriminatedUnion('type', [
  z.strictObject({ type: z.literal('common') }),
  z.strictObject({ type: z.literal('company'), companyId: zWorkspaceId }),
]);
const label = z.string().min(1, '태그 이름을 입력해 주세요.').max(40);
const sortOrder = z.number().int().min(Number.MIN_SAFE_INTEGER).max(Number.MAX_SAFE_INTEGER);
const fields = {
  label,
  scope: zTagScope,
  sortOrder: sortOrder.default(0),
};
export const zNoteTagCreate = z.strictObject(fields);
export const zWorkTagCreate = z.strictObject({ ...fields, isCore: z.boolean().default(false) });
const patch = {
  label: label.optional(),
  sortOrder: sortOrder.optional(),
  isActive: z.boolean().optional(),
  version: zWorkspaceVersion,
};
export const zNoteTagUpdate = z.strictObject(patch);
export const zWorkTagUpdate = z.strictObject({ ...patch, isCore: z.boolean().optional() });
export const zTagDeactivate = z.strictObject({ version: zWorkspaceVersion });
const audit = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
const output = {
  id: zWorkspaceId,
  companyId: zWorkspaceId.nullable(),
  label,
  sortOrder,
  isActive: z.boolean(),
  createdAt: audit,
  updatedAt: audit,
  version: zWorkspaceVersion,
};
export const zAdminNoteTag = z.strictObject(output);
export const zAdminWorkTag = z.strictObject({ ...output, isCore: z.boolean() });
export type AdminNoteTag = z.output<typeof zAdminNoteTag>;
export type AdminWorkTag = z.output<typeof zAdminWorkTag>;
export type AdminTag = AdminNoteTag | AdminWorkTag;
