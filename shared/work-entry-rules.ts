import {
  zEventStatus,
  zLeaveCalculationBasis,
  zLeaveType,
  zWorkEntryDate,
  zWorkEntryEpoch,
  zWorkEntryFinal,
  zWorkEntryId,
  zWorkEntryMerged,
  zWorkEntryPatch,
  zWorkEntrySnapshotV2,
  zWorkEntryStatus,
  zWorkEntryVersion,
  zWorkHoursPerDay,
  type LeaveCalculationBasis,
  type LeaveStatus,
  type LeaveType,
  type WorkEntryFinal,
  type WorkEntryMerged,
  type WorkEntrySnapshotV2,
  type WorkHoursPerDay,
} from './schema/work-entry';

export class WorkEntryRuleError extends Error {
  constructor(
    readonly code: 'VALIDATION_FAILED' | 'VERSION_CONFLICT' | 'CONSTRAINT_VIOLATION',
    readonly reason: string,
    message: string,
  ) {
    super(message);
    this.name = 'WorkEntryRuleError';
  }
}
function constraint(reason: string, message: string): never {
  throw new WorkEntryRuleError('CONSTRAINT_VIOLATION', reason, message);
}
function conflict(reason: string): never {
  throw new WorkEntryRuleError(
    'VERSION_CONFLICT',
    reason,
    '내용이 변경되었습니다. 다시 조회한 뒤 저장하세요.',
  );
}

/** Uses an injected server instant; neither host timezone nor browser clock is trusted. */
export function kstDate(now: number): string {
  zWorkEntryEpoch.parse(now);
  const shifted = new Date(now + 9 * 60 * 60 * 1000);
  if (!Number.isFinite(shifted.getTime()))
    throw new WorkEntryRuleError(
      'VALIDATION_FAILED',
      'INVALID_NOW',
      '처리 시각이 올바르지 않습니다.',
    );
  return zWorkEntryDate.parse(shifted.toISOString().slice(0, 10));
}
export function hasLeaveDateElapsed(date: string, now: number): boolean {
  return zWorkEntryDate.parse(date) < kstDate(now);
}
export function calculateLeaveHours(type: LeaveType, workHoursPerDay: WorkHoursPerDay) {
  zLeaveType.parse(type);
  zWorkHoursPerDay.parse(workHoursPerDay);
  const unavailableHours = workHoursPerDay / (type === 'full' ? 1 : type.endsWith('_half') ? 2 : 4);
  return {
    workHoursPerDay,
    unavailableHours,
    deductibleHours: unavailableHours,
    allDay: type === 'full',
  };
}

export type LeaveState = { plannedDate: string; status: LeaveStatus; completedAt: number | null };
/** Only leave uses automatic completion. Ordinary entry completion policy is not inferred. */
export function normalizeLeaveState(
  next: Pick<LeaveState, 'plannedDate' | 'status'>,
  previous: LeaveState | null,
  now: number,
): Pick<LeaveState, 'status' | 'completedAt'> {
  zWorkEntryDate.parse(next.plannedDate);
  zEventStatus.parse(next.status);
  zWorkEntryEpoch.parse(now);
  if (previous !== null) {
    zWorkEntryDate.parse(previous.plannedDate);
    zEventStatus.parse(previous.status);
    zWorkEntryEpoch.nullable().parse(previous.completedAt);
    if ((previous.status === 'done') !== (previous.completedAt !== null))
      constraint('INVALID_LEAVE_STATE', '저장된 휴가 상태와 완료 시각이 일치하지 않습니다.');
  }
  if (next.status === 'canceled') return { status: 'canceled', completedAt: null };
  const elapsed = hasLeaveDateElapsed(next.plannedDate, now);
  const moved = previous !== null && previous.plannedDate !== next.plannedDate;
  if (previous?.status === 'done' && !moved && elapsed && next.status === 'planned')
    constraint(
      'PAST_LEAVE_CANNOT_BE_PLANNED',
      '지난 휴가는 날짜를 변경해야 예정으로 되돌릴 수 있습니다.',
    );
  const status = elapsed ? 'done' : moved && previous?.status === 'done' ? 'planned' : next.status;
  return {
    status,
    completedAt:
      status === 'done' ? (previous?.status === 'done' ? previous.completedAt : now) : null,
  };
}
export function shouldAutoCompleteLeave(
  entry: Pick<WorkEntryFinal, 'kind' | 'status' | 'plannedDate'>,
  now: number,
): boolean {
  return (
    entry.kind === 'leave' &&
    entry.status === 'planned' &&
    entry.plannedDate !== null &&
    hasLeaveDateElapsed(entry.plannedDate, now)
  );
}

export type LeaveCalculationContext = {
  date: string;
  day: { version: number; workHoursPerDay: WorkHoursPerDay | null } | null;
  settings: { version: number; workHoursPerDay: WorkHoursPerDay } | null;
};
/** Context values must come from the authenticated company's date/year rows. */
export function leaveCalculationBasis(context: LeaveCalculationContext): LeaveCalculationBasis {
  zWorkEntryDate.parse(context.date);
  if (context.day !== null) {
    zWorkEntryVersion.parse(context.day.version);
    zWorkHoursPerDay.nullable().parse(context.day.workHoursPerDay);
  }
  if (context.settings !== null) {
    zWorkEntryVersion.parse(context.settings.version);
    zWorkHoursPerDay.parse(context.settings.workHoursPerDay);
  }
  const fixedHours = context.day?.workHoursPerDay ?? null;
  return {
    date: context.date,
    dayVersion: context.day?.version ?? null,
    workHoursPerDay: fixedHours ?? context.settings?.workHoursPerDay ?? 8,
    ...(fixedHours === null ? { settingsVersion: context.settings?.version ?? null } : {}),
  };
}
export function assertLeaveCalculationBasis(
  rawBasis: unknown,
  context: LeaveCalculationContext,
): LeaveCalculationBasis {
  const basis = zLeaveCalculationBasis.parse(rawBasis);
  const expected = leaveCalculationBasis(context);
  if (
    basis.date !== expected.date ||
    basis.dayVersion !== expected.dayVersion ||
    basis.workHoursPerDay !== expected.workHoursPerDay ||
    (expected.settingsVersion !== undefined && basis.settingsVersion !== expected.settingsVersion)
  )
    conflict('LEAVE_CALCULATION_CHANGED');
  return expected;
}

export type LeaveDayEntry = {
  id: string;
  companyId: string;
  plannedDate: string;
  status: LeaveStatus;
  type: LeaveType;
  workHoursPerDay: WorkHoursPerDay;
};
export type LeaveDaySummary = {
  unavailableHours: number;
  amHours: number;
  pmHours: number;
  canAddTask: boolean;
  inputBlockReason: 'FULL_DAY_LEAVE' | null;
};
/** Supply all existing rows; replacement excludes its old ID exactly once. No DB reads occur here. */
export function validateLeaveDay(input: {
  companyId: string;
  date: string;
  workHoursPerDay: WorkHoursPerDay;
  allowTaskInput: boolean;
  existing: readonly LeaveDayEntry[];
  replacement?: LeaveDayEntry;
}): LeaveDaySummary {
  zWorkEntryId.parse(input.companyId);
  zWorkEntryDate.parse(input.date);
  zWorkHoursPerDay.parse(input.workHoursPerDay);
  if (typeof input.allowTaskInput !== 'boolean')
    constraint('INVALID_INPUT_POLICY', '날짜 입력 정책이 올바르지 않습니다.');
  const rows = input.existing.filter((entry) => entry.id !== input.replacement?.id);
  if (input.replacement) rows.push(input.replacement);
  const types = new Set<LeaveType>();
  const ids = new Set<string>();
  let unavailableHours = 0,
    amHours = 0,
    pmHours = 0,
    full = false;
  for (const row of rows) {
    if (row.companyId !== input.companyId || row.plannedDate !== input.date) continue;
    zWorkEntryId.parse(row.id);
    zEventStatus.parse(row.status);
    zLeaveType.parse(row.type);
    zWorkHoursPerDay.parse(row.workHoursPerDay);
    if (row.status === 'canceled') continue;
    if (row.workHoursPerDay !== input.workHoursPerDay)
      constraint('LEAVE_HOURS_MISMATCH', '날짜 기준과 휴가 근로시간이 다릅니다.');
    if (ids.has(row.id))
      constraint('DUPLICATE_LEAVE_ID', '휴가 목록에 같은 기록이 중복되었습니다.');
    ids.add(row.id);
    if (types.has(row.type))
      constraint('DUPLICATE_LEAVE_TYPE', '같은 날짜에 같은 종류의 활성 휴가가 있습니다.');
    types.add(row.type);
    const amount = calculateLeaveHours(row.type, input.workHoursPerDay).unavailableHours;
    unavailableHours += amount;
    if (row.type.startsWith('am_')) amHours += amount;
    if (row.type.startsWith('pm_')) pmHours += amount;
    if (row.type === 'full') full = true;
  }
  if (unavailableHours > input.workHoursPerDay)
    constraint('DAILY_LEAVE_LIMIT', '하루 휴가 시간이 근로시간을 넘습니다.');
  if (amHours > input.workHoursPerDay / 2)
    constraint('AM_LEAVE_LIMIT', '오전 휴가 시간이 한도를 넘습니다.');
  if (pmHours > input.workHoursPerDay / 2)
    constraint('PM_LEAVE_LIMIT', '오후 휴가 시간이 한도를 넘습니다.');
  const canAddTask = !full || input.allowTaskInput;
  return {
    unavailableHours,
    amHours,
    pmHours,
    canAddTask,
    inputBlockReason: canAddTask ? null : 'FULL_DAY_LEAVE',
  };
}

function editableEntry(current: WorkEntryFinal): WorkEntryMerged {
  return {
    kind: current.kind,
    projectId: current.projectId,
    title: current.title,
    content: current.content,
    plannedDate: current.plannedDate,
    dueDate: current.dueDate,
    endDate: current.endDate,
    timeMode: current.timeMode,
    startAt: current.startAt,
    endAt: current.endAt,
    allDay: current.allDay,
    status: current.status,
    resumeStatus: current.resumeStatus,
    mustFinishToday: current.mustFinishToday,
    sortOrder: current.sortOrder,
    tagIds: [...current.tagIds],
    leave: current.leave === null ? null : { type: current.leave.type },
  };
}
/** Transition checks use the persisted previous state; a combined patch cannot bypass them. */
export function assertWorkEntryTransition(
  previous: Pick<WorkEntryMerged, 'kind' | 'status' | 'plannedDate'> | null,
  next: Pick<WorkEntryMerged, 'kind' | 'status' | 'plannedDate'>,
): void {
  if (next.kind === 'event' && previous?.kind !== 'event')
    constraint(
      'EVENT_NOT_AVAILABLE',
      '회사 행사는 업무 차단 규칙과 함께 후속 단계에서 제공합니다.',
    );
  if (
    previous?.kind === 'task' &&
    (previous.status === 'doing' ||
      previous.status === 'done' ||
      (previous.status === 'paused' &&
        'resumeStatus' in previous &&
        previous.resumeStatus === 'doing')) &&
    next.plannedDate === null
  )
    constraint('DATE_REMOVAL_REQUIRES_TODO', '먼저 미진행 상태로 저장한 뒤 날짜를 제거하세요.');
  if (previous !== null && previous.kind !== next.kind) {
    if (previous.kind === 'leave' || next.kind === 'leave')
      constraint('LEAVE_KIND_IMMUTABLE', '휴가와 다른 업무 종류는 직접 변환할 수 없습니다.');
  }
}

/** Keep unknown historical completion times unknown; only entering done records server now. */
export function normalizeOrdinaryCompletion(
  next: Pick<WorkEntryMerged, 'status'>,
  previous: Pick<WorkEntryFinal, 'status' | 'completedAt'> | null,
  now: number,
): number | null {
  zWorkEntryEpoch.parse(now);
  return next.status === 'done' ? (previous?.status === 'done' ? previous.completedAt : now) : null;
}

export type MergedWorkEntryPatch = {
  entry: WorkEntryMerged;
  calculationBasis?: LeaveCalculationBasis;
  reason?: string | null;
};
export function mergeWorkEntryPatch(
  rawCurrent: WorkEntryFinal,
  rawPatch: unknown,
): MergedWorkEntryPatch {
  const current = zWorkEntryFinal.parse(rawCurrent);
  const patch = zWorkEntryPatch.parse(rawPatch);
  if (patch.version !== current.version) conflict('ENTRY_VERSION_CHANGED');
  const next = editableEntry(current);
  // Explicit undefined is treated as omission, never as a command to erase a value.
  for (const key of Object.keys(next) as (keyof WorkEntryMerged)[]) {
    const value = key === 'resumeStatus' ? undefined : patch[key];
    if (value !== undefined) Object.assign(next, { [key]: value });
  }
  if (current.status === 'paused') {
    if (next.kind !== current.kind || (next.status !== 'paused' && next.status !== 'canceled'))
      constraint('RESUME_REQUIRED', '먼저 중단한 업무를 재개하세요.');
    if (next.status === 'canceled') next.resumeStatus = null;
  } else if (next.status === 'paused') constraint('PAUSE_REQUIRED', '중단 명령을 사용하세요.');
  if ((current.kind === 'leave') !== (next.kind === 'leave'))
    constraint('LEAVE_KIND_IMMUTABLE', '휴가와 다른 업무 종류는 직접 변환할 수 없습니다.');
  if (current.kind !== next.kind && patch.status === undefined)
    constraint('KIND_STATUS_REQUIRED', '종류를 바꿀 때 대상 상태를 직접 선택하세요.');
  if (
    next.kind === 'task' &&
    next.plannedDate === null &&
    (next.status === 'doing' || next.status === 'done')
  )
    constraint('WORK_DATE_REQUIRED', '먼저 업무 날짜를 배정하세요.');
  assertWorkEntryTransition(current, next);
  if (next.kind === 'leave') {
    if (patch.allDay !== undefined)
      constraint('LEAVE_AMOUNT_SERVER_ONLY', '휴가의 종일 여부는 서버가 계산합니다.');
    if (patch.leave !== undefined) next.allDay = patch.leave.type === 'full';
    const needsBasis =
      next.plannedDate !== current.plannedDate ||
      next.leave?.type !== current.leave?.type ||
      (current.status === 'canceled' && next.status !== 'canceled');
    if (needsBasis && patch.calculationBasis === undefined)
      constraint('LEAVE_CALCULATION_REQUIRED', '휴가 계산 기준을 다시 확인하세요.');
    if (patch.calculationBasis && patch.calculationBasis.date !== next.plannedDate)
      constraint('LEAVE_CALCULATION_DATE', '휴가 날짜와 계산 날짜가 다릅니다.');
  } else if (patch.calculationBasis !== undefined)
    constraint(
      'UNEXPECTED_LEAVE_CALCULATION',
      '휴가가 아닌 업무에는 휴가 계산 기준을 지정할 수 없습니다.',
    );
  return {
    entry: zWorkEntryMerged.parse(next),
    ...(patch.calculationBasis === undefined ? {} : { calculationBasis: patch.calculationBasis }),
    ...(patch.reason === undefined ? {} : { reason: patch.reason }),
  };
}
export function mergeWorkEntryStatus(
  current: WorkEntryFinal,
  rawStatus: unknown,
): MergedWorkEntryPatch {
  return mergeWorkEntryPatch(current, zWorkEntryStatus.parse(rawStatus));
}
export function workEntrySnapshot(rawEntry: WorkEntryFinal): WorkEntrySnapshotV2 {
  const entry = zWorkEntryFinal.parse(rawEntry);
  return zWorkEntrySnapshotV2.parse({
    kind: entry.kind,
    projectId: entry.projectId,
    tagIds: [...entry.tagIds].sort(),
    plannedDate: entry.plannedDate,
    dueDate: entry.dueDate,
    endDate: entry.endDate,
    timeMode: entry.timeMode,
    startAt: entry.startAt,
    endAt: entry.endAt,
    allDay: entry.allDay,
    status: entry.status,
    completedAt: entry.completedAt,
    leave: entry.leave,
  });
}
/** Existing tasks stay editable; new tasks or moves into a day obey its full-leave policy. */
export function assertTaskDateInput(
  previous: Pick<WorkEntryMerged, 'kind' | 'plannedDate'> | null,
  next: Pick<WorkEntryMerged, 'kind' | 'plannedDate'>,
  summary: Pick<LeaveDaySummary, 'canAddTask'>,
): void {
  const entersDate =
    next.kind === 'task' &&
    next.plannedDate !== null &&
    (previous === null || previous.kind !== 'task' || previous.plannedDate !== next.plannedDate);
  if (entersDate && !summary.canAddTask)
    constraint('FULL_DAY_LEAVE', '종일 휴가일에는 새 업무를 배정할 수 없습니다.');
}
