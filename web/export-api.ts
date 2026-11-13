import { z } from 'zod';
import { zWorkspaceCompany, zWorkspaceId } from '../shared/schema/workspace';
import { WorkFailure } from './work-entry-api';
import {
  EXPORT_LIMITS,
  ExportError,
  zExportDatasetV4,
  zExportDatasetV5,
  zExportDatasetV6,
  zExportScopeV6,
  zExportRangeScope,
  zExportScope,
} from '../shared/schema/export-dataset';

const zCurrentUser = z.strictObject({
  userId: z.string().min(1).max(128),
  username: z.string().min(1).max(32),
  email: z.email(),
  emailVerified: z.literal(true),
  lastCompanyId: zWorkspaceId.nullable(),
  capabilities: z.strictObject({ manageSignup: z.boolean() }).optional(),
});

async function boundedJson(
  response: Response,
  maxBytes: number,
  limit?: keyof typeof EXPORT_LIMITS,
): Promise<unknown> {
  const overflow = () =>
    limit
      ? new ExportError('EXPORT_LIMIT_EXCEEDED', limit)
      : new WorkFailure(0, 'INVALID_RESPONSE');
  const announced = response.headers.get('Content-Length');
  if (announced !== null && (!/^\d+$/.test(announced) || Number(announced) > maxBytes)) {
    await response.body?.cancel().catch(() => undefined);
    throw overflow();
  }
  if (!response.body) throw new WorkFailure(0, 'INVALID_RESPONSE');
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let length = 0;
  try {
    for (;;) {
      const next = await reader.read();
      if (next.done) break;
      length += next.value.byteLength;
      if (length > maxBytes) {
        next.value.fill(0);
        throw overflow();
      }
      chunks.push(next.value);
    }
    const bytes = new Uint8Array(length);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.byteLength;
    }
    try {
      return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
    } finally {
      bytes.fill(0);
    }
  } finally {
    for (const chunk of chunks) chunk.fill(0);
    await reader.cancel().catch(() => undefined);
    reader.releaseLock();
  }
}

async function request<T extends z.ZodType>(
  path: string,
  schema: T,
  signal: AbortSignal,
  maxBytes: number,
  body?: unknown,
): Promise<z.output<T>> {
  if (!navigator.onLine) throw new WorkFailure(0, 'OFFLINE');
  const response = await fetch(path, {
    method: body === undefined ? 'GET' : 'POST',
    credentials: 'same-origin',
    cache: 'no-store',
    redirect: 'error',
    signal: AbortSignal.any([signal, AbortSignal.timeout(15_000)]),
    ...(body === undefined
      ? {}
      : {
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        }),
  });
  if (response.status === 401 || response.status === 403) {
    await response.body?.cancel().catch(() => undefined);
    throw new WorkFailure(
      response.status,
      response.status === 401 ? 'UNAUTHENTICATED' : 'FORBIDDEN',
    );
  }
  if (!response.ok) {
    let code = 'REQUEST_FAILED';
    try {
      const raw = await boundedJson(response, 4096);
      if (
        raw &&
        typeof raw === 'object' &&
        'code' in raw &&
        typeof raw.code === 'string' &&
        Object.hasOwn(exportMessages, raw.code)
      )
        code = raw.code;
    } catch {
      // Server text and unknown codes never become user messages or logs.
    }
    throw new WorkFailure(response.status, code);
  }
  if (
    body !== undefined &&
    (!/\bno-store\b/i.test(response.headers.get('Cache-Control') ?? '') ||
      !/\bprivate\b/i.test(response.headers.get('Cache-Control') ?? ''))
  ) {
    await response.body?.cancel().catch(() => undefined);
    throw new WorkFailure(0, 'INVALID_RESPONSE');
  }
  if (!/^application\/json(?:\s*;|$)/i.test(response.headers.get('Content-Type') ?? '')) {
    await response.body?.cancel().catch(() => undefined);
    throw new WorkFailure(0, 'INVALID_RESPONSE');
  }
  const parsed = schema.safeParse(
    await boundedJson(response, maxBytes, body === undefined ? undefined : 'datasetBytes'),
  );
  if (!parsed.success) throw new WorkFailure(0, 'INVALID_RESPONSE');
  return parsed.data;
}

const zExportCompanies = z.preprocess(
  (value) =>
    Array.isArray(value) &&
    value.some(
      (row) =>
        row !== null &&
        typeof row === 'object' &&
        !Array.isArray(row) &&
        Object.keys(row).some((key) => !Object.hasOwn(zWorkspaceCompany.shape, key)),
    )
      ? undefined
      : value,
  zWorkspaceCompany
    .array()
    .refine((rows) => new Set(rows.map((row) => row.id)).size === rows.length),
);

/** The selector lists only the server-authorized companies; it never combines their exports. */
export function readExportCompanies(signal: AbortSignal) {
  return request('/api/companies', zExportCompanies, signal, 256 * 1024);
}

export async function readExportAuthority(companyId: string, userId: string, signal: AbortSignal) {
  const parsedId = zWorkspaceId.safeParse(companyId);
  if (!parsedId.success) throw new WorkFailure(400, 'VALIDATION_FAILED');
  const [profile, company] = await Promise.all([
    request('/api/me', zCurrentUser, signal, 16_384),
    request(
      `/api/companies/${parsedId.data}`,
      zWorkspaceCompany.refine((value) => value.id === parsedId.data),
      signal,
      16_384,
    ),
  ]);
  if (profile.userId !== userId) throw new WorkFailure(401, 'UNAUTHENTICATED');
  return company;
}

export function readExportSnapshot(companyId: string, signal: AbortSignal) {
  const scope = zExportScope.safeParse({
    companyId,
    period: 'all',
    scopeVersion: 1,
  });
  if (!scope.success) throw new ExportError('INVALID_SCOPE');
  return request(
    `/api/companies/${scope.data.companyId}/exports/snapshot`,
    zExportDatasetV4.refine(
      (value) =>
        value.scope.companyId === scope.data.companyId &&
        value.scope.period === scope.data.period &&
        value.scope.scopeVersion === scope.data.scopeVersion &&
        Number.isFinite(new Date(value.snapshotAt).getTime()),
    ),
    signal,
    EXPORT_LIMITS.datasetBytes,
    scope.data,
  );
}

/** A range snapshot is read once, reviewed in memory and never merged with another request. */
export function readExportRangeSnapshot(input: unknown, signal: AbortSignal) {
  const scope = zExportRangeScope.safeParse(input);
  if (!scope.success) throw new ExportError('INVALID_SCOPE');
  return request(
    `/api/companies/${scope.data.companyId}/exports/range-snapshot`,
    zExportDatasetV5.refine(
      (value) =>
        value.scope.companyId === scope.data.companyId &&
        value.scope.period === scope.data.period &&
        value.scope.scopeVersion === scope.data.scopeVersion &&
        value.scope.from === scope.data.from &&
        value.scope.to === scope.data.to &&
        value.scope.dateBasis === scope.data.dateBasis &&
        value.scope.includeUndated === scope.data.includeUndated,
    ),
    signal,
    EXPORT_LIMITS.datasetBytes,
    scope.data,
  );
}

export function readExportSnapshotV6(input: unknown, signal: AbortSignal) {
  const scope = zExportScopeV6.safeParse(input);
  if (!scope.success) throw new ExportError('INVALID_SCOPE');
  return request(
    `/api/companies/${scope.data.companyId}/exports/v6-snapshot`,
    zExportDatasetV6.refine(
      (value) =>
        JSON.stringify(value.base.scope) === JSON.stringify(scope.data) &&
        value.provenance.scope.companyId === scope.data.companyId,
    ),
    signal,
    EXPORT_LIMITS.datasetBytes,
    scope.data,
  );
}

const exportMessages: Record<ExportError['code'], string> = {
  INVALID_SCOPE: '내보낼 회사와 기간 조건을 다시 확인해 주세요.',
  UNSUPPORTED_SCHEMA: '현재 자료 구조를 지원하지 않아 내보내기를 중단했습니다.',
  UNSUPPORTED_HISTORY_VERSION: '지원하지 않는 이력 형식이 있어 내보내기를 중단했습니다.',
  UNSUPPORTED_ACTOR: '기록의 소유 정보를 확인할 수 없어 내보내기를 중단했습니다.',
  RELATION_INVALID: '자료 사이의 관계를 확인할 수 없어 내보내기를 중단했습니다.',
  DATASET_CORRUPT: '자료 형식을 검증하지 못해 내보내기를 중단했습니다.',
  EXPORT_LIMIT_EXCEEDED: '안전한 생성 한도를 넘어 두 파일을 모두 폐기했습니다.',
  XLSX_UNREPRESENTABLE_TEXT:
    '엑셀에 원문 그대로 기록할 수 없는 문자가 있어 두 파일을 모두 폐기했습니다.',
  XLSX_BUILD_FAILED: '엑셀 파일을 준비하지 못해 두 파일을 모두 폐기했습니다.',
  PAIR_MISMATCH: '두 파일의 내용 검증에 실패하여 모두 폐기했습니다.',
  CANCELLED: '내보내기를 취소하고 준비 중인 두 파일을 모두 폐기했습니다.',
};

export function isExportFailureCode(value: unknown): value is ExportError['code'] {
  return typeof value === 'string' && Object.hasOwn(exportMessages, value);
}

export function exportLogin(companyId: string) {
  const path = zWorkspaceId.safeParse(companyId).success ? `/c/${companyId}/export` : '/';
  window.location.assign(`/login?${new URLSearchParams({ returnTo: path })}`);
}

export function exportFailureMessage(failure: unknown) {
  if (failure instanceof ExportError)
    return (
      exportMessages[failure.code] ??
      '두 파일 검증에 실패하여 모두 폐기했습니다. 다시 생성해 주세요.'
    );
  if (failure instanceof WorkFailure) {
    if (failure.status === 401)
      return '로그인이 만료되어 파일을 폐기했습니다. 다시 로그인해 주세요.';
    if (failure.status === 403)
      return '회사 권한을 확인할 수 없어 파일을 폐기했습니다. 회사 선택에서 다시 확인해 주세요.';
    if (Object.hasOwn(exportMessages, failure.code))
      return exportMessages[failure.code as ExportError['code']];
    if (failure.code === 'OFFLINE')
      return '오프라인에서는 내보낼 수 없습니다. 연결 후 다시 생성해 주세요.';
  }
  return '두 파일을 준비하거나 권한을 확인하지 못해 파일을 폐기했습니다. 연결 상태를 확인한 뒤 다시 생성해 주세요.';
}
