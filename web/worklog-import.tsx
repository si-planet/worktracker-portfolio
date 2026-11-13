import './worklog-import.css';
import { RefreshButton } from './ui-controls';
import { WorklogSourceReview } from './worklog-source-review';
import { useEffect, useRef, useState, type ChangeEvent } from 'react';
import { z } from 'zod';
import {
  verifyWorklogImportPackage,
  worklogPackageRowPreview,
  type WorklogImportPackage,
  type WorklogPackageRow,
} from '../shared/schema/worklog-import-package';
import {
  zWorklogMapping,
  zWorklogMaterialize,
  type WorklogMapping,
} from '../shared/schema/worklog-import';
import {
  zWorkspaceCompany,
  zWorkspaceProject,
  type WorkspaceCompany,
  type WorkspaceProject,
} from '../shared/schema/workspace';
import { zAdminWorkTag, type AdminWorkTag } from '../shared/schema/tags';
import { workApi, WorkFailure, workError } from './work-entry-api';
import {
  beginImport,
  sendImportChunk,
  readImportRun,
  observeImportChunk,
  validateImport,
  dryRunImport,
  materializeImport,
  readImportReceipt,
  readExistingImportReceipt,
  readImportSummaries,
  type ImportRun,
  type ImportReceipt,
  type ImportDryRun,
  type ImportSummaries,
} from './worklog-import-api';

const zPending = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('begin') }),
  z.strictObject({ kind: z.literal('chunk'), index: z.number().int().min(0).max(1499) }),
  z.strictObject({ kind: z.literal('validate'), expectedRunVersion: z.number().int().positive() }),
  z.strictObject({ kind: z.literal('materialize'), input: zWorklogMaterialize }),
]);
const zFields = z.strictObject({
  kind: z.string().max(10),
  status: z.string().max(10),
  projectId: z.string().max(36),
  tagIds: z.array(z.uuid()).max(16),
  decisionRef: z.string().max(500),
  acknowledged: z.boolean(),
});
const zDraft = z.strictObject({
  packageId: z.uuid(),
  runId: z.uuid(),
  sourceSha256: z.string().regex(/^[0-9a-f]{64}$/),
  manifestHash: z.string().regex(/^[0-9a-f]{64}$/),
  fields: z.record(z.string(), zFields),
  mappings: z.record(z.string(), zWorklogMapping),
  pending: zPending.nullable(),
  lastReviewedCommand: zPending.nullable().default(null),
});
type Draft = z.output<typeof zDraft>;
type Fields = z.output<typeof zFields>;
const blank = (): Fields => ({
  kind: '',
  status: '',
  projectId: '',
  tagIds: [],
  decisionRef: '',
  acknowledged: false,
});
const checkLabel = (s: string) =>
  ({ checked: '체크됨', unchecked: '미체크', blank: '체크 빈칸' })[s] ?? s;
function load(key: string): Draft | null {
  try {
    return zDraft.parse(JSON.parse(sessionStorage.getItem(key) ?? 'null'));
  } catch {
    return null;
  }
}
function packageMatches(d: Draft, p: WorklogImportPackage) {
  return (
    d.packageId === p.packageId &&
    d.runId === p.begin.id &&
    d.sourceSha256 === p.begin.sourceSha256 &&
    d.manifestHash === p.begin.manifestHash
  );
}
function validMapping(p: WorklogImportPackage, m: WorklogMapping) {
  const row = p.rows.find((r) => r.rowId === m.rowId);
  return (
    row?.section === 'daily' &&
    row.interpretationId === m.interpretationId &&
    row.entryCandidateId === m.entryId &&
    row.sourceCompletionState === m.acknowledgedSourceState
  );
}
function validDraft(p: WorklogImportPackage, d: Draft) {
  if (!Object.values(d.mappings).every((m) => validMapping(p, m))) return false;
  const c = d.pending;
  if (c?.kind === 'chunk') return !!p.chunks[c.index];
  if (c?.kind === 'materialize')
    return (
      validMapping(p, c.input.mapping) &&
      p.rows.find((r) => r.rowId === c.input.mapping.rowId)?.materializeCommandId === c.input.id
    );
  return true;
}
const text = (v: unknown) => (typeof v === 'string' ? v : JSON.stringify(v));
export function WorklogImportPage(props: { companyId: string; userId: string }) {
  return <WorklogImportSession key={`${props.userId}:${props.companyId}`} {...props} />;
}
function WorklogImportSession({ companyId, userId }: { companyId: string; userId: string }) {
  const key = `wt:worklog-import:v1:${encodeURIComponent(userId)}:${companyId}`;
  const [draft, setDraft] = useState(() => load(key)),
    [pkg, setPkg] = useState<WorklogImportPackage | null>(null),
    [run, setRun] = useState<ImportRun | null>(null),
    [absent, setAbsent] = useState(false),
    [retry, setRetry] = useState(false),
    [canReview, setCanReview] = useState(false),
    [denied, setDenied] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [message, setMessage] = useState(''),
    [online, setOnline] = useState(navigator.onLine),
    [dry, setDry] = useState<ImportDryRun | null>(null),
    [receipts, setReceipts] = useState<Record<string, ImportReceipt>>({}),
    [summaries, setSummaries] = useState<ImportSummaries | null>(null);
  const [masters, setMasters] = useState<{
    company: WorkspaceCompany;
    projects: WorkspaceProject[];
    tags: AdminWorkTag[];
  } | null>(null);
  const current = useRef(draft),
    alive = useRef(true),
    revision = useRef(0),
    lock = useRef(false),
    file = useRef<HTMLInputElement>(null),
    stop = useRef(false);
  current.current = draft;
  const blocked = busy || !online || denied || !masters;
  function store(d: Draft | null) {
    if (d) sessionStorage.setItem(key, JSON.stringify(zDraft.parse(d)));
    else sessionStorage.removeItem(key);
    current.current = d;
    setDraft(d);
  }
  function bindRun(id: string) {
    const u = new URL(location.href);
    u.search = '';
    u.searchParams.set('runId', id);
    history.replaceState(null, '', u.pathname + u.search);
  }
  function fail(e: unknown) {
    setDry(null);
    setRetry(false);
    setCanReview(false);
    if (e instanceof WorkFailure && e.status === 401) {
      const params = new URLSearchParams();
      const id = current.current?.runId;
      if (id) params.set('runId', id);
      location.assign(
        `/login?${new URLSearchParams({ returnTo: `/c/${companyId}/worklog-import${params.size ? `?${params}` : ''}` })}`,
      );
      return;
    }
    if (e instanceof WorkFailure && e.status === 403) {
      setDenied(true);
      setMasters(null);
      setPkg(null);
      setRun(null);
      setReceipts({});
      setSummaries(null);
      setMessage('');
    }
    setError(
      e instanceof WorkFailure && e.status === 409
        ? '회차·매핑 또는 기존 등록 결과가 다릅니다. 고정 ID를 유지했습니다. 결과를 조회한 뒤 다시 검토해 주세요.'
        : e instanceof WorkFailure && e.status === 404
          ? '현재 조회에서 기록을 찾지 못했습니다. 과거 성공·실패를 확정하지 않습니다.'
          : workError(e),
    );
  }
  async function act(fn: (ticket: number) => Promise<void>) {
    if (lock.current || !online || denied) return;
    lock.current = true;
    setBusy(true);
    setError('');
    setMessage('');
    stop.current = false;
    const t = ++revision.current;
    try {
      await fn(t);
    } catch (e) {
      if (alive.current && t === revision.current) fail(e);
    } finally {
      lock.current = false;
      if (alive.current && t === revision.current) setBusy(false);
    }
  }
  function live(t: number) {
    return alive.current && revision.current === t;
  }
  async function metadata(t: number) {
    const [company, projects, tags] = await Promise.all([
      workApi(
        `/api/companies/${companyId}`,
        zWorkspaceCompany.refine((v) => v.id === companyId),
      ),
      workApi(
        `/api/companies/${companyId}/projects`,
        z
          .array(zWorkspaceProject)
          .refine(
            (v) =>
              v.every((x) => x.companyId === companyId) &&
              new Set(v.map((x) => x.id)).size === v.length,
          ),
      ),
      workApi(
        `/api/companies/${companyId}/work-tags?includeInactive=true`,
        z
          .array(zAdminWorkTag)
          .refine(
            (v) =>
              v.every((x) => x.companyId === null || x.companyId === companyId) &&
              new Set(v.map((x) => x.id)).size === v.length,
          ),
      ),
    ]);
    if (live(t)) {
      setMasters({ company, projects, tags });
      setDry(null);
    }
  }
  useEffect(() => {
    alive.current = true;
    const t = ++revision.current;
    setBusy(true);
    void metadata(t)
      .catch((e) => {
        if (live(t)) fail(e);
      })
      .finally(() => {
        if (live(t)) setBusy(false);
      });
    const change = () => setOnline(navigator.onLine);
    window.addEventListener('online', change);
    window.addEventListener('offline', change);
    return () => {
      alive.current = false;
      revision.current++;
      window.removeEventListener('online', change);
      window.removeEventListener('offline', change);
    };
  }, [key]);
  async function choose(event: ChangeEvent<HTMLInputElement>) {
    const selected = event.target.files?.[0];
    event.target.value = '';
    if (!selected || blocked) return;
    await act(async (t) => {
      const p = await verifyWorklogImportPackage(JSON.parse(await selected.text()));
      if (!live(t)) return;
      const queryId = new URLSearchParams(location.search).get('runId'),
        old = current.current;
      if (
        (queryId && queryId !== p.begin.id) ||
        (old && (!packageMatches(old, p) || !validDraft(p, old)))
      ) {
        setError(
          '보존한 회차와 다른 패키지입니다. 기존 고정 명령은 유지했습니다. 같은 파일을 선택하거나 결과 확인 후 초안을 명시 폐기해 주세요.',
        );
        return;
      }
      if (!old)
        store({
          packageId: p.packageId,
          runId: p.begin.id,
          sourceSha256: p.begin.sourceSha256,
          manifestHash: p.begin.manifestHash,
          fields: {},
          mappings: {},
          pending: null,
          lastReviewedCommand: null,
        });
      setPkg(p);
      setRun(null);
      setAbsent(false);
      setRetry(false);
      setDry(null);
      setReceipts({});
      setSummaries(null);
      bindRun(p.begin.id);
      try {
        const r = await readImportRun(companyId, p.begin.id, p);
        if (live(t)) {
          setRun(r);
          setMessage('패키지를 검증하고 기존 회차를 조회했습니다. 자동 등록하지 않습니다.');
        }
      } catch (e) {
        if (!live(t)) return;
        if (e instanceof WorkFailure && e.status === 404) {
          setAbsent(true);
          setMessage(
            '패키지 검증 완료 · 현재 회차 조회에서 기록이 없습니다. 원장 등록 시작은 별도 버튼으로 실행하세요.',
          );
        } else throw e;
      }
    });
  }
  async function execute(kind: 'begin' | 'chunks' | 'validate', t: number) {
    if (!pkg || !current.current) return;
    const p = pkg;
    let r = run;
    if (kind === 'begin') {
      store({ ...current.current, pending: { kind: 'begin' } });
      setRetry(false);
      r = await beginImport(companyId, p);
      if (!live(t)) return;
      store({ ...current.current!, pending: null });
      setRun(r);
      setAbsent(false);
      setMessage('원장 회차를 확인했습니다. 실제 업무는 아직 생성하지 않았습니다.');
    }
    if (kind === 'chunks') {
      if (!r || r.state !== 'staging') return;
      for (let index = r.version - 1; index < p.chunks.length; index++) {
        if (!live(t) || stop.current || !navigator.onLine) break;
        store({ ...current.current!, pending: { kind: 'chunk', index } });
        setRetry(false);
        const result = await sendImportChunk(companyId, p, index);
        if (!live(t)) return;
        r = result.run;
        store({ ...current.current!, pending: null });
        setRun(r);
        setMessage(`원장 묶음 ${index + 1}/${p.chunks.length}개 확인 · 실제 업무 생성 전`);
        if (r.version !== index + 2 || r.state !== 'staging') break;
      }
    }
    if (kind === 'validate') {
      if (!r) return;
      const expectedRunVersion = r.version;
      store({ ...current.current, pending: { kind: 'validate', expectedRunVersion } });
      setRetry(false);
      const result = await validateImport(companyId, p, {
        expectedRunVersion,
        manifestHash: p.begin.manifestHash,
      });
      if (!live(t)) return;
      setRun(result);
      store({ ...current.current!, pending: null });
      setMessage('서버 원장 검증을 확인했습니다. 실제 업무 등록 전 매핑 사전검사를 실행하세요.');
    }
  }
  async function recover(t: number) {
    const d = current.current,
      id = d?.runId ?? new URLSearchParams(location.search).get('runId');
    if (!id) {
      setError('회차 ID 또는 같은 패키지를 먼저 선택해 주세요.');
      return;
    }
    z.uuid().parse(id);
    setRetry(false);
    setCanReview(false);
    setAbsent(false);
    let r: ImportRun;
    try {
      r = await readImportRun(companyId, id, pkg ?? undefined);
    } catch (e) {
      if (live(t) && e instanceof WorkFailure && e.status === 404) {
        setRun(null);
        setAbsent(true);
        if (d?.pending?.kind === 'begin' && pkg) setRetry(true);
        setMessage(
          '현재 회차 조회에 기록이 없습니다. 과거 실패를 확정하지 않습니다. 재시도는 같은 ID로 직접 실행하세요.',
        );
        return;
      }
      throw e;
    }
    if (!live(t)) return;
    setRun(r);
    if (!pkg || !d) {
      setMessage(
        '회차 상태를 조회했습니다. 원문·고정 명령 검토에는 같은 로컬 패키지를 다시 선택해 주세요.',
      );
      return;
    }
    const pending = d.pending;
    if (pending?.kind === 'begin') {
      store({ ...d, pending: null });
      setMessage('같은 문서·원본 해시의 회차를 확인했습니다.');
    } else if (pending?.kind === 'chunk') {
      try {
        const observed = await observeImportChunk(companyId, pkg, pending.index);
        if (!live(t)) return;
        setRun(observed.run);
        store({ ...d, pending: null });
        setMessage(
          '같은 고정 묶음의 payload·적용 버전을 확인했습니다. 다음 전송은 직접 실행해 주세요.',
        );
      } catch (e) {
        if (e instanceof WorkFailure && e.status === 404) {
          if (live(t)) {
            setRetry(
              r.state === 'staging' && r.version === pkg.chunks[pending.index]?.expectedRunVersion,
            );
            setMessage(
              '소유 회차는 존재하지만 현재 고정 묶음은 관측되지 않았습니다. 같은 묶음의 명시 재시도만 허용합니다.',
            );
          }
        } else throw e;
      }
    } else if (pending?.kind === 'validate') {
      if (r.state === 'validated') {
        store({ ...d, pending: null });
        setMessage(
          '현재 서버 원장이 검증된 상태임을 확인했습니다. 과거 실행 주체는 단정하지 않습니다.',
        );
      } else {
        setRetry(r.version === pending.expectedRunVersion);
        setMessage(
          '현재 원장은 검증 전입니다. 버전이 같을 때 같은 입력으로 직접 재시도할 수 있습니다.',
        );
      }
    } else if (pending?.kind === 'materialize') {
      try {
        const receipt = await readImportReceipt(companyId, pkg, pending.input.mapping);
        if (!live(t)) return;
        setReceipts((v) => ({ ...v, [receipt.rowId]: receipt }));
        store({ ...d, pending: null });
        setMessage(
          '고정 명령·매핑과 같은 최초 영수증을 확인했습니다. 현재 편집·삭제 상태는 별도로 표시합니다.',
        );
      } catch (e) {
        if (e instanceof WorkFailure && e.status === 404) {
          if (live(t)) {
            setRetry(r.state === 'validated' && r.version === pending.input.expectedRunVersion);
            setCanReview(r.state === 'validated');
            setMessage(
              '소유 회차에서 현재 고정 영수증을 찾지 못했습니다. 과거 실패를 단정하지 않으며 버전이 같을 때 같은 명령으로 직접 재시도할 수 있습니다.',
            );
          }
        } else throw e;
      }
    } else {
      if (r.state === 'validated')
        for (const row of pkg.rows.filter((x) => x.section === 'daily')) {
          if (!live(t) || stop.current) break;
          try {
            const receipt = await readExistingImportReceipt(companyId, pkg, row.rowId);
            if (live(t)) setReceipts((v) => ({ ...v, [row.rowId]: receipt }));
          } catch (e) {
            if (!(e instanceof WorkFailure && e.status === 404)) throw e;
          }
        }
      if (live(t))
        setMessage(
          '현재 회차와 관측 가능한 일간 영수증을 조회했습니다. 원문 전체는 로컬 패키지 미리보기이며 영수증과 구별합니다.',
        );
    }
  }
  async function retryPending(t: number) {
    const d = current.current;
    if (!d?.pending || !pkg || !retry) return;
    const pending = d.pending;
    setRetry(false);
    if (pending.kind === 'begin') await execute('begin', t);
    else if (pending.kind === 'chunk') {
      const v = await sendImportChunk(companyId, pkg, pending.index);
      if (live(t)) {
        setRun(v.run);
        store({ ...d, pending: null });
        setMessage('같은 고정 묶음의 명시 재시도 결과를 확인했습니다.');
      }
    } else if (pending.kind === 'validate') {
      const v = await validateImport(companyId, pkg, {
        expectedRunVersion: pending.expectedRunVersion,
        manifestHash: pkg.begin.manifestHash,
      });
      if (live(t)) {
        setRun(v);
        store({ ...d, pending: null });
        setMessage('동일 검증 입력의 현재 결과를 확인했습니다.');
      }
    } else await saveMappingReceipt(pending.input, t);
  }
  function editFields(rowId: string, f: Fields) {
    if (!current.current || current.current.pending) return;
    const mappings = { ...current.current.mappings };
    delete mappings[rowId];
    store({ ...current.current, fields: { ...current.current.fields, [rowId]: f }, mappings });
    setDry(null);
  }
  function applyMapping(row: WorklogPackageRow) {
    const d = current.current;
    if (!d || !masters || d.pending || receipts[row.rowId]) return;
    try {
      const f = d.fields[row.rowId] ?? blank(),
        project = masters.projects.find(
          (x) => x.id === f.projectId && x.isActive && x.code === row.projectCode,
        );
      if (!f.acknowledged || !project) throw new Error('EXPLICIT_MAPPING_REQUIRED');
      const tags = f.tagIds.map((id) => {
        const tag = masters.tags.find(
          (x) => x.id === id && x.isActive && x.companyId === companyId,
        );
        if (!tag) throw new Error('INACTIVE_TAG');
        return { id: tag.id, version: tag.version };
      });
      const mapping = zWorklogMapping.parse({
        rowId: row.rowId,
        interpretationId: row.interpretationId,
        interpretationVersion: 1,
        entryId: row.entryCandidateId,
        kind: f.kind,
        project: { id: project.id, version: project.version },
        tags,
        status: f.status,
        acknowledgedSourceState: row.sourceCompletionState,
        decisionRef: f.decisionRef,
      });
      store({ ...d, mappings: { ...d.mappings, [row.rowId]: mapping } });
      setDry(null);
      setError('');
      setMessage('명시 매핑을 보존했습니다. 사전검사와 실제 등록은 각각 별도 실행입니다.');
    } catch {
      setError(
        '종류·상태·같은 코드의 활성 프로젝트·회사 태그·체크 확인과 선택 근거를 직접 입력해 주세요. 원문 체크만으로 상태를 자동 선택하지 않습니다.',
      );
    }
  }
  async function inspect(t: number) {
    if (!pkg || !run || !current.current || current.current.pending) return;
    setDry(null);
    const mappings = Object.values(current.current.mappings).filter((m) => !receipts[m.rowId]);
    if (!mappings.length) {
      setError('등록할 일간의 명시 매핑을 먼저 적용해 주세요.');
      return;
    }
    // Each bounded request stays under the unchanged 8KiB HTTP limit, even for 90 mappings.
    const results: ImportDryRun['results'] = pkg.rows.map((r) => ({
      rowId: r.rowId,
      state: r.section === 'weeklySummary' ? 'summary' : 'hold',
      reason:
        r.section === 'weeklySummary'
          ? '주간 요약은 업무로 생성하지 않습니다.'
          : '명시 매핑이 없거나 이미 영수증을 조회한 행입니다.',
    }));
    let version: number | null = null;
    for (const mapping of mappings) {
      if (!live(t) || stop.current) return;
      const v = await dryRunImport(companyId, pkg, [mapping]);
      if (!live(t)) return;
      if (version !== null && version !== v.version) throw new WorkFailure(409, 'IMPORT_CHANGED');
      version = v.version;
      const result = v.results.find((r) => r.rowId === mapping.rowId)!;
      results[results.findIndex((r) => r.rowId === mapping.rowId)] = result;
    }
    if (version !== run.version) throw new WorkFailure(409, 'IMPORT_CHANGED');
    setDry({ runId: pkg.begin.id, version: version!, results });
    setMessage(
      `매핑 ${mappings.length}개 사전검사를 확인했습니다. 아직 실제 업무는 생성하지 않았습니다.`,
    );
  }
  async function saveMappingReceipt(input: z.output<typeof zWorklogMaterialize>, t: number) {
    if (!pkg || !current.current) return;
    store({ ...current.current, pending: { kind: 'materialize', input } });
    setRetry(false);
    const receipt = await materializeImport(companyId, pkg, input);
    if (!live(t)) return;
    setReceipts((v) => ({ ...v, [receipt.rowId]: receipt }));
    store({ ...current.current!, pending: null });
    setDry(null);
    setRun(null);
    setMessage('같은 ID의 최초 등록 영수증을 확인했습니다. 현재 상태와 별도로 보존됩니다.');
    const latest = await readImportRun(companyId, pkg.begin.id, pkg);
    if (live(t)) setRun(latest);
  }
  async function materialize(row: WorklogPackageRow, t: number) {
    const d = current.current,
      m = d?.mappings[row.rowId];
    if (
      !pkg ||
      !run ||
      !d ||
      !m ||
      d.pending ||
      receipts[row.rowId] ||
      dry?.version !== run.version ||
      dry.results.find((r) => r.rowId === row.rowId)?.state !== 'ready'
    )
      return;
    const latest = await readImportRun(companyId, pkg.begin.id, pkg);
    if (!live(t)) return;
    setRun(latest);
    if (latest.version !== run.version) throw new WorkFailure(409, 'IMPORT_CHANGED');
    try {
      const receipt = await readExistingImportReceipt(companyId, pkg, row.rowId);
      if (live(t)) {
        setReceipts((v) => ({ ...v, [row.rowId]: receipt }));
        setDry(null);
        setMessage(
          '이 행에는 기존 영수증이 있습니다. 새 업무를 만들지 않았습니다. 최초 매핑·현재 편집/삭제 결과를 확인해 주세요.',
        );
      }
      return;
    } catch (e) {
      if (!(e instanceof WorkFailure && e.status === 404)) throw e;
    }
    if (live(t))
      await saveMappingReceipt(
        { id: row.materializeCommandId!, expectedRunVersion: run.version, mapping: m },
        t,
      );
  }
  if (denied)
    return (
      <section className="workspace">
        <h1>등록 접근 제한</h1>
        <p role="alert">
          접근할 수 없는 회사 또는 회차입니다. 원문·매핑·결과를 숨겼으며 삭제나 과거 성공을 확정하지
          않습니다.
        </p>
        <a className="control-link" href="/">
          회사 선택
        </a>
      </section>
    );
  return (
    <section className="workspace worklog-import" aria-label="업무일지 패키지 등록">
      <nav className="workspace-nav" aria-label="등록 메뉴">
        <a className="control-link" href={`/c/${companyId}`}>
          회사 작업공간
        </a>
        <a className="control-link" href={`/c/${companyId}/week`}>
          주간 보기
        </a>
        <a className="control-link" href="/">
          회사 선택
        </a>
      </nav>
      <h1>초기 자료 이전 · 전용 도구</h1>
      <p>
        처음 기록을 옮길 때만 사용하는 도구입니다. 평소 기록은 업무 화면에서 작성하고, 보관·이전은
        기록 내보내기를 이용하세요.
      </p>
      <p>{masters?.company.name ?? '회사 확인 중'}</p>
      <p>
        기존 계정 연결은 아직 사용할 수 없습니다. 실제 출처·목적 환경의 설치·정책이 채택되지 않아 이
        화면에서 계정을 연결하거나 메일·비밀번호를 요청하지 않습니다.
      </p>
      <p>
        원장은 주간 요약과 일간 원문을 보존합니다. 실제 업무는 매핑 사전검사 후 선택한 일간만 명시
        등록합니다. 제목·본문에서 상태를 추론하거나 이관용 태그를 추가하지 않습니다.
      </p>
      <WorklogSourceReview
        companyId={companyId}
        userId={userId}
        onAccessLost={() => {
          revision.current++;
          stop.current = true;
          current.current = null;
          setDraft(null);
          setPkg(null);
          setRun(null);
          setReceipts({});
          setSummaries(null);
          setMasters(null);
          setDry(null);
          setMessage('');
          setError('');
          setRetry(false);
          setCanReview(false);
          setAbsent(false);
          setBusy(false);
          setDenied(true);
        }}
      />
      {error && (
        <p className="form-message" role="alert">
          {error}
        </p>
      )}
      {message && <p role="status">{message}</p>}
      {busy && <p role="status">검증·조회·명시 요청을 처리하고 있습니다.</p>}
      {!online && <p role="status">오프라인 읽기 전용입니다. 자동 전송·재시도하지 않습니다.</p>}
      <RefreshButton
        type="button"
        disabled={busy || !online}
        onClick={() => void act(metadata)}
        busy={!!busy}
      >
        회사·매핑 선택 목록 다시 조회
      </RefreshButton>
      <label>
        검증할 로컬 패키지 파일
        <input
          ref={file}
          type="file"
          accept="application/json,.json"
          disabled={blocked}
          onChange={(e) => void choose(e)}
        />
      </label>
      <p className="field-hint">
        {pkg
          ? `선택한 로컬 패키지는 시트 ${pkg.begin.counts.sheet}개·원문 ${pkg.begin.counts.row}행입니다. `
          : '로컬 패키지를 선택하면 실제 원문 수와 해시를 확인할 수 있습니다. '}
        아래 업로드 미리보기는 브라우저 메모리에서 열며 다시 열 때 같은 파일을 선택합니다.
      </p>
      {draft && (
        <>
          <p>보존한 회차 ID {draft.runId} · 고정 ID는 재발급하지 않습니다.</p>
          <RefreshButton
            type="button"
            disabled={blocked}
            onClick={() => void act(recover)}
            showLabel
          >
            등록 결과 다시 조회
          </RefreshButton>
          <button
            type="button"
            disabled={blocked || !!draft.pending}
            onClick={() => {
              try {
                store(null);
                setPkg(null);
                setRun(null);
                setDry(null);
                setReceipts({});
                setSummaries(null);
                setAbsent(false);
                history.replaceState(null, '', `/c/${companyId}/worklog-import`);
                setMessage(
                  '로컬 초안만 명시 폐기했습니다. 서버 원장·업무·영수증은 삭제하지 않았습니다.',
                );
              } catch (e) {
                fail(e);
              }
            }}
          >
            보존한 등록 초안 명시 폐기
          </button>
        </>
      )}
      {!draft && new URLSearchParams(location.search).has('runId') && (
        <RefreshButton type="button" disabled={blocked} onClick={() => void act(recover)}>
          회차 상태 다시 조회
        </RefreshButton>
      )}
      {draft?.pending && (
        <section aria-label="등록 명령 결과 확인">
          <h2>결과 확인 필요</h2>
          <p>
            {draft.pending.kind} 고정 명령을 보존했습니다. 같은 패키지를 선택하고 안전 조회 뒤 직접
            재시도하세요.
          </p>
          <button
            type="button"
            disabled={blocked || !pkg || !retry}
            onClick={() => void act(retryPending)}
          >
            관측한 같은 명령 명시 재시도
          </button>
          <button
            type="button"
            disabled={blocked || !pkg || !canReview}
            onClick={() => {
              const d = current.current;
              if (!d?.pending || d.pending.kind !== 'materialize' || !canReview) return;
              store({ ...d, lastReviewedCommand: d.pending, pending: null });
              setRetry(false);
              setCanReview(false);
              setDry(null);
              setMessage(
                '현재 영수증 부재를 관측한 원명령을 보존했습니다. 과거 실패를 확정하지 않습니다. 매핑과 현재 버전을 다시 검토한 뒤 같은 고정 ID로 사전검사·명시 등록해 주세요.',
              );
            }}
          >
            관측한 미반영 일간 명령 다시 검토
          </button>
        </section>
      )}
      {draft?.lastReviewedCommand?.kind === 'materialize' && (
        <p>
          이전 고정 명령 {draft.lastReviewedCommand.input.id} · 당시 회차 버전{' '}
          {draft.lastReviewedCommand.input.expectedRunVersion}의 입력을 보존했습니다.
        </p>
      )}
      {run && (
        <section aria-label="서버 등록 회차">
          <h2>서버 회차</h2>
          <p>
            {run.state === 'validated' ? '원장 검증됨' : '원장 수집 중'} · 버전 {run.version} · 받은
            원장 {run.receivedBytes} bytes
          </p>
          <p>원장 수집·검증 완료와 실제 일간 업무 등록 완료는 다릅니다.</p>
        </section>
      )}
      {pkg && draft && (
        <>
          <section aria-label="로컬 패키지 미리보기">
            <h2>선택한 패키지</h2>
            <p>
              주간 요약 {pkg.summary.weeklySummaries}행 · 일간 {pkg.summary.daily}행 · 전체{' '}
              {pkg.rows.length}행 · 원문 셀 {pkg.begin.counts.cell}개
            </p>
            <p>
              체크됨 {pkg.summary.checked} · 미체크 {pkg.summary.unchecked} · 체크 빈칸{' '}
              {pkg.summary.blank} · 일간 체크 빈칸 {pkg.summary.dailyBlank}
            </p>
            <p>
              원장 {pkg.begin.expectedBytes} bytes / 16MiB · 묶음 {pkg.chunks.length}개 · 최대
              16항목/128KiB씩
            </p>
            <p>원본 SHA-256 {pkg.begin.sourceSha256}</p>
            <p>원장 manifest {pkg.begin.manifestHash}</p>
            <p>후보 업무 ID는 아직 저장됐다는 뜻이 아닙니다.</p>
          </section>
          <div className="workspace-inline">
            <button
              type="button"
              disabled={blocked || !!draft.pending || !!run || !absent}
              onClick={() => void act((t) => execute('begin', t))}
            >
              원장 등록 시작
            </button>
            <button
              type="button"
              disabled={
                blocked ||
                !!draft.pending ||
                !run ||
                run.state !== 'staging' ||
                run.version > pkg.chunks.length
              }
              onClick={() => void act((t) => execute('chunks', t))}
            >
              남은 원장 묶음 전송
            </button>
            <button
              type="button"
              disabled={
                blocked ||
                !!draft.pending ||
                !run ||
                run.state !== 'staging' ||
                run.version !== pkg.chunks.length + 1 ||
                run.receivedBytes !== pkg.begin.expectedBytes
              }
              onClick={() => void act((t) => execute('validate', t))}
            >
              서버 원장 검증
            </button>
            <button
              type="button"
              disabled={blocked || !!draft.pending || run?.state !== 'validated'}
              onClick={() => void act(inspect)}
            >
              선택 매핑 사전검사
            </button>
            <RefreshButton
              type="button"
              disabled={blocked || run?.state !== 'validated'}
              onClick={() =>
                void act(async (t) => {
                  const v = await readImportSummaries(companyId, pkg);
                  if (live(t)) setSummaries(v);
                })
              }
            >
              등록된 주간 요약 조회
            </RefreshButton>
            {busy && (
              <button
                type="button"
                onClick={() => {
                  stop.current = true;
                  setMessage('진행 중 요청의 결과를 기다린 뒤 다음 묶음·조회부터 중단합니다.');
                }}
              >
                현재 요청 뒤 중단
              </button>
            )}
          </div>
          {dry && (
            <section aria-label="매핑 사전검사 결과">
              <h2>매핑 사전검사 결과</h2>
              <p>
                등록 가능 {dry.results.filter((r) => r.state === 'ready').length}행 · 보류{' '}
                {dry.results.filter((r) => r.state === 'hold').length}행 · 주간 요약{' '}
                {dry.results.filter((r) => r.state === 'summary').length}행 · 회차 버전{' '}
                {dry.version}
              </p>
            </section>
          )}
          <section aria-label="원문 행과 명시 매핑">
            <h2>원문 행과 명시 매핑</h2>
            <ul>
              {pkg.rows.map((row) => {
                const preview = worklogPackageRowPreview(pkg, row.rowId),
                  f = draft.fields[row.rowId] ?? blank(),
                  mapping = draft.mappings[row.rowId],
                  receipt = receipts[row.rowId],
                  result = dry?.results.find((r) => r.rowId === row.rowId),
                  frozen = blocked || !!draft.pending || !!receipt;
                return (
                  <li key={row.rowId}>
                    <section aria-label={`원문 행: ${row.sourceRecordId}`}>
                      <h3>{text(preview.title)}</h3>
                      <p>
                        {row.section === 'weeklySummary'
                          ? '주간 요약 · 업무 생성 제외'
                          : '일간 · 실제 업무 후보'}{' '}
                        · {row.sourceTitleCell} · 원문 분류 {row.originalCategory} → 프로젝트 코드{' '}
                        {row.projectCode}
                      </p>
                      <p>
                        원문 {checkLabel(row.sourceCompletionState)} · 기준 주 {row.weekStart} ·
                        업무일 {row.activityDate ?? '없음'} · 마감 {row.dueDate ?? '없음'}
                      </p>
                      <p style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>
                        {preview.content === null || preview.content === undefined
                          ? '본문 없음'
                          : text(preview.content)}
                      </p>
                      <details>
                        <summary>날짜 해석 근거와 후보 연결 확인</summary>
                        <p>{row.interpretationDecisionRef}</p>
                        <p>주간·일간 연결은 후보이며 병합·완료 전파가 없습니다.</p>
                      </details>
                      {row.section === 'daily' && (
                        <fieldset disabled={frozen}>
                          <legend>일간 명시 매핑: {row.sourceRecordId}</legend>
                          <p>
                            기본은 보류입니다. 원문 체크와 종류·상태를 직접 확인하고 적용하세요.
                            무태그도 가능하지만 원문 제안서는 회사의 제안서 태그를 명시 선택해야
                            합니다.
                          </p>
                          <label>
                            등록할 기록 종류
                            <select
                              value={f.kind}
                              onChange={(e) =>
                                editFields(row.rowId, { ...f, kind: e.target.value, status: '' })
                              }
                            >
                              <option value="">선택 전 · 보류</option>
                              {['task', 'meeting', 'field', 'etc'].map((v) => (
                                <option key={v} value={v}>
                                  {
                                    (
                                      {
                                        task: '업무',
                                        meeting: '회의',
                                        field: '외근',
                                        etc: '기타',
                                      } as Record<string, string>
                                    )[v]
                                  }
                                </option>
                              ))}
                            </select>
                          </label>
                          <label>
                            등록할 상태
                            <select
                              value={f.status}
                              onChange={(e) =>
                                editFields(row.rowId, { ...f, status: e.target.value })
                              }
                            >
                              <option value="">명시 선택 전 · 보류</option>
                              {(f.kind === 'task'
                                ? ['todo', 'doing', 'done', 'canceled']
                                : ['planned', 'done', 'canceled']
                              ).map((v) => (
                                <option key={v} value={v}>
                                  {
                                    (
                                      {
                                        todo: '미진행',
                                        doing: '진행 중',
                                        planned: '예정',
                                        done: '완료',
                                        canceled: '취소',
                                      } as Record<string, string>
                                    )[v]
                                  }
                                </option>
                              ))}
                            </select>
                          </label>
                          <label>
                            등록할 실제 프로젝트
                            <select
                              value={f.projectId}
                              onChange={(e) =>
                                editFields(row.rowId, { ...f, projectId: e.target.value })
                              }
                            >
                              <option value="">활성 프로젝트 직접 선택</option>
                              {masters?.projects
                                .filter((p) => p.isActive && p.code === row.projectCode)
                                .map((p) => (
                                  <option key={p.id} value={p.id}>
                                    {p.code} · 버전 {p.version}
                                  </option>
                                ))}
                            </select>
                          </label>
                          <fieldset>
                            <legend>등록 태그 (선택)</legend>
                            {masters?.tags
                              .filter((t) => t.isActive && t.companyId === companyId)
                              .map((tag) => (
                                <label className="workspace-check" key={tag.id}>
                                  <input
                                    type="checkbox"
                                    checked={f.tagIds.includes(tag.id)}
                                    onChange={(e) =>
                                      editFields(row.rowId, {
                                        ...f,
                                        tagIds: e.target.checked
                                          ? [...f.tagIds, tag.id]
                                          : f.tagIds.filter((x) => x !== tag.id),
                                      })
                                    }
                                  />
                                  {tag.label}
                                </label>
                              ))}
                          </fieldset>
                          <label>
                            매핑 선택 근거
                            <input
                              maxLength={500}
                              value={f.decisionRef}
                              onChange={(e) =>
                                editFields(row.rowId, { ...f, decisionRef: e.target.value })
                              }
                            />
                          </label>
                          <label className="workspace-check">
                            <input
                              type="checkbox"
                              checked={f.acknowledged}
                              onChange={(e) =>
                                editFields(row.rowId, { ...f, acknowledged: e.target.checked })
                              }
                            />
                            원문 {checkLabel(row.sourceCompletionState)}과 선택한 상태를
                            확인했습니다
                          </label>
                          <button type="button" onClick={() => applyMapping(row)}>
                            이 행 매핑 적용
                          </button>
                        </fieldset>
                      )}
                      {mapping && (
                        <p>
                          보존한 매핑: {mapping.kind} / {mapping.status} · 프로젝트 버전{' '}
                          {mapping.project?.version} · 태그 {mapping.tags.length}개 · 후보 업무 ID{' '}
                          {mapping.entryId}
                        </p>
                      )}
                      {result && (
                        <p>
                          사전검사{' '}
                          {result.state === 'ready'
                            ? '등록 가능'
                            : result.state === 'summary'
                              ? '주간 요약'
                              : '보류'}{' '}
                          {result.reason ?? ''}
                        </p>
                      )}
                      {row.section === 'daily' && (
                        <button
                          type="button"
                          disabled={
                            frozen ||
                            run?.state !== 'validated' ||
                            dry?.version !== run?.version ||
                            result?.state !== 'ready' ||
                            !mapping
                          }
                          onClick={() => void act((t) => materialize(row, t))}
                        >
                          이 일간 명시 등록: {row.sourceRecordId}
                        </button>
                      )}
                      {receipt && (
                        <section aria-label={`등록 영수증: ${row.sourceRecordId}`}>
                          <h4>등록된 최초 업무</h4>
                          <p>
                            영수증 {receipt.id} · 저장된 업무 ID {receipt.originalEntry.id} ·{' '}
                            {receipt.originalEntry.kind} / {receipt.originalEntry.status}
                          </p>
                          <p>{receipt.originalEntry.title}</p>
                          <p>
                            현재 상태:{' '}
                            {receipt.current.state === 'deleted'
                              ? '업무 삭제됨 · 재생성하지 않음'
                              : receipt.current.state === 'edited'
                                ? '등록 후 편집됨 · 최초 영수증과 별도'
                                : '최초 등록과 동일'}
                          </p>
                          {receipt.current.entry && (
                            <p>
                              {receipt.current.entry.title} / {receipt.current.entry.status}
                            </p>
                          )}
                          <a
                            className="control-link"
                            href={`/c/${companyId}/day?date=${row.activityDate}&entryId=${receipt.originalEntry.id}`}
                          >
                            현재 업무 날짜 보기
                          </a>
                        </section>
                      )}
                    </section>
                  </li>
                );
              })}
            </ul>
          </section>
          {summaries && (
            <section aria-label="서버 주간 요약 결과">
              <h2>서버 주간 요약 {summaries.items.length}행</h2>
              <p>일간과 독립된 원문 요약입니다. 업무 생성·일간 완료 전파는 없습니다.</p>
              <ul>
                {summaries.items.map((x) => (
                  <li key={x.row.id}>
                    {x.row.kind === 'row' ? text(x.row.data.fields.title) : ''} · 후보 연결{' '}
                    {x.relations.length}개
                  </li>
                ))}
              </ul>
            </section>
          )}
        </>
      )}
    </section>
  );
}
