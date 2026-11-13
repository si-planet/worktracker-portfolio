import { z } from 'zod';
import {
  zMonthlyFocusCreate,
  zMonthlyFocusPatch,
  zMonthlyFocusDelete,
  zMonthlyFocusItem,
  zMonthlyFocusList,
  type MonthlyFocusCreate,
  type MonthlyFocusPatch,
  type MonthlyFocusItem,
} from '../shared/schema/monthly-focus';
import { workApi, WorkFailure, workError } from './work-entry-api';
export const focusPath = (company: string, id?: string) =>
  `/api/companies/${company}/monthly-focus-items${id ? `/${id}` : ''}`;
export function focusSchema(company: string, year: number, month: number, id?: string) {
  return zMonthlyFocusItem.refine(
    (v) => v.companyId === company && v.year === year && v.month === month && (!id || v.id === id),
  );
}
export function compareMonthlyFocus(a: MonthlyFocusItem, b: MonthlyFocusItem) {
  return a.sortOrder !== b.sortOrder
    ? a.sortOrder < b.sortOrder
      ? -1
      : 1
    : a.createdAt !== b.createdAt
      ? a.createdAt < b.createdAt
        ? -1
        : 1
      : a.id < b.id
        ? -1
        : a.id > b.id
          ? 1
          : 0;
}
export function readMonthlyFocus(company: string, year: number, month: number) {
  return workApi(
    `${focusPath(company)}?${new URLSearchParams({ year: String(year), month: String(month) })}`,
    zMonthlyFocusList.refine(
      (v) =>
        v.companyId === company &&
        v.year === year &&
        v.month === month &&
        new Set(v.items.map((i) => i.id)).size === v.items.length &&
        v.items.every(
          (i, n) =>
            i.companyId === company &&
            i.year === year &&
            i.month === month &&
            (n === 0 || compareMonthlyFocus(v.items[n - 1]!, i) <= 0),
        ),
    ),
  );
}
export function focusValuesMatch(
  item: MonthlyFocusItem,
  value: { title: string; detail: string | null; sortOrder: number },
) {
  return (
    item.title === value.title && item.detail === value.detail && item.sortOrder === value.sortOrder
  );
}
function checkSize(body: unknown) {
  if (new TextEncoder().encode(JSON.stringify(body)).length > 8192)
    throw new WorkFailure(400, 'FOCUS_BODY_TOO_LARGE');
}
export function createMonthlyFocus(company: string, input: MonthlyFocusCreate) {
  const body = zMonthlyFocusCreate.parse(input);
  checkSize(body);
  return workApi(
    focusPath(company),
    focusSchema(company, body.year, body.month, body.id).refine(
      (v) => v.version === 1 && focusValuesMatch(v, body),
    ),
    'POST',
    body,
  );
}
export function patchMonthlyFocus(
  company: string,
  before: MonthlyFocusItem,
  input: MonthlyFocusPatch,
) {
  const body = zMonthlyFocusPatch.parse(input);
  checkSize(body);
  const expected = {
    title: body.title ?? before.title,
    detail: body.detail === undefined ? before.detail : body.detail,
    sortOrder: body.sortOrder ?? before.sortOrder,
  };
  return workApi(
    focusPath(company, before.id),
    focusSchema(company, before.year, before.month, before.id).refine(
      (v) =>
        v.version === before.version + 1 &&
        v.createdAt === before.createdAt &&
        focusValuesMatch(v, expected),
    ),
    'PATCH',
    body,
  );
}
export function deleteMonthlyFocus(company: string, before: MonthlyFocusItem) {
  const body = zMonthlyFocusDelete.parse({ version: before.version });
  return workApi(
    focusPath(company, before.id),
    z.strictObject({ deleted: z.literal(true), id: z.uuid() }).refine((v) => v.id === before.id),
    'DELETE',
    body,
  );
}
export function monthlyFocusError(value: unknown) {
  if (value instanceof WorkFailure && value.code === 'FOCUS_BODY_TOO_LARGE')
    return '요청 크기는 8192바이트 이하여야 합니다. 제목·메모의 원문은 보관했으니 내용을 줄여 주세요.';
  if (value instanceof WorkFailure && value.status === 409)
    return '같은 ID가 저장되었거나 메모 버전이 바뀌었습니다. 입력과 ID를 유지하고 최신 목록에서 결과를 확인하세요.';
  return workError(value);
}
