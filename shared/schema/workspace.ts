import { z } from 'zod';

export const zWorkspaceId = z.uuid();
export const zWorkspaceVersion = z.number().int().positive().max(Number.MAX_SAFE_INTEGER);
export const zWorkspaceYear = z.number().int().min(1).max(9999);
export const zWorkspaceDate = z
  .string()
  .regex(/^(?!0000)[0-9]{4}-[0-9]{2}-[0-9]{2}$/, '날짜를 YYYY-MM-DD 형식으로 입력해 주세요.')
  .refine((value) => {
    const millis = Date.parse(`${value}T00:00:00.000Z`);
    return Number.isFinite(millis) && new Date(millis).toISOString().slice(0, 10) === value;
  }, '실제 달력에 있는 날짜를 입력해 주세요.');
const timestamp = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
const audit = {
  id: zWorkspaceId,
  createdAt: timestamp,
  updatedAt: timestamp,
  version: zWorkspaceVersion,
};
export const zCompanyCreate = z.strictObject({
  name: z.string().min(1, '회사명을 입력해 주세요.').max(100),
  startedOn: zWorkspaceDate.nullable().default(null),
  endedOn: zWorkspaceDate.nullable().default(null),
  isCurrent: z.boolean().default(false),
});
export const zWorkspaceCompany = z.strictObject({
  ...audit,
  name: zCompanyCreate.shape.name,
  startedOn: zWorkspaceDate.nullable(),
  endedOn: zWorkspaceDate.nullable(),
  isCurrent: z.boolean(),
  sortOrder: z.number().int(),
});
export type WorkspaceCompany = z.output<typeof zWorkspaceCompany>;
export const zProjectCreate = z.strictObject({
  code: z.string().min(1, '프로젝트 코드를 입력해 주세요.').max(60),
  description: z.string().max(500).nullable().default(null),
  startedOn: zWorkspaceDate.nullable().default(null),
  endedOn: zWorkspaceDate.nullable().default(null),
  isActive: z.boolean().default(true),
  color: z
    .string()
    .regex(/^#[0-9a-fA-F]{6}$/)
    .nullable()
    .default(null),
  defaultTagIds: z
    .array(zWorkspaceId)
    .refine((ids) => new Set(ids).size === ids.length)
    .default([]),
});
export const zProjectUpdate = z.strictObject({
  code: zProjectCreate.shape.code.optional(),
  description: zProjectCreate.shape.description.unwrap().optional(),
  startedOn: zProjectCreate.shape.startedOn.unwrap().optional(),
  endedOn: zProjectCreate.shape.endedOn.unwrap().optional(),
  isActive: zProjectCreate.shape.isActive.unwrap().optional(),
  color: zProjectCreate.shape.color.unwrap().optional(),
  defaultTagIds: zProjectCreate.shape.defaultTagIds.unwrap().optional(),
  version: zWorkspaceVersion,
});
export const zProjectDeactivate = z.strictObject({ version: zWorkspaceVersion });
export const zWorkspaceProject = z.strictObject({
  ...audit,
  companyId: zWorkspaceId,
  code: zProjectCreate.shape.code,
  description: z.string().max(500).nullable(),
  startedOn: zWorkspaceDate.nullable(),
  endedOn: zWorkspaceDate.nullable(),
  isActive: z.boolean(),
  color: z
    .string()
    .regex(/^#[0-9a-fA-F]{6}$/)
    .nullable(),
  defaultTagIds: z.array(zWorkspaceId).refine((ids) => new Set(ids).size === ids.length),
});
export type WorkspaceProject = z.output<typeof zWorkspaceProject>;
export const zWorkspaceTag = z.strictObject({
  id: zWorkspaceId,
  companyId: zWorkspaceId.nullable(),
  label: z.string().min(1).max(40),
  isCore: z.boolean(),
  isActive: z.boolean(),
  sortOrder: z.number().int(),
});
export type WorkspaceTag = z.output<typeof zWorkspaceTag>;
export const zDefaultYearMode = z.enum(['company', 'current']);
export const zWorkspaceSettings = z.strictObject({
  lastCompanyId: z.strictObject({
    value: zWorkspaceId.nullable(),
    version: zWorkspaceVersion.nullable(),
  }),
  defaultYearMode: z.strictObject({
    value: zDefaultYearMode,
    version: zWorkspaceVersion.nullable(),
  }),
});
export type WorkspaceSettings = z.output<typeof zWorkspaceSettings>;
export const zWorkspaceSettingUpdate = z.discriminatedUnion('key', [
  z.strictObject({
    key: z.literal('last_company_id'),
    value: zWorkspaceId.nullable(),
    version: zWorkspaceVersion.nullable(),
  }),
  z.strictObject({
    key: z.literal('default_year_mode'),
    value: zDefaultYearMode,
    version: zWorkspaceVersion.nullable(),
  }),
]);

/** Dates are calendar values. Explicit URL year wins; default uses KST today. */
export function workspaceDefaultYear(
  company: Pick<WorkspaceCompany, 'endedOn'>,
  mode: z.infer<typeof zDefaultYearMode>,
  now = Date.now(),
) {
  if (mode === 'company' && company.endedOn) return Number(company.endedOn.slice(0, 4));
  return new Date(now + 9 * 60 * 60 * 1000).getUTCFullYear();
}
