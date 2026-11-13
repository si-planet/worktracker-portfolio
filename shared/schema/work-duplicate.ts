import { z } from 'zod';
import { zWorkEntryCreate, zWorkEntryVersion, zWorkEntryFinal, zWorkEntryId } from './work-entry';

import { zExpectedLink, zLinkTarget, zLinkSnapshot } from './wbs-work-link';

export const zDuplicateWbsReview = z.strictObject({
  expectedSource: zExpectedLink.nullable(),
  link: z
    .strictObject({ id: zWorkEntryId, projectId: zWorkEntryId, target: zLinkTarget })
    .nullable(),
});
export type DuplicateWbsReview = z.output<typeof zDuplicateWbsReview>;

/** Reviewed new-entry payload, never persisted source audit/history or ownership fields. */
export const zWorkEntryDuplicate = z
  .strictObject({
    sourceVersion: zWorkEntryVersion,
    entry: zWorkEntryCreate,
    wbs: zDuplicateWbsReview.optional(),
  })
  .superRefine(({ entry, wbs }, context) => {
    if (wbs?.link && (entry.kind !== 'task' || entry.projectId !== wbs.link.projectId))
      context.addIssue({
        code: 'custom',
        path: ['wbs'],
        message: '선택한 업무 프로젝트의 WBS만 연결할 수 있습니다.',
      });
    if (entry.status !== (entry.kind === 'task' ? 'todo' : 'planned'))
      context.addIssue({
        code: 'custom',
        path: ['entry', 'status'],
        message: '복제한 새 업무는 초기 상태로 저장하세요.',
      });
    if (entry.plannedDate === null)
      context.addIssue({
        code: 'custom',
        path: ['entry', 'plannedDate'],
        message: '복제한 업무의 새 날짜를 지정하세요.',
      });
  });
export type WorkEntryDuplicate = z.output<typeof zWorkEntryDuplicate>;

/** Default HTTP response retained for already-open clients with a strict v1 parser. */
export const zLegacyWorkEntryDuplicateSnapshot = z
  .strictObject({
    sourceVersion: zWorkEntryVersion,
    entry: zWorkEntryFinal,
  })
  .refine((value) => value.sourceVersion === value.entry.version);

export const zWorkEntryDuplicateSnapshot = z
  .strictObject({
    sourceVersion: zWorkEntryVersion,
    entry: zWorkEntryFinal,
    wbs: zLinkSnapshot,
  })
  .refine(
    (value) =>
      value.sourceVersion === value.entry.version &&
      value.wbs.entryId === value.entry.id &&
      value.wbs.sourceEntryVersion === value.sourceVersion &&
      (!value.wbs.link || value.wbs.link.companyId === value.entry.companyId),
    {
      message: '복제 원본 버전이 일치하지 않습니다.',
    },
  );
export type WorkEntryDuplicateSnapshot = z.output<typeof zWorkEntryDuplicateSnapshot>;
