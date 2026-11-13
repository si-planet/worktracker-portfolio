import { HelpHint } from './help-hint';
import { displayWeekLabel } from './calendar-display';
import { RefreshButton } from './ui-controls';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { z } from 'zod';
import {
  zWeeklyGoal,
  zWeeklyGoalCreate,
  zWeeklyGoalPatch,
  type WeeklyGoal,
  type GoalPlacementResult,
} from '../shared/schema/weekly-goal';
import { zWorkEntryDate, zWorkEntryFinal, type WorkEntryFinal } from '../shared/schema/work-entry';
import {
  zWorkspaceCompany,
  zWorkspaceProject,
  type WorkspaceProject,
  type WorkspaceCompany,
} from '../shared/schema/workspace';
import { zAdminWorkTag, type AdminWorkTag } from '../shared/schema/tags';
import { isoWeekForDate, weekCalendar, shiftIsoWeek } from '../shared/week-calendar';
import { kstDate } from '../shared/work-entry-rules';
import { WorkFailure, workApi, uncertainWork } from './work-entry-api';
import {
  goalPath,
  goalSchema,
  readGoals,
  goalError,
  storeGoalDraft,
  clearGoalDraft,
  readPlacement,
} from './goal-api';
import {
  zWbsGoalDraftSource,
  zWbsGoalImport,
  assertWbsGoalImportBytes,
  type WbsGoalDraftSource,
} from '../shared/schema/wbs-goal-import';
import {
  inboundKey,
  readInbound,
  forgetInbound,
  zWbsGoalInbound,
  loadCompatibleGoalDraft,
  useGoalImportDialog,
  type WbsGoalInbound,
} from './wbs-goal-import';
import { readWbsGoalSource, importWbsGoal, observeWbsGoalImport } from './goal-api';
import { GoalPlacement, GoalSourcePicker } from './goal-placement';
import './work-entries.css';
import './weekly-goals.css';

const zEditor = z.strictObject({
  id: z.uuid(),
  title: z.string().max(200),
  detail: z.string().max(5000),
  source: zWorkEntryFinal.nullable(),
  sourceEntryId: z.uuid().nullable(),
  original: zWeeklyGoal.nullable(),
  uncertain: z.boolean(),
  wbsSource: zWbsGoalDraftSource.nullable().default(null),
  wbsCommand: zWbsGoalImport.nullable().default(null),
  wbsSourceUnavailable: z.boolean().default(false),
});
type Editor = z.output<typeof zEditor>;
function loadEditor(key: string, companyId: string) {
  const v = loadCompatibleGoalDraft(key, zEditor);
  if (
    !v ||
    (v.original && v.original.companyId !== companyId) ||
    (v.wbsSource && v.wbsSource.companyId !== companyId)
  )
    return null;
  return v;
}
function fresh(): Editor {
  return {
    id: crypto.randomUUID(),
    title: '',
    detail: '',
    source: null,
    sourceEntryId: null,
    original: null,
    uncertain: false,
    wbsSource: null,
    wbsCommand: null,
    wbsSourceUnavailable: false,
  };
}
function initialDate() {
  const value = new URLSearchParams(window.location.search).get('date');
  try {
    if (value) {
      isoWeekForDate(value);
      weekCalendar(isoWeekForDate(value).isoYear, isoWeekForDate(value).isoWeek);
      return value;
    }
  } catch {
    /* Invalid URLs never reach the API. */
  }
  return kstDate(Date.now());
}
export function WeeklyGoals({ companyId, userId }: { companyId: string; userId: string }) {
  const [date, setDate] = useState(initialDate),
    [dateInput, setDateInput] = useState(initialDate);
  const week = weekCalendar(isoWeekForDate(date).isoYear, isoWeekForDate(date).isoWeek);
  const scope = `${companyId}/${week.isoYear}/${week.isoWeek}`;
  const storageKey = `wt:weekly-goals:v1:${encodeURIComponent(userId)}:${scope}`;
  const [editor, setEditor] = useState(() => loadEditor(storageKey, companyId) ?? fresh());
  const current = useRef({ editor, key: storageKey });
  current.current = { editor, key: storageKey };
  const [company, setCompany] = useState<WorkspaceCompany | null>(null),
    [projects, setProjects] = useState<WorkspaceProject[]>([]),
    [tags, setTags] = useState<AdminWorkTag[]>([]),
    [metadata, setMetadata] = useState(false);
  const [items, setItems] = useState<WeeklyGoal[]>([]),
    [loading, setLoading] = useState(false),
    [pending, setPending] = useState(false),
    [online, setOnline] = useState(navigator.onLine),
    [denied, setDenied] = useState(false),
    [error, setError] = useState(''),
    [notice, setNotice] = useState(''),
    [reload, setReload] = useState(0),
    [picker, setPicker] = useState(false);
  const [latest, setLatest] = useState<WeeklyGoal | null>(null),
    [deleting, setDeleting] = useState<WeeklyGoal | null>(null),
    [placement, setPlacement] = useState<WeeklyGoal | null>(null),
    [receipt, setReceipt] = useState<GoalPlacementResult | null>(null);
  const [replace, setReplace] = useState<
    | { kind: 'new' }
    | { kind: 'edit'; goal: WeeklyGoal }
    | { kind: 'import'; source: WorkEntryFinal }
    | { kind: 'wbsImport'; inbound: WbsGoalInbound }
    | { kind: 'discardInbound' }
    | { kind: 'discardWbsCommand' }
    | null
  >(null);
  const [inbound, setInbound] = useState(() =>
    readInbound(inboundKey(userId, companyId, week.isoYear, week.isoWeek), zWbsGoalInbound),
  );
  const [wbsRecheck, setWbsRecheck] = useState<WbsGoalDraftSource | null>(null),
    [wbsSourceDenied, setWbsSourceDenied] = useState(editor.wbsSourceUnavailable);
  const [sourceInfo, setSourceInfo] = useState<{ id: string; source: WbsGoalDraftSource } | null>(
    null,
  );
  const replaceDialog = useGoalImportDialog(!!replace);

  const [recoveryGoal, setRecoveryGoal] = useState<WeeklyGoal | null>(() =>
    loadCompatibleGoalDraft(`${storageKey}:placement`, zWeeklyGoal),
  );
  const [unknownDelete, setUnknownDelete] = useState<WeeklyGoal | null>(() =>
    loadCompatibleGoalDraft(`${storageKey}:delete`, zWeeklyGoal),
  );
  useEffect(() => {
    if (unknownDelete) storeGoalDraft(`${storageKey}:delete`, unknownDelete);
    else clearGoalDraft(`${storageKey}:delete`);
  }, [unknownDelete, storageKey]);
  const lock = useRef(false),
    revision = useRef(0),
    metadataRevision = useRef(0),
    mutationRevision = useRef(0);
  useEffect(() => {
    storeGoalDraft(storageKey, editor);
  }, [storageKey, editor]);
  useEffect(() => {
    function connected() {
      setOnline(navigator.onLine);
    }
    window.addEventListener('online', connected);
    window.addEventListener('offline', connected);
    return () => {
      window.removeEventListener('online', connected);
      window.removeEventListener('offline', connected);
      revision.current++;
      metadataRevision.current++;
      mutationRevision.current++;
    };
  }, []);
  function failure(value: unknown) {
    storeGoalDraft(current.current.key, current.current.editor);
    if (value instanceof WorkFailure && value.status === 401) {
      window.location.assign(
        `/login?${new URLSearchParams({ returnTo: `/c/${companyId}/goals?date=${date}` })}`,
      );
      return true;
    }
    if (value instanceof WorkFailure && value.status === 403) {
      revision.current++;
      metadataRevision.current++;
      setDenied(true);
      setItems([]);
      setCompany(null);
      setProjects([]);
      setTags([]);
      setMetadata(false);
      setReceipt(null);
      setPlacement(null);
      setError(goalError(value));
      return true;
    }
    return false;
  }
  useEffect(() => {
    const ticket = ++metadataRevision.current;
    setMetadata(false);
    if (!online) return;
    void Promise.all([
      workApi(
        `/api/companies/${companyId}`,
        zWorkspaceCompany.refine((v) => v.id === companyId),
      ),
      workApi(
        `/api/companies/${companyId}/projects`,
        z.array(zWorkspaceProject).refine((v) => v.every((p) => p.companyId === companyId)),
      ),
      workApi(
        `/api/companies/${companyId}/work-tags?includeInactive=true`,
        z
          .array(zAdminWorkTag)
          .refine((v) => v.every((t) => t.companyId === null || t.companyId === companyId)),
      ),
    ])
      .then(([c, p, t]) => {
        if (ticket !== metadataRevision.current) return;
        setCompany(c);
        setProjects(p);
        setTags(t);
        setMetadata(true);
        setDenied(false);
      })
      .catch((value) => {
        if (ticket === metadataRevision.current && !failure(value)) setError(goalError(value));
      });
    return () => {
      metadataRevision.current++;
    };
  }, [companyId, online, reload]);
  useEffect(() => {
    const ticket = ++revision.current;
    setItems([]);
    setLoading(false);
    setReceipt(null);
    if (!metadata || denied || !online) return;
    setLoading(true);
    void readGoals(companyId, week.isoYear, week.isoWeek)
      .then((value) => {
        if (ticket === revision.current) setItems(value.items);
      })
      .catch((value) => {
        if (ticket === revision.current && !failure(value)) setError(goalError(value));
      })
      .finally(() => {
        if (ticket === revision.current) setLoading(false);
      });
    return () => {
      revision.current++;
    };
  }, [scope, metadata, denied, online, reload]);
  function selectWeek(value: string, push = true) {
    try {
      const next = isoWeekForDate(zWorkEntryDate.parse(value));
      weekCalendar(next.isoYear, next.isoWeek);
      storeGoalDraft(storageKey, editor);
      const key = `wt:weekly-goals:v1:${encodeURIComponent(userId)}:${companyId}/${next.isoYear}/${next.isoWeek}`;
      const state = loadEditor(key, companyId) ?? fresh();
      mutationRevision.current++;
      lock.current = false;
      setPending(false);
      setRecoveryGoal(loadCompatibleGoalDraft(`${key}:placement`, zWeeklyGoal));
      setDate(value);
      setDateInput(value);
      setEditor(state);
      setInbound(
        readInbound(inboundKey(userId, companyId, next.isoYear, next.isoWeek), zWbsGoalInbound),
      );
      setWbsRecheck(null);
      setWbsSourceDenied(state?.wbsSourceUnavailable ?? false);
      setSourceInfo(null);
      current.current = { editor: state, key };
      setPlacement(null);
      setLatest(null);
      setDeleting(null);
      setUnknownDelete(loadCompatibleGoalDraft(`${key}:delete`, zWeeklyGoal));
      setReplace(null);
      setError('');
      setNotice('');
      setPicker(false);
      if (push) window.history.pushState(null, '', `/c/${companyId}/goals?date=${value}`);
    } catch {
      setError('지원하는 실제 주간 날짜를 선택해 주세요.');
    }
  }
  useEffect(() => {
    function pop() {
      selectWeek(initialDate(), false);
    }
    window.addEventListener('popstate', pop);
    return () => window.removeEventListener('popstate', pop);
  }, [storageKey, editor]);
  function apply(action: NonNullable<typeof replace>) {
    setLatest(null);
    setError('');
    if (action.kind === 'discardInbound') {
      forgetInbound(inboundKey(userId, companyId, week.isoYear, week.isoWeek));
      setInbound(null);
      setReplace(null);
      return;
    }
    setWbsSourceDenied(false);
    setWbsRecheck(null);
    setSourceInfo(null);
    if (action.kind === 'discardWbsCommand') {
      setEditor(fresh());
      setReplace(null);
      setNotice(
        '결과 미확인 검토를 명시 폐기했습니다. 저장된 목표를 삭제하거나 되돌리지 않았습니다.',
      );
      return;
    }
    if (action.kind === 'wbsImport') {
      const v = action.inbound;
      if (v.companyId !== companyId || v.isoYear !== week.isoYear || v.isoWeek !== week.isoWeek) {
        setError('다른 회사나 주의 WBS 초안은 가져오지 않습니다.');
        setReplace(null);
        return;
      }
      const next = { ...fresh(), id: v.id, title: v.source.title, detail: '', wbsSource: v.source };
      storeGoalDraft(storageKey, next);
      setEditor(next);
      current.current = { editor: next, key: storageKey };
      forgetInbound(inboundKey(userId, companyId, week.isoYear, week.isoWeek));
      setInbound(null);
      setWbsSourceDenied(false);
      setNotice(
        'WBS 제목만 목표 초안으로 가져왔습니다. 목표 메모는 독립 입력이며 아직 저장하지 않았습니다.',
      );
      setReplace(null);
      return;
    }
    if (action.kind === 'new') {
      setEditor(fresh());
      setNotice('새 목표 초안을 준비했습니다.');
    } else if (action.kind === 'edit') {
      setEditor({
        id: action.goal.id,
        title: action.goal.title,
        detail: action.goal.detail ?? '',
        source: null,
        sourceEntryId: action.goal.sourceEntryId,
        original: action.goal,
        uncertain: false,
        wbsSource: null,
        wbsCommand: null,
        wbsSourceUnavailable: false,
      });
      setNotice('목표만 편집합니다. 배치된 업무는 자동 수정하지 않습니다.');
    } else {
      setEditor({
        ...fresh(),
        title: action.source.title,
        detail: action.source.content ?? '',
        source: action.source,
        sourceEntryId: action.source.id,
      });
      setNotice('기존 업무를 목표 초안으로 가져왔습니다. 목표와 업무를 아직 저장하지 않았습니다.');
      setPicker(false);
    }
    setReplace(null);
  }
  function request(action: NonNullable<typeof replace>) {
    if (editor.uncertain) {
      setError('저장 결과를 먼저 확인해 주세요.');
      return;
    }
    if (
      editor.title ||
      editor.detail ||
      editor.sourceEntryId ||
      editor.original ||
      editor.wbsSource
    )
      setReplace(action);
    else apply(action);
  }
  async function checkEditor() {
    if (lock.current || !online) return;
    lock.current = true;
    setPending(true);
    const ticket = mutationRevision.current;
    try {
      const list = await readGoals(companyId, week.isoYear, week.isoWeek);
      const value = list.items.find((item) => item.id === editor.id);
      if (editor.wbsCommand) {
        if (ticket !== mutationRevision.current) return;
        const observed = observeWbsGoalImport(companyId, editor.wbsCommand, value ?? null);
        if (observed === 'matching-current' || observed === 'matching-deleted-source') {
          setEditor({
            ...editor,
            original: value!,
            uncertain: false,
            wbsSource: null,
            wbsCommand: null,
          });
          setLatest(null);
          setReload((n) => n + 1);
          setNotice(
            observed === 'matching-deleted-source'
              ? '고정 목표 ID·내용·역사 출처가 일치하며 원본 WBS는 삭제되어 있습니다. 현재 관측이며 영구 영수증은 아닙니다.'
              : '고정 목표 ID·내용·역사 출처와 현재 live 연결이 일치합니다. 자동 재제출하지 않았습니다.',
          );
        } else if (observed === 'currently-absent') {
          setNotice(
            '소유 회사와 원래 주 목록에서 고정 목표 ID가 현재 없습니다. 과거 미실행 증명은 아닙니다. 원본을 직접 재검토하고 같은 ID로 명시 저장할 수 있습니다.',
          );
          setEditor({ ...editor, uncertain: false });
          setLatest(null);
        } else {
          setLatest(value ?? null);
          setNotice(
            observed === 'later-version'
              ? '후속 목표 버전입니다. 내용이 같아도 원래 명령의 성공을 확정하지 않습니다.'
              : '현재 목표가 고정 명령의 내용·출처와 다릅니다. 자동 재제출하거나 덮어쓰지 않습니다.',
          );
        }
        return;
      }
      if (!value) throw new WorkFailure(404, 'NOT_FOUND');
      if (ticket !== mutationRevision.current) return;
      setLatest(value);
      if (
        !editor.original &&
        value.title === editor.title &&
        value.detail === (editor.detail || null) &&
        value.sourceEntryId === editor.sourceEntryId
      ) {
        setNotice('고정한 목표 ID에서 저장 결과를 확인했습니다.');
        setEditor({ ...editor, original: value, uncertain: false });
        setReload((n) => n + 1);
      } else setNotice('최신 목표를 확인했습니다. 입력과 비교한 뒤 버전을 직접 선택하세요.');
    } catch (value) {
      if (ticket !== mutationRevision.current || failure(value)) return;
      if (value instanceof WorkFailure && value.status === 404) {
        setNotice(
          editor.original
            ? '목표가 현재 삭제되어 있습니다. 배치 업무와 영수증은 별개로 남습니다.'
            : '같은 목표 ID가 없음을 확인했습니다. ID와 초안을 유지하고 직접 다시 저장할 수 있습니다.',
        );
        if (!editor.original) setEditor({ ...editor, uncertain: false });
      } else setError(goalError(value));
    } finally {
      if (ticket === mutationRevision.current) {
        lock.current = false;
        setPending(false);
      }
    }
  }
  async function save(event: FormEvent) {
    event.preventDefault();
    if (lock.current || !online || !metadata || editor.uncertain || wbsSourceDenied) return;
    let body;
    try {
      body =
        editor.wbsSource && !editor.original
          ? zWbsGoalImport.parse({
              goal: {
                id: editor.id,
                isoYear: week.isoYear,
                isoWeek: week.isoWeek,
                title: editor.title,
                detail: editor.detail || null,
                sortOrder: 0,
              },
              source: {
                itemId: editor.wbsSource.itemId,
                itemVersion: editor.wbsSource.itemVersion,
                planId: editor.wbsSource.planId,
                planVersion: editor.wbsSource.planVersion,
              },
            })
          : editor.original
            ? zWeeklyGoalPatch.parse({
                version: editor.original.version,
                title: editor.title,
                detail: editor.detail || null,
                ...(editor.original.source.type === 'wbsItem'
                  ? {}
                  : { sourceEntryId: editor.sourceEntryId }),
              })
            : zWeeklyGoalCreate.parse({
                id: editor.id,
                isoYear: week.isoYear,
                isoWeek: week.isoWeek,
                title: editor.title,
                detail: editor.detail || null,
                sourceEntryId: editor.sourceEntryId,
              });
      if (editor.wbsSource && !editor.original) assertWbsGoalImportBytes(body);
    } catch {
      setError('목표 제목·메모와 요청 크기(8192바이트)를 확인해 주세요.');
      return;
    }
    lock.current = true;
    setPending(true);
    setError('');
    const ticket = mutationRevision.current;
    const wbsCommand = editor.wbsSource && !editor.original ? zWbsGoalImport.parse(body) : null;
    const next = { ...editor, uncertain: true, wbsCommand };
    setEditor(next);
    current.current = { editor: next, key: storageKey };
    storeGoalDraft(storageKey, next);
    try {
      const value = wbsCommand
        ? await importWbsGoal(companyId, wbsCommand)
        : await workApi(
            goalPath(companyId, editor.original ? editor.id : undefined),
            goalSchema(companyId, editor.id),
            editor.original ? 'PATCH' : 'POST',
            body,
          );
      if (ticket !== mutationRevision.current) return;
      setEditor({
        ...editor,
        original: value,
        uncertain: false,
        wbsSource: null,
        wbsCommand: null,
      });
      setLatest(null);
      setNotice('주간 목표를 저장했습니다. 배치된 업무는 변경하지 않았습니다.');
      setReload((n) => n + 1);
    } catch (value) {
      if (ticket !== mutationRevision.current || failure(value)) return;
      setError(goalError(value));
      if (value instanceof WorkFailure && [400, 422].includes(value.status))
        setEditor({ ...editor, uncertain: false });
      else if (!(uncertainWork(value) || (value instanceof WorkFailure && value.status === 409)))
        setEditor({ ...editor, uncertain: false });
    } finally {
      if (ticket === mutationRevision.current) {
        lock.current = false;
        setPending(false);
      }
    }
  }
  async function remove(goal: WeeklyGoal) {
    if (lock.current || !online) return;
    lock.current = true;
    setPending(true);
    const ticket = mutationRevision.current;
    try {
      await workApi(
        goalPath(companyId, goal.id),
        z.strictObject({ deleted: z.literal(true), id: z.literal(goal.id) }),
        'DELETE',
        { version: goal.version },
      );
      if (ticket !== mutationRevision.current) return;
      setDeleting(null);
      if (editor.id === goal.id) {
        setEditor(fresh());
        clearGoalDraft(storageKey);
      }
      setNotice('목표만 삭제했습니다. 배치된 업무와 영수증은 보존됩니다.');
      setReload((n) => n + 1);
    } catch (value) {
      if (ticket !== mutationRevision.current || failure(value)) return;
      setError(goalError(value));
      setDeleting(null);
      setUnknownDelete(goal);
    } finally {
      if (ticket === mutationRevision.current) {
        lock.current = false;
        setPending(false);
      }
    }
  }
  async function checkDelete() {
    if (!unknownDelete || lock.current || !online) return;
    lock.current = true;
    setPending(true);
    const ticket = mutationRevision.current;
    try {
      const list = await readGoals(companyId, week.isoYear, week.isoWeek);
      const value = list.items.find((item) => item.id === unknownDelete.id);
      if (!value) throw new WorkFailure(404, 'NOT_FOUND');
      if (ticket !== mutationRevision.current) return;
      setNotice('목표가 남아 있습니다. 최신 목록을 확인한 뒤 삭제를 다시 선택하세요.');
      setUnknownDelete(null);
      setItems((old) => old.map((i) => (i.id === value.id ? value : i)));
    } catch (value) {
      if (ticket === mutationRevision.current && !failure(value)) {
        if (value instanceof WorkFailure && value.status === 404) {
          setNotice('해당 목표가 삭제되어 있음을 확인했습니다.');
          if (editor.id === unknownDelete.id) setEditor(fresh());
          setUnknownDelete(null);
          setReload((n) => n + 1);
        } else setError(goalError(value));
      }
    } finally {
      if (ticket === mutationRevision.current) {
        lock.current = false;
        setPending(false);
      }
    }
  }
  async function inspectWbs(goal?: WeeklyGoal) {
    if (lock.current || !online) return;
    const source = goal?.source;
    const itemId = goal
      ? source?.type === 'wbsItem'
        ? source.liveItemId
        : null
      : editor.wbsSource?.itemId;
    if (!itemId) return;
    lock.current = true;
    setPending(true);
    setError('');
    const ticket = mutationRevision.current;
    try {
      const snapshot = await readWbsGoalSource(companyId, itemId);
      if (ticket !== mutationRevision.current) return;
      if (
        !goal &&
        editor.wbsSource &&
        (snapshot.planId !== editor.wbsSource.planId ||
          snapshot.projectId !== editor.wbsSource.projectId)
      )
        throw new WorkFailure(403, 'FORBIDDEN');
      if (goal) setSourceInfo({ id: goal.id, source: snapshot });
      else setWbsRecheck(snapshot);
    } catch (e) {
      if (ticket !== mutationRevision.current) return;
      if (e instanceof WorkFailure && e.status === 401) {
        failure(e);
        return;
      }
      if (e instanceof WorkFailure && e.status === 403) {
        if (!goal) {
          setWbsSourceDenied(true);
          setEditor((old) => ({ ...old, wbsSourceUnavailable: true }));
        }
        setSourceInfo(null);
        setWbsRecheck(null);
        setError('원본 WBS를 확인할 수 없습니다. 삭제를 확정하지 않으며 목표 입력은 보존합니다.');
      } else setError(goalError(e));
    } finally {
      if (ticket === mutationRevision.current) {
        lock.current = false;
        setPending(false);
      }
    }
  }
  const disabled = pending || !online || !metadata || denied;
  function adjacent(offset: number) {
    try {
      const next = shiftIsoWeek(week, offset);
      return weekCalendar(next.isoYear, next.isoWeek).weekStart;
    } catch {
      return null;
    }
  }
  async function showReceipt(id: string, goalId: string) {
    if (lock.current || !online) return;
    lock.current = true;
    setPending(true);
    const ticket = mutationRevision.current;
    try {
      const value = await readPlacement(companyId, id, goalId);
      if (ticket === mutationRevision.current) setReceipt(value);
    } catch (value) {
      if (ticket === mutationRevision.current && !failure(value)) setError(goalError(value));
    } finally {
      if (ticket === mutationRevision.current) {
        lock.current = false;
        setPending(false);
      }
    }
  }
  return (
    <section className="workspace goals-page work-panel" aria-label="주간 목표 관리">
      <nav className="workspace-nav" aria-label="목표 메뉴">
        <a className="control-link" href="/">
          회사 선택
        </a>
        <a className="control-link" href={`/c/${companyId}/week?date=${date}`}>
          주간 보기
        </a>
        <a className="control-link" href="/settings">
          계정 설정
        </a>
      </nav>
      <h1>주간 목표 · {company?.name ?? '회사 확인 중'}</h1>
      <HelpHint label="주간 목표 메모">목표 메모는 달성률에서 제외됩니다.</HelpHint>
      <p>가져오기는 초안이며 명시 배치 전에는 업무를 바꾸지 않습니다.</p>
      {error && <p role="alert">{error}</p>}
      {notice && <p role="status">{notice}</p>}
      {!online && <p role="status">오프라인 읽기 전용입니다. 작성한 초안을 유지합니다.</p>}
      {denied ? (
        <p>접근할 수 없는 회사입니다. 회사 선택에서 다시 확인하세요.</p>
      ) : (
        <>
          <section aria-label="목표 주 선택">
            <h2>{displayWeekLabel(date)}</h2>
            <p>
              {week.weekStart} ~ {week.weekEnd} · 한국 시간
            </p>
            <div className="work-actions">
              <button
                type="button"
                disabled={pending || !!placement || !adjacent(-1)}
                onClick={() => {
                  const d = adjacent(-1);
                  if (d) selectWeek(d);
                }}
              >
                목표 이전 주
              </button>
              <button
                type="button"
                disabled={pending || !!placement || !adjacent(1)}
                onClick={() => {
                  const d = adjacent(1);
                  if (d) selectWeek(d);
                }}
              >
                목표 다음 주
              </button>
              <button
                type="button"
                disabled={pending || !!placement}
                onClick={() => selectWeek(kstDate(Date.now()))}
              >
                목표 이번 주
              </button>
            </div>
            <form
              onSubmit={(e) => {
                e.preventDefault();
                selectWeek(dateInput);
              }}
            >
              <label>
                목표 주의 날짜
                <input
                  type="date"
                  required
                  value={dateInput}
                  disabled={pending || !!placement}
                  onChange={(e) => setDateInput(e.target.value)}
                />
              </label>
              <button disabled={pending || !!placement}>목표 주 조회</button>
            </form>
          </section>
          <RefreshButton
            type="button"
            disabled={pending || !online || loading || denied}
            onClick={() => setReload((n) => n + 1)}
            busy={loading || pending}
          >
            목표 다시 조회
          </RefreshButton>
          {loading && <p role="status">주간 목표를 불러오고 있습니다.</p>}
          {!metadata && <p role="status">회사와 배치 선택 항목을 확인하고 있습니다.</p>}
          <div className="goals-grid">
            <section aria-label="주간 목표 목록">
              <h2>주간 목표 목록</h2>
              {metadata && !loading && !items.length && <p>이 주의 목표가 없습니다.</p>}
              <ul className="work-list">
                {items.map((g) => (
                  <li className="goal-card" key={g.id}>
                    <h3>{g.title}</h3>
                    <p className="goal-note">{g.detail ?? '목표 메모 없음'}</p>
                    <p>
                      {g.placements.length ? '배치 결과 있음' : '미배치'} · 목표 버전 {g.version} ·
                      목표 메모는 집계 제외
                    </p>
                    {g.source.type === 'wbsItem' && (
                      <div className="wbs-goal-import">
                        <p>
                          {g.source.deleted
                            ? 'WBS에서 가져온 목표 · 원본 WBS 삭제됨 · 목표 내용 보존'
                            : 'WBS에서 가져온 목표 · 자동 배치 없음'}
                        </p>
                        <p>배치는 별도 수동 업무 등록이며 WBS 연결을 자동 승계하지 않습니다.</p>
                        {!g.source.deleted && (
                          <button
                            type="button"
                            disabled={disabled}
                            onClick={() => void inspectWbs(g)}
                          >
                            원본 WBS 확인: {g.title}
                          </button>
                        )}
                        {sourceInfo?.id === g.id && !g.source.deleted && (
                          <a
                            className="control-link"
                            href={`/c/${companyId}/wbs?${new URLSearchParams({ year: String(sourceInfo.source.year), projectId: sourceInfo.source.projectId, itemId: sourceInfo.source.itemId })}`}
                          >
                            원본 WBS로 이동: {sourceInfo.source.projectCode} ·{' '}
                            {sourceInfo.source.title}
                          </a>
                        )}
                      </div>
                    )}
                    {g.sourceEntryId && (
                      <p>
                        {g.sourceDeleted
                          ? '참조 원본 삭제됨 · 새 수행 또는 다른 원본을 선택하세요.'
                          : '기존 업무 참조 있음 · 자동 배치하지 않습니다.'}
                      </p>
                    )}
                    <div className="work-actions">
                      <button
                        type="button"
                        aria-label={`목표 편집: ${g.title}`}
                        disabled={disabled || !!placement || editor.uncertain}
                        onClick={() => request({ kind: 'edit', goal: g })}
                      >
                        목표 편집
                      </button>
                      <button
                        type="button"
                        aria-label={`목표 배치 검토: ${g.title}`}
                        disabled={disabled || !!placement}
                        onClick={() => {
                          storeGoalDraft(`${storageKey}:placement`, g);
                          setRecoveryGoal(g);
                          setPlacement(g);
                          setReceipt(null);
                        }}
                      >
                        배치 검토
                      </button>
                      <button
                        type="button"
                        aria-label={`목표 삭제: ${g.title}`}
                        disabled={disabled || !!placement || !!unknownDelete}
                        onClick={() => setDeleting(g)}
                      >
                        목표 삭제
                      </button>
                    </div>
                    {g.placements.length > 0 && (
                      <ol className="goal-receipts" aria-label={`${g.title} 배치 결과`}>
                        {g.placements.map((p) => (
                          <li key={p.id}>
                            {p.targetDate} ·{' '}
                            {p.intent === 'continue' ? '동일 업무 이연' : '새 수행'} · 업무 ID{' '}
                            {p.workEntryId}
                            <RefreshButton
                              type="button"
                              disabled={disabled || !!placement}
                              onClick={() => void showReceipt(p.id, g.id)}
                              showLabel
                            >
                              배치 결과 확인
                            </RefreshButton>
                          </li>
                        ))}
                      </ol>
                    )}
                  </li>
                ))}
              </ul>
            </section>
            <section className="goal-editor" aria-label="주간 목표 초안">
              {inbound &&
                inbound.companyId === companyId &&
                inbound.isoYear === week.isoYear &&
                inbound.isoWeek === week.isoWeek && (
                  <section className="wbs-goal-import" aria-label="가져온 WBS 목표 초안">
                    <p>
                      검토 대기 WBS: {inbound.source.projectCode} · {inbound.source.year}년 ·{' '}
                      {inbound.source.title}
                    </p>
                    <p>
                      기존 목표 입력은 아직 바꾸지 않았습니다. 제목만 가져오고 메모는 독립
                      입력합니다.
                    </p>
                    <button
                      type="button"
                      disabled={disabled || editor.uncertain || !!placement}
                      onClick={() => request({ kind: 'wbsImport', inbound })}
                    >
                      WBS 제목을 목표 초안으로 가져오기
                    </button>
                    <button
                      type="button"
                      disabled={pending}
                      onClick={() => setReplace({ kind: 'discardInbound' })}
                    >
                      보관한 WBS 가져오기 초안 폐기
                    </button>
                  </section>
                )}

              <h2>{editor.original ? '목표 편집' : '새 목표 초안'}</h2>
              <p>목표 ID: {editor.id}</p>
              {editor.sourceEntryId && (
                <p>참조 업무: {editor.source?.title ?? editor.sourceEntryId}</p>
              )}
              {editor.wbsSource && (
                <section className="wbs-goal-import" aria-label="WBS 목표 원본 검토">
                  <p>WBS 출처 · 목표 제목만 가져왔으며 메모는 독립 입력입니다.</p>
                  {!wbsSourceDenied && (
                    <p>
                      {editor.wbsSource.projectCode} · {editor.wbsSource.year}년 ·{' '}
                      {editor.wbsSource.title} · 원본 버전 {editor.wbsSource.itemVersion}/
                      {editor.wbsSource.planVersion}
                    </p>
                  )}
                  <button
                    type="button"
                    disabled={pending || !online || editor.uncertain}
                    onClick={() => void inspectWbs()}
                  >
                    WBS 원본 다시 검토
                  </button>
                  {wbsRecheck && (
                    <>
                      <p>
                        현재 원본: {wbsRecheck.projectCode} · {wbsRecheck.title} · 버전{' '}
                        {wbsRecheck.itemVersion}/{wbsRecheck.planVersion}
                      </p>
                      <button
                        type="button"
                        disabled={pending || editor.uncertain}
                        onClick={() => {
                          setEditor({
                            ...editor,
                            wbsSource: wbsRecheck,
                            wbsCommand: null,
                            wbsSourceUnavailable: false,
                          });
                          setWbsRecheck(null);
                          setWbsSourceDenied(false);
                          setNotice(
                            '편집한 제목·메모·목표 ID를 유지하고 원본 버전을 명시 채택했습니다. 직접 저장해 주세요.',
                          );
                        }}
                      >
                        목표 입력 유지하고 원본 버전 선택
                      </button>
                    </>
                  )}
                </section>
              )}
              <form onSubmit={save}>
                <fieldset disabled={disabled || editor.uncertain || !!placement}>
                  <legend>목표 입력</legend>
                  <label>
                    목표 제목
                    <input
                      required
                      maxLength={200}
                      value={editor.title}
                      onChange={(e) => setEditor({ ...editor, title: e.target.value })}
                    />
                  </label>
                  <label>
                    목표 메모
                    <textarea
                      maxLength={5000}
                      value={editor.detail}
                      onChange={(e) => setEditor({ ...editor, detail: e.target.value })}
                    />
                  </label>
                  <p>목표 편집은 배치 업무의 제목·내용·일정을 자동 수정하지 않습니다.</p>
                  <button type="submit" disabled={wbsSourceDenied}>
                    목표 저장
                  </button>
                  <button type="button" onClick={() => request({ kind: 'new' })}>
                    새 목표 시작
                  </button>
                  <button type="button" onClick={() => setPicker((v) => !v)}>
                    기존 업무 가져오기
                  </button>
                  {editor.sourceEntryId && (
                    <button
                      type="button"
                      onClick={() => setEditor({ ...editor, source: null, sourceEntryId: null })}
                    >
                      목표 원본 참조 해제
                    </button>
                  )}
                </fieldset>
              </form>
              {editor.uncertain && (
                <section aria-label="목표 저장 결과 확인">
                  <p>초안과 ID를 유지합니다. 결과 확인 전에는 다시 저장하지 않습니다.</p>
                  {editor.wbsCommand && (
                    <button
                      type="button"
                      disabled={pending}
                      onClick={() => setReplace({ kind: 'discardWbsCommand' })}
                    >
                      WBS 저장 검토 명시 폐기
                    </button>
                  )}
                  <RefreshButton
                    disabled={pending || !online}
                    onClick={() => void checkEditor()}
                    busy={pending}
                    showLabel
                  >
                    목표 저장 결과 다시 확인
                  </RefreshButton>
                  {latest && !editor.wbsCommand && (
                    <>
                      <p>
                        최신 목표: {latest.title} · 버전 {latest.version}
                      </p>
                      <button
                        disabled={pending || !online}
                        onClick={() => {
                          setEditor({ ...editor, original: latest, uncertain: false });
                          setLatest(null);
                          setNotice(
                            '입력을 유지하고 최신 목표 버전을 선택했습니다. 직접 다시 저장하세요.',
                          );
                        }}
                      >
                        목표 입력 유지하고 최신 버전 선택
                      </button>
                    </>
                  )}
                </section>
              )}
              {picker && !placement && (
                <GoalSourcePicker
                  companyId={companyId}
                  online={online}
                  disabled={disabled || editor.uncertain}
                  onFailure={failure}
                  onSelect={(source) => request({ kind: 'import', source })}
                />
              )}
            </section>
          </div>
          {replace && (
            <dialog
              ref={replaceDialog}
              role="alertdialog"
              aria-modal="true"
              aria-label="목표 초안 교체 확인"
              className="goal-import-dialog"
              onCancel={(e) => {
                e.preventDefault();
                if (!pending) setReplace(null);
              }}
            >
              <p>
                {replace.kind === 'discardInbound'
                  ? '보관한 WBS 가져오기 초안을 폐기할까요? 기존 목표 입력은 유지됩니다.'
                  : replace.kind === 'discardWbsCommand'
                    ? '결과 미확인 검토를 폐기하고 새 초안을 시작할까요? 이미 저장된 목표나 업무는 삭제하지 않습니다.'
                    : '작성한 목표 입력을 새 초안으로 바꾸시겠습니까? 아직 저장하지 않은 입력이 교체됩니다.'}
              </p>
              <button
                type="button"
                data-safe-cancel
                disabled={pending}
                onClick={() => setReplace(null)}
              >
                기존 목표 입력 유지
              </button>
              <button
                type="button"
                className="primary"
                disabled={pending || !online}
                onClick={() => apply(replace)}
              >
                목표 초안 교체 확인
              </button>
            </dialog>
          )}
          {deleting && (
            <section
              role="alertdialog"
              aria-modal="true"
              aria-label="목표 삭제 확인"
              className="work-conflict"
            >
              <p>
                {deleting.title} 목표만 삭제합니다. 배치 업무·영수증·과거 보고는 삭제하지 않습니다.
              </p>
              <button disabled={pending} onClick={() => setDeleting(null)}>
                목표 삭제하지 않기
              </button>
              <button disabled={disabled} onClick={() => void remove(deleting)}>
                목표만 영구 삭제 확인
              </button>
            </section>
          )}
          {unknownDelete && (
            <section aria-label="목표 삭제 결과 확인">
              <p>삭제 결과를 확인하기 전에는 다시 삭제하지 않습니다.</p>
              <RefreshButton
                disabled={pending || !online}
                onClick={() => void checkDelete()}
                busy={pending}
                showLabel
              >
                목표 삭제 결과 다시 확인
              </RefreshButton>
            </section>
          )}
          {recoveryGoal && !placement && recoveryGoal.companyId === companyId && (
            <button type="button" disabled={disabled} onClick={() => setPlacement(recoveryGoal)}>
              보관한 배치 검토 열기
            </button>
          )}
          {placement && (
            <GoalPlacement
              key={`${scope}:${placement.id}`}
              goal={placement}
              companyId={companyId}
              userId={userId}
              projects={projects}
              tags={tags}
              online={online}
              onFailure={failure}
              onSaved={() => setReload((n) => n + 1)}
              onClose={() => setPlacement(null)}
            />
          )}
          {receipt && (
            <section aria-label="저장된 배치 영수증">
              <h2>저장된 배치 영수증</h2>
              <p>
                배치 ID {receipt.placement.id} · {receipt.placement.targetDate}
              </p>
              <p>
                업무 ID {receipt.placement.workEntryId} · 당시 버전{' '}
                {receipt.placement.workEntryVersion}
              </p>
              <p>
                {receipt.entry
                  ? receipt.entry.title
                  : '배치 업무는 현재 삭제되었습니다. 영수증은 보존됩니다.'}
              </p>
              <a
                className="control-link"
                href={`/c/${companyId}/day?date=${receipt.placement.targetDate}`}
              >
                배치 일간 보기
              </a>
            </section>
          )}
        </>
      )}
    </section>
  );
}
