import { HelpHint } from './help-hint';
import { RefreshButton } from './ui-controls';
import { WbsExcelImport } from './wbs-excel-import';
import { useEffect, useRef, useState } from 'react';
import { z } from 'zod';
import {
  zWbsItem,
  zWbsYear,
  type WbsPlanDeletePreview,
  type WbsItemDeletePreview,
  type WbsChanges,
} from '../shared/schema/wbs';
import {
  zWorkspaceCompany,
  zWorkspaceProject,
  type WorkspaceCompany,
  type WorkspaceProject,
} from '../shared/schema/workspace';
import { kstDate } from '../shared/work-entry-rules';
import { workApi, WorkFailure, workError } from './work-entry-api';
import {
  readWbs,
  readWbsChanges,
  previewWbs,
  sendWbs,
  validateWbsCommand,
  matchWbsResult,
  wbsFailure,
  zWbsCommand,
  type WbsCommand,
  type WbsPlan,
  type WbsItem,
} from './wbs-api';
import { WbsItemEditor, newItemFields } from './wbs-item-editor';
import { WbsCompletion } from './wbs-completion';
import { WbsWorkLinks } from './wbs-work-links';
import { WbsActualPeriod } from './wbs-actual-period';
import { WbsPlanner } from './wbs-planner';
import { setWorkspaceDraftDirty } from './workspace-draft-state';
import { readWbsGoalSource } from './goal-api';
import {
  goalWeekForDate,
  inboundKey,
  writeInbound,
  readInbound,
  zWbsGoalInbound,
  useGoalImportDialog,
} from './wbs-goal-import';
import type { WbsGoalDraftSource } from '../shared/schema/wbs-goal-import';
import './weekly-goals.css';
import './wbs.css';
const zFields = z.strictObject({
  id: z.uuid(),
  originalId: z.uuid().nullable(),
  title: z.string().max(200),
  description: z.string().max(5000),
  sortOrder: z.string().max(40),
  startOn: z.string().max(10),
  endOn: z.string().max(10),
  revise: z.boolean(),
  revisedStartOn: z.string().max(10),
  revisedEndOn: z.string().max(10),
  reason: z.string().max(5000),
});
const zDraft = z.strictObject({
  createId: z.uuid(),
  note: z.string().max(5000),
  noteVersion: z.number().int().positive().nullable(),
  noteOriginal: z.string().nullable(),
  noteOpen: z.boolean(),
  item: zFields.nullable(),
  original: zWbsItem.nullable(),
  planVersion: z.number().int().positive().nullable(),
  itemOpen: z.boolean(),
  command: zWbsCommand.nullable(),
  stale: z.boolean(),
});
type Draft = z.output<typeof zDraft>;
function fresh(): Draft {
  return {
    createId: crypto.randomUUID(),
    note: '',
    noteVersion: null,
    noteOriginal: null,
    noteOpen: false,
    item: null,
    original: null,
    planVersion: null,
    itemOpen: false,
    command: null,
    stale: false,
  };
}
function load(key: string) {
  try {
    return zDraft.parse(JSON.parse(sessionStorage.getItem(key) ?? 'null'));
  } catch {
    return fresh();
  }
}
function put(key: string, d: Draft) {
  try {
    sessionStorage.setItem(key, JSON.stringify(d));
  } catch {
    /* Memory draft remains. */
  }
}
const range = (s: string | null, e: string | null) => `${s ?? '미정'} ~ ${e ?? '미정'}`;
function validScope(year: string, project: string) {
  return (
    /^[0-9]{1,4}$/.test(year) &&
    zWbsYear.safeParse(Number(year)).success &&
    (!project || z.uuid().safeParse(project).success)
  );
}
function scopeURL(company: string, year: string, project: string, itemId = '') {
  if (!z.uuid().safeParse(company).success || !validScope(year, project)) return '/';
  const p = new URLSearchParams({ year: String(Number(year)) });
  if (project) p.set('projectId', project);
  if (z.uuid().safeParse(itemId).success) p.set('itemId', itemId);
  return `/c/${company}/wbs?${p}`;
}
/** Opening a clean editor is not an edit. Keep commands, original IDs and versions intact. */
function draftIsDirty(d: Draft) {
  if (d.command) return true;
  if (d.noteVersion !== null ? d.note !== (d.noteOriginal ?? '') : !!d.note) return true;
  const f = d.item,
    old = d.original;
  if (!f) return false;
  if (!old)
    return !!(f.title || f.description || f.sortOrder !== '0' || f.startOn || f.endOn || f.reason);
  return (
    f.title !== old.title ||
    f.description !== (old.description ?? '') ||
    f.sortOrder !== String(old.sortOrder) ||
    (f.revise &&
      (f.revisedStartOn !== (old.effectiveStartOn ?? '') ||
        f.revisedEndOn !== (old.effectiveEndOn ?? '') ||
        !!f.reason))
  );
}
function historyEntryIndex(): number | null {
  const index = (window as Window & { navigation?: { currentEntry?: { index: number } } })
    .navigation?.currentEntry?.index;
  return index !== undefined && Number.isInteger(index) && index >= 0 ? index : null;
}
export function WbsPage({ companyId, userId }: { companyId: string; userId: string }) {
  const query = new URLSearchParams(location.search);
  const [year, setYear] = useState(query.get('year') ?? kstDate(Date.now()).slice(0, 4)),
    [project, setProject] = useState(query.get('projectId') ?? '');
  const itemQuery = query.get('itemId') ?? '';
  const [selected, setSelected] = useState({
    year,
    project,
    itemId: z.uuid().safeParse(itemQuery).success ? itemQuery : '',
  });
  const selectedContext = useRef(selected);
  selectedContext.current = selected;
  const [plannerOpened, setPlannerOpened] = useState(false);
  const importBusyGuard = useRef<() => boolean>(() => false);
  const scopeGuard = useRef<() => boolean>(() => false);
  const moveGuard = useRef<() => boolean>(() => false);
  const [privateDenied, setPrivateDenied] = useState(false);
  const selectedURL = useRef(location.pathname + location.search + location.hash);
  const selectedHistoryState = useRef(history.state);
  const selectedHistoryIndex = useRef(historyEntryIndex());
  const restoringHistory = useRef(false);
  function confirmScopeChange() {
    if (importBusyGuard.current()) {
      window.alert(
        '엑셀 파일 또는 등록 결과를 확인 중입니다. 완료된 뒤 프로젝트·연도를 변경해 주세요.',
      );
      return false;
    }
    return (
      (!scopeGuard.current() && !moveGuard.current()) ||
      window.confirm(
        '저장 전 입력 또는 결과 확인이 필요한 요청을 현재 범위에 보관하고 이동할까요? 돌아오면 같은 ID·버전의 초안을 복구합니다.',
      )
    );
  }
  const scope = `${companyId}/${selected.year}/${selected.project}`;
  const [data, setData] = useState<{
      scope: string;
      company: WorkspaceCompany;
      projects: WorkspaceProject[];
      plans: WbsPlan[];
    } | null>(null),
    [error, setError] = useState(''),
    [loading, setLoading] = useState(false),
    [online, setOnline] = useState(navigator.onLine),
    [reload, setReload] = useState(0);
  const revision = useRef(0);
  useEffect(() => {
    const change = () => setOnline(navigator.onLine);
    window.addEventListener('online', change);
    window.addEventListener('offline', change);
    return () => {
      window.removeEventListener('online', change);
      window.removeEventListener('offline', change);
    };
  }, []);
  function expired(e: unknown) {
    if (e instanceof WorkFailure && [401, 403].includes(e.status)) {
      setPrivateDenied(true);
      setData(null);
    }
    if (e instanceof WorkFailure && e.status === 401) {
      location.assign(
        `/login?${new URLSearchParams({
          returnTo: scopeURL(
            companyId,
            selectedContext.current.year,
            selectedContext.current.project,
            selectedContext.current.itemId,
          ),
        })}`,
      );
      return true;
    }
    return false;
  }
  useEffect(() => {
    const ticket = ++revision.current;
    setError('');
    setLoading(false);
    const y = zWbsYear.safeParse(Number(selected.year));
    if (!y.success || !validScope(selected.year, selected.project)) {
      setError('계획 연도는 1~9999의 정수, 프로젝트는 선택 목록에서 확인해 주세요.');
      return;
    }
    if (!online) return;
    setLoading(true);
    void Promise.all([
      workApi(
        `/api/companies/${companyId}`,
        zWorkspaceCompany.refine((c) => c.id === companyId),
      ),
      workApi(
        `/api/companies/${companyId}/projects`,
        z
          .array(zWorkspaceProject)
          .refine(
            (v) =>
              v.every((p) => p.companyId === companyId) &&
              new Set(v.map((p) => p.id)).size === v.length,
          ),
      ),
      readWbs(companyId, y.data),
    ])
      .then(([company, projects, list]) => {
        if (list.plans.some((p) => !projects.some((project) => project.id === p.projectId)))
          throw new WorkFailure(0, 'INVALID_RESPONSE');
        if (ticket === revision.current) setData({ scope, company, projects, plans: list.plans });
      })
      .catch((e) => {
        if (ticket !== revision.current || expired(e)) return;
        if (e instanceof WorkFailure && e.status === 403) {
          setData(null);
        }
        setError(workError(e));
      })
      .finally(() => {
        if (ticket === revision.current) setLoading(false);
      });
    return () => {
      revision.current++;
    };
  }, [scope, reload, online]);
  const shown = data?.scope === scope ? data : null;
  function navigate(nextYear: string, nextProject: string, itemId = '') {
    if (!validScope(nextYear, nextProject) || (itemId && !z.uuid().safeParse(itemId).success)) {
      setError('계획 연도는 1~9999의 정수, 프로젝트는 선택 목록에서 확인해 주세요.');
      return false;
    }
    if (!confirmScopeChange()) {
      setYear(selected.year);
      setProject(selected.project);
      return false;
    }
    const next = {
      year: String(Number(nextYear)),
      project: nextProject,
      itemId,
    };
    setYear(next.year);
    setProject(next.project);
    setSelected(next);
    selectedURL.current = scopeURL(companyId, next.year, next.project, itemId);
    selectedHistoryState.current = history.state;
    history.pushState(selectedHistoryState.current, '', selectedURL.current);
    selectedHistoryIndex.current = historyEntryIndex();
    return true;
  }
  function apply() {
    setPrivateDenied(false);
    if (year === selected.year && project === selected.project) {
      setReload((n) => n + 1);
      return;
    }
    navigate(year, project);
  }
  useEffect(() => {
    const pop = (event: PopStateEvent) => {
      if (restoringHistory.current) {
        restoringHistory.current = false;
        selectedHistoryState.current = history.state;
        event.stopImmediatePropagation();
        return;
      }
      if (!confirmScopeChange()) {
        // popstate itself cannot be canceled. Restore before any outer route listener runs.
        event.stopImmediatePropagation();
        const arrived = historyEntryIndex(),
          previous = selectedHistoryIndex.current;
        if (arrived !== null && previous !== null && arrived !== previous) {
          // Restore the original entry, including state changed by another caller.
          restoringHistory.current = true;
          history.go(previous - arrived);
        } else {
          // Older browsers retain the app's controlled URL and saved state.
          history.pushState(selectedHistoryState.current, '', selectedURL.current);
          selectedHistoryIndex.current = historyEntryIndex();
        }
        setYear(selected.year);
        setProject(selected.project);
        return;
      }
      const p = new URLSearchParams(location.search);
      const y = p.get('year') ?? kstDate(Date.now()).slice(0, 4),
        project = p.get('projectId') ?? '',
        rawItem = p.get('itemId') ?? '';
      if (location.pathname !== `/c/${companyId}/wbs`) return;
      setYear(y);
      setProject(project);
      setSelected({
        year: y,
        project,
        itemId: z.uuid().safeParse(rawItem).success ? rawItem : '',
      });
      selectedURL.current = location.pathname + location.search + location.hash;
      selectedHistoryState.current = history.state;
      selectedHistoryIndex.current = historyEntryIndex();
    };
    window.addEventListener('popstate', pop, true);
    return () => window.removeEventListener('popstate', pop, true);
  }, [companyId, selected]);
  return (
    <section className="workspace wbs-page">
      <nav className="workspace-nav" aria-label="WBS 메뉴">
        <a className="control-link" href="/">
          회사 선택
        </a>
        <a className="control-link" href={`/c/${companyId}/week`}>
          주간 보기
        </a>
        <a className="control-link" href={`/c/${companyId}/settings/projects`}>
          프로젝트 관리
        </a>
      </nav>
      <h1>WBS 계획</h1>
      <p>
        {shown?.company.name ?? '회사별 WBS'} · 프로젝트·달력연도별 선택적 평면 계획입니다. 실제
        업무·수동완료·실적·주간 분모를 자동으로 만들지 않습니다.
      </p>
      <form
        className="wbs-controls"
        onSubmit={(e) => {
          e.preventDefault();
          apply();
        }}
      >
        <label>
          WBS 계획 연도
          <input
            type="number"
            min="1"
            max="9999"
            step="1"
            required
            value={year}
            onChange={(e) => setYear(e.target.value)}
          />
        </label>
        <label>
          WBS 프로젝트
          <select value={project} onChange={(e) => setProject(e.target.value)}>
            <option value="">프로젝트 선택</option>
            {shown?.projects.map((p) => (
              <option key={p.id} value={p.id}>
                {p.code}
                {p.isActive ? '' : ' (비활성)'}
              </option>
            ))}
          </select>
        </label>
        <button type="submit" className="primary" disabled={!online || loading}>
          WBS 조회
        </button>
      </form>
      <HelpHint label="WBS 조회">같은 조건으로 조회하면 최신 목록을 불러옵니다.</HelpHint>
      {shown && selected.project && validScope(selected.year, selected.project) && (
        <WbsExcelImport
          key={scope}
          busyGuard={importBusyGuard}
          projectId={selected.project}
          year={Number(selected.year)}
          onImported={() => setReload((n) => n + 1)}
        />
      )}
      {!online && <p role="status">오프라인 · 초안을 보존하며 조회·저장은 제한됩니다.</p>}
      {loading && <p role="status">WBS를 불러오고 있습니다.</p>}
      {error && <p role="alert">{error}</p>}
      {error && shown && (
        <p>마지막 성공 조회의 목록입니다. 오류를 빈 WBS로 해석하지 말고 다시 조회해 주세요.</p>
      )}
      <details
        className="wbs-planner-entry"
        onToggle={(event) => {
          if (event.currentTarget.open) setPlannerOpened(true);
        }}
      >
        <summary>연간 달력 · 정규 WBS와 내 일정</summary>
        {plannerOpened && !privateDenied && validScope(selected.year, selected.project) && (
          <WbsPlanner
            key={`move/${userId}/${scope}`}
            companyId={companyId}
            userId={userId}
            moveGuard={moveGuard}
            onChanged={() => setReload((n) => n + 1)}
            year={Number(selected.year)}
            projectId={selected.project}
            refresh={reload}
            online={online}
            expired={expired}
            onYearChange={(next) => navigate(String(next), selected.project)}
            onItemOpen={(nextProject, itemId) => navigate(selected.year, nextProject, itemId)}
          />
        )}
      </details>
      {shown && !privateDenied && (
        <WbsScope
          key={`${userId}/${scope}`}
          companyId={companyId}
          userId={userId}
          year={Number(selected.year)}
          projectId={selected.project}
          itemId={selected.itemId}
          scopeGuard={scopeGuard}
          projects={shown.projects}
          plans={shown.plans}
          online={online}
          disabled={loading}
          expired={expired}
          onReload={() => setReload((n) => n + 1)}
        />
      )}
    </section>
  );
}
function WbsScope({
  companyId,
  userId,
  year,
  projectId,
  itemId,
  scopeGuard,
  projects,
  plans,
  online,
  disabled,
  expired,
  onReload,
}: {
  companyId: string;
  userId: string;
  year: number;
  projectId: string;
  itemId: string;
  scopeGuard: { current: () => boolean };
  projects: WorkspaceProject[];
  plans: WbsPlan[];
  online: boolean;
  disabled: boolean;
  expired: (e: unknown) => boolean;
  onReload: () => void;
}) {
  const key = `wt:wbs:v1:${encodeURIComponent(userId)}:${companyId}/${year}/${projectId}`;
  const [draft, setDraft] = useState(() => {
      const d = load(key);
      if (
        d.command &&
        (d.command.companyId !== companyId ||
          d.command.projectId !== projectId ||
          d.command.year !== year)
      )
        return fresh();
      if (d.original && d.original.companyId !== companyId) return fresh();
      return d;
    }),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [message, setMessage] = useState(''),
    [preview, setPreview] = useState<{
      command: WbsCommand;
      data: WbsPlanDeletePreview | WbsItemDeletePreview;
      title: string;
    } | null>(null),
    [confirmText, setConfirmText] = useState(''),
    [changes, setChanges] = useState<{
      id: string;
      title: string;
      data: WbsChanges;
    } | null>(null),
    [replace, setReplace] = useState<{ label: string; run: () => void } | null>(null),
    [denied, setDenied] = useState(false);
  const [goalImport, setGoalImport] = useState<WbsGoalDraftSource | null>(null),
    [goalDate, setGoalDate] = useState(() => kstDate(Date.now())),
    [goalPreparing, setGoalPreparing] = useState(false);
  const goalImportDialog = useGoalImportDialog(!!goalImport);
  const current = useRef(draft);
  current.current = draft;
  const lock = useRef(false),
    alive = useRef(true),
    historyRevision = useRef(0),
    trigger = useRef<HTMLElement | null>(null),
    dialog = useRef<HTMLDialogElement>(null),
    heading = useRef<HTMLHeadingElement>(null);
  const plan = plans.find((p) => p.projectId === projectId),
    project = projects.find((p) => p.id === projectId);
  const blocked = disabled || busy || !online;
  const focusedLinkItem = useRef('');
  useEffect(() => {
    const id = itemId;
    if (!id || focusedLinkItem.current === id || !plan?.items.some((i) => i.id === id)) return;
    const node = document.getElementById(`wbs-item-${id}`);
    if (node) {
      focusedLinkItem.current = id;
      node.focus();
      node.scrollIntoView({ block: 'center' });
    }
  }, [plan, itemId]);

  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  useEffect(() => {
    const guard = () => draftIsDirty(current.current);
    scopeGuard.current = guard;
    const leave = (event: BeforeUnloadEvent) => {
      if (!guard()) return;
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', leave);
    return () => {
      window.removeEventListener('beforeunload', leave);
      setWorkspaceDraftDirty(key, false);
      if (scopeGuard.current === guard) scopeGuard.current = () => false;
    };
  }, [key, scopeGuard]);
  useEffect(() => {
    setWorkspaceDraftDirty(key, draftIsDirty(draft));
  }, [key, draft]);
  function update(d: Draft) {
    current.current = d;
    put(key, d);
    setDraft(d);
  }
  useEffect(() => {
    if ((preview || replace) && dialog.current) {
      if (!dialog.current.open) dialog.current.showModal();
      dialog.current.querySelector<HTMLButtonElement>('button')?.focus();
    }
  }, [preview, replace]);
  function fail(e: unknown) {
    if (expired(e)) return;
    if (e instanceof WorkFailure && e.status === 403) {
      setDenied(true);
      setChanges(null);
      setPreview(null);
      setMessage('');
    }
    setError(wbsFailure(e) ?? workError(e));
  }
  function restore() {
    dialog.current?.close();
    trigger.current?.focus();
  }
  function replaceDraft(label: string, run: () => void) {
    trigger.current = document.activeElement as HTMLElement;
    if (draft.command) {
      setError('저장 결과 확인이 먼저 필요합니다. 고정 ID와 입력을 보존했습니다.');
      return;
    }
    if (draftIsDirty(draft)) setReplace({ label, run });
    else run();
  }
  function startItem(i?: WbsItem) {
    if (!plan) return;
    replaceDraft('기존 검토 입력을 새 항목 검토로 바꿉니다.', () => {
      const f = i
        ? {
            ...newItemFields(),
            id: i.id,
            originalId: i.id,
            title: i.title,
            description: i.description ?? '',
            sortOrder: String(i.sortOrder),
            revisedStartOn: i.effectiveStartOn ?? '',
            revisedEndOn: i.effectiveEndOn ?? '',
          }
        : newItemFields();
      update({
        ...draft,
        item: f,
        original: i ?? null,
        planVersion: plan.version,
        itemOpen: true,
        stale: false,
        noteOpen: false,
      });
      setReplace(null);
    });
  }
  function command(
    kind: WbsCommand['kind'],
    id: string,
    body: Record<string, unknown>,
    planId = plan?.id ?? id,
  ): WbsCommand {
    return {
      kind,
      companyId,
      projectId,
      year,
      id,
      planId,
      body,
      ...(kind === 'itemPatch' ? { original: draft.original } : {}),
    };
  }
  async function perform(input: WbsCommand) {
    if (lock.current || blocked || current.current.command) return;
    let c: WbsCommand;
    try {
      c = validateWbsCommand(input);
    } catch {
      setError('필수 값·날짜 순서·길이·정수·8192바이트 제한 및 삭제 확인을 확인해 주세요.');
      return;
    }
    lock.current = true;
    setBusy(true);
    setError('');
    setMessage('');
    update({ ...current.current, command: c });
    try {
      await sendWbs(c);
      if (!alive.current) return;
      update({ ...fresh(), createId: crypto.randomUUID() });
      dialog.current?.close();
      setPreview(null);
      setChanges(null);
      setMessage('저장했습니다. WBS 목록을 다시 확인합니다.');
      onReload();
      heading.current?.focus();
    } catch (e) {
      if (!alive.current) return;
      dialog.current?.close();
      setPreview(null);
      heading.current?.focus();
      if (e instanceof WorkFailure && [400, 409, 422].includes(e.status)) {
        update({ ...current.current, command: null, stale: e.status === 409 });
        if (e.status === 409) setPreview(null);
      }
      fail(e);
    } finally {
      lock.current = false;
      if (alive.current) setBusy(false);
    }
  }
  async function recover() {
    const c = current.current.command;
    if (!c || lock.current || blocked) return;
    lock.current = true;
    setBusy(true);
    setError('');
    try {
      const list = await readWbs(companyId, year);
      if (!alive.current) return;
      const result = matchWbsResult(c, list.plans);
      if (
        result === 'matched' ||
        (result === 'absent' && (c.kind === 'planDelete' || c.kind === 'itemDelete'))
      ) {
        update(fresh());
        setPreview(null);
        setMessage(
          result === 'matched'
            ? '고정 ID·제출값과 기대 버전이 일치하는 결과를 확인했습니다.'
            : '소유 회사·원래 연도 전체 목록에서 현재 부재를 확인했습니다. 이 요청만이 삭제했다는 이력 증명은 아닙니다.',
        );
        onReload();
      } else
        setMessage(
          result === 'absent'
            ? '현재 전체 목록에 대상이 없습니다. 생성 후 삭제됐을 수도 있어 최초 저장 실패를 단정하거나 자동 재제출하지 않습니다.'
            : '제출값·기대 버전과 다릅니다. 후속 버전의 성공 주체를 단정하지 않습니다. 입력을 보존했습니다.',
        );
    } catch (e) {
      if (alive.current) fail(e);
    } finally {
      lock.current = false;
      if (alive.current) setBusy(false);
    }
  }
  function saveItem() {
    if (!plan || !draft.item || draft.stale) return;
    const f = draft.item,
      old = draft.original;
    const sort = Number(f.sortOrder);
    if (!f.sortOrder || !Number.isSafeInteger(sort)) {
      setError('표시 순서는 안전한 정수로 입력해 주세요.');
      return;
    }
    if (!old) {
      void perform(
        command('itemCreate', f.id, {
          id: f.id,
          planVersion: draft.planVersion,
          title: f.title,
          description: f.description || null,
          sortOrder: sort,
          plannedStartOn: f.startOn || null,
          plannedEndOn: f.endOn || null,
        }),
      );
      return;
    }
    const b: Record<string, unknown> = {
      version: old.version,
      planVersion: draft.planVersion,
    };
    if (old.title !== f.title) b.title = f.title;
    if ((old.description ?? '') !== f.description) b.description = f.description || null;
    if (old.sortOrder !== sort) b.sortOrder = sort;
    if (f.revise) {
      if (
        (old.effectiveStartOn ?? '') === f.revisedStartOn &&
        (old.effectiveEndOn ?? '') === f.revisedEndOn
      ) {
        setError(
          '적용 일정이 같습니다. 다른 항목 변경과 함께 보내도 일정 변경으로 저장하지 않습니다.',
        );
        return;
      }
      b.schedule = {
        startOn: f.revisedStartOn || null,
        endOn: f.revisedEndOn || null,
        reason: f.reason,
      };
    }
    if (Object.keys(b).length === 2) {
      setError('실제 변경이 없습니다.');
      return;
    }
    void perform(command('itemPatch', old.id, b));
  }
  async function latest() {
    if (blocked || draft.command) return;
    if (!plan) {
      setBusy(true);
      try {
        await readWbs(companyId, year);
        if (alive.current) {
          setMessage(
            '회사·연도 전체 목록을 다시 확인했습니다. 입력을 유지하고 기존 WBS 여부를 확인하세요.',
          );
          onReload();
        }
      } catch (e) {
        if (alive.current) fail(e);
      } finally {
        if (alive.current) setBusy(false);
      }
      return;
    }
    setBusy(true);
    setError('');
    try {
      const list = await readWbs(companyId, year),
        p = list.plans.find((p) => p.id === plan.id);
      if (!alive.current) return;
      if (!p) {
        setError('계획이 삭제됐습니다. 현재 입력은 보존됩니다.');
        return;
      }
      const i = p.items.find((i) => i.id === draft.original?.id);
      if (draft.original && !i) {
        setError('항목이 삭제됐습니다. 현재 입력은 보존됩니다.');
        return;
      }
      update({
        ...current.current,
        original: i ?? null,
        planVersion: p.version,
        noteVersion: current.current.noteOpen ? p.version : current.current.noteVersion,
        noteOriginal: p.note,
        stale: false,
      });
      setMessage(
        '최신 버전을 확인했습니다. 유지한 입력과 원래/변경 계획을 비교한 뒤 명시 저장하세요.',
      );
      onReload();
    } catch (e) {
      fail(e);
    } finally {
      if (alive.current) setBusy(false);
    }
  }
  async function askDelete(i?: WbsItem) {
    if (!plan || blocked || draft.command) return;
    trigger.current = document.activeElement as HTMLElement;
    setBusy(true);
    setError('');
    try {
      const c = command(i ? 'itemDelete' : 'planDelete', i?.id ?? plan.id, {}),
        d = await previewWbs(c);
      if (alive.current) {
        setPreview({
          command: c,
          data: d,
          title: i?.title ?? `${project?.code} · ${year}년 WBS`,
        });
        setConfirmText('');
      }
    } catch (e) {
      if (alive.current) fail(e);
    } finally {
      if (alive.current) setBusy(false);
    }
  }
  async function historyFor(i: WbsItem) {
    if (blocked) return;
    const ticket = ++historyRevision.current;
    if (changes?.id === i.id) {
      setChanges(null);
      return;
    }
    setBusy(true);
    setError('');
    try {
      const data = await readWbsChanges(companyId, i.id);
      if (alive.current && ticket === historyRevision.current)
        setChanges({ id: i.id, title: i.title, data });
    } catch (e) {
      if (alive.current) fail(e);
    } finally {
      if (alive.current) setBusy(false);
    }
  }
  async function prepareGoalImport(i: WbsItem) {
    if (lock.current || blocked || draft.command) return;
    lock.current = true;
    setGoalPreparing(true);
    setError('');
    try {
      const source = await readWbsGoalSource(companyId, i.id);
      if (!alive.current) return;
      if (source.projectId !== projectId || source.planId !== plan?.id)
        throw new WorkFailure(0, 'INVALID_RESPONSE');
      setGoalImport(source);
    } catch (e) {
      if (alive.current && !expired(e))
        setError(
          e instanceof WorkFailure && e.status === 403
            ? '원본 WBS를 확인할 수 없습니다. 삭제를 확정하지 않고 기존 입력을 보존합니다.'
            : workError(e),
        );
    } finally {
      lock.current = false;
      if (alive.current) setGoalPreparing(false);
    }
  }
  function stageGoalImport() {
    if (!goalImport || blocked) return;
    try {
      const w = goalWeekForDate(goalDate),
        k = inboundKey(userId, companyId, w.isoYear, w.isoWeek);
      const existing = readInbound(k, zWbsGoalInbound);
      if (existing) {
        setError(
          '선택한 주에 보존한 WBS 가져오기 초안이 있습니다. 목표 화면에서 먼저 확인하거나 명시 폐기해 주세요.',
        );
        return;
      }
      writeInbound(k, zWbsGoalInbound, {
        id: crypto.randomUUID(),
        companyId,
        isoYear: w.isoYear,
        isoWeek: w.isoWeek,
        source: goalImport,
      });
      location.assign(`/c/${companyId}/goals?date=${w.date}`);
    } catch {
      setError(
        '지원하는 목표 주와 임시 초안 저장을 확인해 주세요. 입력을 유지하며 이동하거나 저장하지 않았습니다.',
      );
    }
  }
  const deleteBody = () => {
    if (!preview) return;
    const d = preview.data,
      b =
        'planVersion' in d
          ? {
              version: d.version,
              planVersion: d.planVersion,
              confirmText,
              expectedImpact: {
                historyCount: d.impact.historyCount,
                completionHistoryCount: d.impact.completionHistoryCount,
                workLinkCount: d.impact.workLinkCount,
                goalCount: d.impact.goalCount,
              },
              contractVersion: d.contractVersion,
            }
          : {
              version: d.version,
              confirmText,
              expectedImpact: {
                itemCount: d.impact.itemCount,
                workLinkCount: d.impact.workLinkCount,
                goalCount: d.impact.goalCount,
                historyCount: d.impact.historyCount,
                completionHistoryCount: d.impact.completionHistoryCount,
              },
              contractVersion: d.contractVersion,
            };
    void perform({ ...preview.command, body: b });
  };
  if (denied)
    return (
      <section aria-label="WBS 접근 제한">
        <p role="alert">{error || '접근할 수 없는 회사 또는 기록입니다.'}</p>
        <p>내용을 숨겼습니다. 계정별 초안은 보존되며 다른 회사에 제출하지 않습니다.</p>
      </section>
    );
  return (
    <section aria-label="WBS 계획 내용">
      <h2 ref={heading} tabIndex={-1}>
        {project
          ? `${project.code}${project.isActive ? '' : ' (비활성)'} · ${year}년`
          : '프로젝트를 선택하고 WBS 조회를 눌러 주세요.'}
      </h2>
      {busy && <p role="status">WBS 요청을 처리하고 있습니다.</p>}
      {error && <p role="alert">{error}</p>}
      {message && <p role="status">{message}</p>}
      {draft.command && (
        <section aria-label="WBS 결과 확인">
          <p>
            저장 결과 확인 필요 · 고정 ID {draft.command.id}. 입력·버전·제출값을 보존했으며 자동
            재제출하지 않습니다.
          </p>
          <RefreshButton type="button" disabled={blocked} onClick={() => void recover()} showLabel>
            WBS 저장 결과 다시 확인
          </RefreshButton>
        </section>
      )}
      {draft.stale && (
        <p role="alert">
          다른 항목의 변경도 부모 버전을 바꿉니다. 기존 입력을 유지하고 최신 버전을 명시 확인해
          주세요.
        </p>
      )}
      {(draft.stale || draft.item) && (
        <button type="button" disabled={blocked || !!draft.command} onClick={() => void latest()}>
          최신 버전으로 검토 갱신
        </button>
      )}
      {project && !plan && (
        <>
          <p>이 프로젝트·연도에는 WBS가 없습니다. WBS는 선택 사항입니다.</p>
          <p>
            WBS를 만든 뒤 제목·설명·계획 일정으로 항목을 추가하세요. 날짜는 미정으로 둘 수 있습니다.
          </p>
          <details className="wbs-optional">
            <summary>계획 메모 (선택){draft.note ? ' · 작성한 내용 있음' : ''}</summary>
            <label>
              WBS 계획 메모
              <textarea
                maxLength={5000}
                value={draft.note}
                disabled={!!draft.command}
                placeholder="필요한 경우에만 계획 전체의 참고 내용을 입력하세요."
                onChange={(e) => update({ ...draft, note: e.target.value })}
              />
            </label>
            <HelpHint label="계획 메모">공란으로 만들 수 있습니다. 최대 5,000자.</HelpHint>
          </details>
          <button
            type="button"
            disabled={blocked || !project.isActive || !!draft.command}
            onClick={() =>
              void perform(
                command(
                  'planCreate',
                  draft.createId,
                  { id: draft.createId, year, note: draft.note || null },
                  draft.createId,
                ),
              )
            }
          >
            이 프로젝트·연도에 WBS 만들기
          </button>
          {!project.isActive && <p>비활성 프로젝트의 새 계획·새 항목 생성은 제한됩니다.</p>}
        </>
      )}
      {plan && (
        <>
          <p>
            계획 버전 {plan.version} · WBS {plan.id}
          </p>
          <div className="wbs-actions">
            <button
              type="button"
              disabled={blocked || !project?.isActive || !!draft.command}
              onClick={() => startItem()}
            >
              WBS 항목 추가
            </button>
            <button
              type="button"
              disabled={blocked || !!draft.command}
              onClick={() => void askDelete()}
            >
              WBS 삭제 영향 확인
            </button>
          </div>
          <details className="wbs-optional" open={draft.noteOpen}>
            <summary>
              계획 메모 (선택){plan.note !== null ? ' · 저장된 내용 있음' : ''}
              {draft.noteVersion !== null ? ' · 검토 초안 있음' : ''}
            </summary>
            <p className="wbs-text">{plan.note ?? '등록된 계획 메모가 없습니다.'}</p>
            <button
              type="button"
              disabled={blocked || !!draft.command}
              onClick={() =>
                replaceDraft('기존 검토 입력을 계획 메모 편집으로 바꿉니다.', () => {
                  update({
                    ...draft,
                    noteOpen: true,
                    note: plan.note ?? '',
                    noteOriginal: plan.note,
                    noteVersion: plan.version,
                    itemOpen: false,
                  });
                  setReplace(null);
                })
              }
            >
              WBS 계획 메모 수정
            </button>
            {draft.noteOpen && (
              <form
                aria-label="WBS 계획 메모 검토"
                onSubmit={(e) => {
                  e.preventDefault();
                  if ((draft.noteOriginal ?? '') === draft.note) {
                    setError('실제 변경이 없습니다.');
                    return;
                  }
                  void perform(
                    command('planPatch', plan.id, {
                      version: draft.noteVersion,
                      note: draft.note || null,
                    }),
                  );
                }}
              >
                <label>
                  WBS 계획 메모
                  <textarea
                    maxLength={5000}
                    value={draft.note}
                    disabled={blocked || !!draft.command}
                    placeholder="필요한 경우에만 계획 전체의 참고 내용을 입력하세요."
                    onChange={(e) => update({ ...draft, note: e.target.value })}
                  />
                </label>
                <button
                  type="submit"
                  className="primary"
                  disabled={blocked || draft.stale || !!draft.command}
                >
                  WBS 계획 메모 저장
                </button>
                <button type="button" onClick={() => update({ ...draft, noteOpen: false })}>
                  계획 메모 검토 닫기 · 초안 유지
                </button>
              </form>
            )}
            {!draft.noteOpen && draft.noteVersion !== null && (
              <button type="button" onClick={() => update({ ...draft, noteOpen: true })}>
                보존한 WBS 계획 메모 검토 다시 열기
              </button>
            )}
          </details>
          {!plan.items.length && (
            <p>등록된 항목이 없습니다. ‘WBS 항목 추가’에서 제목과 계획 일정을 입력하세요.</p>
          )}
          <ul aria-label="WBS 항목 목록" className="wbs-list">
            {plan.items.map((i) => (
              <li key={i.id} id={`wbs-item-${i.id}`} tabIndex={-1}>
                <h3>{i.title}</h3>
                <WbsCompletion
                  key={`${userId}/${companyId}/${i.id}`}
                  companyId={companyId}
                  userId={userId}
                  projectId={plan.projectId}
                  planId={plan.id}
                  itemId={i.id}
                  itemTitle={i.title}
                  itemVersion={i.version}
                  planVersion={plan.version}
                  online={online}
                  disabled={blocked || !!draft.command}
                  expired={expired}
                  onChanged={onReload}
                />
                <WbsWorkLinks
                  companyId={companyId}
                  userId={userId}
                  projectId={plan.projectId}
                  itemId={i.id}
                  itemTitle={i.title}
                  target={{
                    planId: plan.id,
                    planVersion: plan.version,
                    itemId: i.id,
                    itemVersion: i.version,
                  }}
                  disabled={blocked || !!draft.command}
                  expired={expired}
                  onChanged={onReload}
                  autoOpen={itemId === i.id}
                />
                {i.description !== null && <p className="wbs-text">{i.description}</p>}
                <div className="wbs-dates">
                  <div>
                    <strong>원래 계획</strong>
                    <p>{range(i.plannedStartOn, i.plannedEndOn)}</p>
                  </div>
                  <div>
                    <strong>변경 계획</strong>
                    <p>
                      {i.hasRevisedSchedule
                        ? range(i.revisedStartOn, i.revisedEndOn)
                        : '변경 계획 미등록'}
                    </p>
                  </div>
                </div>
                <p>
                  적용 계획 {range(i.effectiveStartOn, i.effectiveEndOn)} · 순서 {i.sortOrder} ·
                  버전 {i.version}
                </p>
                <WbsActualPeriod
                  companyId={companyId}
                  userId={userId}
                  projectId={plan.projectId}
                  planId={plan.id}
                  itemId={i.id}
                  itemTitle={i.title}
                  itemVersion={i.version}
                  planVersion={plan.version}
                  online={online}
                  expired={expired}
                />
                <div className="wbs-actions">
                  <button
                    type="button"
                    disabled={blocked || goalPreparing || !!draft.command}
                    onClick={() => void prepareGoalImport(i)}
                  >
                    주간 목표 초안 가져오기: {i.title}
                  </button>
                  <button
                    type="button"
                    disabled={blocked || !!draft.command}
                    onClick={() => startItem(i)}
                  >
                    수정: {i.title}
                  </button>
                  <button
                    type="button"
                    disabled={blocked}
                    aria-expanded={changes?.id === i.id}
                    aria-controls={`wbs-history-${i.id}`}
                    onClick={() => void historyFor(i)}
                  >
                    일정 변경 이력: {i.title}
                  </button>
                  <button
                    type="button"
                    disabled={blocked || !!draft.command}
                    onClick={() => void askDelete(i)}
                  >
                    삭제 영향 확인: {i.title}
                  </button>
                </div>
                <div id={`wbs-history-${i.id}`} hidden={changes?.id !== i.id}>
                  {changes?.id === i.id && (
                    <section className="wbs-history" aria-label={`일정 변경 이력: ${i.title}`}>
                      <HelpHint label="WBS 일정 이력">
                        WBS 일정 이력입니다. 메타데이터 수정 버전에는 일정 이력이 없어 버전이
                        연속되지 않을 수 있습니다.
                      </HelpHint>
                      <ol>
                        {changes.data.changes.map((c) => (
                          <li key={c.id}>
                            <p>
                              {c.type === 'create' ? '원래 계획 생성' : '변경 계획 저장'} · 버전{' '}
                              {c.itemVersion} ·{' '}
                              {new Date(c.changedAt).toLocaleString('ko-KR', {
                                timeZone: 'Asia/Seoul',
                              })}{' '}
                              (한국 시간)
                            </p>
                            <p>
                              원래 계획{' '}
                              {c.before
                                ? range(c.before.plannedStartOn, c.before.plannedEndOn)
                                : '생성 전'}{' '}
                              → {range(c.after.plannedStartOn, c.after.plannedEndOn)}
                            </p>
                            <p>
                              변경 계획{' '}
                              {c.before?.hasRevisedSchedule
                                ? range(c.before.revisedStartOn, c.before.revisedEndOn)
                                : '미등록'}{' '}
                              →{' '}
                              {c.after.hasRevisedSchedule
                                ? range(c.after.revisedStartOn, c.after.revisedEndOn)
                                : '미등록'}
                            </p>
                            {c.reason !== null && (
                              <p className="wbs-text">
                                사유: {c.reason === '' ? '빈 사유' : c.reason}
                              </p>
                            )}
                          </li>
                        ))}
                      </ol>
                      {!changes.data.changes.length && (
                        <p>반환된 일정 이력이 없습니다. 업무 이력으로 보충하지 않습니다.</p>
                      )}
                    </section>
                  )}
                </div>
              </li>
            ))}
          </ul>
        </>
      )}
      {goalPreparing && <p role="status">WBS 목표 원본을 확인하고 있습니다.</p>}
      {goalImport && (
        <dialog
          ref={goalImportDialog}
          className="goal-import-dialog"
          role="dialog"
          aria-modal="true"
          aria-labelledby="wbs-goal-import-title"
          onCancel={(e) => {
            e.preventDefault();
            setGoalImport(null);
          }}
        >
          <h2 id="wbs-goal-import-title">WBS 목표 가져오기 검토</h2>
          <p>
            {goalImport.projectCode} · {goalImport.year}년 · {goalImport.title}
          </p>
          <p>
            제목만 목표 초안으로 가져옵니다. 목표 메모는 독립 입력이며 WBS 본문을 복사하지 않습니다.
            업무·날짜·주간 분모는 만들지 않습니다.
          </p>
          <label>
            가져올 목표 주 날짜
            <input
              type="date"
              value={goalDate}
              disabled={blocked}
              onChange={(e) => setGoalDate(e.target.value)}
            />
          </label>
          <p>이동 후 기존 목표 입력을 확인하고 목표 저장을 따로 실행해야 합니다.</p>
          {error && <p role="alert">{error}</p>}
          <button type="button" data-safe-cancel onClick={() => setGoalImport(null)}>
            WBS 목표 가져오기 취소
          </button>
          <button type="button" className="primary" disabled={blocked} onClick={stageGoalImport}>
            목표 초안 준비 후 이동
          </button>
          <a className="control-link" href={`/c/${companyId}/goals?date=${goalDate}`}>
            보존한 목표 초안 확인
          </a>
        </dialog>
      )}
      {draft.item && draft.itemOpen && (
        <WbsItemEditor
          value={draft.item}
          onChange={(item) => update({ ...draft, item })}
          onSave={saveItem}
          onClose={() => {
            update({ ...draft, itemOpen: false });
            restore();
          }}
          disabled={blocked || draft.stale || !!draft.command}
          originalLabel={
            draft.original
              ? `원래 계획 ${range(draft.original.plannedStartOn, draft.original.plannedEndOn)} · 항목 버전 ${draft.original.version} · 부모 버전 ${draft.planVersion}`
              : `새 항목 ID ${draft.item.id} · 부모 버전 ${draft.planVersion}`
          }
        />
      )}
      {draft.item && !draft.itemOpen && (
        <button type="button" onClick={() => update({ ...draft, itemOpen: true })}>
          보존한 WBS 항목 검토 다시 열기
        </button>
      )}
      {preview && (
        <dialog
          onCancel={(e) => {
            e.preventDefault();
            if (!busy) {
              setPreview(null);
              setReplace(null);
              restore();
            }
          }}
          ref={dialog}
          tabIndex={-1}
          role="alertdialog"
          aria-modal="true"
          aria-labelledby="wbs-delete-title"
          aria-describedby="wbs-delete-desc"
          className="wbs-dialog"
        >
          <h2 id="wbs-delete-title">WBS 삭제 확인</h2>
          <p id="wbs-delete-desc">
            {preview.title} · {preview.data.id}. 공식 WBS 대상과 전용 일정·완료 이력을 삭제합니다.
            실제 업무·확정 과거보고·기존 목표 배치 영수증은 보존됩니다.
          </p>
          <p>
            {'itemCount' in preview.data.impact
              ? `항목 ${preview.data.impact.itemCount}개 · `
              : '항목 1개 · '}
            일정 이력 {preview.data.impact.historyCount}건 · 완료 이력{' '}
            {preview.data.impact.completionHistoryCount}건
          </p>
          <p>
            현재 업무 연결 {preview.data.impact.workLinkCount}개를 해제하며 실제 업무{' '}
            {preview.data.impact.workCount}개는 보존합니다. 목표 원본 참조{' '}
            {preview.data.impact.goalCount}개는 삭제됨으로 전환하고 목표 내용은 보존합니다.
            보고·영수증·실제기간 연결 수는 미지원입니다. 목표 수·완료 이력 수 또는 버전이 달라지면
            다시 확인해야 하며 같은 수의 목표 신원까지 고정하지 않습니다.
          </p>
          <p>확인 문구: {preview.data.confirmText}</p>
          <label>
            WBS 삭제 확인 문구
            <input value={confirmText} onChange={(e) => setConfirmText(e.target.value)} />
          </label>
          <button
            type="button"
            disabled={busy}
            onClick={() => {
              setPreview(null);
              restore();
            }}
          >
            WBS 삭제 취소
          </button>
          <button
            type="button"
            disabled={blocked || !!draft.command || confirmText !== preview.data.confirmText}
            onClick={deleteBody}
          >
            영향을 확인하고 WBS 삭제
          </button>
        </dialog>
      )}
      {replace && (
        <dialog
          onCancel={(e) => {
            e.preventDefault();
            if (!busy) {
              setPreview(null);
              setReplace(null);
              restore();
            }
          }}
          ref={dialog}
          tabIndex={-1}
          role="alertdialog"
          aria-modal="true"
          aria-label="WBS 입력 교체 확인"
          className="wbs-dialog"
        >
          <p>{replace.label} 현재 검토 초안을 명시적으로 교체합니다.</p>
          <button
            type="button"
            onClick={() => {
              setReplace(null);
              restore();
            }}
          >
            기존 WBS 입력 유지
          </button>
          <button type="button" onClick={replace.run}>
            WBS 검토 입력 교체
          </button>
        </dialog>
      )}
    </section>
  );
}
