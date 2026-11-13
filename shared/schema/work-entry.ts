import { z } from 'zod';

export const zWorkEntryId = z.uuid();
export const zWorkEntryVersion = z.number().int().positive().max(Number.MAX_SAFE_INTEGER);
export const zWorkEntryEpoch = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
export const zWorkEntryDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine((value) => {
    if (value.startsWith('0000')) return false;
    const parsed = new Date(`${value}T00:00:00.000Z`);
    return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
  }, '실제 달력 날짜를 입력하세요.');
export const zWorkEntryKind = z.enum(['task', 'meeting', 'field', 'event', 'leave', 'etc']);
export const zTaskStatus = z.enum(['todo', 'doing', 'paused', 'done', 'canceled']);
export const zEventStatus = z.enum(['planned', 'done', 'canceled']);
export const zWorkEntryStatusValue = z.enum([
  'todo',
  'doing',
  'paused',
  'planned',
  'done',
  'canceled',
]);
export const zWorkHoursPerDay = z.union([z.literal(4), z.literal(8), z.literal(12), z.literal(16)]);
export const zLeaveType = z.enum(['full', 'am_half', 'pm_half', 'am_quarter', 'pm_quarter']);
export const zLeaveInput = z.strictObject({ type: zLeaveType });
export const zWorkEntryTagIds = z
  .array(zWorkEntryId)
  .refine((ids) => new Set(ids).size === ids.length, '태그가 중복되었습니다.');
const reason = z.string().max(5000).nullable();

export const zLeaveCalculationBasis = z
  .strictObject({
    date: zWorkEntryDate,
    dayVersion: zWorkEntryVersion.nullable(),
    workHoursPerDay: zWorkHoursPerDay,
    // Explicit null means the settings row does not yet exist (default H=8).
    settingsVersion: zWorkEntryVersion.nullable().optional(),
  })
  .superRefine((value, ctx) => {
    if (value.dayVersion === null && value.settingsVersion === undefined) {
      ctx.addIssue({
        code: 'custom',
        path: ['settingsVersion'],
        message: '첫 휴가 계산에는 설정 버전이 필요합니다.',
      });
    }
  });

const editableShape = {
  kind: zWorkEntryKind,
  projectId: zWorkEntryId.nullable(),
  title: z.string().min(1).max(200),
  content: z.string().max(5000).nullable(),
  plannedDate: zWorkEntryDate.nullable(),
  dueDate: zWorkEntryDate.nullable(),
  endDate: zWorkEntryDate.nullable(),
  timeMode: z.enum(['date_only', 'exact']),
  startAt: zWorkEntryEpoch.nullable(),
  endAt: zWorkEntryEpoch.nullable(),
  allDay: z.boolean(),
  status: zWorkEntryStatusValue,
  resumeStatus: z.enum(['todo', 'doing']).nullable().default(null),
  mustFinishToday: z.boolean(),
  sortOrder: z.number().int().min(-Number.MAX_SAFE_INTEGER).max(Number.MAX_SAFE_INTEGER),
  tagIds: zWorkEntryTagIds,
  leave: zLeaveInput.nullable(),
};
type EditableShape = z.infer<z.ZodObject<typeof editableShape>>;
function validateExactDates(
  value: Pick<EditableShape, 'timeMode' | 'startAt' | 'endAt' | 'plannedDate' | 'endDate'>,
  ctx: z.RefinementCtx,
) {
  if (
    value.timeMode !== 'exact' ||
    value.startAt === null ||
    value.endAt === null ||
    value.endAt <= value.startAt
  )
    return;
  const dateAt = (instant: number) => {
    const shifted = new Date(instant + 9 * 60 * 60 * 1000);
    return Number.isFinite(shifted.getTime()) ? shifted.toISOString().slice(0, 10) : null;
  };
  const first = dateAt(value.startAt);
  const last = dateAt(value.endAt - 1);
  if (
    !first ||
    !last ||
    !zWorkEntryDate.safeParse(first).success ||
    !zWorkEntryDate.safeParse(last).success ||
    value.plannedDate !== first ||
    (value.endDate ?? value.plannedDate) !== last
  )
    ctx.addIssue({
      code: 'custom',
      path: ['plannedDate'],
      message: '날짜는 한국 시각의 시작일과 종료 직전 날짜에 맞춰 지정하세요.',
    });
}
function validateEditable(value: EditableShape, ctx: z.RefinementCtx) {
  const issue = (path: string, message: string) =>
    ctx.addIssue({ code: 'custom', path: [path], message });
  const statuses = value.kind === 'task' ? zTaskStatus : zEventStatus;
  if (
    value.status === 'paused'
      ? value.kind !== 'task' ||
        value.resumeStatus === null ||
        (value.resumeStatus === 'doing' && value.plannedDate === null)
      : value.resumeStatus !== null
  )
    issue('status', '중단과 재개 상태를 확인하세요.');
  if (!statuses.safeParse(value.status).success)
    issue('status', '업무 종류에 맞는 상태를 선택하세요.');
  if (value.kind === 'task') {
    if (value.projectId === null) issue('projectId', '일반 업무에는 프로젝트가 필요합니다.');
  }
  if (value.plannedDate === null) {
    if (value.kind !== 'task') issue('plannedDate', '날짜를 지정하세요.');
    if (value.status !== 'todo' && value.status !== 'paused' && value.status !== 'canceled')
      issue('status', '먼저 업무 날짜를 배정하세요.');
    if (
      value.timeMode !== 'date_only' ||
      value.startAt !== null ||
      value.endAt !== null ||
      value.endDate !== null
    )
      issue('plannedDate', '날짜 미정 업무의 시각과 종료일을 명시적으로 비우세요.');
  }
  if (value.endDate !== null && value.plannedDate !== null && value.endDate < value.plannedDate)
    issue('endDate', '종료일이 시작일보다 빠릅니다.');
  if (value.timeMode === 'date_only') {
    if (value.startAt !== null || value.endAt !== null)
      issue('timeMode', '날짜 기록에는 정확한 시각을 지정할 수 없습니다.');
  } else if (value.startAt === null || value.endAt === null || value.endAt <= value.startAt) {
    issue('endAt', '정확한 시각은 시작과 종료가 필요하며 종료가 시작보다 늦어야 합니다.');
  }
  validateExactDates(value, ctx);
  if (value.kind === 'leave') {
    if (value.leave === null) issue('leave', '휴가 종류를 지정하세요.');
    if (
      value.dueDate !== null ||
      value.endDate !== null ||
      value.timeMode !== 'date_only' ||
      value.startAt !== null ||
      value.endAt !== null
    )
      issue('leave', '최소 휴가는 한 날짜의 시각 없는 기록입니다.');
  } else if (value.leave !== null)
    issue('leave', '휴가가 아닌 업무에는 휴가 상세를 지정할 수 없습니다.');
}

// All editable keys are required after merging; no defaults erase existing values.
export const zWorkEntryMerged = z.strictObject(editableShape).superRefine(validateEditable);
export type WorkEntryMerged = z.infer<typeof zWorkEntryMerged>;

const createShape = {
  id: zWorkEntryId,
  projectId: zWorkEntryId.nullable().default(null),
  title: editableShape.title,
  content: editableShape.content.default(null),
  plannedDate: editableShape.plannedDate.default(null),
  dueDate: editableShape.dueDate.default(null),
  endDate: editableShape.endDate.default(null),
  timeMode: editableShape.timeMode.default('date_only'),
  startAt: editableShape.startAt.default(null),
  endAt: editableShape.endAt.default(null),
  mustFinishToday: editableShape.mustFinishToday.default(false),
  sortOrder: editableShape.sortOrder.default(0),
  tagIds: editableShape.tagIds.default([]),
  reason: reason.optional(),
};
export const zWorkEntryCreate = z
  .discriminatedUnion('kind', [
    z.strictObject({
      ...createShape,
      kind: z.literal('task'),
      status: zTaskStatus.default('todo'),
      allDay: z.boolean().default(true),
    }),
    z.strictObject({
      ...createShape,
      kind: z.enum(['meeting', 'field', 'event', 'etc']),
      status: zEventStatus.default('planned'),
      allDay: z.boolean().default(true),
    }),
    z.strictObject({
      ...createShape,
      kind: z.literal('leave'),
      status: zEventStatus.default('planned'),
      leave: zLeaveInput,
      calculationBasis: zLeaveCalculationBasis,
    }),
  ])
  .superRefine((value, ctx) => {
    validateEditable(
      {
        ...value,
        resumeStatus: null,
        allDay: 'allDay' in value ? value.allDay : value.leave.type === 'full',
        leave: 'leave' in value ? value.leave : null,
      },
      ctx,
    );
    if (value.kind === 'leave' && value.calculationBasis.date !== value.plannedDate)
      ctx.addIssue({
        code: 'custom',
        path: ['calculationBasis', 'date'],
        message: '휴가 날짜와 계산 날짜가 다릅니다.',
      });
  });

// Parent identity, ownership, audit fields and calculated leave amounts are absent.
export const zWorkEntryPatch = z
  .strictObject({
    kind: editableShape.kind.optional(),
    projectId: editableShape.projectId.optional(),
    title: editableShape.title.optional(),
    content: editableShape.content.optional(),
    plannedDate: editableShape.plannedDate.optional(),
    dueDate: editableShape.dueDate.optional(),
    endDate: editableShape.endDate.optional(),
    timeMode: editableShape.timeMode.optional(),
    startAt: editableShape.startAt.optional(),
    endAt: editableShape.endAt.optional(),
    allDay: editableShape.allDay.optional(),
    status: editableShape.status.optional(),
    mustFinishToday: editableShape.mustFinishToday.optional(),
    sortOrder: editableShape.sortOrder.optional(),
    tagIds: editableShape.tagIds.optional(),
    leave: zLeaveInput.optional(),
    calculationBasis: zLeaveCalculationBasis.optional(),
    version: zWorkEntryVersion,
    reason: reason.optional(),
  })
  .superRefine((value, ctx) => {
    const changes = Object.entries(value).filter(
      ([key, field]) =>
        !['version', 'reason', 'calculationBasis'].includes(key) && field !== undefined,
    );
    if (changes.length === 0)
      ctx.addIssue({ code: 'custom', message: '수정할 항목을 지정하세요.' });
  });
export const zWorkEntryStatus = z.strictObject({
  status: zWorkEntryStatusValue,
  version: zWorkEntryVersion,
  reason: reason.optional(),
  calculationBasis: zLeaveCalculationBasis.optional(),
});
export const zWorkEntryDelete = z.strictObject({ version: zWorkEntryVersion });

export const zLeaveDetail = z
  .strictObject({
    id: zWorkEntryId,
    type: zLeaveType,
    workHoursPerDay: zWorkHoursPerDay,
    unavailableHours: z.number().int().positive(),
    deductibleHours: z.number().int().nonnegative(),
  })
  .superRefine((value, ctx) => {
    const divisor = value.type === 'full' ? 1 : value.type.endsWith('_half') ? 2 : 4;
    if (
      value.unavailableHours !== value.workHoursPerDay / divisor ||
      value.deductibleHours !== value.unavailableHours
    )
      ctx.addIssue({ code: 'custom', message: '휴가 종류와 기준에 맞지 않는 시간량입니다.' });
  });
export const zWorkEntryFinal = z
  .strictObject({
    ...editableShape,
    leave: zLeaveDetail.nullable(),
    id: zWorkEntryId,
    companyId: zWorkEntryId,
    completedAt: zWorkEntryEpoch.nullable(),
    createdAt: zWorkEntryEpoch,
    updatedAt: zWorkEntryEpoch,
    version: zWorkEntryVersion,
  })
  .superRefine((value, ctx) => {
    if (value.status === 'paused' && value.completedAt !== null)
      ctx.addIssue({
        code: 'custom',
        path: ['completedAt'],
        message: '중단한 업무에는 완료 시각이 없습니다.',
      });
    validateEditable(value, ctx);
    if (value.plannedDate === null && value.completedAt !== null)
      ctx.addIssue({
        code: 'custom',
        path: ['completedAt'],
        message: '날짜 미정 업무에는 완료 시각이 없습니다.',
      });
    if (value.kind === 'leave') {
      if ((value.status === 'done') !== (value.completedAt !== null))
        ctx.addIssue({
          code: 'custom',
          path: ['completedAt'],
          message: '휴가 상태와 완료 시각이 일치하지 않습니다.',
        });
      if (
        value.leave &&
        value.allDay !== (value.leave.unavailableHours === value.leave.workHoursPerDay)
      )
        ctx.addIssue({
          code: 'custom',
          path: ['allDay'],
          message: '휴가 시간량과 종일 표시가 다릅니다.',
        });
    }
  });

// Fixed history keys preserve omitted-vs-null information without copying text.
export const zWorkEntrySnapshotV1 = z
  .strictObject({
    plannedDate: editableShape.plannedDate,
    dueDate: editableShape.dueDate,
    endDate: editableShape.endDate,
    timeMode: editableShape.timeMode,
    startAt: editableShape.startAt,
    endAt: editableShape.endAt,
    allDay: editableShape.allDay,
    status: z.enum(['todo', 'doing', 'planned', 'done', 'canceled']),
    completedAt: zWorkEntryEpoch.nullable(),
    leave: zLeaveDetail.nullable(),
  })
  .superRefine((value, ctx) => {
    if (value.endDate !== null && value.plannedDate !== null && value.endDate < value.plannedDate)
      ctx.addIssue({ code: 'custom', path: ['endDate'], message: '종료일이 시작일보다 빠릅니다.' });
    if (
      value.timeMode === 'date_only'
        ? value.startAt !== null || value.endAt !== null
        : value.startAt === null || value.endAt === null || value.endAt <= value.startAt
    )
      ctx.addIssue({
        code: 'custom',
        path: ['timeMode'],
        message: '시각 형식이 일치하지 않습니다.',
      });
    if (
      value.plannedDate === null &&
      ((value.status !== 'todo' && value.status !== 'canceled') ||
        value.completedAt !== null ||
        value.endDate !== null ||
        value.timeMode !== 'date_only')
    )
      ctx.addIssue({
        code: 'custom',
        path: ['plannedDate'],
        message: '날짜 미정 기록이 올바르지 않습니다.',
      });
    if (
      value.leave !== null &&
      (value.plannedDate === null ||
        value.dueDate !== null ||
        value.endDate !== null ||
        value.timeMode !== 'date_only' ||
        !zEventStatus.safeParse(value.status).success ||
        (value.status === 'done') !== (value.completedAt !== null) ||
        value.allDay !== (value.leave.unavailableHours === value.leave.workHoursPerDay))
    )
      ctx.addIssue({
        code: 'custom',
        path: ['leave'],
        message: '휴가 이력 값이 일치하지 않습니다.',
      });
  });

// Version 1 remains frozen: do not infer fields that were never recorded.
export const zWorkEntrySnapshot = zWorkEntrySnapshotV1;
export const zWorkEntrySnapshotV2 = zWorkEntrySnapshotV1
  .safeExtend({
    kind: zWorkEntryKind,
    projectId: zWorkEntryId.nullable(),
    tagIds: zWorkEntryTagIds.refine(
      (ids) => ids.every((id, index) => index === 0 || ids[index - 1]! < id),
      '이력 태그는 정렬된 ID 배열이어야 합니다.',
    ),
  })
  .superRefine((value, ctx) => {
    validateEditable(
      {
        ...value,
        resumeStatus: null,
        title: '_',
        content: null,
        mustFinishToday: false,
        sortOrder: 0,
      },
      ctx,
    );
  });
export const zWorkEntrySnapshotV3 = z
  .strictObject({
    kind: editableShape.kind,
    projectId: editableShape.projectId,
    tagIds: editableShape.tagIds,
    plannedDate: editableShape.plannedDate,
    dueDate: editableShape.dueDate,
    endDate: editableShape.endDate,
    timeMode: editableShape.timeMode,
    startAt: editableShape.startAt,
    endAt: editableShape.endAt,
    allDay: editableShape.allDay,
    status: editableShape.status,
    resumeStatus: editableShape.resumeStatus,
    completedAt: zWorkEntryEpoch.nullable(),
    leave: zLeaveDetail.nullable(),
  })
  .superRefine((value, ctx) =>
    validateEditable(
      { ...value, title: '_', content: null, mustFinishToday: false, sortOrder: 0 },
      ctx,
    ),
  )
  .superRefine((value, ctx) => {
    if (value.status === 'paused' && value.completedAt !== null)
      ctx.addIssue({
        code: 'custom',
        path: ['completedAt'],
        message: '중단한 업무에는 완료 시각이 없습니다.',
      });
  });
export const zWorkPause = z.strictObject({ version: zWorkEntryVersion, reason: reason.optional() });
export const zWorkResume = zWorkPause;
const changeShape = {
  id: zWorkEntryId,
  workEntryId: zWorkEntryId,
  entryVersion: zWorkEntryVersion,
  changeType: z.enum(['create', 'edit', 'status', 'cancel', 'restore', 'auto_complete']),
  reason,
  changedAt: zWorkEntryEpoch,
};
export const zWorkEntryChange = z
  .discriminatedUnion('schemaVersion', [
    z.strictObject({
      ...changeShape,
      schemaVersion: z.literal(1),
      before: zWorkEntrySnapshotV1.nullable(),
      after: zWorkEntrySnapshotV1,
    }),
    z.strictObject({
      ...changeShape,
      schemaVersion: z.literal(2),
      before: zWorkEntrySnapshotV2.nullable(),
      after: zWorkEntrySnapshotV2,
    }),
    z.strictObject({
      ...changeShape,
      changeType: z.enum([
        'create',
        'edit',
        'status',
        'cancel',
        'restore',
        'auto_complete',
        'pause',
        'resume',
      ]),
      schemaVersion: z.literal(3),
      before: zWorkEntrySnapshotV3.nullable(),
      after: zWorkEntrySnapshotV3,
    }),
  ])
  .superRefine((value, ctx) => {
    if (
      value.changeType === 'create'
        ? value.before !== null || value.entryVersion !== 1
        : value.before === null || value.entryVersion <= 1
    )
      ctx.addIssue({ code: 'custom', message: '이력 생성 종류와 버전이 일치하지 않습니다.' });
  });
export const zWorkEntryHistory = z.strictObject({ items: z.array(zWorkEntryChange) });

export type WorkEntryCreate = z.infer<typeof zWorkEntryCreate>;
export type WorkEntryPatch = z.infer<typeof zWorkEntryPatch>;
export type WorkEntryStatus = z.infer<typeof zWorkEntryStatus>;
export type WorkEntryFinal = z.infer<typeof zWorkEntryFinal>;
export type WorkEntrySnapshot = z.infer<typeof zWorkEntrySnapshot>;
export type WorkEntrySnapshotV2 = z.infer<typeof zWorkEntrySnapshotV2>;
export type WorkEntryHistory = z.infer<typeof zWorkEntryHistory>;
export type LeaveCalculationBasis = z.infer<typeof zLeaveCalculationBasis>;
export type LeaveType = z.infer<typeof zLeaveType>;
export type WorkHoursPerDay = z.infer<typeof zWorkHoursPerDay>;
export type LeaveStatus = z.infer<typeof zEventStatus>;

export type WorkEntrySnapshotV3 = z.infer<typeof zWorkEntrySnapshotV3>;
