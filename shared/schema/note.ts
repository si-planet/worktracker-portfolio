import { z } from 'zod';
import {
  zWorkEntryId as id,
  zWorkEntryVersion as version,
  zWorkEntryEpoch as epoch,
  zWorkEntryDate,
  zWorkEntryKind,
} from './work-entry';

export const zNoteScope = z.strictObject({ companyId: id, workEntryId: id });
export const zNoteResourceScope = zNoteScope.extend({ noteId: id });
export const zNoteTagIds = z
  .array(id)
  .max(100)
  .refine((ids) => new Set(ids).size === ids.length, 'DUPLICATE_TAG')
  .transform((ids) => [...ids].sort());
export const zNoteBody = z.string().min(1).max(5000);
export const zNoteCreate = z.strictObject({
  id,
  workEntryVersion: version,
  body: zNoteBody,
  tagIds: zNoteTagIds,
});
export const zNotePatch = z
  .strictObject({ version, body: zNoteBody.optional(), tagIds: zNoteTagIds.optional() })
  .refine((v) => v.body !== undefined || v.tagIds !== undefined, 'EMPTY_PATCH');
export const zNoteDelete = z.strictObject({ version });
export const zNoteParent = z.strictObject({
  id,
  companyId: id,
  version,
  title: z.string().min(1).max(200),
  kind: zWorkEntryKind,
  projectId: id.nullable(),
  projectCode: z.string().nullable(),
  plannedDate: zWorkEntryDate.nullable(),
});
export const zNoteTag = z.strictObject({
  id,
  companyId: id.nullable(),
  label: z.string().min(1).max(40),
  isActive: z.boolean(),
  version,
});
export const zNote = z
  .strictObject({
    id,
    companyId: id,
    workEntryId: id,
    body: zNoteBody,
    tagIds: z.array(id).max(100),
    tags: z.array(zNoteTag).max(100),
    createdAt: epoch,
    updatedAt: epoch,
    version,
  })
  .superRefine((v, ctx) => {
    if (
      v.tagIds.length !== v.tags.length ||
      v.tagIds.some((id, i) => id !== v.tags[i]?.id || (i > 0 && v.tagIds[i - 1]! >= id))
    )
      ctx.addIssue({ code: 'custom', message: 'TAG_SET_INVALID' });
    if (v.tags.some((t) => t.companyId !== null && t.companyId !== v.companyId))
      ctx.addIssue({ code: 'custom', message: 'TAG_SCOPE_INVALID' });
  });
const pagination = {
  limit: z.coerce.number().int().min(1).max(200).default(100),
  cursor: z.string().min(1).max(20000).optional(),
};
export const zNoteListQuery = z.strictObject(pagination);
/** year always means note creation year in Asia/Seoul, never the parent's planned date. */
export const zNoteFeedQuery = z.strictObject({
  ...pagination,
  year: z.coerce.number().int().min(1).max(9999).optional(),
  projectId: id.optional(),
  tagIds: zNoteTagIds.default([]),
  keyword: z.string().min(1).max(5000).optional(),
});
export const zNoteListResponse = z.strictObject({
  ...zNoteScope.shape,
  parent: zNoteParent,
  items: z.array(zNote),
  nextCursor: z.string().nullable(),
});
export const zNoteReadResponse = z.strictObject({
  ...zNoteScope.shape,
  parent: zNoteParent,
  note: zNote.nullable(),
});
export const zNoteWriteResponse = z.strictObject({
  ...zNoteScope.shape,
  parent: zNoteParent,
  note: zNote,
});
export const zNoteDeleteResponse = z.strictObject({
  ...zNoteScope.shape,
  id,
  deleted: z.literal(true),
});
export const zNoteFeedResponse = z.strictObject({
  companyId: id,
  items: z.array(z.strictObject({ note: zNote, parent: zNoteParent })),
  nextCursor: z.string().nullable(),
});
export type Note = z.output<typeof zNote>;
export type NoteParent = z.output<typeof zNoteParent>;
export type NoteCreate = z.output<typeof zNoteCreate>;
export type NotePatch = z.output<typeof zNotePatch>;
export type NoteListResponse = z.output<typeof zNoteListResponse>;
export type NoteReadResponse = z.output<typeof zNoteReadResponse>;
export type NoteWriteResponse = z.output<typeof zNoteWriteResponse>;
export type NoteDeleteResponse = z.output<typeof zNoteDeleteResponse>;
export type NoteFeedResponse = z.output<typeof zNoteFeedResponse>;
export type NoteFeedQuery = z.output<typeof zNoteFeedQuery>;
