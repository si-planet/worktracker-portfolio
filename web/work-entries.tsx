import { HelpHint } from './help-hint';
import { WorkImportanceCheckbox } from './work-importance-checkbox';
import { commitPendingWorkImportance } from './work-importance-api';
import {
  dailyNoteCapacity,
  editableDailyNotes,
  replaceDailyNotes,
  importedImportance,
} from './daily-sheet-model';
import { DailyWorkSheet } from './daily-work-sheet';
import { useWorkSourceLabels, WorkSourceBadges, WorkSourceNotice } from './work-source-labels';
import { WorkDialogSurface } from './work-dialog-surface';
import { RefreshButton } from './ui-controls';
import { reconcileWorkEntryDraft } from './work-entry-draft-reconciliation';
import { LeaveLedgerDetails, useLeaveWorkReview } from './leave-ledger';
import { WorkEntryNotes } from './work-entry-notes';
import { PeriodDocument } from './period-document';
import { setWorkspaceDraftDirty, workspaceHasUnsavedChanges } from './workspace-draft-state';
import { WorkEntryWbsLink, PendingWorkLinkReviews } from './wbs-work-links';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { z } from 'zod';
import {
  zLeaveType,
  zWorkEntryCreate,
  zWorkEntryDate,
  zWorkEntryFinal,
  zWorkEntryId,
  zWorkEntryKind,
  zWorkEntryPatch,
  zWorkEntryStatusValue,
  type WorkEntryFinal,
} from '../shared/schema/work-entry';
import { calculateLeaveHours, kstDate } from '../shared/work-entry-rules';
import type { WorkspaceProject, WorkspaceTag } from '../shared/schema/workspace';
import {
  WorkFailure,
  readWorkDuplicate,
  saveWorkDuplicate,
  setWorkPause,
  historySchema,
  leaveContextSchema,
  uncertainWork,
  workApi,
  workEntrySchema,
  workError,
  workListSchema,
  zWorkDay,
  type LeaveContext,
  type WorkHistory,
} from './work-entry-api';
import './work-entries.css';
import { entryVisibleOnDate } from '../shared/work-state-projection';
import { newDraftForDate } from './week-hub-model';
import './work-layout.css';
import { DayNavigation } from './day-navigation';
import { WeekView } from './week-view';
import {
  WorkReschedule,
  readRescheduleSelection,
  storeReschedule,
  type RescheduleSelection,
} from './work-reschedule';
import {
  createWorkDuplicateDraft,
  createDuplicateWbsReview,
  matchesWorkDuplicate,
} from '../shared/work-duplicate';
import {
  zDuplicateWbsReview,
  zWorkEntryDuplicate,
  type WorkEntryDuplicate,
  type WorkEntryDuplicateSnapshot,
} from '../shared/schema/work-duplicate';
import { readWorkLinkTarget } from './wbs-work-link-api';
import { WorkDuplicateWbs } from './work-duplicate-wbs';
import { useKstToday, WorkDeadlineBadges } from './work-deadline';

const kinds = {
  task: '업무',
  meeting: '회의',
  field: '외근',
  event: '회사 행사',
  leave: '휴가',
  etc: '기타',
};
const statuses = {
  todo: '미진행',
  doing: '진행 중',
  paused: '중단',
  planned: '예정',
  done: '완료',
  canceled: '취소',
};
const leaveLabels = {
  full: '종일 휴가',
  am_half: '오전 반차',
  pm_half: '오후 반차',
  am_quarter: '오전 반반차',
  pm_quarter: '오후 반반차',
};
const zForm = z.strictObject({
  id: zWorkEntryId,
  kind: zWorkEntryKind,
  title: z.string().max(200),
  content: z.string().max(5000),
  notes: z.string().max(5000).optional(),
  metadataContent: z.string().max(5000).optional(),
  date: z.union([z.literal(''), zWorkEntryDate]),
  dueDate: z.union([z.literal(''), zWorkEntryDate]),
  projectId: z.union([z.literal(''), zWorkEntryId]),
  tagIds: z.array(zWorkEntryId).max(200),
  leaveType: zLeaveType,
  mustFinishToday: z.boolean().optional(),
  importanceDraftChanged: z.boolean().optional(),
  targetStatus: zWorkEntryStatusValue.optional(),
  transitionRequested: z.boolean().optional(),
});
type EntryForm = z.infer<typeof zForm>;
function formFingerprint(value: EntryForm): string {
  const {
    mustFinishToday,
    importanceDraftChanged,
    notes: _notes,
    metadataContent: _metadata,
    ...fields
  } = value;
  void _notes;
  void _metadata;
  return JSON.stringify({
    ...fields,
    mustFinishToday: mustFinishToday ?? false,
    importanceDraftChanged: importanceDraftChanged ?? false,
  });
}
const zDuplicateSource = z.strictObject({
  id: zWorkEntryId,
  companyId: zWorkEntryId,
  version: z.number().int().positive(),
  title: z.string().max(200),
  linkId: zWorkEntryId.optional(),
  sourceLabel: z.string().optional(),
  selectionLabel: z.string().optional(),
  wbs: zDuplicateWbsReview.optional(),
  choiceRequired: z.boolean().optional(),
  attempt: zWorkEntryDuplicate.optional(),
});
const zSaved = z.strictObject({
  form: zForm,
  original: zWorkEntryFinal.nullable(),
  unresolved: z.boolean(),
  duplicateSource: zDuplicateSource.optional(),
  duplicateReadHold: z.boolean().optional(),
});
const keyFor = (userId: string, companyId: string) =>
  `work-tracker:work-draft:${encodeURIComponent(userId)}:${companyId}`;
function save(key: string, value: unknown) {
  try {
    sessionStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* Optional tab-local recovery. */
  }
}
function clear(key: string) {
  try {
    sessionStorage.removeItem(key);
  } catch {
    /* Optional storage. */
  }
}
function toForm(entry: WorkEntryFinal): EntryForm {
  return {
    id: entry.id,
    kind: entry.kind,
    title: entry.title,
    content: entry.content ?? '',
    notes: editableDailyNotes(entry.content ?? ''),
    metadataContent: entry.content ?? '',
    date: entry.plannedDate ?? '',
    dueDate: entry.dueDate ?? '',
    projectId: entry.projectId ?? '',
    tagIds: entry.tagIds,
    leaveType: entry.leave?.type ?? 'full',
    mustFinishToday: entry.mustFinishToday,
    targetStatus: entry.status,
  };
}
function createForm(
  date: string,
  selected: WorkspaceProject | undefined,
  activeTagIds: string[],
): EntryForm {
  return {
    id: crypto.randomUUID(),
    kind: 'task',
    title: '',
    content: '',
    date,
    dueDate: '',
    projectId: selected?.id ?? '',
    tagIds: (selected?.defaultTagIds ?? []).filter((id) => activeTagIds.includes(id)),
    leaveType: 'full',
  };
}
function read(key: string, companyId: string, initial: EntryForm): z.infer<typeof zSaved> {
  try {
    const raw = sessionStorage.getItem(key);
    if (raw) {
      const result = zSaved.safeParse(JSON.parse(raw));
      if (
        result.success &&
        (!result.data.original ||
          (result.data.original.companyId === companyId &&
            result.data.original.id === result.data.form.id)) &&
        (!result.data.duplicateSource ||
          (result.data.original === null &&
            result.data.duplicateSource.companyId === companyId &&
            result.data.duplicateSource.id !== result.data.form.id))
      )
        return {
          ...result.data,
          form: {
            ...result.data.form,
            // Upgrade older tab drafts once, using their own preserved content.
            // Original may be null (duplicate) or have an older content baseline.
            notes: result.data.form.notes ?? editableDailyNotes(result.data.form.content),
            metadataContent: result.data.form.metadataContent ?? result.data.form.content,
            mustFinishToday:
              result.data.form.mustFinishToday ?? result.data.original?.mustFinishToday ?? false,
          },
        };
      clear(key);
    }
  } catch {
    /* Invalid or unavailable drafts are ignored. */
  }
  return { form: initial, original: null, unresolved: false };
}
function dateForYear(year: number) {
  const today = kstDate(Date.now());
  return Number(today.slice(0, 4)) === year ? today : `${String(year).padStart(4, '0')}-01-01`;
}

export function WorkEntriesPanel({
  userId,
  companyId,
  projects,
  tags,
  selectedProjectId,
  year,
  unscheduled = false,
  dayView = false,
  onDateSelect,
  creationContext,
}: {
  userId: string;
  companyId: string;
  projects: WorkspaceProject[];
  tags: WorkspaceTag[];
  selectedProjectId: string;
  year: number;
  unscheduled?: boolean;
  dayView?: boolean;
  onDateSelect: (date: string) => void;
  creationContext?: { date: string; onPendingChange: (pending: boolean) => void };
}) {
  const today = useKstToday();
  const activeTagIds = tags.filter((tag) => tag.isActive).map((tag) => tag.id);
  const selectedProject = projects.find((project) => project.id === selectedProjectId);
  const initialDate = () => {
    if (creationContext && zWorkEntryDate.safeParse(creationContext.date).success)
      return creationContext.date;
    const value = new URLSearchParams(window.location.search).get('date');
    return zWorkEntryDate.safeParse(value).success ? value! : dateForYear(year);
  };
  const [editing, setEditing] = useState(!!creationContext);
  const [detailedTools, setDetailedTools] = useState(false);
  const [weekDetail, setWeekDetail] = useState(false);
  const [navigation, setNavigation] = useState<string | null>(null);
  const navigationRef = useRef<HTMLButtonElement>(null);
  const navigationDialog = useRef<HTMLDialogElement>(null);
  const navigationOrigin = useRef<HTMLAnchorElement | null>(null);
  useEffect(() => {
    if (navigation) navigationDialog.current?.showModal();
  }, [navigation]);
  const [date, setDate] = useState(initialDate);
  const [dateInput, setDateInput] = useState(initialDate);
  const storageKey = `${keyFor(userId, companyId)}:${unscheduled ? 'unscheduled' : 'day'}`;
  const [saved] = useState(() =>
    read(
      storageKey,
      companyId,
      createForm(unscheduled ? '' : initialDate(), selectedProject, activeTagIds),
    ),
  );
  const rescheduleKey = `${keyFor(userId, companyId)}:reschedule`;
  const [rescheduleRecovery, setRescheduleRecovery] = useState<RescheduleSelection | null>(() =>
    readRescheduleSelection(rescheduleKey, companyId),
  );
  const [reschedule, setReschedule] = useState<RescheduleSelection | null>(rescheduleRecovery);
  useEffect(() => {
    storeReschedule(rescheduleKey, rescheduleRecovery);
  }, [rescheduleKey, rescheduleRecovery]);
  const [form, setForm] = useState(() =>
    saved.original || saved.duplicateSource
      ? saved.form
      : {
          ...newDraftForDate(saved.form, unscheduled ? '' : initialDate(), saved.unresolved),
          tagIds: saved.form.tagIds.filter((id) => activeTagIds.includes(id)),
        },
  );
  const cleanForm = useRef(
    formFingerprint(
      saved.original
        ? toForm(saved.original)
        : {
            ...form,
            title: '',
            content: '',
            dueDate: '',
            mustFinishToday: false,
            importanceDraftChanged: false,
          },
    ),
  );
  useEffect(() => {
    if (
      saved.duplicateSource ||
      (dayView &&
        saved.original &&
        formFingerprint(saved.form) !== formFingerprint(toForm(saved.original)))
    )
      setEditing(true);
  }, [dayView, saved]);
  const [original, setOriginal] = useState(saved.original);
  const [duplicateSource, setDuplicateSource] = useState(saved.duplicateSource);
  const [duplicateReadHold, setDuplicateReadHold] = useState(
    saved.duplicateReadHold ?? !!saved.duplicateSource,
  );
  const [duplicateRequest, setDuplicateRequest] = useState<WorkEntryFinal | null>(null);
  const [duplicateLatest, setDuplicateLatest] = useState<
    (WorkEntryDuplicateSnapshot & { displayLabel: string }) | null
  >(null);
  const [unresolved, setUnresolved] = useState(saved.unresolved);
  const [latest, setLatest] = useState<WorkEntryFinal | null>(null);
  const [items, setItems] = useState<WorkEntryFinal[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [filter, setFilter] = useState({ keyword: '', projectId: '', status: 'active' });
  const [query, setQuery] = useState(filter);
  const [loading, setLoading] = useState(true);
  const [listReady, setListReady] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [online, setOnline] = useState(navigator.onLine);
  const [context, setContext] = useState<LeaveContext | null>(null);
  const [preview, setPreview] = useState<LeaveContext | null>(null);
  const [refresh, setRefresh] = useState(0);
  const [deleting, setDeleting] = useState<WorkEntryFinal | null>(null);
  const [discarding, setDiscarding] = useState(false);
  const [history, setHistory] = useState<{ title: string; value: WorkHistory } | null>(null);
  const [denied, setDenied] = useState(false);
  const sourceLabels = useWorkSourceLabels(
    companyId,
    items,
    `${userId}:${companyId}:${date}:${refresh}`,
    online && listReady && !denied,
  );
  const [kindConfirmed, setKindConfirmed] = useState(false);
  const lock = useRef(false);
  const duplicateRevision = useRef(0);
  useEffect(
    () => () => {
      duplicateRevision.current++;
    },
    [userId, companyId],
  );
  const deleteOrigin = useRef<HTMLButtonElement | null>(null);
  const confirmation = useRef<HTMLElement | null>(null);
  const revision = useRef(0);
  const displayedQuery = useRef<string | null>(null);
  const currentDraft = useRef({
    form,
    original,
    unresolved,
    ...(duplicateSource ? { duplicateSource } : {}),
    ...(duplicateReadHold ? { duplicateReadHold } : {}),
  });
  currentDraft.current = {
    form,
    original,
    unresolved,
    ...(duplicateSource ? { duplicateSource } : {}),
    ...(duplicateReadHold ? { duplicateReadHold } : {}),
  };
  const leaveReview = useLeaveWorkReview({
    userId,
    companyId,
    onExpired: expired,
    onSaved(operation, result, historical) {
      if (historical) {
        setNotice(
          '연차 명령의 과거 저장을 확인했습니다. 현재 기록은 다시 조회하세요. 입력은 유지했습니다.',
        );
        return;
      }
      const id = operation.intent === 'create' ? operation.input.id : operation.entryId;
      const changed = result.entries.find((value) => value.entryId === id);
      if (!changed) return;
      if (
        (operation.intent === 'create' || operation.intent === 'patch') &&
        changed.entry &&
        currentDraft.current.form.id === id
      )
        useEntry(changed.entry);
      if (operation.intent === 'status' && changed.entry)
        observeEntry(changed.entry, operation.input.version);
      if (operation.intent === 'delete') {
        setDeleting(null);
        if (original?.id === id) reset();
        setEditing(false);
      }
      setNotice(
        duplicateSource && operation.intent === 'create'
          ? '복제 기록을 저장했습니다. 원본은 변경하지 않았습니다. 새 기록 내용을 확인해 주세요.'
          : '연차 명령의 저장 결과를 확인했습니다.',
      );
      if (!duplicateReadHold) setRefresh((value) => value + 1);
    },
  });
  const dirty =
    formFingerprint(form) !== cleanForm.current ||
    !!duplicateSource ||
    unresolved ||
    !!rescheduleRecovery?.unresolved ||
    leaveReview.blocked;
  const dirtyRef = useRef(dirty);
  dirtyRef.current = dirty;
  useEffect(() => {
    setWorkspaceDraftDirty(storageKey, dirty || pending);
    return () => setWorkspaceDraftDirty(storageKey, false);
  }, [storageKey, dirty, pending]);
  useEffect(() => {
    creationContext?.onPendingChange(pending);
    return () => creationContext?.onPendingChange(false);
  }, [pending, creationContext?.onPendingChange]);
  const pendingRef = useRef(pending);
  pendingRef.current = pending;
  useEffect(() => {
    const before = (event: BeforeUnloadEvent) => {
      if (!dirtyRef.current && !pendingRef.current) return;
      event.preventDefault();
      event.returnValue = '';
    };
    const link = (event: MouseEvent) => {
      if (
        event.defaultPrevented ||
        event.button !== 0 ||
        event.metaKey ||
        event.ctrlKey ||
        event.shiftKey ||
        event.altKey
      )
        return;
      const target = event.target instanceof Element ? event.target.closest('a[href]') : null;
      if (!(target instanceof HTMLAnchorElement) || target.target || target.download) return;
      const url = new URL(target.href);
      if (
        url.origin !== location.origin ||
        url.href === location.href ||
        (!dirtyRef.current && !pendingRef.current)
      )
        return;
      event.preventDefault();
      navigationOrigin.current = target;
      setNavigation(url.pathname + url.search + url.hash);
      requestAnimationFrame(() => navigationRef.current?.focus());
    };
    window.addEventListener('beforeunload', before);
    document.addEventListener('click', link);
    return () => {
      window.removeEventListener('beforeunload', before);
      document.removeEventListener('click', link);
    };
  }, []);
  const activeProjects = projects.filter((project) => project.isActive);
  const activeTags = tags.filter((tag) => tag.isActive);
  useEffect(() => {
    save(storageKey, {
      form,
      original,
      unresolved,
      ...(duplicateSource ? { duplicateSource } : {}),
      ...(duplicateReadHold ? { duplicateReadHold } : {}),
    });
  }, [form, original, unresolved, duplicateSource, duplicateReadHold, storageKey]);
  useEffect(
    () => setKindConfirmed(false),
    [form.kind, form.targetStatus, form.projectId, form.tagIds],
  );
  useEffect(() => {
    if (deleting || discarding || duplicateRequest) {
      confirmation.current?.focus();
      confirmation.current?.scrollIntoView({ block: 'center' });
    }
  }, [deleting, discarding, duplicateRequest]);
  const focusedLinkEntry = useRef('');
  useEffect(() => {
    if (!unscheduled && !dayView) return;
    const id = new URLSearchParams(location.search).get('entryId');
    const linked = items.find((entry) => entry.id === id);
    if (!id || focusedLinkEntry.current === id || !linked) return;
    if (
      dayView &&
      (dirty || unresolved || duplicateSource || duplicateRequest || pending || lock.current)
    )
      return;
    const node = document.getElementById(`work-entry-${id}`);
    if (node) {
      focusedLinkEntry.current = id;
      node.focus();
      node.scrollIntoView({ block: 'center' });
      if (dayView) void edit(linked);
    }
  }, [items, unscheduled, dayView, dirty, unresolved, duplicateSource, duplicateRequest, pending]);
  function expired(failure: unknown) {
    if (failure instanceof WorkFailure && failure.status === 401) {
      save(storageKey, currentDraft.current);
      const route = `/c/${companyId}/${unscheduled ? 'unscheduled' : dayView ? 'day' : 'week'}`;
      const params = new URLSearchParams();
      if (!unscheduled) {
        params.set('year', String(year));
        params.set('date', date);
      }
      if (selectedProjectId) params.set('projectId', selectedProjectId);
      const entryId = new URLSearchParams(location.search).get('entryId');
      if ((unscheduled || dayView) && zWorkEntryId.safeParse(entryId).success)
        params.set('entryId', entryId!);
      dirtyRef.current = false;
      pendingRef.current = false;
      window.location.assign(
        `/login?${new URLSearchParams({ returnTo: route + (params.size ? `?${params}` : '') })}`,
      );
      return true;
    }
    return false;
  }
  const path = `/api/companies/${companyId}/work-entries`;
  function listQuery(next?: string) {
    const params = new URLSearchParams({
      limit: '50',
      dateState: unscheduled ? 'unscheduled' : 'scheduled',
    });
    if (unscheduled) {
      params.set('kinds', 'task');
      for (const status of query.status === 'canceled' ? ['canceled'] : ['todo', 'paused'])
        params.append('statuses', status);
    } else {
      params.set('projection', 'working');
      params.set('from', date);
      params.set('to', date);
      if (query.status === 'canceled') params.set('statuses', 'canceled');
      else
        for (const status of ['todo', 'doing', 'paused', 'planned', 'done'])
          params.append('statuses', status);
    }
    if (query.keyword) params.set('keyword', query.keyword);
    if (query.projectId) params.set('projectIds', query.projectId);
    if (next) params.set('cursor', next);
    return params.toString();
  }
  async function load(more = false) {
    if (duplicateReadHold || !navigator.onLine) {
      if (duplicateReadHold && displayedQuery.current !== listQuery()) {
        displayedQuery.current = null;
        setItems([]);
        setCursor(null);
        setListReady(false);
      }
      setLoading(false);
      return;
    }
    const ticket = ++revision.current;
    const requestedQuery = listQuery();
    setLoading(true);
    if (!more && requestedQuery !== displayedQuery.current) {
      displayedQuery.current = null;
      setCursor(null);
      setItems([]);
      setListReady(false);
    }
    try {
      const value = await workApi(
        `${path}?${listQuery(more ? (cursor ?? undefined) : undefined)}`,
        workListSchema(companyId),
      );
      if (ticket !== revision.current) return;
      if (
        value.items.some((row) =>
          unscheduled
            ? row.kind !== 'task' || row.plannedDate !== null
            : !entryVisibleOnDate(row, date, 'working'),
        )
      )
        throw new WorkFailure(0, 'INVALID_RESPONSE');
      // An explicit link may name a canceled entry or one beyond the current page.
      // Read that exact owned record, never widen the normal daily list's status scope.
      const directId = new URLSearchParams(location.search).get('entryId');
      if (
        dayView &&
        !more &&
        zWorkEntryId.safeParse(directId).success &&
        !value.items.some((row) => row.id === directId)
      ) {
        try {
          const linked = await workApi(
            `/api/work-entries/${directId}`,
            workEntrySchema(companyId, directId!),
          );
          if (ticket !== revision.current) return;
          if (
            entryVisibleOnDate(linked, date, 'working') &&
            (!query.projectId || linked.projectId === query.projectId)
          )
            value.items.push(linked);
        } catch (failure) {
          if (ticket !== revision.current) return;
          if (!(failure instanceof WorkFailure && [403, 404].includes(failure.status)))
            throw failure;
          setNotice(
            '링크된 업무를 확인할 수 없습니다. 목록의 다른 업무는 그대로 확인할 수 있습니다.',
          );
        }
      }
      setItems((previous) =>
        more
          ? [
              ...previous,
              ...value.items.filter((row) => !previous.some((old) => old.id === row.id)),
            ]
          : value.items,
      );
      setCursor(value.nextCursor);
      displayedQuery.current = requestedQuery;
      setListReady(true);
      setDenied(false);
    } catch (failure) {
      if (ticket === revision.current && !expired(failure)) {
        if (failure instanceof WorkFailure && failure.status === 403) setDenied(true);
        setError(workError(failure));
      }
    } finally {
      if (ticket === revision.current) setLoading(false);
    }
  }
  useEffect(() => {
    void load();
    return () => {
      revision.current++;
    };
  }, [date, query, unscheduled, refresh, duplicateReadHold]);
  useEffect(() => {
    const update = () => setOnline(navigator.onLine);
    window.addEventListener('online', update);
    window.addEventListener('offline', update);
    const awake = () => {
      if (
        document.visibilityState === 'visible' &&
        navigator.onLine &&
        !currentDraft.current.duplicateReadHold
      )
        setRefresh((value) => value + 1);
    };
    document.addEventListener('visibilitychange', awake);
    let previousDay = kstDate(Date.now());
    const timer = window.setInterval(() => {
      const day = kstDate(Date.now());
      if (day !== previousDay) {
        previousDay = day;
        if (navigator.onLine && !currentDraft.current.duplicateReadHold)
          setRefresh((value) => value + 1);
      }
    }, 30_000);
    return () => {
      window.removeEventListener('online', update);
      window.removeEventListener('offline', update);
      document.removeEventListener('visibilitychange', awake);
      window.clearInterval(timer);
    };
  }, []);
  useEffect(() => {
    if (!unscheduled && Number(date.slice(0, 4)) !== year) {
      const next = dateForYear(year);
      setDate(next);
      setDateInput(next);
    }
  }, [year]);
  useEffect(() => {
    let active = true;
    setContext(null);
    if (!unscheduled && !duplicateReadHold)
      void workApi(
        `/api/companies/${companyId}/days/${date}/leave-context`,
        leaveContextSchema(companyId, date),
      )
        .then((value) => {
          if (active) setContext(value);
        })
        .catch((failure: unknown) => {
          if (active && !expired(failure)) setError(workError(failure));
        });
    return () => {
      active = false;
    };
  }, [date, unscheduled, refresh, duplicateReadHold]);
  useEffect(() => {
    let active = true;
    setPreview(null);
    if (form.kind === 'leave' && zWorkEntryDate.safeParse(form.date).success)
      void workApi(
        `/api/companies/${companyId}/days/${form.date}/${duplicateReadHold ? 'duplicate-leave-context' : 'leave-context'}`,
        leaveContextSchema(companyId, form.date),
      )
        .then((value) => {
          if (active) setPreview(value);
        })
        .catch((failure: unknown) => {
          if (active && !expired(failure)) setError(workError(failure));
        });
    return () => {
      active = false;
    };
  }, [form.kind, form.date, refresh, duplicateReadHold]);
  useEffect(() => {
    if (!selectedProject) return;
    const baseline = cleanForm.current;
    setForm((value) => {
      const draft = currentDraft.current;
      if (
        draft.original ||
        draft.unresolved ||
        draft.duplicateSource ||
        draft.duplicateReadHold ||
        reschedule ||
        rescheduleRecovery ||
        pendingRef.current ||
        value.title ||
        value.content ||
        value.projectId ||
        formFingerprint(value) !== baseline
      )
        return value;
      const next = {
        ...value,
        projectId: selectedProject.id,
        tagIds: selectedProject.defaultTagIds.filter((id) =>
          tags.some((tag) => tag.id === id && tag.isActive),
        ),
      };
      cleanForm.current = formFingerprint(next);
      return next;
    });
  }, [selectedProjectId]);
  function reset() {
    const next = createForm(unscheduled ? '' : date, selectedProject, activeTagIds);
    cleanForm.current = formFingerprint(next);
    currentDraft.current = {
      form: next,
      original: null,
      unresolved: false,
      ...(currentDraft.current.duplicateReadHold ? { duplicateReadHold: true } : {}),
    };
    setForm(next);
    setOriginal(null);
    setDuplicateSource(undefined);
    setDuplicateRequest(null);
    setDuplicateLatest(null);
    setLatest(null);
    setUnresolved(false);
    setHistory(null);
    setDeleting(null);
    setDiscarding(false);
    setKindConfirmed(false);
    clear(storageKey);
  }
  function useEntry(value: WorkEntryFinal) {
    const next = toForm(value);
    cleanForm.current = formFingerprint(next);
    currentDraft.current = {
      form: next,
      original: value,
      unresolved: false,
      ...(currentDraft.current.duplicateReadHold ? { duplicateReadHold: true } : {}),
    };
    setOriginal(value);
    setDuplicateSource(undefined);
    setDuplicateRequest(null);
    setDuplicateLatest(null);
    setForm(next);
    setLatest(null);
    setUnresolved(false);
    setKindConfirmed(false);
    clear(storageKey);
  }
  function observeEntry(value: WorkEntryFinal, confirmedSourceVersion?: number) {
    const draft = currentDraft.current;
    const action = reconcileWorkEntryDraft({
      original: draft.original,
      incoming: value,
      changed:
        formFingerprint(draft.form) !== cleanForm.current ||
        !!draft.duplicateSource ||
        !!draft.duplicateReadHold,
      unresolved: draft.unresolved,
      confirmedSourceVersion,
    });
    if (action === 'sync') useEntry(value);
    else if (action === 'conflict') {
      setLatest(value);
      setUnresolved(true);
      currentDraft.current.unresolved = true;
    }
  }
  async function duplicateLabel(snapshot: WorkEntryDuplicateSnapshot) {
    if (!snapshot.wbs.target) return '연결 없음';
    const target = await readWorkLinkTarget(companyId, snapshot.wbs.target);
    if (
      target.itemVersion !== snapshot.wbs.target.itemVersion ||
      target.planVersion !== snapshot.wbs.target.planVersion
    )
      throw new WorkFailure(409, 'VERSION_CONFLICT');
    return `${projects.find((project) => project.id === target.projectId)?.code ?? '프로젝트'} · ${target.year} · ${target.title}`;
  }
  function prepareDuplicate(snapshot: WorkEntryDuplicateSnapshot, label: string) {
    const { entry: source, sourceVersion } = snapshot;
    const linkId = crypto.randomUUID();
    const draft = createWorkDuplicateDraft(source, crypto.randomUUID());
    setDuplicateReadHold(true);
    setForm({
      id: draft.id,
      kind: draft.kind,
      title: draft.title,
      content: draft.content ?? '',
      notes: editableDailyNotes(draft.content ?? ''),
      metadataContent: draft.content ?? '',
      date: '',
      dueDate: '',
      projectId: draft.projectId ?? '',
      tagIds: draft.tagIds,
      leaveType: draft.leave?.type ?? 'full',
      mustFinishToday: draft.mustFinishToday,
    });
    setOriginal(null);
    setDuplicateSource({
      id: source.id,
      companyId: source.companyId,
      version: sourceVersion,
      title: source.title,
      linkId,
      sourceLabel: label,
      selectionLabel: label,
      wbs: createDuplicateWbsReview(snapshot, linkId),
      choiceRequired: false,
    });
    setLatest(null);
    setUnresolved(false);
    setDuplicateRequest(null);
    setDuplicateLatest(null);
    setKindConfirmed(false);
    setHistory(null);
    setDeleting(null);
    setDiscarding(false);
    setError('');
    setNotice(
      '복제 내용을 새 입력으로 준비했습니다. 원본은 변경하지 않습니다. 날짜와 선택 항목을 확인한 뒤 직접 저장하세요.',
    );
    document.getElementById('work-form-title')?.scrollIntoView({ block: 'start' });
  }
  async function beginDuplicate(id: string) {
    if (lock.current || unresolved || denied || !navigator.onLine) return;
    lock.current = true;
    setPending(true);
    setDuplicateReadHold(true);
    currentDraft.current.duplicateReadHold = true;
    const ticket = ++duplicateRevision.current;
    setError('');
    try {
      const snapshot = await readWorkDuplicate(companyId, id);
      const label = await duplicateLabel(snapshot);
      if (ticket !== duplicateRevision.current) return;
      prepareDuplicate(snapshot, label);
    } catch (failure) {
      if (ticket === duplicateRevision.current && !expired(failure)) setError(workError(failure));
    } finally {
      if (ticket === duplicateRevision.current) {
        lock.current = false;
        setPending(false);
      }
    }
  }
  async function refreshDuplicateSource() {
    if (!duplicateSource || lock.current || !navigator.onLine) return;
    const ticket = duplicateRevision.current;
    lock.current = true;
    setPending(true);
    setError('');
    try {
      const snapshot = await readWorkDuplicate(companyId, duplicateSource.id);
      const displayLabel = await duplicateLabel(snapshot);
      if (ticket !== duplicateRevision.current) return;
      setDuplicateLatest({ ...snapshot, displayLabel });
      setNotice('원본의 최신 상태를 확인했습니다. 현재 입력과 비교한 뒤 직접 선택하세요.');
    } catch (failure) {
      if (ticket !== duplicateRevision.current) return;
      if (!expired(failure)) setError(workError(failure));
    } finally {
      lock.current = false;
      setPending(false);
    }
  }
  function requestDuplicate(value: WorkEntryFinal) {
    if (lock.current || unresolved || denied || !navigator.onLine) return;
    if (
      original ||
      duplicateSource ||
      form.title ||
      form.content ||
      form.dueDate ||
      form.kind !== 'task' ||
      form.mustFinishToday ||
      form.importanceDraftChanged ||
      form.date !== (unscheduled ? '' : date) ||
      form.projectId !== (selectedProject?.id ?? '') ||
      JSON.stringify([...form.tagIds].sort()) !==
        JSON.stringify(
          [
            ...(selectedProject?.defaultTagIds ?? []).filter((id) => activeTagIds.includes(id)),
          ].sort(),
        )
    )
      setDuplicateRequest(value);
    else void beginDuplicate(value.id);
  }
  async function checkResult(
    id = form.id,
    creating = original === null,
    attempt: WorkEntryDuplicate | undefined = currentDraft.current.duplicateSource?.attempt,
  ) {
    const ticket = duplicateRevision.current;
    const requestedVersion = currentDraft.current.original?.version;
    const requestedForm = formFingerprint(currentDraft.current.form);
    const stillCurrent = () =>
      ticket === duplicateRevision.current &&
      currentDraft.current.form.id === id &&
      currentDraft.current.original?.version === requestedVersion &&
      formFingerprint(currentDraft.current.form) === requestedForm;
    setUnresolved(true);
    try {
      const snapshot = duplicateReadHold ? await readWorkDuplicate(companyId, id) : null;
      const value =
        snapshot?.entry ??
        (await workApi(`/api/work-entries/${id}`, workEntrySchema(companyId, id)));
      if (!stillCurrent()) return;
      if (creating) {
        if (
          duplicateSource &&
          (!attempt || !snapshot || !matchesWorkDuplicate(companyId, attempt, snapshot))
        ) {
          setError(
            '같은 ID의 기록이 있지만 요청한 업무 내용과 WBS 연결을 모두 확인하지 못했습니다. 입력과 ID를 보존합니다.',
          );
          return;
        }
        useEntry(value);
        setNotice('같은 ID로 저장된 기록을 확인했습니다. 내용을 확인해 주세요.');
      } else {
        setLatest(value);
        setNotice('최신 기록을 불러왔습니다. 입력을 유지할지 최신 내용으로 바꿀지 선택해 주세요.');
      }
      if (!duplicateReadHold) setRefresh((value) => value + 1);
    } catch (failure) {
      if (!stillCurrent()) return;
      if (expired(failure)) return;
      if (failure instanceof WorkFailure && [403, 404].includes(failure.status))
        setError(
          '이 ID의 기록을 확인할 수 없어 저장 여부가 불명확합니다. 동일 ID를 유지하며 다시 조회하거나 직접 재시도를 선택하세요.',
        );
      else setError(workError(failure));
    }
  }
  async function edit(value: WorkEntryFinal) {
    if (lock.current) return;
    if (
      dirty &&
      !window.confirm(
        '현재 입력을 다른 기록으로 교체할까요? 계속하려면 현재 입력을 먼저 저장하거나, 교체를 확인하세요.',
      )
    )
      return;
    setEditing(true);
    if (duplicateSource) {
      setError('복제 입력을 보존하고 있습니다. 먼저 복제 입력 취소로 검토를 종료하세요.');
      return;
    }
    lock.current = true;
    setPending(true);
    setError('');
    setNotice('');
    try {
      const row = await workApi(
        `/api/work-entries/${value.id}`,
        workEntrySchema(companyId, value.id),
      );
      useEntry(row);
      document.getElementById('work-form-title')?.scrollIntoView({ block: 'start' });
    } catch (failure) {
      if (!expired(failure)) setError(workError(failure));
    } finally {
      lock.current = false;
      setPending(false);
    }
  }
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (lock.current || unresolved || denied || !online) return;
    if (
      duplicateSource &&
      (!duplicateSource.wbs || !duplicateSource.linkId || duplicateSource.choiceRequired)
    ) {
      setError('원본을 다시 확인하고 새 업무의 WBS 연결 또는 연결 없이 복사를 선택해 주세요.');
      return;
    }
    if (
      duplicateSource?.wbs?.link &&
      (form.kind !== 'task' || duplicateSource.wbs.link.projectId !== form.projectId)
    ) {
      setError('현재 프로젝트·종류에 맞는 WBS를 다시 선택하거나 연결 없이 복사를 선택해 주세요.');
      return;
    }
    if (duplicateSource && !form.date) {
      setError('복제할 새 기록의 날짜를 지정해 주세요.');
      return;
    }
    if (transitionRequested && (!form.targetStatus || !kindConfirmed)) {
      setError('바꿀 종류의 상태·프로젝트·태그를 확인해 주세요.');
      return;
    }
    if (form.kind === 'leave' && (!preview || preview.calculationBasis.date !== form.date)) {
      setError('휴가 계산 기준을 먼저 조회해 주세요.');
      return;
    }
    if (
      form.kind === 'task' &&
      form.date === date &&
      context &&
      !context.summary.canAddTask &&
      (!original || original.kind !== 'task' || original.plannedDate !== form.date)
    ) {
      setError('종일 휴가일에는 새 업무를 배정할 수 없습니다. 입력 예외를 확인해 주세요.');
      return;
    }
    const common = {
      title: form.title,
      content: form.content || null,
      projectId: form.projectId || null,
      plannedDate: form.date || null,
      dueDate: form.kind === 'leave' ? null : form.dueDate || null,
      tagIds: form.tagIds,
      mustFinishToday: form.mustFinishToday ?? false,
    };
    const payload = original
      ? {
          ...common,
          version: original.version,
          ...(transitionRequested ? { kind: form.kind, status: form.targetStatus } : {}),
          ...(dayView &&
          original.kind !== 'leave' &&
          original.status !== 'paused' &&
          !transitionRequested &&
          form.targetStatus
            ? { status: form.targetStatus }
            : {}),
          ...(original.kind === 'leave'
            ? { leave: { type: form.leaveType }, calculationBasis: preview!.calculationBasis }
            : {}),
        }
      : {
          ...common,
          id: form.id,
          kind: form.kind,
          ...(form.kind === 'leave'
            ? { leave: { type: form.leaveType }, calculationBasis: preview!.calculationBasis }
            : {}),
        };
    const parsed = original
      ? zWorkEntryPatch.safeParse(payload)
      : zWorkEntryCreate.safeParse(payload);
    if (!parsed.success) {
      setError('제목·프로젝트·태그 선택과 날짜를 확인해 주세요. 태그는 선택 사항입니다.');
      return;
    }
    if (form.kind === 'leave') {
      lock.current = true;
      setPending(true);
      setError('');
      try {
        if (
          await leaveReview.inspect(
            original
              ? { intent: 'patch', entryId: original.id, input: parsed.data }
              : { intent: 'create', input: parsed.data },
            original ?? undefined,
            duplicateSource
              ? { id: duplicateSource.id, version: duplicateSource.version }
              : undefined,
          )
        )
          return;
      } catch (failure) {
        setError(workError(failure));
        return;
      } finally {
        lock.current = false;
        setPending(false);
      }
    }
    lock.current = true;
    setPending(true);
    setError('');
    setNotice('');
    const ticket = duplicateRevision.current;
    const attempt = duplicateSource
      ? zWorkEntryDuplicate.parse({
          sourceVersion: duplicateSource.version,
          entry: parsed.data,
          wbs: duplicateSource.wbs,
        })
      : undefined;
    const submittedSource =
      duplicateSource && attempt ? { ...duplicateSource, attempt } : duplicateSource;
    if (submittedSource) {
      setDuplicateSource(submittedSource);
      currentDraft.current.duplicateSource = submittedSource;
    }
    save(storageKey, {
      form,
      original,
      unresolved: true,
      ...(submittedSource ? { duplicateSource: submittedSource } : {}),
      ...(duplicateReadHold ? { duplicateReadHold } : {}),
    });
    try {
      const value = duplicateSource
        ? await saveWorkDuplicate(
            companyId,
            duplicateSource.id,
            duplicateSource.version,
            parsed.data,
            duplicateSource.wbs,
          )
        : await workApi(
            original ? `/api/work-entries/${original.id}` : path,
            workEntrySchema(companyId, form.id),
            original ? 'PATCH' : 'POST',
            parsed.data,
          );
      let importanceNeedsReview = false;
      if (!original) {
        try {
          await commitPendingWorkImportance(userId, companyId, value.id);
        } catch {
          importanceNeedsReview = true;
        }
      }
      if (ticket !== duplicateRevision.current) return;
      useEntry(value);
      if (dayView && !creationContext) setEditing(false);
      setNotice(
        importanceNeedsReview
          ? '기록은 저장했습니다. 중요 표시만 확인이 필요합니다. 업무를 다시 열어 확인해 주세요.'
          : duplicateSource
            ? '복제 기록을 저장했습니다. 원본은 변경하지 않았습니다. 새 기록 내용을 확인해 주세요.'
            : '기록을 저장했습니다.',
      );
      if (!duplicateReadHold) setRefresh((value) => value + 1);
    } catch (failure) {
      if (ticket !== duplicateRevision.current) return;
      if (expired(failure)) return;
      save(storageKey, {
        form,
        original,
        unresolved: false,
        ...(submittedSource ? { duplicateSource: submittedSource } : {}),
        ...(duplicateReadHold ? { duplicateReadHold } : {}),
      });
      setError(workError(failure));
      if (uncertainWork(failure) || (failure instanceof WorkFailure && failure.status === 409)) {
        setUnresolved(true);
        currentDraft.current.unresolved = true;
        await checkResult(form.id, original === null, attempt);
      }
      if (
        !duplicateReadHold &&
        failure instanceof WorkFailure &&
        (failure.status === 409 || failure.status === 422)
      )
        setRefresh((value) => value + 1);
    } finally {
      lock.current = false;
      setPending(false);
    }
  }
  async function changePause(value: WorkEntryFinal, action: 'pause' | 'resume') {
    if (lock.current || !navigator.onLine || duplicateReadHold || value.kind !== 'task') return;
    lock.current = true;
    setPending(true);
    setError('');
    setNotice('');
    const ticket = duplicateRevision.current;
    try {
      const result = await setWorkPause(companyId, value, action);
      if (ticket !== duplicateRevision.current) return;
      observeEntry(result, value.version);
      setNotice(
        action === 'pause'
          ? '업무를 중단했습니다. 자동 이월하지 않으며 직접 재개할 수 있습니다.'
          : `업무를 ${statuses[result.status]} 상태로 재개했습니다.`,
      );
      setRefresh((count) => count + 1);
    } catch (failure) {
      if (ticket !== duplicateRevision.current || expired(failure)) return;
      setError(workError(failure));
      if (failure instanceof WorkFailure && failure.status === 403) {
        revision.current++;
        setDenied(true);
        setItems([]);
        setCursor(null);
        setHistory(null);
        return;
      }
      if (uncertainWork(failure) || (failure instanceof WorkFailure && failure.status === 409)) {
        try {
          const requestedOriginal = currentDraft.current.original;
          const latest = (await readWorkDuplicate(companyId, value.id)).entry;
          if (ticket !== duplicateRevision.current) return;
          if (
            requestedOriginal?.id === latest.id &&
            currentDraft.current.original?.id === latest.id &&
            currentDraft.current.original.version === requestedOriginal.version
          ) {
            setLatest(latest);
            setUnresolved(true);
            currentDraft.current.unresolved = true;
          }
          setNotice(
            `현재 상태: ${statuses[latest.status]}. 결과를 확인했으며 자동으로 재전송하지 않습니다.`,
          );
        } catch (checkFailure) {
          if (ticket === duplicateRevision.current && !expired(checkFailure))
            setError(workError(checkFailure));
        }
      }
      setRefresh((count) => count + 1);
    } finally {
      if (ticket === duplicateRevision.current) {
        lock.current = false;
        setPending(false);
      }
    }
  }
  async function changeStatus(value: WorkEntryFinal, status: WorkEntryFinal['status']) {
    if (lock.current || !online) return;
    lock.current = true;
    setPending(true);
    setError('');
    setNotice('');
    // Preserve any unrelated in-progress form; conflict detail is shown without overwriting it.
    try {
      let calculationBasis;
      if (value.kind === 'leave' && value.status === 'canceled' && status !== 'canceled')
        calculationBasis = (
          await workApi(
            `/api/companies/${companyId}/days/${value.plannedDate}/leave-context`,
            leaveContextSchema(companyId, value.plannedDate!),
          )
        ).calculationBasis;
      if (
        value.kind === 'leave' &&
        (await leaveReview.inspect(
          {
            intent: 'status',
            entryId: value.id,
            input: {
              version: value.version,
              status,
              ...(calculationBasis ? { calculationBasis } : {}),
            },
          },
          value,
        ))
      )
        return;
      const result = await workApi(
        `/api/work-entries/${value.id}/status`,
        workEntrySchema(companyId, value.id),
        'POST',
        { version: value.version, status, ...(calculationBasis ? { calculationBasis } : {}) },
      );
      observeEntry(result, value.version);
      setNotice('상태를 변경했습니다.');
      setRefresh((v) => v + 1);
    } catch (failure) {
      if (!expired(failure)) {
        setError(workError(failure));
        if (
          currentDraft.current.original?.id === value.id &&
          (uncertainWork(failure) || (failure instanceof WorkFailure && failure.status === 409))
        ) {
          currentDraft.current.unresolved = true;
          setUnresolved(true);
          await checkResult(value.id, false);
        }
        setRefresh((v) => v + 1);
      }
    } finally {
      lock.current = false;
      setPending(false);
    }
  }
  async function remove() {
    if (!deleting || lock.current || !online) return;
    lock.current = true;
    setPending(true);
    setError('');
    const target = deleting;
    try {
      if (
        target.kind === 'leave' &&
        (await leaveReview.inspect(
          { intent: 'delete', entryId: target.id, input: { version: target.version } },
          target,
        ))
      ) {
        setDeleting(null);
        return;
      }
      await workApi(
        `/api/work-entries/${target.id}`,
        z.strictObject({ deleted: z.literal(true), id: z.literal(target.id) }),
        'DELETE',
        { version: target.version },
      );
      setDeleting(null);
      if (original?.id === target.id) reset();
      setEditing(false);
      setNotice('기록을 삭제했습니다.');
      setRefresh((v) => v + 1);
    } catch (failure) {
      if (expired(failure)) return;
      setDeleting(null);
      setError('삭제 결과를 확인하지 못했습니다. 다시 조회해 주세요.');
      try {
        const current = await workApi(
          `/api/work-entries/${target.id}`,
          workEntrySchema(companyId, target.id),
        );
        setNotice(
          `현재 기록이 남아 있습니다: ${current.title}. 삭제하려면 목록을 확인하고 다시 선택하세요.`,
        );
      } catch (checkFailure) {
        if (expired(checkFailure)) return;
        if (checkFailure instanceof WorkFailure && checkFailure.status === 404) {
          if (original?.id === target.id) reset();
          setEditing(false);
          setError('');
          setNotice('해당 기록이 더 이상 존재하지 않는 것을 확인했습니다.');
        } else setError(workError(checkFailure));
      }
      setRefresh((v) => v + 1);
    } finally {
      lock.current = false;
      setPending(false);
    }
  }
  async function showHistory(value: WorkEntryFinal) {
    if (lock.current) return;
    lock.current = true;
    setPending(true);
    setError('');
    setHistory(null);
    try {
      setHistory({
        title: value.title,
        value: await workApi(`/api/work-entries/${value.id}/changes`, historySchema(value.id)),
      });
    } catch (failure) {
      if (!expired(failure)) setError(workError(failure));
    } finally {
      lock.current = false;
      setPending(false);
    }
  }
  async function inputPolicy() {
    if (!context || lock.current || !online) return;
    lock.current = true;
    setPending(true);
    setError('');
    try {
      await workApi(
        `/api/companies/${companyId}/days/${date}/input-policy`,
        zWorkDay.refine((day) => day.date === date),
        'PUT',
        { allowTaskInput: !context.day?.allowTaskInput, version: context.day?.version ?? null },
      );
      setNotice('이 날짜의 업무 입력 예외를 저장했습니다.');
    } catch (failure) {
      if (!expired(failure))
        setError(
          '입력 예외 저장 결과를 다시 조회합니다. 현재 표시를 확인한 뒤 필요한 경우 다시 저장하세요.',
        );
    } finally {
      setContext(null);
      setRefresh((v) => v + 1);
      lock.current = false;
      setPending(false);
    }
  }
  const disabled =
    pending ||
    leaveReview.blocked ||
    denied ||
    !online ||
    unresolved ||
    !!reschedule ||
    !!rescheduleRecovery?.unresolved;
  const transitionRequested =
    !!original && (original.kind !== form.kind || !!form.transitionRequested);
  const dateLocked = !!original && (original.timeMode === 'exact' || original.endDate !== null);
  const amount = preview
    ? calculateLeaveHours(form.leaveType, preview.calculationBasis.workHoursPerDay)
    : null;
  const noDateAllowed =
    form.kind === 'task' &&
    (!original ||
      ((original.status === 'paused'
        ? original.resumeStatus === 'todo'
        : !['doing', 'done'].includes(original.status)) &&
        ['todo', 'paused', 'canceled'].includes(form.targetStatus ?? original.status)));
  const hiddenTags = form.tagIds.filter((id) => !activeTags.some((tag) => tag.id === id));
  const selectionLabel = (value: { projectId: string | null; tagIds: string[] }) =>
    `${value.projectId ? (projects.find((project) => project.id === value.projectId)?.code ?? '이전 프로젝트') : '프로젝트 없음'} · ${value.tagIds.length ? value.tagIds.map((id) => tags.find((tag) => tag.id === id)?.label ?? '이전 태그').join(', ') : '태그 없음'}`;
  const deletePanel = deleting && (
    <section
      className="work-confirm"
      ref={confirmation}
      tabIndex={-1}
      role="alertdialog"
      aria-labelledby="work-delete-title"
    >
      <h3 id="work-delete-title">기록을 영구 삭제할까요?</h3>
      <p>{deleting.title}</p>
      <p>
        휴가 상세와 변경 이력도 삭제되며 앱에서 복원할 수 없습니다. 기록을 남기려면 취소를
        사용하세요.
      </p>
      <div className="work-actions">
        <button
          className="button secondary"
          disabled={pending}
          onClick={() => {
            setDeleting(null);
            deleteOrigin.current?.focus();
          }}
        >
          삭제하지 않기
        </button>
        <button className="button primary" disabled={disabled} onClick={() => void remove()}>
          영구 삭제 확인
        </button>
      </div>
    </section>
  );
  const historyPanel = history && (
    <WorkDialogSurface modal={false} open label="업무 변경 이력" onClose={() => setHistory(null)}>
      <section className="work-history" aria-label="업무 변경 이력">
        <h3>{history.title} · 변경 이력</h3>
        <p className="field-hint">
          저장된 날짜·상태·분류 변경입니다. 제목·본문의 과거 내용은 수집되지 않았습니다.
        </p>
        {history.value.items.length === 0 && <p>변경 이력이 없습니다.</p>}
        <ol>
          {history.value.items.map((change) => (
            <li key={change.id}>
              <strong>
                버전 {change.entryVersion} ·{' '}
                {new Date(change.changedAt).toLocaleString('ko-KR', {
                  timeZone: 'Asia/Seoul',
                })}
              </strong>
              <p>
                {change.before
                  ? `${change.before.plannedDate ?? '날짜 미정'} · ${statuses[change.before.status]}`
                  : '새 기록'}{' '}
                → {change.after.plannedDate ?? '날짜 미정'} · {statuses[change.after.status]}
              </p>
              {change.after.leave && (
                <p>
                  {leaveLabels[change.after.leave.type]} · {change.after.leave.unavailableHours}시간
                </p>
              )}
              {change.schemaVersion !== 1 ? (
                <>
                  <p>
                    {change.before ? `${kinds[change.before.kind]} → ` : ''}
                    {kinds[change.after.kind]}
                  </p>
                  <p>
                    {change.before ? `${selectionLabel(change.before)} → ` : ''}
                    {selectionLabel(change.after)}
                  </p>
                </>
              ) : (
                <p className="field-hint">
                  이 기록의 종류·프로젝트·태그 과거 값은 수집되지 않았습니다.
                </p>
              )}
              {change.before?.status === 'done' && (
                <p>
                  이전 완료 처리:{' '}
                  {change.before.completedAt === null
                    ? '시각 미수집'
                    : new Date(change.before.completedAt).toLocaleString('ko-KR', {
                        timeZone: 'Asia/Seoul',
                      })}
                </p>
              )}
              {change.after.status === 'done' && (
                <p>
                  완료 처리:{' '}
                  {change.after.completedAt === null
                    ? '시각 미수집'
                    : new Date(change.after.completedAt).toLocaleString('ko-KR', {
                        timeZone: 'Asia/Seoul',
                      })}
                </p>
              )}
              {change.reason && <p>{change.reason}</p>}
            </li>
          ))}
        </ol>
        <button className="text-button" onClick={() => setHistory(null)}>
          이력 닫기
        </button>
      </section>
    </WorkDialogSurface>
  );
  return (
    <section
      className={`work-panel work-layout ${dayView ? 'is-day' : unscheduled ? 'is-unscheduled' : 'is-week'} ${editing ? 'is-editing' : 'is-reviewing'}${creationContext ? ' is-schedule-create' : ''}`}
      aria-labelledby="work-panel-title"
    >
      {leaveReview.panel}
      <div className="work-heading">
        <h2 id="work-panel-title">
          {unscheduled ? '날짜 미정 업무' : dayView ? '일간 상세' : '주간'}
        </h2>
        {unscheduled && (
          <a className="control-link" href={`/c/${companyId}/week?year=${year}`}>
            주간으로
          </a>
        )}
      </div>
      {unscheduled && (
        <div
          className={`work-mode-bar${pending || unresolved || dirty ? ' has-work-status' : ''}`}
          aria-label="확인·편집 모드"
          hidden={!!creationContext || !unscheduled}
        >
          <div className="work-mode-switch">
            <button type="button" aria-pressed={!editing} onClick={() => setEditing(false)}>
              확인 모드
            </button>
            <button type="button" aria-pressed={editing} onClick={() => setEditing(true)}>
              편집 모드
            </button>
          </div>

          <p>
            {pending
              ? '저장·처리 중…'
              : unresolved
                ? '저장 결과 확인 필요 · 초안 유지'
                : dirty
                  ? '저장 전 변경 있음 · 초안 유지'
                  : editing
                    ? '입력 후 저장 버튼으로 반영합니다.'
                    : '완료 체크와 화면 탐색을 할 수 있습니다.'}
          </p>
        </div>
      )}
      {navigation && (
        <dialog
          ref={navigationDialog}
          className="work-navigation-confirm"
          role="alertdialog"
          aria-labelledby="work-navigation-title"
          onCancel={(event) => {
            event.preventDefault();
            navigationDialog.current?.close();
            setNavigation(null);
            requestAnimationFrame(() => navigationOrigin.current?.focus());
          }}
        >
          <h3 id="work-navigation-title">작성 중인 입력을 두고 이동할까요?</h3>
          <p>
            서버에는 자동 저장되지 않습니다. 이 탭의 초안을 보관하지만 브라우저 저장 공간을 사용할
            수 없으면 복원하지 못할 수 있습니다.
          </p>
          <div className="work-actions">
            <button
              type="button"
              ref={navigationRef}
              onClick={() => {
                navigationDialog.current?.close();
                setNavigation(null);
                requestAnimationFrame(() => navigationOrigin.current?.focus());
              }}
            >
              이 화면에 머무르기
            </button>
            <button
              type="button"
              disabled={pending}
              onClick={() => {
                save(storageKey, currentDraft.current);
                const target = navigation;
                dirtyRef.current = false;
                window.location.assign(target);
              }}
            >
              초안 보관하고 이동
            </button>
          </div>
        </dialog>
      )}
      {unscheduled && (
        <p>회사 전체 · 날짜 미정. 연도와 관계없이 아직 날짜를 배정하지 않은 업무입니다.</p>
      )}
      {!online && (
        <p className="form-message" role="status">
          오프라인입니다. 입력을 보존하며 연결될 때까지 저장·삭제를 중지합니다.
        </p>
      )}
      {!denied && !duplicateReadHold && rescheduleRecovery && !reschedule && (
        <div className="work-conflict">
          <p>보관한 일정 변경 검토가 있습니다. 불명 결과를 먼저 확인하세요.</p>
          <button
            type="button"
            disabled={pending || !online}
            onClick={() => setReschedule(rescheduleRecovery)}
          >
            보관한 일정 변경 검토 열기
          </button>
        </div>
      )}
      {!denied && !duplicateReadHold && reschedule && (
        <WorkReschedule
          key={`${reschedule.entry.id}:${reschedule.intent}`}
          selection={reschedule}
          companyId={companyId}
          userId={userId}
          online={online}
          onExpired={expired}
          onForbidden={() => {
            revision.current++;
            setDenied(true);
            setItems([]);
            setHistory(null);
          }}
          onObserved={(value, confirmedSourceVersion) => {
            observeEntry(value, confirmedSourceVersion);
            setRescheduleRecovery((old) => (old ? { ...old, entry: value } : old));
            setRefresh((n) => n + 1);
          }}
          onUnresolved={(value) =>
            setRescheduleRecovery((old) => (old ? { ...old, unresolved: value } : old))
          }
          onClose={(keep) => {
            setReschedule(null);
            if (!keep) setRescheduleRecovery(null);
          }}
        />
      )}
      {error && (
        <p className="form-message" role="alert">
          {error}
        </p>
      )}
      {notice && (
        <p className="workspace-notice" role="status">
          {notice}
        </p>
      )}
      {denied ? (
        <a className="control-link" href="/">
          회사 선택으로 돌아가기
        </a>
      ) : (
        <>
          {!unscheduled && dayView && (
            <DayNavigation
              date={date}
              disabled={disabled || duplicateReadHold}
              onSelect={(next) => {
                if (
                  workspaceHasUnsavedChanges() &&
                  !window.confirm('저장 전 입력을 이 탭에 보관하고 날짜를 이동할까요?')
                )
                  return;
                setDate(next);
                setDateInput(next);
                onDateSelect(next);
                if (!original && !form.title && !form.content && !form.dueDate && !dirty) {
                  const nextForm = { ...form, date: next };
                  if (!dirty) cleanForm.current = formFingerprint(nextForm);
                  setForm(nextForm);
                }
              }}
            />
          )}
          {!unscheduled && !dayView && !duplicateReadHold && (
            <WeekView
              today={today}
              companyId={companyId}
              navigationProjectId={selectedProjectId}
              userId={userId}
              projects={projects}
              tags={tags}
              onChanged={() => setRefresh((n) => n + 1)}
              date={date}
              filter={query}
              refresh={refresh}
              disabled={disabled}
              online={online}
              onExpired={expired}
              onDetailChange={setWeekDetail}
              onStatusChange={(entry, status) => void changeStatus(entry, status)}
              onSelect={(next) => {
                if (
                  workspaceHasUnsavedChanges() &&
                  !window.confirm('저장 전 입력을 이 탭에 보관하고 날짜를 이동할까요?')
                )
                  return;
                setDate(next);
                setDateInput(next);
                onDateSelect(next);
                if (!original && !form.title && !form.content && !form.dueDate && !dirty) {
                  const nextForm = { ...form, date: next };
                  if (!dirty) cleanForm.current = formFingerprint(nextForm);
                  setForm(nextForm);
                }
              }}
            />
          )}
          {!dayView && !unscheduled && weekDetail && (
            <button
              type="button"
              className="text-button"
              aria-expanded={detailedTools}
              onClick={() => {
                setDetailedTools((value) => !value);
                setEditing(true);
              }}
            >
              {detailedTools ? '상세 입력·관리 접기' : '기타 기록·휴가 입력 및 상세 관리'}
            </button>
          )}
          <div
            className="work-detail-body"
            hidden={
              !unscheduled &&
              !dayView &&
              !duplicateReadHold &&
              !unresolved &&
              !reschedule &&
              !rescheduleRecovery &&
              (!weekDetail || !editing || !detailedTools)
            }
          >
            <div className="work-day-main">
              {!dayView && (
                <details className="work-query-tools">
                  <summary>조회 날짜 · 검색 · 입력 정책</summary>
                  {!unscheduled && !dayView && (
                    <a
                      className="control-link"
                      href={`/c/${companyId}/day?${new URLSearchParams({ year: String(year), date, ...(selectedProjectId ? { projectId: selectedProjectId } : {}) })}`}
                    >
                      일간 보기
                    </a>
                  )}
                  <a className="control-link" href={`/c/${companyId}/search`}>
                    검색·필터
                  </a>
                  {!unscheduled && !dayView && (
                    <a
                      className="control-link"
                      href={`/c/${companyId}/month?${new URLSearchParams({ year: String(year), month: date.slice(0, 7), date, ...(selectedProjectId ? { projectId: selectedProjectId } : {}) })}`}
                    >
                      월간 보기
                    </a>
                  )}
                  {!unscheduled && (
                    <form
                      className="work-date-filter"
                      onSubmit={(event) => {
                        event.preventDefault();
                        if (zWorkEntryDate.safeParse(dateInput).success) {
                          if (
                            dateInput !== date &&
                            workspaceHasUnsavedChanges() &&
                            !window.confirm('저장 전 입력을 이 탭에 보관하고 날짜를 이동할까요?')
                          )
                            return;
                          setDate(dateInput);
                          onDateSelect(dateInput);
                          setError('');
                        } else setError('실제 달력 날짜를 선택해 주세요.');
                      }}
                    >
                      <label>
                        조회 날짜
                        <input
                          aria-label="조회 날짜"
                          type="date"
                          value={dateInput}
                          disabled={pending || !online}
                          onChange={(event) => setDateInput(event.target.value)}
                        />
                      </label>
                      <button className="button secondary" disabled={pending || !online}>
                        날짜 조회
                      </button>
                    </form>
                  )}
                  {context && !unscheduled && (
                    <div className="work-day-summary">
                      <p>
                        하루 기준 {context.calculationBasis.workHoursPerDay}시간 · 휴가{' '}
                        {context.summary.unavailableHours}시간
                      </p>
                      <p>
                        {context.summary.canAddTask
                          ? '이 날짜에 새 업무를 배정할 수 있습니다.'
                          : '종일 휴가로 새 업무 배정이 제한됩니다. 기존 업무는 보존됩니다.'}
                      </p>
                      <button
                        className="text-button work-edit-action"
                        disabled={disabled}
                        onClick={() => void inputPolicy()}
                      >
                        {context.day?.allowTaskInput
                          ? '업무 입력 예외 해제'
                          : '이 날짜에 업무 입력 허용'}
                      </button>
                      <p className="field-hint">
                        종일 휴가의 입력 제한만 바꾸며 기존 기록을 삭제하지 않습니다.
                      </p>
                    </div>
                  )}
                  <form
                    className="work-filters"
                    onSubmit={(event) => {
                      event.preventDefault();
                      setQuery({ ...filter });
                    }}
                  >
                    <label>
                      검색
                      <input
                        aria-label="업무 검색"
                        value={filter.keyword}
                        maxLength={100}
                        disabled={pending}
                        onChange={(event) => setFilter({ ...filter, keyword: event.target.value })}
                      />
                    </label>
                    <label>
                      프로젝트 필터
                      <select
                        aria-label="프로젝트 필터"
                        value={filter.projectId}
                        disabled={pending}
                        onChange={(event) =>
                          setFilter({ ...filter, projectId: event.target.value })
                        }
                      >
                        <option value="">전체 프로젝트</option>
                        {projects.map((project) => (
                          <option key={project.id} value={project.id}>
                            {project.code}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label>
                      목록 상태
                      <select
                        aria-label="목록 상태"
                        value={filter.status}
                        disabled={pending}
                        onChange={(event) => setFilter({ ...filter, status: event.target.value })}
                      >
                        <option value="active">활성 기록</option>
                        <option value="canceled">취소 기록</option>
                      </select>
                    </label>
                    <button className="button secondary" disabled={pending}>
                      목록 검색
                    </button>
                  </form>
                </details>
              )}
              {dayView &&
                context &&
                (!context.summary.canAddTask || context.day?.allowTaskInput) && (
                  <details className="daily-input-policy">
                    <summary>휴가일 업무 입력 설정</summary>
                    <p>종일 휴가의 입력 제한만 바꾸며 기존 기록을 삭제하지 않습니다.</p>
                    <button type="button" disabled={disabled} onClick={() => void inputPolicy()}>
                      {context.day?.allowTaskInput
                        ? '업무 입력 예외 해제'
                        : '이 날짜에 업무 입력 허용'}
                    </button>
                  </details>
                )}
              {!creationContext && (
                <>
                  <div className="work-heading">
                    <h3>{dayView || unscheduled ? '업무 · 일정' : '선택한 날짜의 업무 · 일정'}</h3>
                    {duplicateReadHold && (
                      <p className="field-hint">
                        복제 검토 이후 목록은 마지막 조회 결과입니다. 기록 다시 조회로 갱신하세요.
                      </p>
                    )}
                    {dayView && (
                      <button
                        type="button"
                        className="button secondary daily-add"
                        aria-label="업무 추가"
                        title="업무 추가"
                        disabled={disabled}
                        onClick={() => {
                          if (!original && dirty && !duplicateSource) {
                            setEditing(true);
                            return;
                          }
                          if (
                            dirty &&
                            !window.confirm('작성 중인 변경을 버리고 새 업무를 입력할까요?')
                          )
                            return;
                          reset();
                          setEditing(true);
                        }}
                      >
                        <span aria-hidden="true">＋</span>
                      </button>
                    )}
                    <RefreshButton
                      className="text-button"
                      disabled={pending || loading || !!duplicateSource || !!duplicateRequest}
                      onClick={() => {
                        setError('');
                        setDuplicateReadHold(false);
                        setRefresh((v) => v + 1);
                      }}
                      busy={loading || pending}
                    >
                      기록 다시 조회
                    </RefreshButton>
                  </div>
                  {loading && <p role="status">기록을 불러오고 있습니다.</p>}
                  {!loading && listReady && items.length === 0 && (
                    <p className="workspace-empty">표시할 기록이 없습니다.</p>
                  )}
                  {(unscheduled || dayView) && (
                    <PendingWorkLinkReviews
                      key={`${userId}:${companyId}:${new URLSearchParams(location.search).get('entryId') ?? ''}`}
                      userId={userId}
                      companyId={companyId}
                      entryId={new URLSearchParams(location.search).get('entryId') ?? undefined}
                      exclude={items.map((e) => e.id)}
                      disabled={disabled || duplicateReadHold}
                      expired={expired}
                    />
                  )}
                  {!dayView && <WorkSourceNotice status={sourceLabels.status} />}
                  {dayView ? (
                    <DailyWorkSheet
                      refresh={refresh}
                      userId={userId}
                      companyId={companyId}
                      entries={items}
                      projects={projects}
                      tags={tags}
                      categories={sourceLabels.categories}
                      disabled={disabled || duplicateReadHold}
                      onEdit={(value) => void edit(value)}
                      onStatus={(value, status) => void changeStatus(value, status)}
                    />
                  ) : (
                    <ul className="work-list">
                      {items.map((value) => (
                        <li
                          key={value.id}
                          id={`work-entry-${value.id}`}
                          tabIndex={-1}
                          className="work-card"
                        >
                          <div className="work-card-top">
                            <span className="workspace-badge">
                              {kinds[value.kind]} · {statuses[value.status]}
                            </span>
                            <span>{value.plannedDate ?? '날짜 미정'}</span>
                          </div>
                          <h4>{value.title}</h4>
                          {value.dueDate && (
                            <p className="work-card-deadline">마감 {value.dueDate}</p>
                          )}
                          <WorkSourceBadges categories={sourceLabels.categories(value)} />
                          <WorkDeadlineBadges entry={value} today={today} />
                          {value.kind === 'task' && (
                            <div className="work-edit-action">
                              <WorkEntryWbsLink
                                triggerTargetId={`work-record-actions-${value.id}`}
                                entry={value}
                                userId={userId}
                                disabled={disabled || duplicateReadHold}
                                expired={expired}
                                autoOpen={
                                  (unscheduled || dayView) &&
                                  new URLSearchParams(location.search).get('entryId') === value.id
                                }
                              />
                            </div>
                          )}
                          {value.endDate && value.endDate !== value.plannedDate && (
                            <p>
                              {value.plannedDate} ~ {value.endDate}
                            </p>
                          )}
                          {value.timeMode === 'exact' && <p>정확 시각 일정 · 한국 시간 기준</p>}
                          {value.status === 'done' && (
                            <p className="field-hint">
                              {value.completedAt === null
                                ? '완료 시각 미수집'
                                : `완료 처리 ${new Date(value.completedAt).toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' })}`}
                            </p>
                          )}
                          {value.content && (
                            <p className="work-content">{editableDailyNotes(value.content)}</p>
                          )}
                          <WorkEntryNotes
                            key={`${userId}:${companyId}:${value.id}`}
                            userId={userId}
                            companyId={companyId}
                            parent={{
                              id: value.id,
                              companyId,
                              version: value.version,
                              title: value.title,
                              kind: value.kind,
                              projectId: value.projectId,
                              projectCode:
                                projects.find((project) => project.id === value.projectId)?.code ??
                                null,
                              plannedDate: value.plannedDate,
                            }}
                          />
                          {value.leave && (
                            <LeaveLedgerDetails
                              entry={value}
                              companyId={companyId}
                              onExpired={expired}
                            />
                          )}
                          {value.leave && (
                            <p>
                              {leaveLabels[value.leave.type]} · {value.leave.unavailableHours}시간 /
                              하루 {value.leave.workHoursPerDay}시간
                            </p>
                          )}
                          <div
                            className={`work-actions work-record-actions${dayView ? ' is-day-actions' : ''}`}
                            id={`work-record-actions-${value.id}`}
                            aria-label={`기록 작업: ${value.title}`}
                          >
                            <button
                              className="work-edit-action"
                              type="button"
                              hidden={dayView}
                              disabled={disabled}
                              aria-label={`복제: ${value.title}`}
                              onClick={() => requestDuplicate(value)}
                            >
                              복제
                            </button>
                            {!dayView &&
                              value.kind === 'task' &&
                              ['todo', 'doing', 'paused'].includes(value.status) && (
                                <>
                                  {(['extend', 'postpone'] as const).map((intent) => (
                                    <button
                                      key={intent}
                                      className="work-edit-action"
                                      type="button"
                                      disabled={disabled || duplicateReadHold}
                                      aria-label={`${intent === 'extend' ? '마감 연장' : '업무 미루기'}: ${value.title}`}
                                      onClick={() => {
                                        const selection = {
                                          entry: value,
                                          intent,
                                          unresolved: false,
                                        };
                                        setRescheduleRecovery(selection);
                                        storeReschedule(rescheduleKey, selection);
                                        setReschedule(selection);
                                      }}
                                    >
                                      {intent === 'extend' ? '마감 연장' : '업무 미루기'}
                                    </button>
                                  ))}
                                </>
                              )}
                            <button
                              className="work-edit-action work-edit-primary"
                              disabled={disabled || duplicateReadHold}
                              aria-label="내용·날짜 편집"
                              onClick={() => void edit(value)}
                            >
                              편집
                            </button>
                            {!dayView &&
                              value.kind === 'task' &&
                              (value.status === 'todo' || value.status === 'doing') && (
                                <button
                                  type="button"
                                  disabled={disabled || duplicateReadHold}
                                  className="work-edit-action"
                                  aria-label={`업무 중단: ${value.title}`}
                                  onClick={() => void changePause(value, 'pause')}
                                >
                                  업무 중단
                                </button>
                              )}
                            {value.kind === 'task' && value.status === 'paused' && (
                              <>
                                <p className="field-hint">
                                  중단 · 자동 이월 없음 ·{' '}
                                  {value.resumeStatus === 'doing' ? '진행 중' : '미진행'}으로 재개
                                </p>
                                <button
                                  type="button"
                                  disabled={disabled || duplicateReadHold}
                                  className="work-edit-action"
                                  aria-label={`업무 재개: ${value.title}`}
                                  onClick={() => void changePause(value, 'resume')}
                                >
                                  업무 재개
                                </button>
                              </>
                            )}
                            {!dayView &&
                              value.kind === 'task' &&
                              value.plannedDate &&
                              value.status === 'todo' && (
                                <button
                                  className="work-edit-action"
                                  disabled={disabled || duplicateReadHold}
                                  onClick={() => void changeStatus(value, 'doing')}
                                >
                                  진행 시작
                                </button>
                              )}
                            {!dayView && value.kind === 'task' && value.status === 'doing' && (
                              <button
                                className="work-edit-action"
                                disabled={disabled || duplicateReadHold}
                                onClick={() => void changeStatus(value, 'todo')}
                              >
                                미진행으로
                              </button>
                            )}
                            {value.kind !== 'leave' &&
                              value.status !== 'done' &&
                              value.status !== 'paused' &&
                              value.status !== 'canceled' &&
                              value.plannedDate && (
                                <button
                                  disabled={disabled || duplicateReadHold}
                                  onClick={() => void changeStatus(value, 'done')}
                                >
                                  완료 처리
                                </button>
                              )}
                            {value.kind !== 'leave' && value.status === 'done' && (
                              <>
                                <button
                                  disabled={disabled || duplicateReadHold}
                                  onClick={() =>
                                    void changeStatus(
                                      value,
                                      value.kind === 'task' ? 'todo' : 'planned',
                                    )
                                  }
                                >
                                  {value.kind === 'task' ? '미진행으로' : '예정으로'}
                                </button>
                                {!dayView && value.kind === 'task' && (
                                  <button
                                    className="work-edit-action"
                                    disabled={disabled || duplicateReadHold}
                                    onClick={() => void changeStatus(value, 'doing')}
                                  >
                                    진행 재개
                                  </button>
                                )}
                              </>
                            )}
                            {value.kind === 'leave' && value.status === 'planned' && (
                              <button
                                disabled={disabled || duplicateReadHold}
                                onClick={() => void changeStatus(value, 'done')}
                              >
                                휴가 사용 완료
                              </button>
                            )}
                            {value.kind === 'leave' &&
                              value.status === 'done' &&
                              value.plannedDate! >= kstDate(Date.now()) && (
                                <button
                                  disabled={disabled || duplicateReadHold}
                                  onClick={() => void changeStatus(value, 'planned')}
                                >
                                  휴가 예정으로
                                </button>
                              )}
                            {!dayView && value.status !== 'canceled' && (
                              <button
                                className="work-edit-action"
                                disabled={disabled || duplicateReadHold}
                                onClick={() => void changeStatus(value, 'canceled')}
                              >
                                기록 취소
                              </button>
                            )}
                            {!dayView && value.status === 'canceled' && (
                              <button
                                className="work-edit-action"
                                disabled={disabled || duplicateReadHold}
                                onClick={() =>
                                  void changeStatus(
                                    value,
                                    value.kind === 'task' ? 'todo' : 'planned',
                                  )
                                }
                              >
                                취소 복원
                              </button>
                            )}
                            <button
                              disabled={disabled || duplicateReadHold}
                              onClick={() => void showHistory(value)}
                            >
                              변경 이력
                            </button>
                            <button
                              disabled={disabled || duplicateReadHold}
                              className="work-edit-action"
                              onClick={(event) => {
                                deleteOrigin.current = event.currentTarget;
                                setDeleting(value);
                              }}
                            >
                              삭제
                            </button>
                          </div>
                        </li>
                      ))}
                    </ul>
                  )}
                  {cursor && (
                    <button
                      className="button secondary"
                      disabled={loading || pending}
                      onClick={() => void load(true)}
                    >
                      기록 더 보기
                    </button>
                  )}
                  {cursor && (
                    <p className="field-hint">
                      추가 기록이 있습니다. 현재 표시된 목록은 전체가 아닙니다.
                    </p>
                  )}
                  {!dayView && deletePanel}
                  {!dayView && historyPanel}
                </>
              )}
              <WorkDialogSurface
                modal={dayView && !creationContext}
                open={editing || unresolved || !!duplicateRequest || discarding}
                label={original ? '업무 편집' : '업무 추가'}
                onClose={() => {
                  if (pending || unresolved) return;
                  if (
                    workspaceHasUnsavedChanges() &&
                    !window.confirm(
                      '저장하지 않은 업무 변경을 버리고 닫을까요? 노트 초안은 보관됩니다.',
                    )
                  )
                    return;
                  reset();
                  setEditing(false);
                }}
              >
                <section
                  className="work-editor"
                  aria-labelledby="work-form-title"
                  hidden={!editing && !unresolved && !duplicateRequest && !discarding}
                >
                  {dayView && error && <p role="alert">{error}</p>}
                  <div className="work-heading">
                    <h3 id="work-form-title">
                      {original ? '기록 편집' : duplicateSource ? '복제 기록 검토' : '새 기록 입력'}
                    </h3>
                    <button
                      type="button"
                      className="text-button"
                      hidden={dayView && !creationContext}
                      disabled={pending || unresolved}
                      onClick={() => (dirty || duplicateSource ? setDiscarding(true) : reset())}
                    >
                      새 기록 시작
                    </button>
                  </div>
                  {duplicateRequest && (
                    <section
                      className="work-confirm"
                      role="alertdialog"
                      aria-label="복제 초안 교체 확인"
                      ref={confirmation}
                      tabIndex={-1}
                    >
                      <h4>현재 입력 대신 복제 내용을 검토할까요?</h4>
                      <p>
                        지금 작성 중인 입력을 교체합니다. 서버의 원본 기록과 이력은 변경하지
                        않습니다.
                      </p>
                      <div className="work-actions">
                        <button
                          type="button"
                          disabled={pending || unresolved}
                          onClick={() => setDuplicateRequest(null)}
                        >
                          기존 입력 유지
                        </button>
                        <button
                          type="button"
                          disabled={pending || unresolved}
                          onClick={() => void beginDuplicate(duplicateRequest.id)}
                        >
                          현재 입력 대신 복제 검토
                        </button>
                      </div>
                    </section>
                  )}
                  {duplicateSource && (
                    <section aria-label="복제 검토 안내">
                      <p>
                        원본: {duplicateSource.title} · 원본 ID: {duplicateSource.id} · 원본 버전:{' '}
                        {duplicateSource.version} · 새 기록 ID: {form.id}
                      </p>
                      <p>
                        초기 상태: {form.kind === 'task' ? '미진행' : '예정'}. 날짜·기간·기한·완료
                        시각·원본 이력은 복사하지 않습니다. 휴가는 새 날짜의 계산 기준을 사용합니다.
                      </p>
                      <p>
                        비활성 프로젝트·태그는 새 기록에 사용할 수 없습니다. 복사한 선택을 검토하고
                        활성 항목으로 직접 다시 선택하세요.
                      </p>
                      <button
                        type="button"
                        disabled={pending || !online}
                        onClick={() => setDiscarding(true)}
                      >
                        복제 입력 취소
                      </button>
                    </section>
                  )}
                  {duplicateSource && (
                    <div className="work-actions">
                      <RefreshButton
                        type="button"
                        disabled={pending || !online}
                        onClick={() => void refreshDuplicateSource()}
                        busy={pending}
                      >
                        복제 원본 다시 확인
                      </RefreshButton>
                      {duplicateLatest && (
                        <>
                          <p>
                            최신 원본: {duplicateLatest.entry.title} · 버전{' '}
                            {duplicateLatest.sourceVersion} · {kinds[duplicateLatest.entry.kind]} ·{' '}
                            {duplicateLatest.entry.plannedDate ?? '날짜 미정'}
                          </p>
                          <button
                            type="button"
                            disabled={pending || !online}
                            onClick={() => {
                              const linkId = duplicateSource.linkId ?? crypto.randomUUID();
                              const reviewed = createDuplicateWbsReview(duplicateLatest, linkId);
                              setDuplicateSource({
                                id: duplicateLatest.entry.id,
                                companyId: duplicateLatest.entry.companyId,
                                version: duplicateLatest.sourceVersion,
                                title: duplicateLatest.entry.title,
                                linkId,
                                sourceLabel: duplicateLatest.displayLabel,
                                selectionLabel:
                                  duplicateSource.selectionLabel ?? duplicateLatest.displayLabel,
                                wbs: duplicateSource.wbs
                                  ? {
                                      ...duplicateSource.wbs,
                                      expectedSource: reviewed.expectedSource,
                                    }
                                  : reviewed,
                                choiceRequired: true,
                              });
                              setDuplicateLatest(null);
                              setUnresolved(false);
                              setError('');
                              setNotice(
                                '복제 입력과 새 ID를 유지하고 원본 최신 버전을 선택했습니다. WBS 연결을 다시 검토한 뒤 저장하세요.',
                              );
                            }}
                          >
                            복제 입력 유지하고 원본 최신 버전 선택
                          </button>
                        </>
                      )}
                    </div>
                  )}
                  {unresolved && (
                    <div className="work-conflict" role="status">
                      <p>
                        저장 결과 또는 최신 버전을 확인하기 전까지 제출하지 않습니다. 입력은
                        유지됩니다.
                      </p>
                      <RefreshButton
                        type="button"
                        className="button secondary"
                        disabled={pending}
                        onClick={() => {
                          if (!lock.current) {
                            lock.current = true;
                            setPending(true);
                            void checkResult().finally(() => {
                              lock.current = false;
                              setPending(false);
                            });
                          }
                        }}
                        busy={pending}
                        showLabel
                      >
                        저장 결과 다시 확인
                      </RefreshButton>
                      {!original && (
                        <button
                          type="button"
                          className="button secondary"
                          disabled={pending || !online}
                          onClick={() => {
                            setUnresolved(false);
                            setError('');
                            setNotice(
                              '동일 ID를 유지했습니다. 내용을 확인한 뒤 기록 저장을 직접 눌러 재시도하세요.',
                            );
                          }}
                        >
                          같은 ID로 재시도 준비
                        </button>
                      )}
                      <button
                        type="button"
                        className="text-button"
                        disabled={pending}
                        onClick={(event) => {
                          deleteOrigin.current = event.currentTarget;
                          setDiscarding(true);
                        }}
                      >
                        현재 입력 폐기
                      </button>
                      {latest && (
                        <>
                          <p>
                            최신 기록: {latest.title} · {statuses[latest.status]} ·{' '}
                            {latest.plannedDate ?? '날짜 미정'} · 버전 {latest.version}
                          </p>
                          <div className="work-actions">
                            <button
                              type="button"
                              disabled={pending}
                              onClick={() => useEntry(latest)}
                            >
                              최신 내용 사용
                            </button>
                            <button
                              type="button"
                              disabled={
                                pending || (latest.kind === 'leave') !== (form.kind === 'leave')
                              }
                              onClick={() => {
                                setOriginal(latest);
                                if (transitionRequested)
                                  setForm({ ...form, transitionRequested: true });
                                setKindConfirmed(false);
                                setLatest(null);
                                setUnresolved(false);
                                setNotice(
                                  '입력을 유지하고 최신 버전을 선택했습니다. 변경 내용을 검토한 뒤 직접 저장하세요.',
                                );
                              }}
                            >
                              입력 유지하고 최신 버전 선택
                            </button>
                          </div>
                        </>
                      )}
                    </div>
                  )}
                  {discarding && (
                    <section
                      className="work-confirm"
                      ref={confirmation}
                      tabIndex={-1}
                      role="alertdialog"
                      aria-label="현재 입력 폐기 확인"
                    >
                      <h4>현재 입력을 폐기할까요?</h4>
                      <p>
                        서버에 저장된 기록은 삭제하지 않습니다. 저장 여부가 불명확하면 목록을 먼저
                        확인하고 중복 등록을 피하세요. 이 화면에 보존한 입력만 지웁니다.
                      </p>
                      <div className="work-actions">
                        <button
                          type="button"
                          onClick={() => {
                            setDiscarding(false);
                            deleteOrigin.current?.focus();
                          }}
                        >
                          입력 계속 보관
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            reset();
                            setError('');
                            setNotice(
                              '현재 입력을 폐기했습니다. 서버의 저장 결과를 확인한 것으로 처리하지 않습니다.',
                            );
                          }}
                        >
                          입력 폐기 확인
                        </button>
                      </div>
                    </section>
                  )}
                  <form
                    onSubmit={(event) => void submit(event)}
                    noValidate
                    hidden={!editing && !(dayView && unresolved)}
                  >
                    <fieldset disabled={disabled || unresolved}>
                      <label>
                        기록 종류
                        <select
                          aria-label="기록 종류"
                          value={form.kind}
                          disabled={
                            original?.kind === 'leave' ||
                            original?.status === 'paused' ||
                            unscheduled
                          }
                          onChange={(event) => {
                            const kind = zWorkEntryKind.parse(event.target.value);
                            if (duplicateSource)
                              setDuplicateSource({ ...duplicateSource, choiceRequired: true });
                            setForm({
                              ...form,
                              kind,
                              transitionRequested: false,
                              targetStatus: kind === original?.kind ? original.status : undefined,
                              date: kind !== 'task' && !form.date ? date : form.date,
                            });
                            setKindConfirmed(false);
                          }}
                        >
                          {Object.entries(kinds)
                            .filter(
                              ([value]) =>
                                value !== 'event' ||
                                original?.kind === 'event' ||
                                !!duplicateSource,
                            )
                            .filter(
                              ([value]) =>
                                !original || original.kind === 'leave' || value !== 'leave',
                            )
                            .map(([value, label]) => (
                              <option key={value} value={value}>
                                {label}
                              </option>
                            ))}
                        </select>
                      </label>
                      {original && transitionRequested && (
                        <div className="work-conflict">
                          <p>
                            {original.kind === form.kind
                              ? `최신 기록도 ${kinds[form.kind]}입니다. 앞서 선택한 목표 상태를 확인해 함께 저장하세요.`
                              : `${kinds[original.kind]}에서 ${kinds[form.kind]}로 변경합니다. 같은 기록의 상태와 필수값을 함께 저장합니다.`}
                          </p>
                          <label>
                            변경 후 상태
                            <select
                              aria-label="변경 후 상태"
                              value={form.targetStatus ?? ''}
                              onChange={(event) => {
                                setForm({
                                  ...form,
                                  targetStatus: event.target.value
                                    ? zWorkEntryStatusValue.parse(event.target.value)
                                    : undefined,
                                });
                                setKindConfirmed(false);
                              }}
                            >
                              <option value="">상태를 직접 선택해 주세요</option>
                              {(form.kind === 'task'
                                ? (['todo', 'doing', 'done', 'canceled'] as const)
                                : (['planned', 'done', 'canceled'] as const)
                              ).map((status) => (
                                <option key={status} value={status}>
                                  {statuses[status]}
                                </option>
                              ))}
                            </select>
                          </label>
                          <label className="workspace-check">
                            <input
                              type="checkbox"
                              checked={kindConfirmed}
                              onChange={(event) => setKindConfirmed(event.target.checked)}
                            />
                            변경 후 상태·프로젝트·태그를 확인했습니다
                          </label>
                        </div>
                      )}
                      {original?.kind === 'leave' && (
                        <p className="field-hint">
                          휴가는 다른 종류로 바꿀 수 없습니다. 기록 취소 또는 영구 삭제를 사용할 수
                          있습니다.
                        </p>
                      )}
                      <label>
                        제목
                        <input
                          aria-label="업무 제목"
                          value={form.title}
                          maxLength={200}
                          onChange={(event) => setForm({ ...form, title: event.target.value })}
                          required
                        />
                      </label>
                      <WorkImportanceCheckbox
                        userId={userId}
                        companyId={companyId}
                        entryId={form.id}
                        title={form.title}
                        saved={!!original}
                        disabled={disabled || unresolved || !!duplicateRequest}
                        derivedDefault={importedImportance(form.content)}
                        onDraftChange={() =>
                          setForm((current) => ({ ...current, importanceDraftChanged: true }))
                        }
                      />
                      <label>
                        비고 · 내용 (선택)
                        <textarea
                          aria-label="업무 내용"
                          rows={3}
                          maxLength={dailyNoteCapacity(
                            form.metadataContent ?? original?.content ?? '',
                          )}
                          value={form.notes ?? editableDailyNotes(form.content)}
                          onChange={(event) =>
                            setForm({
                              ...form,
                              content: replaceDailyNotes(
                                form.metadataContent ?? original?.content ?? '',
                                event.target.value,
                              ),
                              notes: event.target.value,
                            })
                          }
                        />
                      </label>
                      {dayView && original && original.kind !== 'leave' && !transitionRequested && (
                        <label>
                          진행 상태
                          <select
                            aria-label="진행 상태"
                            value={form.targetStatus ?? original.status}
                            disabled={original.status === 'paused'}
                            onChange={(event) =>
                              setForm({
                                ...form,
                                targetStatus: zWorkEntryStatusValue.parse(event.target.value),
                              })
                            }
                          >
                            {(original.status === 'paused'
                              ? ['paused']
                              : form.kind === 'task'
                                ? ['todo', 'doing', 'done', 'canceled']
                                : ['planned', 'done', 'canceled']
                            ).map((status) => (
                              <option key={status} value={status}>
                                {statuses[status as keyof typeof statuses]}
                              </option>
                            ))}
                          </select>
                        </label>
                      )}
                      <div className="work-date-fields">
                        <label>
                          업무 날짜
                          <input
                            aria-label="업무 날짜"
                            type="date"
                            value={form.date}
                            disabled={dateLocked}
                            required={!noDateAllowed}
                            onChange={(event) => {
                              if (event.target.value || noDateAllowed)
                                setForm({ ...form, date: event.target.value });
                            }}
                          />
                        </label>
                        {form.kind !== 'leave' && (
                          <label>
                            마감일 (선택)
                            <input
                              aria-label="마감일"
                              type="date"
                              value={form.dueDate}
                              onChange={(event) =>
                                setForm({ ...form, dueDate: event.target.value })
                              }
                            />
                          </label>
                        )}
                      </div>
                      {dateLocked && (
                        <p className="field-hint">
                          정확 시각 또는 종료 날짜가 있는 일정은 시작과 종료를 함께 편집해야 하므로
                          이 화면에서 날짜를 변경하거나 해제할 수 없습니다. 내용과 상태는 편집할 수
                          있습니다.
                        </p>
                      )}
                      {original?.status === 'paused' && (
                        <p className="field-hint">
                          중단 중에는 완료·종류 변경 전에 업무 재개를 직접 실행하세요.
                          {original.resumeStatus === 'doing'
                            ? ' 날짜를 해제하려면 재개한 뒤 미진행으로 변경하세요.'
                            : ' 날짜를 해제해도 중단 상태를 유지합니다.'}
                        </p>
                      )}
                      {noDateAllowed && !dateLocked && (
                        <button
                          type="button"
                          className="text-button"
                          onClick={() => setForm({ ...form, date: '' })}
                        >
                          날짜 미정으로
                        </button>
                      )}
                      <label>
                        업무 프로젝트{form.kind === 'task' ? ' (필수)' : ' (선택)'}
                        <select
                          aria-label="업무 프로젝트"
                          value={form.projectId}
                          onChange={(event) => {
                            const project = projects.find((item) => item.id === event.target.value);
                            if (duplicateSource)
                              setDuplicateSource({ ...duplicateSource, choiceRequired: true });
                            setForm({
                              ...form,
                              projectId: event.target.value,
                              tagIds:
                                original || duplicateSource
                                  ? form.tagIds
                                  : (project?.defaultTagIds ?? []).filter((id) =>
                                      activeTagIds.includes(id),
                                    ),
                            });
                          }}
                        >
                          <option value="">프로젝트 선택</option>
                          {projects
                            .filter((project) => project.isActive || project.id === form.projectId)
                            .map((project) => (
                              <option key={project.id} value={project.id}>
                                {project.code}
                                {!project.isActive ? ' (비활성)' : ''}
                              </option>
                            ))}
                        </select>
                      </label>
                      {duplicateSource?.wbs && duplicateSource.linkId && (
                        <WorkDuplicateWbs
                          key={form.id}
                          companyId={companyId}
                          projectId={form.projectId}
                          kind={form.kind}
                          year={form.date ? Number(form.date.slice(0, 4)) : year}
                          review={duplicateSource.wbs}
                          sourceLabel={duplicateSource.sourceLabel ?? '원본 연결 · 다시 조회 필요'}
                          selectionLabel={
                            duplicateSource.selectionLabel ?? '선택 연결 · 다시 조회 필요'
                          }
                          linkId={duplicateSource.linkId}
                          required={duplicateSource.choiceRequired ?? false}
                          disabled={pending || unresolved}
                          online={online}
                          onChange={(wbs, selectionLabel) =>
                            setDuplicateSource({
                              ...duplicateSource,
                              wbs,
                              selectionLabel,
                              choiceRequired: false,
                            })
                          }
                        />
                      )}
                      {form.kind === 'task' && activeProjects.length === 0 && (
                        <p className="field-hint">
                          회사 작업공간에서 프로젝트를 먼저 만들어 주세요.
                        </p>
                      )}
                      <fieldset className="workspace-tags">
                        <legend>업무 태그 (선택)</legend>
                        {activeTags.map((tag) => (
                          <label className="workspace-check" key={tag.id}>
                            <input
                              type="checkbox"
                              checked={form.tagIds.includes(tag.id)}
                              onChange={(event) =>
                                setForm({
                                  ...form,
                                  tagIds: event.target.checked
                                    ? [...form.tagIds, tag.id]
                                    : form.tagIds.filter((id) => id !== tag.id),
                                })
                              }
                            />
                            {tag.label}
                          </label>
                        ))}
                        {hiddenTags.length > 0 && (
                          <p className="field-hint">
                            현재 선택 목록에 없는 기존 태그 {hiddenTags.length}개를 보존합니다.
                          </p>
                        )}
                      </fieldset>
                      <label className="workspace-check">
                        <input
                          type="checkbox"
                          checked={form.mustFinishToday ?? false}
                          onChange={(event) =>
                            setForm({ ...form, mustFinishToday: event.target.checked })
                          }
                        />
                        당일 완료 필수
                      </label>
                      {duplicateSource && hiddenTags.length > 0 && (
                        <button
                          type="button"
                          onClick={() =>
                            setForm({
                              ...form,
                              tagIds: form.tagIds.filter((id) => activeTagIds.includes(id)),
                            })
                          }
                        >
                          선택 목록에 없는 복제 태그 제거
                        </button>
                      )}
                      {form.kind === 'leave' && (
                        <>
                          <label>
                            휴가 종류
                            <select
                              aria-label="휴가 종류"
                              value={form.leaveType}
                              onChange={(event) =>
                                setForm({
                                  ...form,
                                  leaveType: zLeaveType.parse(event.target.value),
                                })
                              }
                            >
                              {Object.entries(leaveLabels).map(([value, label]) => (
                                <option key={value} value={value}>
                                  {label}
                                </option>
                              ))}
                            </select>
                          </label>
                          <div className="work-preview" role="status">
                            {amount ? (
                              <>
                                <p>
                                  하루 기준 {amount.workHoursPerDay}시간 · 부재{' '}
                                  {amount.unavailableHours}
                                  시간 · 차감 대상 {amount.deductibleHours}시간
                                </p>
                                <p>
                                  {amount.allDay ? '종일 휴가' : '부분 휴가 · 정확 시각 입력 없음'}
                                </p>
                              </>
                            ) : (
                              <p>휴가 계산 기준을 조회해 주세요.</p>
                            )}
                            <p>
                              휴가 날짜가 지나면 KST 다음 날 0시 기준으로 사용 완료됩니다. 차감
                              대상은 실제 배분 완료를 뜻하지 않습니다. 항목의 연차 장부에서
                              확인하세요.
                            </p>
                          </div>
                          <RefreshButton
                            type="button"
                            className="text-button"
                            disabled={pending || loading || !online}
                            busy={pending || loading}
                            onClick={() => setRefresh((v) => v + 1)}
                          >
                            휴가 계산 다시 조회
                          </RefreshButton>
                        </>
                      )}
                      <button
                        className="button primary"
                        disabled={form.kind === 'leave' && !preview}
                      >
                        {pending
                          ? '저장 중…'
                          : original
                            ? '수정 저장'
                            : duplicateSource
                              ? '복제 기록 저장'
                              : '기록 저장'}
                      </button>
                    </fieldset>
                  </form>
                  {dayView && original && (
                    <>
                      <WorkEntryNotes
                        key={`${userId}:${companyId}:${original.id}`}
                        userId={userId}
                        companyId={companyId}
                        parent={{
                          id: original.id,
                          companyId,
                          version: original.version,
                          title: original.title,
                          kind: original.kind,
                          projectId: original.projectId,
                          projectCode:
                            projects.find((project) => project.id === original.projectId)?.code ??
                            null,
                          plannedDate: original.plannedDate,
                        }}
                      />
                      {original.leave && (
                        <LeaveLedgerDetails
                          entry={original}
                          companyId={companyId}
                          onExpired={expired}
                        />
                      )}
                      <details
                        className="daily-work-management"
                        open={
                          new URLSearchParams(location.search).get('entryId') === original.id ||
                          undefined
                        }
                      >
                        <summary>추가 작업 · 이력</summary>
                        <div className="work-secondary-actions">
                          <button
                            type="button"
                            disabled={disabled || dirty}
                            onClick={() => void showHistory(original)}
                          >
                            변경 이력
                          </button>
                          {original.kind === 'task' &&
                            ['todo', 'doing', 'paused'].includes(original.status) && (
                              <button
                                type="button"
                                disabled={disabled || dirty}
                                onClick={() =>
                                  void changePause(
                                    original,
                                    original.status === 'paused' ? 'resume' : 'pause',
                                  )
                                }
                              >
                                {original.status === 'paused' ? '업무 재개' : '업무 중단'}
                              </button>
                            )}
                          <button
                            type="button"
                            disabled={disabled || dirty}
                            onClick={(event) => {
                              deleteOrigin.current = event.currentTarget;
                              setDeleting(original);
                            }}
                          >
                            삭제
                          </button>
                        </div>
                        {dirty && (
                          <p className="field-hint">
                            작성 중인 내용을 먼저 저장하면 추가 작업을 할 수 있습니다.
                          </p>
                        )}
                        {original.kind === 'task' && (
                          <WorkEntryWbsLink
                            key={original.id}
                            entry={original}
                            userId={userId}
                            disabled={disabled || dirty}
                            expired={expired}
                            autoOpen={
                              new URLSearchParams(location.search).get('entryId') === original.id
                            }
                          />
                        )}
                        {original.leave &&
                          (original.status === 'planned' ||
                            (original.status === 'done' && original.plannedDate! >= today)) && (
                            <button
                              type="button"
                              disabled={disabled || dirty}
                              onClick={() =>
                                void changeStatus(
                                  original,
                                  original.status === 'done' ? 'planned' : 'done',
                                )
                              }
                            >
                              {original.status === 'done' ? '휴가 예정으로' : '휴가 사용 완료'}
                            </button>
                          )}
                        {deletePanel}
                        {historyPanel}
                      </details>
                    </>
                  )}
                  <span className="field-hint">
                    <span>시각·기간 편집 제한</span>{' '}
                    <HelpHint label="시각·기간 편집 제한">
                      정확 시각과 기간의 입력 편집은 아직 연결되지 않았습니다. 기존 일정은 주간
                      화면에 표시하며, 새 회의의 시각은 내용에 적어 주세요.
                    </HelpHint>
                  </span>
                </section>
              </WorkDialogSurface>
            </div>
            {dayView && !creationContext && (
              <aside className="work-day-notes" aria-label="메모">
                <PeriodDocument
                  companyId={companyId}
                  userId={userId}
                  kind="daily_note"
                  externalRefresh={refresh}
                  periodStart={date}
                  editing={true}
                  online={online}
                  onExpired={expired}
                />
              </aside>
            )}
          </div>
        </>
      )}
    </section>
  );
}
