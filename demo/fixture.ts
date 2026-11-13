type Page = { route: (pattern: string, handler: (route: any) => Promise<any>) => Promise<void> };
import { zWorkEntryCreate, type WorkEntryFinal } from '../shared/schema/work-entry';
import { zWbsPlanner, parseWbsPlannerQuery } from '../shared/schema/wbs-planner';
import { zPlanReport } from '../shared/schema/plan-report';
import { zWorkEntryDuplicateSnapshot } from '../shared/schema/work-duplicate';
import { weekCalendar } from '../shared/week-calendar';
import { zPeriodDocumentScope } from '../shared/schema/period-document';
import { zLeaveLedgerState, LEAVE_LEDGER_SUPPORT } from '../shared/schema/leave-ledger';
import { entryDatesInWeek } from '../shared/week-placement';
import {
  calculateLeaveHours,
  normalizeLeaveState,
  validateLeaveDay,
  workEntrySnapshot,
} from '../shared/work-entry-rules';

export const companyId = '019950d3-b800-7000-8000-000000000001';
export const otherCompany = '019950d3-b800-7000-8000-000000000002';
export const projectId = '019950d3-b800-7000-8000-000000000010';
export const tagId = '019950d3-b800-7000-8000-000000000100';
export const entryId = '019950d3-b800-7000-8000-000000000200';
export const date = '2026-10-01';
export const at = Date.parse('2026-10-01T03:00:00Z');
export const company = {
  id: companyId,
  name: '가상 기록 회사',
  startedOn: null,
  endedOn: null,
  isCurrent: true,
  sortOrder: 0,
  createdAt: at,
  updatedAt: at,
  version: 1,
};
export const project = {
  id: projectId,
  companyId,
  code: 'WEB-01',
  description: null,
  startedOn: null,
  endedOn: null,
  isActive: true,
  color: null,
  defaultTagIds: [tagId],
  createdAt: at,
  updatedAt: at,
  version: 1,
};
export const tags = [
  { id: tagId, companyId: null, label: '[CODE]', isCore: false, isActive: true, sortOrder: 0 },
];
export const task = (patch: Partial<WorkEntryFinal> = {}): WorkEntryFinal => ({
  id: entryId,
  companyId,
  projectId,
  kind: 'task',
  title: '기존 업무',
  content: null,
  plannedDate: date,
  dueDate: null,
  endDate: null,
  timeMode: 'date_only',
  startAt: null,
  endAt: null,
  allDay: true,
  status: 'todo',
  resumeStatus: null,
  mustFinishToday: false,
  sortOrder: 0,
  tagIds: [tagId],
  leave: null,
  completedAt: null,
  createdAt: at,
  updatedAt: at,
  version: 1,
  ...patch,
});
/** Contract-v2 safe read: source, ownership and WBS versions are validated together. */
export const duplicateSnapshot = (entry: WorkEntryFinal) =>
  zWorkEntryDuplicateSnapshot.parse({
    sourceVersion: entry.version,
    entry,
    wbs: { entryId: entry.id, sourceEntryVersion: entry.version, link: null, target: null },
  });
export const url = `/c/${companyId}/week?year=2026&projectId=${projectId}&date=${date}`;
export async function fixture(page: Page, options: { now?: () => number } = {}) {
  const state = {
    userId: 'work-user-a',
    authenticated: true,
    entries: [] as WorkEntryFinal[],
    confirmedPeriods: [] as {
      entryId: string;
      entryVersion: number;
      performedDates: string[];
    }[],
    sourceCategories: new Map<string, string[]>(),
    sourceLabelQueries: [] as string[][],
    posts: [] as Record<string, unknown>[],
    patches: [] as Record<string, unknown>[],
    deletes: 0,
    reads: [] as string[],
    unhandledRequests: [] as string[],
    listQueries: [] as URLSearchParams[],
    contextReads: 0,
    allowTaskInput: false,
    dayVersion: null as number | null,
    hours: 8 as 4 | 8 | 12 | 16,
    settingsVersion: null as number | null,
    weekQueries: [] as URLSearchParams[],
    now: at,
  };
  // Tests retain the historical fixed clock unless a runtime clock is supplied.
  const mutationNow = () => options.now?.() ?? state.now;
  const changes = new Map<string, unknown[]>();
  const record = (
    before: WorkEntryFinal | null, after: WorkEntryFinal, changeType: string,
    changedAt = mutationNow(),
  ) => {
    if (before && !changes.has(after.id))
      record(null, before, 'create', options.now ? before.createdAt : state.now);
    const history = changes.get(after.id) ?? [];
    history.push({
      id: crypto.randomUUID(),
      workEntryId: after.id,
      entryVersion: after.version,
      changeType,
      schemaVersion: 2,
      before: before ? workEntrySnapshot(before) : null,
      after: workEntrySnapshot(after),
      reason: null,
      changedAt,
    });
    changes.set(after.id, history);
  };
  const context = (day: string) => {
    const leaves = state.entries
      .filter((row) => row.kind === 'leave' && row.plannedDate === day)
      .map((row) => ({
        id: row.id,
        companyId,
        plannedDate: day,
        type: row.leave!.type,
        status: row.status as 'planned' | 'done' | 'canceled',
        workHoursPerDay: row.leave!.workHoursPerDay,
      }));
    return {
      calculationBasis: {
        date: day,
        dayVersion: state.dayVersion,
        workHoursPerDay: state.hours,
        settingsVersion: state.settingsVersion,
      },
      day:
        state.dayVersion === null
          ? null
          : {
              date: day,
              version: state.dayVersion,
              workHoursPerDay: state.hours,
              allowTaskInput: state.allowTaskInput,
              createdAt: at,
              updatedAt: at,
            },
      leaves,
      summary: validateLeaveDay({
        companyId,
        date: day,
        workHoursPerDay: state.hours,
        allowTaskInput: state.allowTaskInput,
        existing: leaves,
      }),
    };
  };
  const add = (body: unknown) => {
    const parsed = zWorkEntryCreate.parse(body);
    const row = task();
    const createdAt = options.now ? mutationNow() : at;
    row.createdAt = createdAt;
    row.updatedAt = createdAt;
    for (const [key, value] of Object.entries(parsed))
      if (key in row && key !== 'leave') Object.assign(row, { [key]: value });
    row.leave = null;
    if (parsed.kind === 'leave') {
      const amount = calculateLeaveHours(
        parsed.leave.type,
        parsed.calculationBasis.workHoursPerDay,
      );
      row.leave = {
        id: crypto.randomUUID(),
        type: parsed.leave.type,
        workHoursPerDay: amount.workHoursPerDay,
        unavailableHours: amount.unavailableHours,
        deductibleHours: amount.deductibleHours,
      };
      row.allDay = amount.allDay;
      Object.assign(
        row,
        normalizeLeaveState({ plannedDate: parsed.plannedDate!, status: parsed.status }, null, createdAt),
      );
      state.dayVersion = (state.dayVersion ?? 0) + 1;
    }
    if (options.now && row.kind !== 'leave' && row.status === 'done') row.completedAt = createdAt;
    state.entries.push(row);
    record(null, row, 'create', options.now ? createdAt : state.now);
    return row;
  };
  await page.route('**/api/**', async (route) => {
    const u = new URL(route.request().url()),
      path = u.pathname,
      method = route.request().method();
    if (path === '/api/health') return route.fulfill({ json: { status: 'ok' } });
    if (path === '/api/auth/sign-in/username') {
      state.authenticated = true;
      return route.fulfill({
        json: { userId: state.userId, username: 'work.user', emailVerified: true },
      });
    }
    if (!state.authenticated)
      return route.fulfill({ status: 401, json: { code: 'UNAUTHENTICATED' } });
    if (path === '/api/me')
      return route.fulfill({
        json: {
          userId: state.userId,
          username: 'work.user',
          email: 'work@example.test',
          emailVerified: true,
          lastCompanyId: null,
          capabilities: { manageSignup: false },
        },
      });
    if (path === '/api/settings')
      return route.fulfill({
        json: {
          lastCompanyId: { value: companyId, version: 1 },
          defaultYearMode: { value: 'company', version: null },
        },
      });
    if (path === '/api/companies') return route.fulfill({ json: [company] });
    if (path === `/api/companies/${companyId}`) return route.fulfill({ json: company });
    if (path.endsWith('/projects')) return route.fulfill({ json: [project] });
    if (path.endsWith('/work-tags')) return route.fulfill({ json: tags });
    if (method === 'GET' && !u.search && path === `/api/companies/${companyId}/leave-ledger`) {
      const initial = zLeaveLedgerState.safeParse({
        companyId,
        phase: 'not_started',
        enabled: true,
        ledgerVersion: null,
        currentCutoverId: null,
        setup: null,
        createdAt: null,
        updatedAt: null,
        support: LEAVE_LEDGER_SUPPORT.delivery,
      });
      if (initial.success) return route.fulfill({ json: initial.data });
    }
    // Current weekly overview mounts the regular-WBS reference panel on desktop.
    // Give it a schema-valid, same-company empty plan instead of an unrelated 404.
    if (method === 'GET' && path === `/api/companies/${companyId}/planner`) {
      const { year } = parseWbsPlannerQuery(u.searchParams);
      return route.fulfill({
        json: zWbsPlanner.parse({
          companyId,
          year,
          asOf: state.now,
          projects: [
            {
              id: project.id,
              companyId,
              code: project.code,
              color: project.color,
              isActive: project.isActive,
              version: project.version,
              plans: [],
            },
          ],
        }),
      });
    }
    const documentMatch =
      /^\/api\/companies\/([^/]+)\/period-documents\/(weekly_report|weekly_note|daily_note)\/(\d{4}-\d{2}-\d{2})$/.exec(
        path,
      );
    if (method === 'GET' && !u.search && documentMatch?.[1] === companyId) {
      const scope = zPeriodDocumentScope.safeParse({
        companyId,
        kind: documentMatch[2],
        periodStart: documentMatch[3],
      });
      if (scope.success) return route.fulfill({ json: { ...scope.data, document: null } });
    }
    const goalsMatch = /^\/api\/companies\/([^/]+)\/weeks\/([0-9]+)\/([0-9]+)\/goals$/.exec(path);
    if (goalsMatch && route.request().method() === 'GET') {
      return route.fulfill({
        json: {
          companyId: goalsMatch[1],
          isoYear: Number(goalsMatch[2]),
          isoWeek: Number(goalsMatch[3]),
          items: [],
        },
      });
    }
    const summaryMatch = /^\/api\/companies\/([^/]+)\/weeks\/([0-9]+)\/([0-9]+)\/summary$/.exec(
      path,
    );
    if (summaryMatch && route.request().method() === 'GET') {
      const calendar = weekCalendar(Number(summaryMatch[2]), Number(summaryMatch[3]));
      const now = Date.now(),
        finalized = now >= calendar.endAtExclusive;
      const asOf = finalized ? calendar.endAtExclusive : now;
      return route.fulfill({
        json: {
          report: {
            companyId: summaryMatch[1],
            isoYear: calendar.isoYear,
            isoWeek: calendar.isoWeek,
            mode: finalized ? 'historical' : 'live',
            asOf,
            finalized,
            coverage: 'unknown',
            items: [],
            achievement: null,
          },
          groups: { completed: [], incomplete: [], paused: [], canceled: [] },
          tags: [],
          movements: [],
          history: {
            coverage: 'unknown',
            scope: 'report_sources',
            from: calendar.startAt,
            toExclusive: Math.max(calendar.startAt, Math.min(asOf + 1, calendar.endAtExclusive)),
            missingSourceIds: [],
            legacySourceIds: [],
          },
        },
      });
    }
    // WeekReport mounts with the overview; an absent unrelated endpoint must not
    // manufacture a second alert in record validation/error scenarios.
    const reportMatch = /^\/api\/companies\/([^/]+)\/weeks\/([0-9]+)\/([0-9]+)\/report$/.exec(path);
    if (method === 'GET' && reportMatch?.[1] === companyId) {
      const calendar = weekCalendar(Number(reportMatch[2]), Number(reportMatch[3]));
      const finalized = Date.now() >= calendar.endAtExclusive;
      return route.fulfill({
        json: zPlanReport.parse({
          companyId,
          isoYear: calendar.isoYear,
          isoWeek: calendar.isoWeek,
          mode: finalized ? 'historical' : 'live',
          asOf: finalized ? calendar.endAtExclusive : Date.now(),
          finalized,
          coverage: 'unknown',
          items: [],
          achievement: null,
        }),
      });
    }
    const focusMatch = /^\/api\/companies\/([^/]+)\/monthly-focus-items$/.exec(path);
    if (focusMatch && route.request().method() === 'GET') {
      const query = new URL(route.request().url()).searchParams;
      return route.fulfill({
        json: {
          companyId: focusMatch[1],
          year: Number(query.get('year')),
          month: Number(query.get('month')),
          items: [],
        },
      });
    }
    const deadlineMatch = /^\/api\/companies\/([^/]+)\/weeks\/([0-9]+)\/([0-9]+)\/deadlines$/.exec(
      path,
    );
    if (deadlineMatch && route.request().method() === 'GET') {
      const calendar = weekCalendar(Number(deadlineMatch[2]), Number(deadlineMatch[3]));
      return route.fulfill({
        json: {
          companyId: deadlineMatch[1],
          isoYear: calendar.isoYear,
          isoWeek: calendar.isoWeek,
          items: [],
          nextCursor: null,
        },
      });
    }
    const weekMatch = /^\/api\/companies\/([^/]+)\/weeks\/([0-9]+)\/([0-9]+)$/.exec(path);
    if (weekMatch) {
      state.weekQueries.push(u.searchParams);
      const calendar = weekCalendar(Number(weekMatch[2]), Number(weekMatch[3]));
      const all = state.entries.filter((entry) => entryDatesInWeek(entry, calendar).length > 0);
      const statuses = u.searchParams.getAll('statuses');
      const matching = all
        .filter((entry) => !statuses.length || statuses.includes(entry.status))
        .filter(
          (entry) =>
            !u.searchParams.get('keyword') || entry.title.includes(u.searchParams.get('keyword')!),
        )
        .filter(
          (entry) =>
            !u.searchParams.get('projectIds') ||
            entry.projectId === u.searchParams.get('projectIds'),
        );
      const offset = Number(u.searchParams.get('cursor')?.replace('page-', '') ?? 0);
      const limit = Number(u.searchParams.get('limit') ?? 100);
      const pageEntries = matching.slice(offset, offset + limit);
      return route.fulfill({
        json: {
          companyId,
          projection: u.searchParams.get('projection') ?? undefined,
          isoYear: calendar.isoYear,
          isoWeek: calendar.isoWeek,
          weekStart: calendar.weekStart,
          weekEnd: calendar.weekEnd,
          days: calendar.days
            .filter(
              (day) =>
                !day.isWeekend ||
                all.some((entry) => entryDatesInWeek(entry, calendar).includes(day.date)),
            )
            .map((day) => ({
              ...day,
              entries: pageEntries.filter((entry) =>
                entryDatesInWeek(entry, calendar).includes(day.date),
              ),
              calculationBasis: context(day.date).calculationBasis,
              inputPolicy: { allowTaskInput: state.allowTaskInput, version: state.dayVersion },
              leaveSummary: context(day.date).summary,
            })),
          nextCursor: offset + limit < matching.length ? `page-${offset + limit}` : null,
        },
      });
    }
    if (path.endsWith('/leave-context')) {
      state.contextReads++;
      return route.fulfill({ json: context(path.split('/').at(-2)!) });
    }
    if (path.endsWith('/input-policy')) {
      const body = route.request().postDataJSON();
      if (body.version !== state.dayVersion)
        return route.fulfill({ status: 409, json: { code: 'VERSION_CONFLICT' } });
      state.allowTaskInput = body.allowTaskInput;
      state.dayVersion = (state.dayVersion ?? 0) + 1;
      return route.fulfill({ json: context(path.split('/').at(-2)!).day });
    }
    if (path === `/api/companies/${companyId}/work-entry-source-labels` && method === 'GET') {
      const ids = u.searchParams.getAll('ids');
      state.sourceLabelQueries.push(ids);
      return route.fulfill({
        json: {
          companyId,
          available: true,
          items: state.entries.flatMap((entry) => {
            const sourceCategories = state.sourceCategories.get(entry.id);
            return ids.includes(entry.id) && sourceCategories?.length
              ? [{ entryId: entry.id, entryVersion: entry.version, sourceCategories }]
              : [];
          }),
        },
      });
    }
    if (path === `/api/companies/${companyId}/confirmed-work-periods` && method === 'GET') {
      const ids = new Set(u.searchParams.getAll('ids'));
      return route.fulfill({
        json: {
          companyId,
          available: true,
          items: state.confirmedPeriods.filter((period) => ids.has(period.entryId)),
        },
      });
    }
    if (path === `/api/companies/${companyId}/work-entries`) {
      if (method === 'POST') {
        const body = route.request().postDataJSON();
        state.posts.push(body);
        return route.fulfill({ status: 201, json: add(body) });
      }
      state.listQueries.push(u.searchParams);
      const statuses = u.searchParams.getAll('statuses');
      if (statuses.some((value) => value.includes(',')))
        return route.fulfill({ status: 400, json: { code: 'VALIDATION_FAILED' } });
      const values = state.entries
        .filter((row) =>
          u.searchParams.get('dateState') === 'unscheduled'
            ? row.plannedDate === null
            : row.plannedDate !== null &&
              row.plannedDate <= u.searchParams.get('to')! &&
              (row.endDate ?? row.plannedDate) >= u.searchParams.get('from')!,
        )
        .filter((row) => !statuses.length || statuses.includes(row.status))
        .filter(
          (row) =>
            !u.searchParams.get('keyword') || row.title.includes(u.searchParams.get('keyword')!),
        );
      return route.fulfill({ json: { items: values, nextCursor: null } });
    }
    const match = /^\/api\/work-entries\/([^/]+)(?:\/(status|changes))?$/.exec(path);
    if (match) {
      const row = state.entries.find((entry) => entry.id === match[1]);
      if (method === 'GET' && !match[2]) state.reads.push(match[1]!);
      if (!row) return route.fulfill({ status: 403, json: { code: 'FORBIDDEN' } });
      if (match[2] === 'changes')
        return route.fulfill({
          json: {
            items: changes.get(row.id) ?? [
              {
                id: crypto.randomUUID(),
                workEntryId: row.id,
                entryVersion: 1,
                changeType: 'create',
                schemaVersion: 2,
                before: null,
                after: workEntrySnapshot(row),
                reason: null,
                changedAt: row.createdAt,
              },
            ],
          },
        });
      if (method === 'GET') return route.fulfill({ json: row });
      const body = route.request().postDataJSON();
      if (body.version !== row.version)
        return route.fulfill({ status: 409, json: { code: 'VERSION_CONFLICT' } });
      if (method === 'DELETE') {
        state.deletes++;
        state.entries = state.entries.filter((entry) => entry.id !== row.id);
        return route.fulfill({ json: { deleted: true, id: row.id } });
      }
      state.patches.push(body);
      const changedAt = mutationNow();
      const before = structuredClone(row);
      for (const [key, value] of Object.entries(body))
        if (key in row && key !== 'version') Object.assign(row, { [key]: value });
      if (row.kind === 'leave') {
        const type = row.leave!.type;
        const amount = calculateLeaveHours(type, state.hours);
        row.leave = {
          id: before.leave!.id,
          type,
          workHoursPerDay: state.hours,
          unavailableHours: amount.unavailableHours,
          deductibleHours: amount.deductibleHours,
        };
        Object.assign(
          row,
          normalizeLeaveState(
            {
              plannedDate: row.plannedDate!,
              status: row.status as 'planned' | 'done' | 'canceled',
            },
            {
              plannedDate: before.plannedDate!,
              status: before.status as 'planned' | 'done' | 'canceled',
              completedAt: before.completedAt,
            },
            changedAt,
          ),
        );
        state.dayVersion = (state.dayVersion ?? 0) + 1;
      } else
        row.completedAt =
          row.status === 'done'
            ? before.status === 'done'
              ? before.completedAt
              : changedAt
            : null;
      row.version++;
      row.updatedAt = options.now ? changedAt : at + 1;
      record(
        before,
        row,
        row.status === 'canceled'
          ? 'cancel'
          : before.status === 'canceled'
            ? 'restore'
            : row.kind !== before.kind
              ? 'edit'
              : 'status',
        changedAt,
      );
      return route.fulfill({ json: row });
    }
    state.unhandledRequests.push(`${method} ${path}${u.search}`);
    return route.fulfill({ status: 404, json: { code: 'NOT_FOUND' } });
  });
  return { state, add, context };
}
