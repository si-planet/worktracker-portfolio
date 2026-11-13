import { RefreshButton } from './ui-controls';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { z } from 'zod';
import {
  zProjectCreate,
  zProjectUpdate,
  zWorkspaceCompany,
  zWorkspaceProject,
  zWorkspaceTag,
  type WorkspaceProject,
  type WorkspaceTag,
} from '../shared/schema/workspace';
import { zCompanyEntityDelete, zCompanyEntityDeleted } from '../shared/schema/company-admin';

class ProjectFailure extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
  ) {
    super(code);
  }
}
async function api<T extends z.ZodType>(
  path: string,
  schema: T,
  method = 'GET',
  body?: unknown,
): Promise<z.output<T>> {
  if (method !== 'GET' && !navigator.onLine) throw new ProjectFailure(0, 'OFFLINE');
  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), 15_000);
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
    if (response.status === 401) throw new ProjectFailure(401, 'UNAUTHENTICATED');
    const raw: unknown = await response.json();
    if (!response.ok)
      throw new ProjectFailure(
        response.status,
        raw && typeof raw === 'object' && 'code' in raw && typeof raw.code === 'string'
          ? raw.code
          : 'UNKNOWN',
      );
    const result = schema.safeParse(raw);
    if (!result.success) throw new ProjectFailure(0, 'INVALID_RESPONSE');
    return result.data;
  } finally {
    window.clearTimeout(timer);
  }
}
const uncertain = (error: unknown) =>
  !(error instanceof ProjectFailure) || error.status >= 500 || error.code === 'INVALID_RESPONSE';
function message(error: unknown) {
  if (error instanceof ProjectFailure) {
    if (error.code === 'OFFLINE')
      return '오프라인에서는 저장할 수 없습니다. 연결 후 다시 시도해 주세요.';
    if (error.code === 'IN_USE')
      return '연결된 업무, WBS 계획, 기본 태그 또는 사용 이력이 있어 삭제할 수 없습니다. 기록을 유지하려면 비활성화해 주세요.';
    if (error.code === 'DUPLICATE')
      return '같은 프로젝트 코드가 이미 있습니다. 비활성 프로젝트도 확인해 주세요.';
    if (error.status === 400) return '프로젝트 코드, 날짜, 색상과 기본 태그를 확인해 주세요.';
    if (error.status === 403)
      return '접근할 수 없는 회사 또는 프로젝트입니다. 회사 선택에서 다시 확인해 주세요.';
  }
  return '프로젝트를 처리하지 못했습니다. 다시 조회한 뒤 확인해 주세요.';
}
const zDraft = z.strictObject({
  code: z.string().max(60),
  description: z.string().max(500),
  startedOn: z.string().max(10),
  endedOn: z.string().max(10),
  color: z.string().max(7),
  defaultTagIds: z.array(z.string()),
});
type Draft = z.infer<typeof zDraft>;
const blank: Draft = {
  code: '',
  description: '',
  startedOn: '',
  endedOn: '',
  color: '',
  defaultTagIds: [],
};
const fromProject = (row: WorkspaceProject): Draft => ({
  code: row.code,
  description: row.description ?? '',
  startedOn: row.startedOn ?? '',
  endedOn: row.endedOn ?? '',
  color: row.color ?? '',
  defaultTagIds: [...row.defaultTagIds],
});
const input = (draft: Draft) => ({
  ...draft,
  description: draft.description || null,
  startedOn: draft.startedOn || null,
  endedOn: draft.endedOn || null,
  color: draft.color || null,
});

export function ProjectManagement({
  companyId,
  userId,
  onExpired,
}: {
  companyId: string;
  userId: string;
  onExpired: () => void;
}) {
  const storageKey = `wt:project-admin:v1:${userId}:${companyId}`;
  const [restored] = useState(() => {
    try {
      const raw = localStorage.getItem(storageKey);
      if (!raw || raw.length > 32_768) return null;
      const result = z
        .strictObject({
          create: zDraft,
          unknownCreate: z.boolean(),
          edit: zWorkspaceProject.nullable(),
          editDraft: zDraft,
        })
        .safeParse(JSON.parse(raw));
      return result.success && (!result.data.edit || result.data.edit.companyId === companyId)
        ? result.data
        : null;
    } catch {
      return null;
    }
  });
  const [createDraft, setCreateDraft] = useState<Draft>(restored?.create ?? blank);
  const [unknownCreate, setUnknownCreate] = useState(restored?.unknownCreate ?? false);
  const [edit, setEdit] = useState<WorkspaceProject | null>(restored?.edit ?? null);
  const [editDraft, setEditDraft] = useState<Draft>(restored?.editDraft ?? blank);
  const [projects, setProjects] = useState<WorkspaceProject[]>([]);
  const [tags, setTags] = useState<WorkspaceTag[]>([]);
  const [companyName, setCompanyName] = useState('현재 회사');
  const [loading, setLoading] = useState(true);
  const [pending, setPending] = useState(false);
  const [verifiedList, setVerifiedList] = useState(false);
  const [needsRefresh, setNeedsRefresh] = useState(Boolean(restored?.edit));
  const [confirm, setConfirm] = useState<false | 'deactivate' | 'delete'>(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const lock = useRef(false);
  const mounted = useRef(true);
  const revision = useRef(0);
  useEffect(() => {
    try {
      localStorage.setItem(
        storageKey,
        JSON.stringify({ create: createDraft, unknownCreate, edit, editDraft }),
      );
    } catch {
      /* Drafts remain in memory when browser storage is unavailable. */
    }
  }, [storageKey, createDraft, unknownCreate, edit, editDraft]);
  function expired(failure: unknown) {
    if (failure instanceof ProjectFailure && failure.status === 401) {
      onExpired();
      return true;
    }
    return false;
  }
  async function reload() {
    const ticket = ++revision.current;
    setLoading(true);
    setVerifiedList(false);
    setConfirm(false);
    if (edit) setNeedsRefresh(true);
    try {
      const [company, rows, choices] = await Promise.all([
        api(
          `/api/companies/${companyId}`,
          zWorkspaceCompany.refine((row) => row.id === companyId),
        ),
        api(
          `/api/companies/${companyId}/projects`,
          z
            .array(zWorkspaceProject)
            .refine((rows) => rows.every((row) => row.companyId === companyId)),
        ),
        api(
          `/api/companies/${companyId}/work-tags`,
          z
            .array(zWorkspaceTag)
            .refine((rows) =>
              rows.every(
                (row) => row.isActive && (row.companyId === null || row.companyId === companyId),
              ),
            ),
        ),
      ]);
      if (!mounted.current || revision.current !== ticket) return false;
      setCompanyName(company.name);
      setProjects(rows);
      setTags(choices);
      setVerifiedList(true);
      return true;
    } catch (failure) {
      if (mounted.current && revision.current === ticket && !expired(failure))
        setError(message(failure));
      return false;
    } finally {
      if (mounted.current && revision.current === ticket) setLoading(false);
    }
  }
  useEffect(() => {
    mounted.current = true;
    void reload();
    return () => {
      mounted.current = false;
      revision.current++;
    };
  }, []);
  async function create(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (lock.current || loading || !verifiedList || unknownCreate) return;
    const parsed = zProjectCreate.safeParse(input(createDraft));
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? '프로젝트 입력을 확인해 주세요.');
      return;
    }
    lock.current = true;
    setPending(true);
    setError('');
    setNotice('');
    setUnknownCreate(true);
    setVerifiedList(false);
    try {
      const value = await api(
        `/api/companies/${companyId}/projects`,
        zWorkspaceProject.refine((row) => row.companyId === companyId),
        'POST',
        parsed.data,
      );
      if (!mounted.current) return;
      setProjects((rows) => [...rows.filter((row) => row.id !== value.id), value]);
      setCreateDraft(blank);
      setUnknownCreate(false);
      setVerifiedList(true);
      setNotice('프로젝트를 만들었습니다.');
    } catch (failure) {
      if (!mounted.current || expired(failure)) return;
      if (uncertain(failure)) {
        const refreshed = await reload();
        if (mounted.current)
          setError(
            refreshed
              ? '생성 결과를 목록에서 확인해 주세요. 같은 프로젝트가 이미 있을 수 있습니다.'
              : '프로젝트 생성 결과를 확인할 수 없습니다. 다시 조회해 주세요.',
          );
      } else {
        setUnknownCreate(false);
        setVerifiedList(!(failure instanceof ProjectFailure && failure.status === 403));
        setError(message(failure));
      }
    } finally {
      lock.current = false;
      if (mounted.current) setPending(false);
    }
  }
  async function update(action: 'save' | 'deactivate' | 'reactivate' | 'delete') {
    if (!edit || lock.current || loading || needsRefresh || !verifiedList) return;
    if ((action === 'delete' || action === 'deactivate') && confirm !== action) return;
    const parsed =
      action === 'delete'
        ? zCompanyEntityDelete.safeParse({ version: edit.version })
        : zProjectUpdate.safeParse({
            ...(action === 'save' ? input(editDraft) : { isActive: action === 'reactivate' }),
            version: edit.version,
          });
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? '프로젝트 입력을 확인해 주세요.');
      return;
    }
    lock.current = true;
    setPending(true);
    setError('');
    setNotice('');
    try {
      if (action === 'delete') {
        await api(
          `/api/projects/${edit.id}`,
          zCompanyEntityDeleted.refine((row) => row.id === edit.id),
          'DELETE',
          parsed.data,
        );
        if (!mounted.current) return;
        setProjects((rows) => rows.filter((row) => row.id !== edit.id));
      } else {
        const value = await api(
          `/api/projects/${edit.id}`,
          zWorkspaceProject.refine((row) => row.id === edit.id && row.companyId === companyId),
          'PATCH',
          parsed.data,
        );
        if (!mounted.current) return;
        setProjects((rows) => rows.map((row) => (row.id === value.id ? value : row)));
      }
      setEdit(null);
      setEditDraft(blank);
      setConfirm(false);
      setNotice(
        action === 'delete'
          ? '프로젝트를 삭제했습니다.'
          : action === 'deactivate'
            ? '프로젝트를 비활성화했습니다. 과거 기록은 유지됩니다.'
            : action === 'reactivate'
              ? '프로젝트를 다시 활성화했습니다.'
              : '프로젝트를 저장했습니다.',
      );
    } catch (failure) {
      if (!mounted.current || expired(failure)) return;
      setConfirm(false);
      if (
        uncertain(failure) ||
        (failure instanceof ProjectFailure && failure.code === 'VERSION_CONFLICT')
      ) {
        setNeedsRefresh(true);
        const refreshed = await reload();
        if (mounted.current)
          setError(
            refreshed
              ? '요청 결과와 최신 목록을 다시 조회했습니다. 입력은 유지됩니다. 프로젝트를 다시 선택해 주세요.'
              : '요청 결과를 확인할 수 없습니다. 다시 조회한 뒤 확인해 주세요.',
          );
      } else setError(message(failure));
    } finally {
      lock.current = false;
      if (mounted.current) setPending(false);
    }
  }
  const disabled = loading || pending;
  function fields(draft: Draft, setDraft: (draft: Draft) => void, prefix: string) {
    return (
      <>
        <div className="form-field">
          <label htmlFor={`${prefix}-project-code`}>프로젝트 코드</label>
          <input
            id={`${prefix}-project-code`}
            maxLength={60}
            disabled={disabled}
            required
            value={draft.code}
            onChange={(event) => setDraft({ ...draft, code: event.target.value })}
          />
        </div>
        <div className="form-field">
          <label htmlFor={`${prefix}-project-description`}>설명 (선택)</label>
          <textarea
            id={`${prefix}-project-description`}
            maxLength={500}
            disabled={disabled}
            value={draft.description}
            onChange={(event) => setDraft({ ...draft, description: event.target.value })}
          />
        </div>
        <div className="workspace-inline">
          <div className="form-field">
            <label htmlFor={`${prefix}-project-start`}>시작일 (선택)</label>
            <input
              id={`${prefix}-project-start`}
              type="date"
              disabled={disabled}
              value={draft.startedOn}
              onChange={(event) => setDraft({ ...draft, startedOn: event.target.value })}
            />
          </div>
          <div className="form-field">
            <label htmlFor={`${prefix}-project-end`}>종료일 (선택)</label>
            <input
              id={`${prefix}-project-end`}
              type="date"
              disabled={disabled}
              value={draft.endedOn}
              onChange={(event) => setDraft({ ...draft, endedOn: event.target.value })}
            />
          </div>
        </div>
        <div className="form-field">
          <label htmlFor={`${prefix}-project-color`}>색상 (선택, #RRGGBB)</label>
          <input
            id={`${prefix}-project-color`}
            maxLength={7}
            placeholder="#176b5b"
            disabled={disabled}
            value={draft.color}
            onChange={(event) => setDraft({ ...draft, color: event.target.value })}
          />
        </div>
        <fieldset className="workspace-tags" disabled={disabled}>
          <legend>기본 업무 태그 (선택)</legend>
          {tags.length === 0 && (
            <p>활성 업무 태그가 없습니다. 회사 설정의 태그 관리에서 만들 수 있습니다.</p>
          )}
          {tags.map((tag) => (
            <label className="workspace-check" key={tag.id}>
              <input
                type="checkbox"
                checked={draft.defaultTagIds.includes(tag.id)}
                onChange={(event) =>
                  setDraft({
                    ...draft,
                    defaultTagIds: event.target.checked
                      ? [...draft.defaultTagIds, tag.id]
                      : draft.defaultTagIds.filter((id) => id !== tag.id),
                  })
                }
              />
              {tag.label}
            </label>
          ))}
          {draft.defaultTagIds.some((id) => !tags.some((tag) => tag.id === id)) && (
            <p>기존 비활성 태그 연결은 유지됩니다.</p>
          )}
        </fieldset>
      </>
    );
  }
  return (
    <section className="workspace" aria-labelledby="project-admin-title">
      <h1 id="project-admin-title">프로젝트 관리</h1>
      <p>
        {companyName}의 프로젝트를 관리합니다. 비활성화하면 새 선택에서 제외되고 과거 기록은
        유지됩니다. 연결이 없는 프로젝트만 확인 후 삭제할 수 있습니다.
      </p>
      {error && (
        <p role="alert" className="form-message">
          {error}
        </p>
      )}
      {notice && <p role="status">{notice}</p>}
      {loading && <p role="status">프로젝트를 불러오고 있습니다.</p>}
      <RefreshButton
        type="button"
        className="text-button"
        disabled={disabled}
        onClick={() => {
          setError('');
          void reload();
        }}
        busy={loading || pending}
      >
        다시 조회
      </RefreshButton>
      <section className="workspace-block" aria-label="프로젝트 목록">
        <h2>프로젝트 목록</h2>
        {!loading && projects.length === 0 && (
          <p>아직 프로젝트가 없습니다. 아래에서 새 프로젝트를 만들어 주세요.</p>
        )}
        <ul>
          {projects.map((project) => (
            <li key={project.id}>
              <strong>{project.code}</strong> · {project.isActive ? '활성' : '비활성'}{' '}
              <button
                type="button"
                className="text-button"
                disabled={disabled || !verifiedList}
                onClick={() => {
                  setEdit(project);
                  setEditDraft(fromProject(project));
                  setNeedsRefresh(false);
                  setConfirm(false);
                  setError('');
                  setNotice('');
                }}
              >
                수정: {project.code}
              </button>
            </li>
          ))}
        </ul>
      </section>
      {edit && (
        <form
          className="workspace-block"
          aria-label="프로젝트 수정"
          noValidate
          onSubmit={(event) => {
            event.preventDefault();
            void update('save');
          }}
        >
          <h2>프로젝트 수정</h2>
          {needsRefresh && (
            <p>입력은 유지됩니다. 최신 목록의 수정 버튼으로 다시 선택한 뒤 저장해 주세요.</p>
          )}
          {fields(editDraft, setEditDraft, 'edit')}
          <button className="button primary" disabled={disabled || needsRefresh || !verifiedList}>
            프로젝트 저장
          </button>{' '}
          <button
            type="button"
            className="button secondary"
            disabled={disabled}
            onClick={() => {
              setEdit(null);
              setEditDraft(blank);
              setConfirm(false);
            }}
          >
            수정 취소
          </button>{' '}
          {edit.isActive ? (
            <button
              type="button"
              className="text-button"
              disabled={disabled || needsRefresh || !verifiedList}
              onClick={() => setConfirm('deactivate')}
            >
              비활성화
            </button>
          ) : (
            <button
              type="button"
              className="text-button"
              disabled={disabled || needsRefresh || !verifiedList}
              onClick={() => void update('reactivate')}
            >
              다시 활성화
            </button>
          )}
          <button
            type="button"
            className="text-button"
            disabled={disabled || needsRefresh || !verifiedList}
            onClick={() => setConfirm('delete')}
          >
            프로젝트 삭제
          </button>
          {confirm && (
            <div
              role="group"
              aria-label={`프로젝트 ${confirm === 'delete' ? '삭제' : '비활성화'} 확인`}
            >
              <p>
                저장된 프로젝트 “{edit.code}”를 {confirm === 'delete' ? '삭제' : '비활성화'}할까요?
                입력 중인 수정은 저장하지 않습니다.{' '}
                {confirm === 'delete'
                  ? '업무, WBS 계획, 기본 태그 또는 사용 이력이 있으면 삭제가 차단됩니다.'
                  : '과거 기록은 유지됩니다.'}
              </p>
              <button
                type="button"
                disabled={disabled || needsRefresh}
                onClick={() => void update(confirm === 'delete' ? 'delete' : 'deactivate')}
              >
                {confirm === 'delete' ? '삭제 확인' : '비활성화 확인'}
              </button>
              <button type="button" disabled={disabled} onClick={() => setConfirm(false)}>
                {confirm === 'delete' ? '삭제 취소' : '비활성화 취소'}
              </button>
            </div>
          )}
        </form>
      )}
      <form
        className="workspace-block"
        aria-label="새 프로젝트 만들기"
        noValidate
        onSubmit={(event) => void create(event)}
      >
        <h2>새 프로젝트 만들기</h2>
        {fields(createDraft, setCreateDraft, 'new')}
        <button className="button primary" disabled={disabled || !verifiedList || unknownCreate}>
          프로젝트 만들기
        </button>
        {unknownCreate && (
          <div>
            <p>
              생성 결과를 먼저 목록에서 확인해 주세요. 결과를 확인하기 전에는 같은 요청을 다시
              보내지 않습니다.
            </p>
            <button
              type="button"
              className="text-button"
              disabled={disabled || !verifiedList}
              onClick={() => {
                setUnknownCreate(false);
                setError('');
              }}
            >
              목록 확인 후 다시 만들기
            </button>
          </div>
        )}
      </form>
    </section>
  );
}
