import { zWorkEntryFinal } from '../schema/work-entry';
import { weekCalendar } from '../week-calendar';
import {
  EXPORT_ENTITIES,
  EXPORT_ENTITIES_V2,
  EXPORT_ENTITIES_V3,
  EXPORT_ENTITIES_V4,
  EXPORT_PRIMARY_REASONS,
  EXPORT_SUPPORT_REASONS,
  zExportDatasetV5,
  zExportRangeScope,
  type ExportRangeScope,
  type ExportRangeRow,
  type ExportDatasetV5,
  EXPORT_SCHEMA_FAMILIES_V4,
  EXPORT_SCHEMA_FAMILIES_V4_UNKNOWN_COMPLETION,
  EXPORT_SCHEMA_FAMILIES_V4_CALENDAR_RECURRENCE,
  zExportDatasetV4,
  EXPORT_LEAVE_HISTORY_PATHS,
  type ExportDatasetV4,
  type ExportEntityV4,
  type ExportRelationshipV4,
  EXPORT_SCHEMA_FAMILIES_V3,
  zExportDatasetV3,
  zExportRecurrenceRuleResult,
  zExportRecurrenceGenerationResult,
  exportRecurrenceRequestSchemas,
  exportRecurrenceResultSchemas,
  type ExportDatasetV3,
  type ExportEntityV3,
  type ExportRelationshipV3,
  EXPORT_SCHEMA_FAMILIES_V2,
  zExportDatasetV2,
  type ExportDatasetV2,
  type ExportEntityV2,
  type ExportRelationshipV2,
  EXPORT_SCHEMA_FAMILIES,
  EXPORT_LIMITS,
  ExportError,
  zExportDatasetV1,
  zExportScope,
  type ExportDatasetV1,
  type ExportEntity,
  type ExportRelationship,
} from '../schema/export-dataset';

export type JsonValue =
  null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };
export const compareCodeUnits = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
/** Canonical JSON: object keys sorted by UTF-16 code units, arrays keep their meaning. */
export function canonicalJson(value: unknown): string {
  const active = new Set<object>();
  function walk(v: unknown): string {
    if (v === null || typeof v === 'boolean' || typeof v === 'string') return JSON.stringify(v);
    if (typeof v === 'number') {
      if (!Number.isSafeInteger(v) || Object.is(v, -0)) throw new ExportError('DATASET_CORRUPT');
      return String(v);
    }
    if (typeof v !== 'object' || active.has(v)) throw new ExportError('DATASET_CORRUPT');
    const proto = Object.getPrototypeOf(v);
    if (!Array.isArray(v) && proto !== Object.prototype && proto !== null)
      throw new ExportError('DATASET_CORRUPT');
    if (Reflect.ownKeys(v).some((k) => typeof k !== 'string'))
      throw new ExportError('DATASET_CORRUPT');
    active.add(v);
    let result: string;
    if (Array.isArray(v)) {
      if (
        Object.keys(v).length !== v.length ||
        Object.keys(v).some(
          (k, i) => k !== String(i) || !('value' in Object.getOwnPropertyDescriptor(v, k)!),
        )
      )
        throw new ExportError('DATASET_CORRUPT');
      result = '[' + v.map(walk).join(',') + ']';
    } else {
      result =
        '{' +
        Object.keys(v)
          .sort(compareCodeUnits)
          .map((k) => {
            const d = Object.getOwnPropertyDescriptor(v, k);
            if (!d || !('value' in d) || !d.enumerable) throw new ExportError('DATASET_CORRUPT');
            return JSON.stringify(k) + ':' + walk(d.value);
          })
          .join(',') +
        '}';
    }
    active.delete(v);
    return result;
  }
  return walk(value);
}
export function freezeExport<T>(v: T): T {
  if (v && typeof v === 'object') {
    for (const item of Object.values(v)) freezeExport(item);
    Object.freeze(v);
  }
  return v;
}
export function exportRowKey(entity: ExportEntityV4, row: unknown): string {
  const r = row as Record<string, unknown>;
  const fields: Partial<Record<ExportEntityV4, string[]>> = {
    leaveLedgerStates: ['companyId'],
    leavePolicies: ['companyId', 'year'],
    leaveEntryAccounting: ['companyId', 'leaveEntryId'],
    projectDefaultTags: ['projectId', 'workTagId'],
    workEntryTags: ['workEntryId', 'workTagId'],
    noteTagLinks: ['noteId', 'noteTagId'],
    recurrenceRuleRevisions: ['ruleId', 'revision'],
    recurrenceRuleTags: ['ruleId', 'revision', 'workTagId'],
    recurrenceOccurrences: ['ruleId', 'occurrenceDate'],
    recurrenceGeneratedRanges: ['ruleId', 'revision', 'isoYear', 'isoWeek'],
    companyDayStates: ['companyId', 'date'],
    weeklyPlanEntries: ['companyId', 'sourceEntryId', 'isoYear', 'isoWeek'],
    weeklyReports: ['companyId', 'isoYear', 'isoWeek'],
    goalWbsSources: ['goalId'],
    periodDocuments: ['companyId', 'kind', 'periodStart'],
    importOrigins: ['receiptId'],
  };
  return canonicalJson((fields[entity] ?? ['id']).map((k) => r[k]));
}
export type PreparedExportDataset = {
  dataset: ExportDatasetV1;
  relationships: ExportRelationship[];
  entityCounts: Record<ExportEntity, number>;
  relationCounts: { live: number; historical: number };
  canonicalDataset: string;
};
export function prepareExportDataset(input: unknown): PreparedExportDataset {
  try {
    return prepare(input, 1) as PreparedExportDataset;
  } catch (error) {
    if (error instanceof ExportError) throw error;
    throw new ExportError('DATASET_CORRUPT');
  }
}
export type PreparedExportDatasetV2 = {
  dataset: ExportDatasetV2;
  relationships: ExportRelationshipV2[];
  entityCounts: Record<ExportEntityV2, number>;
  relationCounts: { live: number; historical: number };
  canonicalDataset: string;
};
export function prepareExportDatasetV2(input: unknown): PreparedExportDatasetV2 {
  try {
    return prepare(input, 2) as PreparedExportDatasetV2;
  } catch (error) {
    if (error instanceof ExportError) throw error;
    throw new ExportError('DATASET_CORRUPT');
  }
}
export type PreparedExportDatasetV3 = {
  dataset: ExportDatasetV3;
  relationships: ExportRelationshipV3[];
  entityCounts: Record<ExportEntityV3, number>;
  relationCounts: { live: number; historical: number };
  canonicalDataset: string;
};
export function prepareExportDatasetV3(input: unknown): PreparedExportDatasetV3 {
  try {
    return prepare(input, 3) as PreparedExportDatasetV3;
  } catch (error) {
    if (error instanceof ExportError) throw error;
    throw new ExportError('DATASET_CORRUPT');
  }
}
export type PreparedExportDatasetV4 = {
  dataset: ExportDatasetV4;
  relationships: ExportRelationshipV4[];
  entityCounts: Record<ExportEntityV4, number>;
  relationCounts: { live: number; historical: number };
  canonicalDataset: string;
};
export function prepareExportDatasetV4(input: unknown): PreparedExportDatasetV4 {
  try {
    return prepare(input, 4) as PreparedExportDatasetV4;
  } catch (error) {
    if (error instanceof ExportError) throw error;
    throw new ExportError('DATASET_CORRUPT');
  }
}
function prepare(
  input: unknown,
  projectionVersion: 1 | 2 | 3 | 4,
): {
  dataset: ExportDatasetV1 | ExportDatasetV2 | ExportDatasetV3 | ExportDatasetV4;
  relationships: ExportRelationshipV4[];
  entityCounts: Record<ExportEntityV4, number>;
  relationCounts: { live: number; historical: number };
  canonicalDataset: string;
} {
  const v2 = projectionVersion >= 2;
  const registry =
    projectionVersion === 4
      ? EXPORT_ENTITIES_V4
      : projectionVersion === 3
        ? EXPORT_ENTITIES_V3
        : v2
          ? EXPORT_ENTITIES_V2
          : EXPORT_ENTITIES;
  const baseFamilies =
    projectionVersion === 4
      ? EXPORT_SCHEMA_FAMILIES_V4
      : projectionVersion === 3
        ? EXPORT_SCHEMA_FAMILIES_V3
        : v2
          ? EXPORT_SCHEMA_FAMILIES_V2
          : EXPORT_SCHEMA_FAMILIES;
  // Reject accessors, cycles, non-JSON values and unsafe integers before Zod can project.
  const raw = canonicalJson(input);
  if (new TextEncoder().encode(raw).byteLength > EXPORT_LIMITS.datasetBytes)
    throw new ExportError('EXPORT_LIMIT_EXCEEDED', 'datasetBytes');
  const rawValue = JSON.parse(raw) as Record<string, unknown>;
  const families =
    projectionVersion === 4 &&
    Array.isArray(rawValue.schemaFamilies) &&
    rawValue.schemaFamilies.includes('0012')
      ? EXPORT_SCHEMA_FAMILIES_V4_CALENDAR_RECURRENCE
      : projectionVersion === 4 &&
          Array.isArray(rawValue.schemaFamilies) &&
          rawValue.schemaFamilies.includes('0011')
        ? EXPORT_SCHEMA_FAMILIES_V4_UNKNOWN_COMPLETION
        : baseFamilies;
  if (!zExportScope.safeParse(rawValue.scope).success) throw new ExportError('INVALID_SCOPE');
  if (
    rawValue.formatVersion !== projectionVersion ||
    !Array.isArray(rawValue.schemaFamilies) ||
    rawValue.schemaFamilies.length !== families.length ||
    families.some((f) => !(rawValue.schemaFamilies as unknown[]).includes(f))
  )
    throw new ExportError('UNSUPPORTED_SCHEMA');
  const rawData = rawValue.data as Record<string, unknown> | undefined;
  if (rawData) {
    const histories = Array.isArray(rawData.workEntryChanges) ? [...rawData.workEntryChanges] : [];
    if (Array.isArray(rawData.importOrigins))
      for (const r of rawData.importOrigins)
        if (r && typeof r === 'object') histories.push(r.retainedOriginalHistory);
    for (const h of histories)
      if (
        h &&
        typeof h === 'object' &&
        'schemaVersion' in h &&
        ![1, 2, 3].includes(h.schemaVersion)
      )
        throw new ExportError('UNSUPPORTED_HISTORY_VERSION');
    if (Array.isArray(rawData.wbsCompletions))
      for (const r of rawData.wbsCompletions)
        if (r && typeof r === 'object' && 'actor' in r && r.actor !== 'self')
          throw new ExportError('UNSUPPORTED_ACTOR');
    if (Array.isArray(rawData.periodDocuments))
      for (const r of rawData.periodDocuments)
        if (
          r &&
          typeof r === 'object' &&
          (('updatedActor' in r && r.updatedActor !== 'self') ||
            ('confirmedActor' in r && r.confirmedActor !== null && r.confirmedActor !== 'self'))
        )
          throw new ExportError('UNSUPPORTED_ACTOR');
  }
  const parsed = (
    projectionVersion === 4
      ? zExportDatasetV4
      : projectionVersion === 3
        ? zExportDatasetV3
        : v2
          ? zExportDatasetV2
          : zExportDatasetV1
  ).safeParse(rawValue);
  if (!parsed.success) throw new ExportError('DATASET_CORRUPT');
  if (canonicalJson(parsed.data) !== raw) throw new ExportError('DATASET_CORRUPT');
  const dataset = parsed.data,
    d = dataset.data as ExportDatasetV4['data'],
    company = dataset.scope.companyId;
  if (d.companies.length !== 1 || d.companies[0]!.id !== company)
    throw new ExportError('INVALID_SCOPE');
  if (
    dataset.schemaFamilies.length !== families.length ||
    new Set(dataset.schemaFamilies).size !== families.length ||
    families.some((f) => !(dataset.schemaFamilies as readonly string[]).includes(f))
  )
    throw new ExportError('UNSUPPORTED_SCHEMA');
  dataset.schemaFamilies.sort(compareCodeUnits);
  const indexes = new Map<ExportEntityV4, Map<string, Record<string, unknown>>>();
  const entities = {} as Record<ExportEntityV4, number>;
  let count = 0;
  for (const e of registry) {
    const rows = d[e] as unknown as Record<string, unknown>[];
    rows.sort((a, b) => compareCodeUnits(exportRowKey(e, a), exportRowKey(e, b)));
    const map = new Map<string, Record<string, unknown>>();
    indexes.set(e, map);
    for (const r of rows) {
      const k = exportRowKey(e, r);
      if (map.has(k)) throw new ExportError('RELATION_INVALID');
      map.set(k, r);
      if (
        'companyId' in r &&
        r.companyId !== company &&
        !(r.companyId === null && (e === 'workTags' || e === 'noteTags'))
      )
        throw new ExportError('INVALID_SCOPE');
    }
    count += rows.length;
    entities[e] = rows.length;
  }
  if (count > EXPORT_LIMITS.logicalRows)
    throw new ExportError('EXPORT_LIMIT_EXCEEDED', 'logicalRows');
  const relationshipKeys = new Set<string>();
  const rels: ExportRelationshipV4[] = [],
    usedCommon = new Set<string>();
  function find(e: ExportEntityV4, id: string) {
    return indexes.get(e)!.get(canonicalJson([id]));
  }
  function relation(
    from: ExportEntityV4,
    row: unknown,
    to: ExportEntityV4,
    target: string | null,
    type: 'live' | 'historical',
    slot: string,
    customKey?: string,
  ) {
    if (target === null) return;
    const exists = customKey ? indexes.get(to)!.has(customKey) : !!find(to, target);
    if (!exists && type === 'live') throw new ExportError('RELATION_INVALID');
    if (to === 'workTags') usedCommon.add(target);
    const fromId = exportRowKey(from, row),
      key = canonicalJson([from, fromId, slot, to, target]);
    if (relationshipKeys.has(key)) throw new ExportError('RELATION_INVALID');
    relationshipKeys.add(key);
    rels.push({
      key,
      relationType: type,
      fromEntity: from,
      fromId,
      toEntity: to,
      toId: target,
      presence: exists ? 'present' : 'absentHistorical',
      provenance: exists || type === 'live' ? 'scope-verified' : 'historical-unverified',
    });
  }
  const live = (
    a: ExportEntityV4,
    r: unknown,
    b: ExportEntityV4,
    id: string | null,
    slot: string,
  ) => relation(a, r, b, id, 'live', slot);
  const hist = (
    a: ExportEntityV4,
    r: unknown,
    b: ExportEntityV4,
    id: string | null,
    slot: string,
  ) => relation(a, r, b, id, 'historical', slot);
  function snapshotRefs(a: ExportEntityV4, row: unknown, value: unknown, slot: string) {
    if (!value || typeof value !== 'object') return;
    const v = value as {
      projectId?: string | null;
      project?: { id: string } | null;
      tagIds?: string[];
      tags?: { id: string }[];
    };
    if (v.projectId) hist(a, row, 'projects', v.projectId, slot + '.projectId');
    if (v.project) hist(a, row, 'projects', v.project.id, slot + '.project');
    for (const [i, id] of (v.tagIds ?? []).entries())
      hist(a, row, 'workTags', id, slot + '.tagIds.' + i);
    for (const [i, t] of (v.tags ?? []).entries())
      hist(a, row, 'workTags', t.id, slot + '.tags.' + i);
  }
  for (const e of registry)
    for (const row of d[e])
      if ('companyId' in row && row.companyId !== null)
        live(e, row, 'companies', row.companyId, 'company');
  for (const r of d.projectDefaultTags) {
    live('projectDefaultTags', r, 'projects', r.projectId, 'project');
    live('projectDefaultTags', r, 'workTags', r.workTagId, 'tag');
  }
  for (const r of d.workEntryTags) {
    live('workEntryTags', r, 'workEntries', r.workEntryId, 'entry');
    live('workEntryTags', r, 'workTags', r.workTagId, 'tag');
  }
  const leaveByEntry = new Map<string, (typeof d.leaveEntries)[number]>();
  for (const r of d.leaveEntries) {
    live('leaveEntries', r, 'workEntries', r.workEntryId, 'entry');
    if (leaveByEntry.has(r.workEntryId)) throw new ExportError('RELATION_INVALID');
    leaveByEntry.set(r.workEntryId, r);
  }
  for (const r of d.workEntries) {
    live('workEntries', r, 'projects', r.projectId, 'project');
    if (r.plannedDate !== null)
      relation(
        'workEntries',
        r,
        'companyDayStates',
        canonicalJson([company, r.plannedDate]),
        'live',
        'day',
        canonicalJson([company, r.plannedDate]),
      );
    const leave = leaveByEntry.get(r.id),
      entry = r;
    const full = {
      ...entry,
      tagIds: d.workEntryTags.filter((t) => t.workEntryId === r.id).map((t) => t.workTagId),
      leave: leave
        ? {
            id: leave.id,
            type: leave.leaveType,
            workHoursPerDay: leave.workHoursPerDaySnapshot,
            unavailableHours: leave.unavailableHours,
            deductibleHours: leave.deductibleHours,
          }
        : null,
    };
    if (!zWorkEntryFinal.safeParse(full).success || !!leave !== (r.kind === 'leave'))
      throw new ExportError('DATASET_CORRUPT');
  }
  const historyVersions = new Set<string>();
  for (const r of d.workEntryChanges) {
    live('workEntryChanges', r, 'workEntries', r.workEntryId, 'entry');
    const current = find('workEntries', r.workEntryId)!;
    const k = canonicalJson([r.workEntryId, r.entryVersion]);
    if (historyVersions.has(k) || r.entryVersion > Number(current.version))
      throw new ExportError('RELATION_INVALID');
    historyVersions.add(k);
    snapshotRefs('workEntryChanges', r, r.before, 'before');
    snapshotRefs('workEntryChanges', r, r.after, 'after');
  }
  for (const r of d.weeklyPlanEntries) {
    const c = weekCalendar(r.isoYear, r.isoWeek),
      s = r.storedSnapshot;
    if (
      r.weekStart !== c.weekStart ||
      r.weekEndAt !== c.endAtExclusive ||
      s.sourceEntryId !== r.sourceEntryId ||
      s.sourceVersion !== r.sourceVersion ||
      s.sourceDeleted ||
      r.sourcePresenceAtExport !==
        (find('workEntries', r.sourceEntryId) ? 'present' : 'absentHistorical')
    )
      throw new ExportError('RELATION_INVALID');
    hist('weeklyPlanEntries', r, 'workEntries', r.sourceEntryId, 'source');
    snapshotRefs('weeklyPlanEntries', r, s, 'storedSnapshot');
  }
  for (const r of d.weeklyGoals) hist('weeklyGoals', r, 'workEntries', r.sourceEntryId, 'source');
  for (const r of d.goalPlacements) {
    if (
      (r.sourceEntryId === null) !== (r.sourceVersion === null) ||
      (r.intent === 'continue' && (r.sourceEntryId !== r.workEntryId || r.sourceEntryId === null))
    )
      throw new ExportError('RELATION_INVALID');
    hist('goalPlacements', r, 'weeklyGoals', r.goalId, 'goal');
    hist('goalPlacements', r, 'workEntries', r.sourceEntryId, 'source');
    hist('goalPlacements', r, 'workEntries', r.workEntryId, 'entry');
  }
  for (const r of d.wbsPlans) live('wbsPlans', r, 'projects', r.projectId, 'project');
  for (const r of d.wbsItems) live('wbsItems', r, 'wbsPlans', r.wbsPlanId, 'plan');
  for (const r of d.wbsScheduleChanges) {
    live('wbsScheduleChanges', r, 'wbsItems', r.wbsItemId, 'item');
    if (r.itemVersion > Number(find('wbsItems', r.wbsItemId)!.version))
      throw new ExportError('RELATION_INVALID');
  }
  const linkedEntries = new Set<string>();
  for (const r of d.wbsWorkLinks) {
    live('wbsWorkLinks', r, 'workEntries', r.workEntryId, 'entry');
    live('wbsWorkLinks', r, 'wbsItems', r.wbsItemId, 'item');
    if (linkedEntries.has(r.workEntryId) || find('workEntries', r.workEntryId)!.kind !== 'task')
      throw new ExportError('RELATION_INVALID');
    linkedEntries.add(r.workEntryId);
  }
  for (const r of d.goalWbsSources) {
    live('goalWbsSources', r, 'weeklyGoals', r.goalId, 'goal');
    hist('goalWbsSources', r, 'wbsItems', r.originalItemId, 'originalItem');
    hist('goalWbsSources', r, 'wbsPlans', r.originalPlanId, 'originalPlan');
    if (r.liveItemId !== null) {
      if (
        r.liveItemId !== r.originalItemId ||
        find('wbsItems', r.liveItemId)?.wbsPlanId !== r.originalPlanId
      )
        throw new ExportError('RELATION_INVALID');
      live('goalWbsSources', r, 'wbsItems', r.liveItemId, 'liveItem');
    }
    if (find('weeklyGoals', r.goalId)!.sourceEntryId !== null)
      throw new ExportError('RELATION_INVALID');
  }
  for (const r of d.wbsCompletions) {
    live('wbsCompletions', r, 'wbsItems', r.wbsItemId, 'item');
    live('wbsCompletions', r, 'wbsPlans', r.wbsPlanId, 'plan');
    if (find('wbsItems', r.wbsItemId)!.wbsPlanId !== r.wbsPlanId)
      throw new ExportError('RELATION_INVALID');
    const ids = new Set<string>(),
      entryIds = new Set<string>(),
      counts = { todo: 0, doing: 0, paused: 0, done: 0, canceled: 0 };
    for (const [i, t] of r.linkedState.entries()) {
      if (ids.has(t[0]) || entryIds.has(t[2])) throw new ExportError('RELATION_INVALID');
      ids.add(t[0]);
      entryIds.add(t[2]);
      counts[t[4]]++;
      hist('wbsCompletions', r, 'workEntries', t[2], 'linkedState.' + i);
    }
    for (const k of ['todo', 'doing', 'paused', 'done', 'canceled'] as const)
      if (r[k] !== counts[k]) throw new ExportError('RELATION_INVALID');
  }
  for (const r of d.importOrigins) {
    if (
      r.retainedOriginalEntry.id !== r.entryId ||
      r.retainedOriginalEntry.companyId !== company ||
      r.retainedOriginalHistory.companyId !== company ||
      r.retainedOriginalHistory.workEntryId !== r.entryId ||
      r.currentEntryPresence !== (find('workEntries', r.entryId) ? 'present' : 'absentHistorical')
    )
      throw new ExportError('RELATION_INVALID');
    if (
      r.retainedOriginalEntry.version !== 1 ||
      r.retainedOriginalHistory.entryVersion !== 1 ||
      r.retainedOriginalHistory.changeType !== 'create'
    )
      throw new ExportError('RELATION_INVALID');
    hist('importOrigins', r, 'workEntries', r.entryId, 'entry');
    snapshotRefs('importOrigins', r, r.retainedOriginalEntry, 'retainedOriginalEntry');
    snapshotRefs(
      'importOrigins',
      r,
      r.retainedOriginalHistory.before,
      'retainedOriginalHistory.before',
    );
    snapshotRefs(
      'importOrigins',
      r,
      r.retainedOriginalHistory.after,
      'retainedOriginalHistory.after',
    );
  }
  if (projectionVersion >= 3) {
    const data = d as ExportDatasetV3['data'];
    const revisionKey = (ruleId: string, revision: number) => canonicalJson([ruleId, revision]);
    const revision = (ruleId: string, number: number) =>
      indexes.get('recurrenceRuleRevisions')!.get(revisionKey(ruleId, number)) as
        (typeof data.recurrenceRuleRevisions)[number] | undefined;
    const revisionEdge = (
      from: ExportEntityV4,
      row: unknown,
      ruleId: string,
      number: number,
      slot: string,
    ) =>
      relation(
        from,
        row,
        'recurrenceRuleRevisions',
        revisionKey(ruleId, number),
        'live',
        slot,
        revisionKey(ruleId, number),
      );
    for (const rule of data.recurrenceRules) {
      revisionEdge('recurrenceRules', rule, rule.id, rule.currentRevision, 'currentRevision');
      const rows = data.recurrenceRuleRevisions
        .filter((r) => r.ruleId === rule.id)
        .sort((a, b) => a.revision - b.revision);
      if (
        rows.length !== rule.version ||
        rows.some((r, i) => r.revision !== i + 1) ||
        rows[0]?.createdAt !== rule.createdAt ||
        rows.at(-1)?.createdAt !== rule.updatedAt
      )
        throw new ExportError('RELATION_INVALID');
    }
    for (const r of data.recurrenceRuleRevisions) {
      live('recurrenceRuleRevisions', r, 'recurrenceRules', r.ruleId, 'rule');
      live('recurrenceRuleRevisions', r, 'projects', r.projectId, 'project');
      live('recurrenceRuleRevisions', r, 'recurrenceCommands', r.commandId, 'command');
      const command = data.recurrenceCommands.find((c) => c.id === r.commandId);
      if (
        !command ||
        command.ruleId !== r.ruleId ||
        command.companyId !== r.companyId ||
        command.createdAt !== r.createdAt ||
        (r.revision === 1 ? command.kind !== 'create' : !['revise', 'stop'].includes(command.kind))
      )
        throw new ExportError('RELATION_INVALID');
      const ids = data.recurrenceRuleTags
        .filter((t) => t.ruleId === r.ruleId && t.revision === r.revision)
        .map((t) => t.workTagId)
        .sort(compareCodeUnits);
      if (canonicalJson(ids) !== canonicalJson(r.spec.tagIds))
        throw new ExportError('RELATION_INVALID');
    }
    for (const r of data.recurrenceRuleTags) {
      revisionEdge('recurrenceRuleTags', r, r.ruleId, r.revision, 'revision');
      live('recurrenceRuleTags', r, 'workTags', r.workTagId, 'tag');
    }
    const originalIds = new Set<string>(),
      liveIds = new Set<string>();
    for (const r of data.recurrenceOccurrences) {
      live('recurrenceOccurrences', r, 'recurrenceRules', r.ruleId, 'rule');
      revisionEdge('recurrenceOccurrences', r, r.ruleId, r.appliedRevision, 'revision');
      hist('recurrenceOccurrences', r, 'workEntries', r.originalWorkEntryId, 'originalEntry');
      live('recurrenceOccurrences', r, 'workEntries', r.liveWorkEntryId, 'liveEntry');
      if (
        originalIds.has(r.originalWorkEntryId) ||
        (r.liveWorkEntryId !== null && liveIds.has(r.liveWorkEntryId))
      )
        throw new ExportError('RELATION_INVALID');
      originalIds.add(r.originalWorkEntryId);
      if (r.liveWorkEntryId !== null) liveIds.add(r.liveWorkEntryId);
    }
    for (const r of data.recurrenceGeneratedRanges) {
      live('recurrenceGeneratedRanges', r, 'recurrenceRules', r.ruleId, 'rule');
      revisionEdge('recurrenceGeneratedRanges', r, r.ruleId, r.revision, 'revision');
    }
    function checkRuleReceipt(
      value: ReturnType<typeof zExportRecurrenceRuleResult.parse>,
      command: (typeof data.recurrenceCommands)[number],
    ) {
      const r = revision(value.id, value.revision),
        rule = data.recurrenceRules.find((q) => q.id === value.id);
      if (
        !r ||
        !rule ||
        value.id !== command.ruleId ||
        value.companyId !== company ||
        value.createdAt !== rule.createdAt ||
        value.updatedAt !== command.createdAt ||
        value.effectiveFrom !== r.effectiveFrom ||
        canonicalJson(value.spec) !== canonicalJson(r.spec) ||
        r.commandId !== command.id
      )
        throw new ExportError('RELATION_INVALID');
      return r;
    }
    for (const r of data.recurrenceCommands) {
      live('recurrenceCommands', r, 'recurrenceRules', r.ruleId, 'rule');
      if (r.request.commandId !== r.id) throw new ExportError('RELATION_INVALID');
      if (r.kind === 'create') {
        const request = exportRecurrenceRequestSchemas.create.parse(r.request),
          result = zExportRecurrenceRuleResult.parse(r.result),
          rev = checkRuleReceipt(result, r);
        const { id: requestedRule, commandId: receiptId, ...spec } = request;
        if (
          receiptId !== r.id ||
          requestedRule !== r.ruleId ||
          result.version !== 1 ||
          result.revision !== 1 ||
          result.createdAt !== r.createdAt ||
          rev.existingPolicy !== 'reconcile' ||
          result.effectiveFrom !== request.startOn ||
          canonicalJson(result.spec) !== canonicalJson({ ...spec, isActive: true })
        )
          throw new ExportError('RELATION_INVALID');
        revisionEdge('recurrenceCommands', r, r.ruleId, 1, 'resultRevision');
      } else {
        const request = exportRecurrenceRequestSchemas[r.kind].parse(r.request);
        revisionEdge('recurrenceCommands', r, r.ruleId, request.version, 'requestRevision');
        const generation =
          r.kind === 'generate'
            ? zExportRecurrenceGenerationResult.parse(r.result)
            : exportRecurrenceResultSchemas.revise.parse(r.result).generation;
        const resultVersion = request.version + (r.kind === 'generate' ? 0 : 1);
        if (
          generation.commandId !== r.id ||
          generation.ruleId !== r.ruleId ||
          generation.ruleVersion !== resultVersion
        )
          throw new ExportError('RELATION_INVALID');
        revisionEdge('recurrenceCommands', r, r.ruleId, resultVersion, 'resultRevision');
        if (r.kind !== 'generate') {
          const value = exportRecurrenceResultSchemas.revise.parse(r.result).rule,
            rev = checkRuleReceipt(value, r),
            previous = revision(r.ruleId, request.version);
          if (!previous || value.version !== resultVersion)
            throw new ExportError('RELATION_INVALID');
          let expected: unknown, effectiveFrom: string, policy: string;
          if (r.kind === 'revise') {
            const req = exportRecurrenceRequestSchemas.revise.parse(r.request);
            if (req.intervalAnchor !== previous.spec.intervalAnchor)
              throw new ExportError('RELATION_INVALID');
            expected = { ...previous.spec, ...req.patch };
            effectiveFrom = req.applyFrom;
            policy = 'reconcile';
          } else {
            const req = exportRecurrenceRequestSchemas.stop.parse(r.request);
            expected = {
              ...previous.spec,
              isActive: false,
              ...(req.mode === 'end' ? { endOn: req.on } : {}),
            };
            effectiveFrom =
              req.mode === 'end'
                ? new Date(Date.parse(req.on + 'T00:00:00.000Z') + 86400000)
                    .toISOString()
                    .slice(0, 10)
                : req.on;
            policy = req.existingFuture === 'preserve' ? 'preserve' : 'reconcile';
          }
          if (
            canonicalJson(value.spec) !== canonicalJson(expected) ||
            rev.effectiveFrom !== effectiveFrom ||
            rev.existingPolicy !== policy
          )
            throw new ExportError('RELATION_INVALID');
        }
        for (const [index, o] of generation.occurrences.entries()) {
          const key = canonicalJson([o.ruleId, o.occurrenceDate]),
            ledger = indexes.get('recurrenceOccurrences')!.get(key);
          if (
            !ledger ||
            ledger.originalWorkEntryId !== o.originalWorkEntryId ||
            o.ruleId !== r.ruleId
          )
            throw new ExportError('RELATION_INVALID');
          relation(
            'recurrenceCommands',
            r,
            'recurrenceOccurrences',
            key,
            'live',
            'result.occurrences.' + index + '.occurrence',
            key,
          );
          revisionEdge(
            'recurrenceCommands',
            r,
            o.ruleId,
            o.appliedRevision,
            'result.occurrences.' + index + '.revision',
          );
          hist(
            'recurrenceCommands',
            r,
            'workEntries',
            o.originalWorkEntryId,
            'result.occurrences.' + index + '.originalEntry',
          );
          hist(
            'recurrenceCommands',
            r,
            'workEntries',
            o.liveWorkEntryId,
            'result.occurrences.' + index + '.liveEntry',
          );
        }
      }
    }
  }
  if (projectionVersion === 4) {
    const state = d.leaveLedgerStates[0];
    if (d.leaveLedgerStates.length > 1) throw new ExportError('RELATION_INVALID');
    const stateKey = canonicalJson([company]);
    const stateEdge = (entity: ExportEntityV4, row: unknown) =>
      relation(entity, row, 'leaveLedgerStates', stateKey, 'live', 'ledger', stateKey);
    const policyKey = (y: number) => canonicalJson([company, y]);
    const accountKey = (id: string) => canonicalJson([company, id]);
    for (const entity of [
      'leavePolicies',
      'leaveGrants',
      'leaveLedgerCutovers',
      'leaveEntryAccounting',
      'leaveAllocations',
      'leaveLedgerCommands',
    ] as const)
      for (const row of d[entity]) stateEdge(entity, row);
    if (state)
      live(
        'leaveLedgerStates',
        state,
        'leaveLedgerCutovers',
        state.currentCutoverId,
        'currentCutover',
      );
    for (const row of d.leaveLedgerCutovers) {
      live('leaveLedgerCutovers', row, 'leaveLedgerCommands', row.commandId, 'command');
      const command = find('leaveLedgerCommands', row.commandId) as
        (typeof d.leaveLedgerCommands)[number] | undefined;
      if (
        !command ||
        command.kind !== 'cutover' ||
        canonicalJson(command.result.appliedEntryIds) !==
          canonicalJson(row.manifest.map((x) => x.entryId))
      )
        throw new ExportError('RELATION_INVALID');
    }
    const sums = new Map<string, number>(),
      grantSums = new Map<string, number>();
    const add = (m: Map<string, number>, key: string, n: number) => {
      const next = (m.get(key) ?? 0) + n;
      if (!Number.isSafeInteger(next)) throw new ExportError('RELATION_INVALID');
      m.set(key, next);
    };
    for (const row of d.leaveEntryAccounting) {
      live('leaveEntryAccounting', row, 'leaveEntries', row.leaveEntryId, 'leave');
      live('leaveEntryAccounting', row, 'leaveLedgerCutovers', row.cutoverId, 'cutover');
      const leave = find('leaveEntries', row.leaveEntryId) as (typeof d.leaveEntries)[number];
      const work = find('workEntries', leave.workEntryId) as (typeof d.workEntries)[number];
      if (
        !state ||
        work.kind !== 'leave' ||
        work.version !== row.lastWorkVersion ||
        (row.state === 'allocated') !==
          (state.phase === 'active' &&
            work.plannedDate !== null &&
            work.plannedDate >= state.setup.cutoverOn)
      )
        throw new ExportError('RELATION_INVALID');
    }
    for (const row of d.leaveAllocations) {
      const key = accountKey(row.leaveEntryId),
        pk = policyKey(row.policyYear);
      relation('leaveAllocations', row, 'leaveEntryAccounting', key, 'live', 'accounting', key);
      relation('leaveAllocations', row, 'leavePolicies', pk, 'live', 'policy', pk);
      live('leaveAllocations', row, 'leaveGrants', row.grantId, 'grant');
      const account = indexes
        .get('leaveEntryAccounting')!
        .get(key) as (typeof d.leaveEntryAccounting)[number];
      const policy = indexes.get('leavePolicies')!.get(pk) as (typeof d.leavePolicies)[number];
      const grant = find('leaveGrants', row.grantId) as (typeof d.leaveGrants)[number];
      const leave = find('leaveEntries', row.leaveEntryId) as (typeof d.leaveEntries)[number];
      const work = find('workEntries', leave.workEntryId) as (typeof d.workEntries)[number];
      if (
        account.state !== 'allocated' ||
        !grant.everAllocated ||
        work.status === 'canceled' ||
        !work.plannedDate ||
        work.plannedDate < grant.validFrom ||
        work.plannedDate > grant.expiresOn ||
        row.policyYear !== Number(work.plannedDate.slice(0, 4)) ||
        row.policyVersion > policy.version
      )
        throw new ExportError('RELATION_INVALID');
      add(sums, row.leaveEntryId, row.allocatedHours);
      add(grantSums, row.grantId, row.allocatedHours);
    }
    for (const row of d.leaveEntryAccounting) {
      const leave = find('leaveEntries', row.leaveEntryId) as (typeof d.leaveEntries)[number];
      const work = find('workEntries', leave.workEntryId) as (typeof d.workEntries)[number];
      if (
        (sums.get(row.leaveEntryId) ?? 0) !==
        (row.state === 'allocated' && work.status !== 'canceled' ? leave.deductibleHours : 0)
      )
        throw new ExportError('RELATION_INVALID');
    }
    for (const row of d.leaveGrants)
      if (
        (grantSums.get(row.id) ?? 0) > row.grantedHours ||
        (row.grantType === 'opening' && row.remainingAsOf !== state?.setup.cutoverOn)
      )
        throw new ExportError('RELATION_INVALID');
    if (state?.phase === 'active')
      for (const leave of d.leaveEntries) {
        const work = find('workEntries', leave.workEntryId) as (typeof d.workEntries)[number];
        if (
          work.plannedDate !== null &&
          work.plannedDate >= state.setup.cutoverOn &&
          !indexes.get('leaveEntryAccounting')!.has(accountKey(leave.id))
        )
          throw new ExportError('RELATION_INVALID');
      }
    for (const row of d.leaveLedgerCommands) {
      const request = row.request,
        input = 'commandId' in request ? request : request.input;
      if (
        input.commandId !== row.id ||
        !state ||
        (input.ledgerVersion ?? 0) + 1 > state.version ||
        ('companyId' in row.result && row.result.companyId !== company) ||
        ('ledgerVersion' in row.result &&
          row.result.ledgerVersion !== (input.ledgerVersion ?? 0) + 1)
      )
        throw new ExportError('RELATION_INVALID');
      if (
        (row.kind === 'grant_create' ||
          row.kind === 'grant_patch' ||
          row.kind === 'grant_delete') &&
        row.request.id !== row.result.id
      )
        throw new ExportError('RELATION_INVALID');
      if (
        (row.kind === 'policy_put' || row.kind === 'policy_delete') &&
        row.request.year !== ('year' in row.result ? row.result.year : row.result.id)
      )
        throw new ExportError('RELATION_INVALID');
      if (row.kind === 'cutover') {
        if (row.result.commandId !== row.id || row.result.cutoverId !== row.id)
          throw new ExportError('RELATION_INVALID');
        live(
          'leaveLedgerCommands',
          row,
          'leaveLedgerCutovers',
          row.result.cutoverId,
          'result.cutover',
        );
      }
      if (row.kind === 'work') {
        if (row.result.commandId !== row.id) throw new ExportError('RELATION_INVALID');
        const requested = new Set(
          row.request.work.map((x) => (x.intent === 'create' ? x.input.id : x.entryId)),
        );
        if (
          new Set(row.result.entries.map((x) => x.entryId)).size !== row.result.entries.length ||
          row.result.entries.length !== requested.size ||
          row.result.entries.some(
            (x) =>
              !requested.has(x.entryId) ||
              (x.entry !== null &&
                (x.entry.id !== x.entryId ||
                  x.entry.companyId !== company ||
                  x.entry.kind !== 'leave')),
          )
        )
          throw new ExportError('RELATION_INVALID');
      }
    }
    for (const spec of EXPORT_LEAVE_HISTORY_PATHS)
      for (const row of d[spec.entity]) {
        if (
          spec.kinds.length &&
          !(spec.kinds as readonly string[]).includes((row as { kind: string }).kind)
        )
          continue;
        function visit(value: unknown, parts: string[], slot: string) {
          if (!parts.length) {
            if (value === null || value === undefined) return;
            const target =
              spec.target === 'leavePolicies' ? policyKey(value as number) : String(value);
            relation(
              spec.entity,
              row,
              spec.target,
              target,
              'historical',
              slot,
              spec.target === 'leavePolicies' ? target : undefined,
            );
            return;
          }
          const [head, ...tail] = parts;
          if (head === '*') {
            if (Array.isArray(value)) value.forEach((v, i) => visit(v, tail, slot + '.' + i));
          } else if (value && typeof value === 'object')
            visit(
              (value as Record<string, unknown>)[head!],
              tail,
              slot ? slot + '.' + head : head!,
            );
        }
        visit(row, spec.path.split('.'), '');
      }
  }

  const usedCommonNotes = new Set<string>();
  if (v2) {
    for (const r of d.notes) live('notes', r, 'workEntries', r.workEntryId, 'entry');
    for (const r of d.noteTagLinks) {
      live('noteTagLinks', r, 'notes', r.noteId, 'note');
      live('noteTagLinks', r, 'noteTags', r.noteTagId, 'tag');
      usedCommonNotes.add(r.noteTagId);
    }
  }
  if (!v2 && d.noteTags.some((r) => r.companyId === null))
    throw new ExportError('RELATION_INVALID');
  for (const r of [...d.workTags, ...d.noteTags]) {
    if (
      (r.companyId === null) !== (r.scopeKind === 'referencedCommon') ||
      (r.companyId === null &&
        !(d.noteTags.includes(r as (typeof d.noteTags)[number]) ? usedCommonNotes : usedCommon).has(
          r.id,
        ))
    )
      throw new ExportError('RELATION_INVALID');
  }
  const unique = (rows: unknown[], key: (r: Record<string, unknown>) => unknown) => {
    const keys = rows.map((r) => canonicalJson(key(r as Record<string, unknown>)));
    if (new Set(keys).size !== keys.length) throw new ExportError('RELATION_INVALID');
  };
  unique(d.companyYearSettings, (r) => [r.companyId, r.year]);
  unique(d.wbsPlans, (r) => [r.projectId, r.year]);
  unique(d.wbsScheduleChanges, (r) => [r.wbsItemId, r.itemVersion]);
  unique(d.wbsCompletions, (r) => [r.wbsItemId]);
  rels.sort((a, b) => compareCodeUnits(a.key, b.key));
  const relationCounts = {
    live: rels.filter((r) => r.relationType === 'live').length,
    historical: rels.filter((r) => r.relationType === 'historical').length,
  };
  const canonicalDataset = canonicalJson({
    data: d,
    planningCoverageSinceAt: dataset.planningCoverageSinceAt,
    schemaFamilies: dataset.schemaFamilies,
    relationships: rels,
    scope: dataset.scope,
    projectionVersion,
  });
  if (new TextEncoder().encode(canonicalDataset).byteLength > EXPORT_LIMITS.datasetBytes)
    throw new ExportError('EXPORT_LIMIT_EXCEEDED', 'datasetBytes');
  return freezeExport({
    dataset,
    relationships: rels,
    entityCounts: entities,
    relationCounts,
    canonicalDataset,
  });
}
export type ExportDigest = (bytes: Uint8Array) => Promise<string>;
export async function digestExport(
  prepared:
    | PreparedExportDataset
    | PreparedExportDatasetV2
    | PreparedExportDatasetV3
    | PreparedExportDatasetV4
    | PreparedExportDatasetV5,
  digest: ExportDigest,
): Promise<string> {
  const result = await digest(new TextEncoder().encode(prepared.canonicalDataset));
  if (!/^[a-f0-9]{64}$/.test(result)) throw new ExportError('DATASET_CORRUPT');
  return result;
}

export type PreparedExportDatasetV5 = Omit<PreparedExportDatasetV4, 'dataset'> & {
  dataset: ExportDatasetV5;
  realizedScope: {
    entityCounts: Record<ExportEntityV4, { primary: number; support: number; total: number }>;
    primaryRows: number;
    supportRows: number;
    primaryReasonCounts: Record<string, number>;
    supportReasonCounts: Record<string, number>;
    undated: { primary: number; support: number };
  };
};
/** KST bounds are integer instants. Works for 0001 and 9999 without year-0..99 coercion. */
export function exportRangeBounds(scope: ExportRangeScope) {
  return {
    startAt: Date.parse(scope.from + 'T00:00:00.000Z') - 32400000,
    endAtExclusive: Date.parse(scope.to + 'T00:00:00.000Z') + 86400000 - 32400000,
  };
}
export function exportPrimaryReasons(
  entity: ExportEntityV4,
  row: unknown,
  scope: ExportRangeScope,
): ExportRangeRow['primaryReasons'] {
  const r = row as Record<string, unknown>,
    b = exportRangeBounds(scope);
  const between = (v: unknown) => typeof v === 'string' && v >= scope.from && v <= scope.to;
  const week = () => {
    const w = weekCalendar(Number(r.isoYear), Number(r.isoWeek));
    return w.startAt < b.endAtExclusive && w.endAtExclusive > b.startAt;
  };
  if (entity === 'companies') return ['company'];
  if (entity === 'companyDayStates' && between(r.date)) return ['day'];
  if (entity === 'workEntries') {
    if (r.plannedDate === null) return scope.includeUndated ? ['undated'] : [];
    if (r.timeMode === 'exact')
      return Number(r.startAt) < b.endAtExclusive && Number(r.endAt) > b.startAt
        ? ['scheduled_overlap']
        : [];
    return String(r.plannedDate) <= scope.to && String(r.endDate ?? r.plannedDate) >= scope.from
      ? ['scheduled_overlap']
      : [];
  }
  if (
    entity === 'notes' &&
    Number(r.createdAt) >= b.startAt &&
    Number(r.createdAt) < b.endAtExclusive
  )
    return ['note_created'];
  if (['weeklyPlanEntries', 'weeklyReports', 'weeklyGoals'].includes(entity) && week())
    return ['week_overlap'];
  if (entity === 'monthlyFocusItems') {
    const m = String(r.year).padStart(4, '0') + '-' + String(r.month).padStart(2, '0');
    if (m >= scope.from.slice(0, 7) && m <= scope.to.slice(0, 7)) return ['month_overlap'];
  }
  if (entity === 'periodDocuments') {
    const start = Date.parse(String(r.periodStart) + 'T00:00:00.000Z') - 32400000;
    if (
      start < b.endAtExclusive &&
      start + (r.kind === 'daily_note' ? 1 : 7) * 86400000 > b.startAt
    )
      return ['period_overlap'];
  }
  if (entity === 'recurrenceOccurrences' && between(r.occurrenceDate)) return ['occurrence_date'];
  return [];
}
/** Reverse retained sidecars. These are directed closure edges, never new date seeds. */
export const EXPORT_RANGE_SIDECARS: ReadonlyArray<
  readonly [ExportEntityV4, ExportEntityV4, ExportRangeRow['supportReasons'][number]]
> = [
  ['workEntries', 'leaveEntries', 'work_sidecar'],
  ['workEntries', 'workEntryTags', 'work_sidecar'],
  ['workEntries', 'workEntryChanges', 'work_sidecar'],
  ['workEntries', 'importOrigins', 'work_sidecar'],
  ['workEntries', 'goalPlacements', 'goal_provenance'],
  ['weeklyGoals', 'goalPlacements', 'goal_provenance'],
  ['weeklyGoals', 'goalWbsSources', 'goal_provenance'],
  ['notes', 'noteTagLinks', 'note_tags'],
  ['projects', 'projectDefaultTags', 'project_defaults'],
  ['workEntries', 'wbsWorkLinks', 'wbs_context'],
  ['wbsItems', 'wbsScheduleChanges', 'wbs_context'],
  ['wbsItems', 'wbsWorkLinks', 'wbs_context'],
  ['wbsItems', 'wbsCompletions', 'wbs_context'],
  ['workEntries', 'recurrenceOccurrences', 'recurrence_cluster'],
  ['recurrenceRules', 'recurrenceRuleRevisions', 'recurrence_cluster'],
  ['recurrenceRules', 'recurrenceOccurrences', 'recurrence_cluster'],
  ['recurrenceRules', 'recurrenceGeneratedRanges', 'recurrence_cluster'],
  ['recurrenceRules', 'recurrenceCommands', 'recurrence_cluster'],
  ['recurrenceRuleRevisions', 'recurrenceRuleTags', 'recurrence_cluster'],
  ['leaveEntries', 'leaveEntryAccounting', 'leave_ledger_cluster'],
];
/** Only typed date fields, never arbitrary user text or inferred execution/completion dates. */
export const EXPORT_RANGE_YEAR_DATE_PATHS = [
  'date',
  'plannedDate',
  'endDate',
  'periodStart',
  'weekStart',
  'occurrenceDate',
  'targetDate',
  'plannedStartOn',
  'plannedEndOn',
  'revisedStartOn',
  'revisedEndOn',
  'grantedOn',
  'validFrom',
  'expiresOn',
  ...[
    'before',
    'after',
    'storedSnapshot',
    'retainedOriginalEntry',
    'retainedOriginalHistory.before',
    'retainedOriginalHistory.after',
  ].flatMap((p) => ['plannedDate', 'endDate'].map((k) => p + '.' + k)),
];
export const EXPORT_RANGE_YEAR_INTERVAL_PATHS = [
  ['plannedDate', 'endDate'],
  ['plannedStartOn', 'plannedEndOn'],
  ['revisedStartOn', 'revisedEndOn'],
  ['validFrom', 'expiresOn'],
] as const;
export function exportRangeYearMatches(row: Record<string, unknown>, year: number): boolean {
  const get = (path: string) =>
    path
      .split('.')
      .reduce<unknown>(
        (v, k) => (v && typeof v === 'object' ? (v as Record<string, unknown>)[k] : undefined),
        row,
      );
  if (
    EXPORT_RANGE_YEAR_DATE_PATHS.some(
      (p) => typeof get(p) === 'string' && Number(String(get(p)).slice(0, 4)) === year,
    )
  )
    return true;
  if (['year', 'isoYear', 'originYear'].some((p) => row[p] === year)) return true;
  if (
    EXPORT_RANGE_YEAR_INTERVAL_PATHS.some(
      ([a, b]) =>
        typeof get(a) === 'string' &&
        typeof get(b) === 'string' &&
        year >= Number(String(get(a)).slice(0, 4)) &&
        year <= Number(String(get(b)).slice(0, 4)),
    )
  )
    return true;
  if ('isoYear' in row && 'isoWeek' in row) {
    const w = weekCalendar(Number(row.isoYear), Number(row.isoWeek));
    if (Number(w.weekStart.slice(0, 4)) === year || Number(w.weekEnd.slice(0, 4)) === year)
      return true;
  }
  if (typeof row.periodStart === 'string') {
    const last =
      Date.parse(row.periodStart + 'T00:00:00Z') + (row.kind === 'daily_note' ? 0 : 6) * 86400000;
    if (new Date(last).getUTCFullYear() === year) return true;
  }
  if (
    'workEntryId' in row &&
    'body' in row &&
    typeof row.createdAt === 'number' &&
    new Date(row.createdAt + 32400000).getUTCFullYear() === year
  )
    return true;
  return false;
}
export function prepareExportDatasetV5(input: unknown): PreparedExportDatasetV5 {
  try {
    const raw = canonicalJson(input);
    if (new TextEncoder().encode(raw).byteLength > EXPORT_LIMITS.datasetBytes)
      throw new ExportError('EXPORT_LIMIT_EXCEEDED', 'datasetBytes');
    const value = JSON.parse(raw) as Record<string, unknown>;
    const scope = zExportRangeScope.safeParse(value.scope);
    if (!scope.success) throw new ExportError('INVALID_SCOPE');
    if (value.formatVersion !== 5) throw new ExportError('UNSUPPORTED_SCHEMA');
    // Preserve specific history/actor failures before the outer V5 structural parse.
    // This invokes pure stored-row validation only, never a database service.
    const base = prepareExportDatasetV4({
      formatVersion: 4,
      scope: { companyId: scope.data.companyId, period: 'all', scopeVersion: 1 },
      snapshotAt: value.snapshotAt,
      planningCoverageSinceAt: value.planningCoverageSinceAt,
      schemaFamilies: value.schemaFamilies,
      data: value.data,
    });
    const parsed = zExportDatasetV5.safeParse(value);
    if (!parsed.success || canonicalJson(parsed.data) !== raw)
      throw new ExportError('DATASET_CORRUPT');
    const dataset = parsed.data;
    dataset.data = base.dataset.data;
    dataset.schemaFamilies = base.dataset.schemaFamilies;
    const node = (e: ExportEntityV4, k: string) => canonicalJson([e, k]);
    const rows = new Map<
      string,
      { entity: ExportEntityV4; row: Record<string, unknown>; key: string }
    >();
    for (const e of EXPORT_ENTITIES_V4)
      for (const row of dataset.data[e]) {
        const k = exportRowKey(e, row);
        rows.set(node(e, k), { entity: e, row: row as unknown as Record<string, unknown>, key: k });
      }
    const relationships = [...base.relationships];
    for (const command of dataset.data.leaveLedgerCommands)
      if (command.kind === 'work' && command.request.sourceEntryId) {
        const target = command.request.sourceEntryId,
          fromId = exportRowKey('leaveLedgerCommands', command),
          present = rows.has(node('workEntries', canonicalJson([target])));
        relationships.push({
          key: canonicalJson([
            'leaveLedgerCommands',
            fromId,
            'request.sourceEntryId',
            'workEntries',
            target,
          ]),
          relationType: 'historical',
          fromEntity: 'leaveLedgerCommands',
          fromId,
          toEntity: 'workEntries',
          toId: target,
          presence: present ? 'present' : 'absentHistorical',
          provenance: present ? 'scope-verified' : 'historical-unverified',
        });
      }
    relationships.sort((a, b) => compareCodeUnits(a.key, b.key));
    const adjacency = new Map<string, Map<string, Set<string>>>();
    function add(a: string, b: string, reason: string) {
      const m = adjacency.get(a) ?? new Map<string, Set<string>>();
      const reasons = m.get(b) ?? new Set<string>();
      reasons.add(reason);
      m.set(b, reasons);
      adjacency.set(a, m);
    }
    for (const rel of relationships) {
      if (rel.presence !== 'present') continue;
      const target = rows.has(node(rel.toEntity, rel.toId)) ? rel.toId : canonicalJson([rel.toId]);
      const a = node(rel.fromEntity, rel.fromId),
        b = node(rel.toEntity, target);
      add(a, b, 'relation');
      for (const [parent, child, reason] of EXPORT_RANGE_SIDECARS)
        if (parent === rel.toEntity && child === rel.fromEntity) add(b, a, reason);
    }
    const ledger = EXPORT_ENTITIES_V4.filter((e) =>
      [
        'leaveLedgerStates',
        'leavePolicies',
        'leaveGrants',
        'leaveLedgerCutovers',
        'leaveEntryAccounting',
        'leaveAllocations',
        'leaveLedgerCommands',
      ].includes(e),
    );
    const state = node('leaveLedgerStates', canonicalJson([dataset.scope.companyId]));
    for (const [k, r] of rows)
      if (ledger.includes(r.entity)) {
        add(k, state, 'leave_ledger_cluster');
        add(state, k, 'leave_ledger_cluster');
      } else if (r.entity === 'leaveEntries' && rows.has(state))
        add(k, state, 'leave_ledger_cluster');
    for (const [k, r] of rows)
      if (r.entity !== 'companies' && r.entity !== 'companyYearSettings')
        for (const setting of dataset.data.companyYearSettings)
          if (exportRangeYearMatches(r.row, setting.year))
            add(
              k,
              node('companyYearSettings', exportRowKey('companyYearSettings', setting)),
              'year_settings',
            );
    const primary = new Map<string, string[]>();
    for (const [k, r] of rows) {
      const p = exportPrimaryReasons(r.entity, r.row, dataset.scope);
      if (p.length) primary.set(k, p);
    }
    for (const [k, r] of rows)
      if (
        r.entity === 'recurrenceOccurrences' &&
        [r.row.liveWorkEntryId, r.row.originalWorkEntryId].some(
          (id) => typeof id === 'string' && primary.has(node('workEntries', canonicalJson([id]))),
        )
      )
        primary.set(k, [...(primary.get(k) ?? []), 'primary_work_occurrence']);
    const selected = new Set(primary.keys()),
      queue = [...selected];
    for (let i = 0; i < queue.length; i++)
      for (const b of adjacency.get(queue[i]!)?.keys() ?? [])
        if (rows.has(b) && !selected.has(b)) {
          selected.add(b);
          queue.push(b);
        }
    if (selected.size !== rows.size) throw new ExportError('RELATION_INVALID');
    const support = new Map<string, Set<string>>();
    for (const a of selected)
      for (const [b, reasons] of adjacency.get(a) ?? [])
        if (selected.has(b)) {
          const s = support.get(b) ?? new Set<string>();
          for (const r of reasons) s.add(r);
          support.set(b, s);
        }
    const proofs: ExportRangeRow[] = [];
    for (const [k, r] of rows)
      proofs.push({
        entity: r.entity,
        logicalRowKey: r.key,
        isPrimary: primary.has(k),
        primaryReasons: [...(primary.get(k) ?? [])].sort(
          compareCodeUnits,
        ) as ExportRangeRow['primaryReasons'],
        supportReasons: [...(support.get(k) ?? [])].sort(
          compareCodeUnits,
        ) as ExportRangeRow['supportReasons'],
      });
    proofs.sort((a, b) =>
      compareCodeUnits(node(a.entity, a.logicalRowKey), node(b.entity, b.logicalRowKey)),
    );
    if (canonicalJson(dataset.selection.rows) !== canonicalJson(proofs))
      throw new ExportError('RELATION_INVALID');
    const entityCounts = Object.fromEntries(
      EXPORT_ENTITIES_V4.map((e) => [e, { primary: 0, support: 0, total: base.entityCounts[e] }]),
    ) as PreparedExportDatasetV5['realizedScope']['entityCounts'];
    const primaryReasonCounts = Object.fromEntries(EXPORT_PRIMARY_REASONS.map((r) => [r, 0])),
      supportReasonCounts = Object.fromEntries(EXPORT_SUPPORT_REASONS.map((r) => [r, 0]));
    let primaryRows = 0,
      supportRows = 0;
    const undated = { primary: 0, support: 0 };
    for (const proof of proofs) {
      const kind = proof.isPrimary ? 'primary' : 'support';
      entityCounts[proof.entity][kind]++;
      if (proof.isPrimary) primaryRows++;
      else supportRows++;
      for (const r of proof.primaryReasons) primaryReasonCounts[r]!++;
      for (const r of proof.supportReasons) supportReasonCounts[r]!++;
      if (
        proof.entity === 'workEntries' &&
        rows.get(node(proof.entity, proof.logicalRowKey))!.row.plannedDate === null
      )
        undated[kind]++;
    }
    const canonicalDataset = canonicalJson({
      data: dataset.data,
      planningCoverageSinceAt: dataset.planningCoverageSinceAt,
      schemaFamilies: dataset.schemaFamilies,
      relationships,
      scope: dataset.scope,
      projectionVersion: 5,
      selection: dataset.selection,
    });
    if (new TextEncoder().encode(canonicalDataset).byteLength > EXPORT_LIMITS.datasetBytes)
      throw new ExportError('EXPORT_LIMIT_EXCEEDED', 'datasetBytes');
    return freezeExport({
      ...base,
      dataset,
      relationships,
      relationCounts: {
        live: relationships.filter((r) => r.relationType === 'live').length,
        historical: relationships.filter((r) => r.relationType === 'historical').length,
      },
      canonicalDataset,
      realizedScope: {
        entityCounts,
        primaryRows,
        supportRows,
        primaryReasonCounts,
        supportReasonCounts,
        undated,
      },
    });
  } catch (error) {
    if (error instanceof ExportError) throw error;
    throw new ExportError('DATASET_CORRUPT');
  }
}
