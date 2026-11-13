import { z } from 'zod';
import { zWorkEntryDate, zWorkEntryEpoch, zWorkEntryId, zWorkEntryVersion } from './work-entry';
export const zPeriodDocumentKind = z.enum(['weekly_report', 'weekly_note', 'daily_note']);
export type PeriodDocumentKind = z.output<typeof zPeriodDocumentKind>;
export const zPeriodDocumentScope = z
  .strictObject({
    companyId: zWorkEntryId,
    kind: zPeriodDocumentKind,
    periodStart: zWorkEntryDate,
  })
  .refine(
    (v) => v.kind === 'daily_note' || new Date(`${v.periodStart}T00:00:00Z`).getUTCDay() === 1,
    '주간 문서는 월요일 날짜를 사용하세요.',
  );
export type PeriodDocumentScope = z.output<typeof zPeriodDocumentScope>;
export const zPeriodDocumentPut = z.strictObject({
  body: z.string().max(5000),
  version: zWorkEntryVersion.nullable(),
});
export const zPeriodDocumentConfirm = z.strictObject({
  version: zWorkEntryVersion,
  commandId: zWorkEntryId,
});
const actor = z.string().min(1).max(128);
export const zPeriodDocument = z
  .strictObject({
    ...zPeriodDocumentScope.shape,
    body: z.string().max(5000),
    version: zWorkEntryVersion,
    createdAt: zWorkEntryEpoch,
    updatedAt: zWorkEntryEpoch,
    updatedBy: actor,
    confirmedAt: zWorkEntryEpoch.nullable(),
    confirmedBy: actor.nullable(),
    confirmationId: zWorkEntryId.nullable(),
  })
  .refine(
    (v) =>
      zPeriodDocumentScope.safeParse({
        companyId: v.companyId,
        kind: v.kind,
        periodStart: v.periodStart,
      }).success &&
      ((v.confirmedAt === null && v.confirmedBy === null && v.confirmationId === null) ||
        (v.kind === 'weekly_report' &&
          v.confirmedAt !== null &&
          v.confirmedBy !== null &&
          v.confirmationId !== null &&
          v.body.trim().length > 0)),
  );
export const zPeriodDocumentResult = z
  .strictObject({ ...zPeriodDocumentScope.shape, document: zPeriodDocument.nullable() })
  .refine(
    (v) =>
      zPeriodDocumentScope.safeParse({
        companyId: v.companyId,
        kind: v.kind,
        periodStart: v.periodStart,
      }).success &&
      (v.document === null ||
        (v.document.companyId === v.companyId &&
          v.document.kind === v.kind &&
          v.document.periodStart === v.periodStart)),
  );
export type PeriodDocument = z.output<typeof zPeriodDocument>;
export type PeriodDocumentResult = z.output<typeof zPeriodDocumentResult>;
export function assertPeriodDocumentBodyBytes(input: unknown) {
  if (new TextEncoder().encode(JSON.stringify(input)).byteLength > 8192)
    throw new RangeError('PERIOD_DOCUMENT_TOO_LARGE');
}
export function periodDocumentPath(scope: PeriodDocumentScope) {
  const s = zPeriodDocumentScope.parse(scope);
  return `/api/companies/${s.companyId}/period-documents/${s.kind}/${s.periodStart}`;
}
