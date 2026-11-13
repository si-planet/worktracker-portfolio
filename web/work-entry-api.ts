import {
  zDeadlineList,
  zDeadlinePlacement,
  zDeadlinePlacementResult,
  zDeadlinePlacementSnapshot,
} from '../shared/schema/deadline-placement';
import {
  zWorkCarryover,
  zWorkCarryoverResult,
  zWorkCarryoverSnapshot,
} from '../shared/schema/work-carryover';
import { isoWeekForDate, weekCalendar } from '../shared/week-calendar';
import { zWorkExtend, zWorkPostpone } from '../shared/schema/work-reschedule';
import { zWorkEntryDuplicate, zWorkEntryDuplicateSnapshot } from '../shared/schema/work-duplicate';
import { z } from 'zod';
import {
  zEventStatus,
  zLeaveCalculationBasis,
  zLeaveType,
  zWorkEntryDate,
  zWorkEntryEpoch,
  zWorkEntryFinal,
  zWorkEntryId,
  zWorkEntryHistory,
  zWorkEntryVersion,
  zWorkPause,
  zWorkResume,
  zWorkHoursPerDay,
} from '../shared/schema/work-entry';

export class WorkFailure extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    readonly reason?: string,
  ) {
    super(code);
  }
}
const reasonMessages: Record<string, string> = {
  LINK_REVIEW_REQUIRED:
    '연결된 원본입니다. 화면을 업데이트하고 원본과 WBS 연결을 다시 확인한 뒤 복사하세요.',

  LEDGER_INPUT: '연차 장부의 날짜·시간과 명시 선택을 확인해 주세요.',
  LEDGER_SCOPE: '이 회사의 장부 또는 휴가에 접근할 수 없습니다.',
  LEDGER_UNAVAILABLE: '연차 장부를 확인할 수 없습니다. 초안을 유지했습니다.',
  LEDGER_PARTIAL_SCHEMA: '연차 장부 구성이 완전하지 않습니다. 초안과 미확인 명령을 유지했습니다.',
  LEDGER_STORED_INVALID: '연차 장부 자료를 확인할 수 없습니다. 초안과 미확인 명령을 유지했습니다.',
  LEDGER_NOT_STARTED: '장부를 시작한 뒤 다시 확인해 주세요.',
  LEDGER_NOT_ACTIVE: '장부 초안은 아직 활성화되지 않았습니다. 활성화 미리보기를 확인해 주세요.',
  LEDGER_ALREADY_ACTIVE: '이미 활성화된 장부입니다. 현재 상태를 조회해 주세요.',
  LEDGER_VERSION_CHANGED: '장부 버전이 바뀌었습니다. 입력을 유지하고 현재 값을 조회해 주세요.',
  LEDGER_COMMAND_CONFLICT: '같은 명령 ID의 제출값이 다릅니다. 원래 명령을 확인해 주세요.',
  LEDGER_POLICY_REQUIRED: '휴가 사용연도의 차감 정책을 먼저 저장해 주세요.',
  LEDGER_INSUFFICIENT: '해당 휴가일에 배정할 수 있는 연차가 부족합니다.',
  LEDGER_TARGET_SET_CHANGED: '장부 시작 대상 휴가가 바뀌었습니다. 다시 미리 확인해 주세요.',
  LEDGER_PREVIEW_CHANGED: '연차 변경 영향이 바뀌었습니다. 다시 미리 확인해 주세요.',
  LEDGER_REVIEW_REQUIRED: '연차 정산의 영향을 미리 확인하고 명시 적용해 주세요.',
  LEDGER_SOURCE_CHANGED: '휴가가 변경되었습니다. 현재 기록을 확인해 주세요.',
  LEDGER_SOURCE_KIND: '이 변경에는 유효한 휴가 기록이 필요합니다.',
  LEDGER_SOURCE_ACCOUNTING: '휴가의 배분 근거를 확인해야 합니다. 초안을 유지했습니다.',
  LEDGER_IN_USE: '배분 이력이 있어 삭제하거나 기간·양을 축소할 수 없습니다.',
  LEDGER_LIMIT: '장부 요청의 항목 수가 지원 상한을 넘습니다.',
  LEDGER_UNSUPPORTED: '이 휴가 변경은 아직 지원되지 않습니다. 원래 초안을 유지했습니다.',
  LEDGER_HOURS_OVERFLOW: '장부 시간 합계가 지원 범위를 넘습니다.',

  DEADLINE_PLACEMENT_NOT_AVAILABLE: '미진행·진행 중·중단 상태의 업무만 요일을 배치할 수 있습니다.',
  DEADLINE_REQUIRED: '마감기한이 있는 업무를 선택해 주세요.',
  DEADLINE_WEEK_MISMATCH: '마감기한이 속한 주 안의 날짜를 선택해 주세요.',
  DEADLINE_PLACEMENT_UNCHANGED: '이미 같은 날짜에 배치되어 있습니다. 다른 요일을 선택해 주세요.',
  DEADLINE_TARGET_CLOSED: '이미 끝난 주에는 새로 배치할 수 없습니다.',
  DEADLINE_TARGET_FINALIZED:
    '목적 주 계획이 확정되었습니다. 현재 업무와 계획을 다시 확인해 주세요.',

  CARRYOVER_NOT_AVAILABLE: '미완료 업무·회의·외근만 명시 이월할 수 있습니다.',
  CARRYOVER_DATE_REQUIRED: '날짜를 먼저 배정한 뒤 이월해 주세요.',
  CARRYOVER_UNCHANGED: '현재와 같은 예정일입니다. 더 늦은 날짜를 선택해 주세요.',
  CARRYOVER_DATE_NOT_LATER: '현재 예정일보다 늦은 날짜를 선택해 주세요.',
  CARRYOVER_TARGET_CLOSED:
    '이미 끝난 주로 이월할 수 없습니다. 열려 있는 주의 날짜를 선택해 주세요.',
  CARRYOVER_TARGET_FINALIZED:
    '목적 주의 계획이 확정되어 이월할 수 없습니다. 다른 날짜를 확인해 주세요.',

  RESCHEDULE_NOT_AVAILABLE: '미진행·진행 중·중단 상태의 업무만 연장하거나 미룰 수 있습니다.',
  RESCHEDULE_UNCHANGED: '현재와 같은 일정입니다. 변경할 날짜를 확인해 주세요.',
  ENTRY_VERSION_CHANGED: '업무가 변경되었습니다. 현재 일정을 확인하고 버전을 직접 선택해 주세요.',
  PAUSE_NOT_AVAILABLE: '미진행 또는 진행 중인 업무만 중단할 수 있습니다.',
  RESUME_NOT_AVAILABLE: '중단한 업무만 재개할 수 있습니다.',
  RESUME_REQUIRED: '먼저 업무 재개를 실행한 뒤 완료하거나 종류를 변경해 주세요.',
  PAUSE_REQUIRED: '업무 중단 버튼을 사용해 주세요.',
  DUPLICATE_LEAVE_TYPE: '같은 날짜에 같은 종류의 활성 휴가가 있습니다.',
  AM_LEAVE_LIMIT: '오전 휴가 시간이 한도를 넘습니다.',
  PM_LEAVE_LIMIT: '오후 휴가 시간이 한도를 넘습니다.',
  DAILY_LEAVE_LIMIT: '하루 휴가 시간이 근로시간을 넘습니다.',
  FULL_DAY_LEAVE: '종일 휴가가 있는 날입니다. 이 날짜의 업무 입력 허용 여부를 확인해 주세요.',
  LEAVE_CALCULATION_CHANGED: '휴가 계산 기준이 바뀌었습니다. 새 시간량을 확인한 뒤 저장해 주세요.',
  LEAVE_CALCULATION_REQUIRED: '휴가 계산 기준을 먼저 조회해 주세요.',
  LEAVE_CALCULATION_DATE: '휴가 날짜와 계산 기준 날짜를 다시 확인해 주세요.',
  WORK_DATE_REQUIRED: '먼저 업무 날짜를 배정해 주세요.',
  DATE_REMOVAL_REQUIRES_TODO: '먼저 미진행 상태를 저장한 다음 날짜를 제거해 주세요.',
  KIND_STATUS_REQUIRED: '바꿀 기록 종류에 맞는 상태를 직접 선택해 주세요.',
  PAST_LEAVE_CANNOT_BE_PLANNED: '지난 휴가는 날짜를 변경해야 예정으로 되돌릴 수 있습니다.',
  LEAVE_KIND_IMMUTABLE: '휴가와 다른 종류의 기록은 직접 바꿀 수 없습니다.',
  INACTIVE_PROJECT: '활성 프로젝트를 선택해 주세요.',
  INACTIVE_TAG: '활성 태그를 선택해 주세요.',
  INACTIVE_SELECTION: '활성 프로젝트와 태그를 선택해 주세요.',
  INVALID_CURSOR: '조회 조건이 바뀌었습니다. 목록을 처음부터 다시 조회해 주세요.',
};
const zFailureBody = z.strictObject({
  code: z.enum([
    'VALIDATION_FAILED',
    'FORBIDDEN',
    'VERSION_CONFLICT',
    'CONSTRAINT_VIOLATION',
    'WORK_UNAVAILABLE',
  ]),
  message: z.string().max(500),
  traceId: z.uuid(),
  reason: z.string().max(64).optional(),
});
export async function workApi<T extends z.ZodType>(
  path: string,
  schema: T,
  method = 'GET',
  body?: unknown,
): Promise<z.output<T>> {
  if (method !== 'GET' && !navigator.onLine) throw new WorkFailure(0, 'OFFLINE');
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), 15_000);
  try {
    const response = await fetch(path, {
      method,
      credentials: 'same-origin',
      cache: 'no-store',
      signal: controller.signal,
      ...(body === undefined
        ? {}
        : { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }),
    });
    if (response.status === 401) throw new WorkFailure(401, 'UNAUTHENTICATED');
    if (!response.ok) {
      let code = 'REQUEST_FAILED',
        reason: string | undefined;
      try {
        const text = await response.text();
        if (text.length <= 4096) {
          const parsed = zFailureBody.safeParse(JSON.parse(text));
          if (parsed.success) {
            code = parsed.data.code;
            if (parsed.data.reason && Object.hasOwn(reasonMessages, parsed.data.reason))
              reason = parsed.data.reason;
          }
        }
      } catch {
        /* Malformed error bodies never expose raw server text. */
      }
      throw new WorkFailure(response.status, code, reason);
    }
    const parsed = schema.safeParse(await response.json());
    if (!parsed.success) throw new WorkFailure(0, 'INVALID_RESPONSE');
    return parsed.data;
  } finally {
    window.clearTimeout(timeout);
  }
}
export const uncertainWork = (error: unknown) =>
  !(error instanceof WorkFailure) || error.status >= 500 || error.code === 'INVALID_RESPONSE';
export function workError(error: unknown) {
  if (error instanceof WorkFailure) {
    if (error.code === 'DUPLICATE_UPDATE_REQUIRED')
      return '복사 WBS 응답 형식을 확인할 수 없습니다. 화면과 서버를 업데이트한 뒤 원본을 다시 조회하세요. 입력은 유지했습니다.';
    if ([400, 409, 422].includes(error.status) && error.reason)
      return reasonMessages[error.reason]!;
    if (error.code === 'OFFLINE') return '오프라인에서는 저장할 수 없습니다. 입력을 유지했습니다.';
    if (error.status === 403)
      return '접근할 수 없는 회사 또는 기록입니다. 회사 선택에서 다시 확인해 주세요.';
    if (error.status === 404) return '기록을 찾을 수 없습니다. 목록을 다시 확인해 주세요.';
    if (error.status === 409) return '다른 변경이 있습니다. 최신 기록과 입력 내용을 비교해 주세요.';
    if (error.status === 422) return '상태·날짜·휴가 중복 또는 시간 한도를 확인해 주세요.';
    if (error.status === 400) return '입력값과 선택한 프로젝트·태그를 확인해 주세요.';
  }
  return '서버 응답을 확인할 수 없습니다. 입력을 유지했습니다. 다시 조회해 주세요.';
}
export const workEntrySchema = (companyId: string, id?: string) =>
  zWorkEntryFinal.refine(
    (row) => row.companyId === companyId && (id === undefined || row.id === id),
  );
export const workListSchema = (companyId: string) =>
  z.strictObject({
    items: z.array(workEntrySchema(companyId)),
    nextCursor: z.string().min(1).max(12000).nullable(),
  });
export const zWorkDay = z.strictObject({
  date: zWorkEntryDate,
  version: zWorkEntryVersion,
  workHoursPerDay: zWorkHoursPerDay.nullable(),
  allowTaskInput: z.boolean(),
  createdAt: zWorkEntryEpoch,
  updatedAt: zWorkEntryEpoch,
});
export const zLeaveContext = z.strictObject({
  calculationBasis: zLeaveCalculationBasis,
  day: zWorkDay.nullable(),
  leaves: z.array(
    z.strictObject({
      id: zWorkEntryId,
      companyId: zWorkEntryId,
      plannedDate: zWorkEntryDate,
      status: zEventStatus,
      type: zLeaveType,
      workHoursPerDay: zWorkHoursPerDay,
    }),
  ),
  summary: z.strictObject({
    unavailableHours: z.number().int().nonnegative(),
    amHours: z.number().int().nonnegative(),
    pmHours: z.number().int().nonnegative(),
    canAddTask: z.boolean(),
    inputBlockReason: z.literal('FULL_DAY_LEAVE').nullable(),
  }),
});
export const leaveContextSchema = (companyId: string, date: string) =>
  zLeaveContext.refine(
    (value) =>
      value.calculationBasis.date === date &&
      (value.day === null || value.day.date === date) &&
      value.leaves.every((row) => row.companyId === companyId && row.plannedDate === date),
  );
export type LeaveContext = z.infer<typeof zLeaveContext>;
export const historySchema = (id: string) =>
  zWorkEntryHistory.refine((value) => value.items.every((item) => item.workEntryId === id));
export type WorkHistory = z.infer<ReturnType<typeof historySchema>>;

export async function readWorkDuplicate(companyId: string, id: string) {
  try {
    return await workApi(
      `/api/work-entries/${id}/duplicate?contractVersion=2`,
      zWorkEntryDuplicateSnapshot.refine(
        (value) => value.entry.companyId === companyId && value.entry.id === id,
      ),
    );
  } catch (error) {
    // Never fall back to v1 or infer an absent WBS link from an unsupported response.
    if (
      error instanceof WorkFailure &&
      ([400, 404, 405].includes(error.status) || error.code === 'INVALID_RESPONSE')
    )
      throw new WorkFailure(error.status, 'DUPLICATE_UPDATE_REQUIRED');
    throw error;
  }
}
export function saveWorkDuplicate(
  companyId: string,
  sourceId: string,
  sourceVersion: number,
  entry: unknown,
  wbs?: import('../shared/schema/work-duplicate').DuplicateWbsReview,
) {
  const payload = zWorkEntryDuplicate.parse({ sourceVersion, entry, ...(wbs ? { wbs } : {}) });
  return workApi(
    `/api/work-entries/${sourceId}/duplicate`,
    workEntrySchema(companyId, payload.entry.id),
    'POST',
    payload,
  );
}

export function setWorkPause(
  companyId: string,
  entry: import('../shared/schema/work-entry').WorkEntryFinal,
  action: 'pause' | 'resume',
) {
  const body = (action === 'pause' ? zWorkPause : zWorkResume).parse({ version: entry.version });
  return workApi(
    `/api/work-entries/${entry.id}/${action}`,
    workEntrySchema(companyId, entry.id).refine(
      (value) =>
        value.kind === 'task' &&
        value.version > entry.version &&
        (action === 'pause'
          ? value.status === 'paused' &&
            value.completedAt === null &&
            value.resumeStatus === entry.status
          : value.status === entry.resumeStatus && value.resumeStatus === null),
    ),
    'POST',
    body,
  );
}

export type RescheduleCommand =
  | { intent: 'extend'; input: import('../shared/schema/work-reschedule').WorkExtend }
  | { intent: 'postpone'; input: import('../shared/schema/work-reschedule').WorkPostpone };
/** Schedule commands preserve every non-schedule business field. */
export function unchangedWorkFields(
  before: import('../shared/schema/work-entry').WorkEntryFinal,
  after: import('../shared/schema/work-entry').WorkEntryFinal,
) {
  return (
    before.id === after.id &&
    before.companyId === after.companyId &&
    [
      'kind',
      'title',
      'content',
      'projectId',
      'status',
      'resumeStatus',
      'completedAt',
      'createdAt',
      'endDate',
      'timeMode',
      'startAt',
      'endAt',
      'allDay',
      'mustFinishToday',
      'sortOrder',
    ].every((key) => before[key as keyof typeof before] === after[key as keyof typeof after]) &&
    JSON.stringify([...before.tagIds].sort()) === JSON.stringify([...after.tagIds].sort()) &&
    JSON.stringify(before.leave) === JSON.stringify(after.leave)
  );
}
export function rescheduleMatches(
  before: import('../shared/schema/work-entry').WorkEntryFinal,
  after: import('../shared/schema/work-entry').WorkEntryFinal,
  command: RescheduleCommand,
) {
  return (
    unchangedWorkFields(before, after) &&
    after.version === before.version + 1 &&
    after.plannedDate ===
      (command.intent === 'extend' ? before.plannedDate : command.input.newPlannedDate) &&
    after.dueDate ===
      (command.intent === 'extend'
        ? command.input.newDueDate
        : (command.input.newDueDate ?? before.dueDate))
  );
}
export function saveWorkReschedule(
  companyId: string,
  before: import('../shared/schema/work-entry').WorkEntryFinal,
  command: RescheduleCommand,
) {
  const payload =
    command.intent === 'extend'
      ? zWorkExtend.parse(command.input)
      : zWorkPostpone.parse(command.input);
  return workApi(
    `/api/work-entries/${before.id}/${command.intent}`,
    workEntrySchema(companyId, before.id).refine((after) =>
      rescheduleMatches(before, after, command),
    ),
    'POST',
    payload,
  );
}

export function carryoverMatches(
  before: import('../shared/schema/work-entry').WorkEntryFinal,
  after: import('../shared/schema/work-entry').WorkEntryFinal,
  input: import('../shared/schema/work-carryover').WorkCarryover,
) {
  return (
    unchangedWorkFields(before, after) &&
    after.version === before.version + 1 &&
    after.plannedDate === input.newPlannedDate &&
    after.dueDate === before.dueDate
  );
}
export function readCarryoverSnapshot(companyId: string, id: string) {
  return workApi(
    `/api/work-entries/${id}/carryover`,
    zWorkCarryoverSnapshot.refine((v) => {
      if (v.entry.companyId !== companyId || v.entry.id !== id) return false;
      if (!v.membership) return true;
      if (!v.entry.plannedDate) return false;
      const week = isoWeekForDate(v.entry.plannedDate);
      return v.membership.isoYear === week.isoYear && v.membership.isoWeek === week.isoWeek;
    }),
  );
}
export function saveWorkCarryover(
  companyId: string,
  before: import('../shared/schema/work-entry').WorkEntryFinal,
  input: import('../shared/schema/work-carryover').WorkCarryover,
) {
  const payload = zWorkCarryover.parse(input),
    target = isoWeekForDate(payload.newPlannedDate);
  return workApi(
    `/api/work-entries/${before.id}/carryover`,
    zWorkCarryoverResult.refine(
      (v) =>
        v.entry.companyId === companyId &&
        carryoverMatches(before, v.entry, payload) &&
        v.targetWeek.isoYear === target.isoYear &&
        v.targetWeek.isoWeek === target.isoWeek,
    ),
    'POST',
    payload,
  );
}
export function carryoverCandidates(companyId: string, parameters: URLSearchParams) {
  return workApi(
    `/api/companies/${companyId}/carryover-candidates?${parameters}`,
    workListSchema(companyId).refine((v) =>
      v.items.every(
        (e) =>
          e.plannedDate !== null &&
          (e.kind === 'task'
            ? ['todo', 'doing', 'paused'].includes(e.status)
            : ['meeting', 'field'].includes(e.kind) && e.status === 'planned'),
      ),
    ),
  );
}

export function deadlinePlacementMatches(
  before: import('../shared/schema/work-entry').WorkEntryFinal,
  after: import('../shared/schema/work-entry').WorkEntryFinal,
  input: import('../shared/schema/deadline-placement').DeadlinePlacement,
) {
  return (
    unchangedWorkFields(before, after) &&
    after.version === before.version + 1 &&
    after.plannedDate === input.plannedDate &&
    after.dueDate === before.dueDate
  );
}
export function deadlineList(
  companyId: string,
  isoYear: number,
  isoWeek: number,
  parameters: URLSearchParams,
) {
  const calendar = weekCalendar(isoYear, isoWeek);
  const requestedStatuses = parameters.getAll('statuses');
  const allowedStatuses = requestedStatuses.length
    ? requestedStatuses
    : ['todo', 'doing', 'paused', 'done'];
  const limit = Number(parameters.get('limit') ?? 100);
  return workApi(
    `/api/companies/${companyId}/weeks/${isoYear}/${isoWeek}/deadlines?${parameters}`,
    zDeadlineList.refine(
      (v) =>
        v.companyId === companyId &&
        v.isoYear === isoYear &&
        v.isoWeek === isoWeek &&
        (v.nextCursor === null || (v.nextCursor.length > 0 && v.nextCursor.length <= 12000)) &&
        v.items.length <= limit &&
        new Set(v.items.map((i) => i.entry.id)).size === v.items.length &&
        v.items.every((i) => {
          if (
            i.entry.companyId !== companyId ||
            i.entry.kind !== 'task' ||
            !allowedStatuses.includes(i.entry.status) ||
            i.entry.dueDate === null ||
            i.entry.dueDate < calendar.weekStart ||
            i.entry.dueDate > calendar.weekEnd
          )
            return false;
          const m = i.membership;
          if (m && (m.isoYear !== isoYear || m.isoWeek !== isoWeek)) return false;
          const p = i.entry.plannedDate;
          return (
            i.isPlannedInWeek === !!(m && p && p >= calendar.weekStart && p <= calendar.weekEnd)
          );
        }),
    ),
  );
}
export function readDeadlinePlacement(companyId: string, id: string) {
  return workApi(
    `/api/work-entries/${id}/deadline-placement`,
    zDeadlinePlacementSnapshot.refine((v) => {
      if (v.entry.companyId !== companyId || v.entry.id !== id) return false;
      if (!v.membership) return true;
      if (!v.entry.plannedDate) return false;
      const w = isoWeekForDate(v.entry.plannedDate);
      return v.membership.isoYear === w.isoYear && v.membership.isoWeek === w.isoWeek;
    }),
  );
}
export function saveDeadlinePlacement(
  companyId: string,
  before: import('../shared/schema/work-entry').WorkEntryFinal,
  input: import('../shared/schema/deadline-placement').DeadlinePlacement,
) {
  const body = zDeadlinePlacement.parse(input),
    target = isoWeekForDate(body.plannedDate);
  return workApi(
    `/api/work-entries/${before.id}/deadline-placement`,
    zDeadlinePlacementResult.refine(
      (v) =>
        v.entry.companyId === companyId &&
        deadlinePlacementMatches(before, v.entry, body) &&
        v.targetWeek.isoYear === target.isoYear &&
        v.targetWeek.isoWeek === target.isoWeek,
    ),
    'POST',
    body,
  );
}
