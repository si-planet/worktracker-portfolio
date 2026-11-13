import { z } from 'zod';
import { zWorkEntryDate, zWorkEntryId, zWorkEntryVersion, type WorkEntryFinal } from './work-entry';

const hash = z.string().regex(/^[0-9a-f]{64}$/);
const dates = z
  .array(zWorkEntryDate)
  .max(366)
  .refine(
    (values) => values.every((value, index) => index === 0 || values[index - 1]! < value),
    '날짜는 중복 없이 오름차순이어야 합니다.',
  );
export const zConfirmedPeriodProjection = z.strictObject({
  entryId: zWorkEntryId,
  entryVersion: zWorkEntryVersion,
  performedDates: dates.refine((values) => values.length > 0),
});
export const zConfirmedPeriodProjectionResult = z
  .strictObject({
    companyId: zWorkEntryId,
    available: z.boolean(),
    items: z.array(zConfirmedPeriodProjection).max(50),
  })
  .refine((value) => new Set(value.items.map((item) => item.entryId)).size === value.items.length);
export type CalendarWorkEntry = WorkEntryFinal & { confirmedPerformedDates?: string[] };

export const zConfirmedRecoveryApply = z
  .strictObject({
    id: zWorkEntryId,
    decisionKey: z.string().min(1).max(150),
    decisionRef: z.string().min(1).max(500),
    sourceSha256: hash,
    sources: z
      .array(
        z.strictObject({
          runId: zWorkEntryId,
          rowId: zWorkEntryId,
          payloadHash: hash,
          sourceRecordId: z.string().min(1).max(500),
        }),
      )
      .min(1)
      .max(20),
    action: z.enum(['completed', 'paused', 'exclude-canceled', 'handoff-canceled']),
    entryKind: z.literal('meeting').optional(),
    targetEntryId: zWorkEntryId.nullable(),
    primarySourceRecordId: z.string().min(1).max(500),
    anchor: z
      .union([
        z.strictObject({
          receiptId: zWorkEntryId,
          runId: zWorkEntryId,
          expectedVersion: zWorkEntryVersion,
          expectedSnapshotHash: hash,
        }),
        z.strictObject({
          kind: z.literal('confirmed'),
          recoveryId: zWorkEntryId,
          recoveryRequestHash: hash,
          expectedVersion: zWorkEntryVersion,
          expectedSnapshotHash: hash,
        }),
      ])
      .nullable(),
    project: z.strictObject({ id: zWorkEntryId, version: zWorkEntryVersion }).nullable(),
    performedDates: dates,
    excludedDates: dates,
    completedOn: zWorkEntryDate.nullable(),
    handedOffOn: zWorkEntryDate.nullable(),
  })
  .superRefine((value, ctx) => {
    const fail = (message: string) => ctx.addIssue({ code: 'custom', message });
    if (new Set(value.sources.map((source) => source.sourceRecordId)).size !== value.sources.length)
      fail('원본을 중복 지정할 수 없습니다.');
    if (!value.sources.some((source) => source.sourceRecordId === value.primarySourceRecordId))
      fail('대표 원본이 지정된 근거에 있어야 합니다.');
    if (value.performedDates.some((date) => value.excludedDates.includes(date)))
      fail('제외일을 수행일로 지정할 수 없습니다.');
    const work = value.action === 'completed' || value.action === 'paused';
    if (work && (!value.targetEntryId || !value.performedDates.length))
      fail('업무 ID와 확인된 수행일이 필요합니다.');
    if (work && !value.anchor && !value.project) fail('새 업무의 프로젝트를 확인하세요.');
    if (
      value.entryKind === 'meeting' &&
      (value.anchor !== null ||
        value.action !== 'completed' ||
        value.performedDates.length !== 1 ||
        value.completedOn !== value.performedDates[0])
    )
      fail('회의 복구는 기존 업무 연결 없이 확인된 하루의 완료 회의만 지원합니다.');
    if (
      !work &&
      (value.targetEntryId ||
        value.anchor ||
        value.project ||
        value.performedDates.length ||
        value.excludedDates.length ||
        value.completedOn)
    )
      fail('제외 판단은 업무를 생성하거나 변경하지 않습니다.');
    if (value.action === 'completed' && value.completedOn !== value.performedDates.at(-1))
      fail('완료일을 마지막 확인 수행일로 지정하세요.');
    if (value.action !== 'completed' && value.completedOn !== null)
      fail('완료하지 않은 판단에는 완료일이 없습니다.');
    if ((value.action === 'handoff-canceled') !== (value.handedOffOn !== null))
      fail('업무 이관 날짜를 확인하세요.');
  });
export type ConfirmedRecoveryApply = z.infer<typeof zConfirmedRecoveryApply>;
