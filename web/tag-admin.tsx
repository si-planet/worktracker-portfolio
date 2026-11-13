import { RefreshButton } from './ui-controls';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { z } from 'zod';
import {
  zAdminNoteTag,
  zAdminWorkTag,
  zNoteTagCreate,
  zNoteTagUpdate,
  zWorkTagCreate,
  zWorkTagUpdate,
  zTagDeactivate,
  type AdminTag,
  type TagKind,
} from '../shared/schema/tags';
import { zCompanyEntityDelete, zCompanyEntityDeleted } from '../shared/schema/company-admin';
import { zWorkspaceCompany } from '../shared/schema/workspace';

class TagFailure extends Error {
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
  if (method !== 'GET' && !navigator.onLine) throw new TagFailure(0, 'OFFLINE');
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), 15_000);
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
    if (response.status === 401) throw new TagFailure(401, 'UNAUTHENTICATED');
    const raw: unknown = await response.json();
    if (!response.ok)
      throw new TagFailure(
        response.status,
        raw && typeof raw === 'object' && 'code' in raw && typeof raw.code === 'string'
          ? raw.code
          : 'UNKNOWN',
      );
    const parsed = schema.safeParse(raw);
    if (!parsed.success) throw new TagFailure(0, 'INVALID_RESPONSE');
    return parsed.data;
  } finally {
    window.clearTimeout(timeout);
  }
}
const uncertain = (failure: unknown) =>
  !(failure instanceof TagFailure) || failure.status >= 500 || failure.code === 'INVALID_RESPONSE';
function message(failure: unknown) {
  if (failure instanceof TagFailure) {
    if (failure.code === 'OFFLINE')
      return '오프라인에서는 저장할 수 없습니다. 연결 후 다시 시도해 주세요.';
    if (failure.code === 'IN_USE')
      return '연결된 업무, 프로젝트 기본 태그 또는 사용 이력이 있어 삭제할 수 없습니다. 연결을 유지하려면 비활성화해 주세요.';
    if (failure.code === 'DUPLICATE')
      return '같은 범위에 같은 태그 이름이 이미 있습니다. 비활성 태그도 확인해 주세요.';
    if (failure.status === 400) return '태그 이름과 정렬 순서를 확인해 주세요.';
    if (failure.status === 403)
      return '접근할 수 없는 회사 또는 태그입니다. 회사 선택에서 다시 확인해 주세요.';
  }
  return '태그를 처리하지 못했습니다. 다시 조회한 뒤 확인해 주세요.';
}
const zDraft = z.strictObject({
  label: z.string().max(40),
  isCore: z.boolean(),
  sortOrder: z.string().max(24),
});
type Draft = z.infer<typeof zDraft>;
const blank: Draft = { label: '', isCore: false, sortOrder: '0' };
function fromTag(tag: AdminTag): Draft {
  return {
    label: tag.label,
    isCore: 'isCore' in tag && tag.isCore,
    sortOrder: String(tag.sortOrder),
  };
}

export function TagManagement({
  companyId,
  userId,
  onExpired,
}: {
  companyId: string;
  userId: string;
  onExpired: () => void;
}) {
  const [kind, setKind] = useState<TagKind>('work');
  return (
    <section className="workspace" aria-labelledby="tag-admin-title">
      <h1 id="tag-admin-title">태그 관리</h1>
      <p>
        공통 태그는 본인의 여러 회사에서 사용합니다. 회사 태그는 해당 회사에서만 사용합니다. 생성 후
        범위는 바꿀 수 없습니다.
      </p>
      <div className="workspace-inline" role="group" aria-label="태그 종류">
        <button
          type="button"
          className="button secondary"
          aria-pressed={kind === 'work'}
          onClick={() => setKind('work')}
        >
          업무 태그
        </button>
        <button
          type="button"
          className="button secondary"
          aria-pressed={kind === 'note'}
          onClick={() => setKind('note')}
        >
          노트 태그
        </button>
      </div>
      <TagEditor
        key={kind}
        kind={kind}
        companyId={companyId}
        userId={userId}
        onExpired={onExpired}
      />
    </section>
  );
}
function TagEditor({
  kind,
  companyId,
  userId,
  onExpired,
}: {
  kind: TagKind;
  companyId: string;
  userId: string;
  onExpired: () => void;
}) {
  const output = kind === 'work' ? zAdminWorkTag : zAdminNoteTag;
  const storageKey = `wt:tag-admin:v1:${userId}:${companyId}:${kind}`;
  const zStored = z.strictObject({
    create: zDraft,
    scope: z.enum(['common', 'company']),
    unknownCreate: z.boolean(),
    edit: output.nullable(),
    editDraft: zDraft,
  });
  const [restored] = useState(() => {
    try {
      const raw = localStorage.getItem(storageKey);
      if (!raw || raw.length > 32_768) return null;
      const parsed = zStored.safeParse(JSON.parse(raw));
      if (
        !parsed.success ||
        (parsed.data.edit &&
          parsed.data.edit.companyId !== null &&
          parsed.data.edit.companyId !== companyId)
      )
        return null;
      return parsed.data;
    } catch {
      return null;
    }
  });
  const [createDraft, setCreateDraft] = useState<Draft>(restored?.create ?? blank);
  const [scope, setScope] = useState<'common' | 'company'>(restored?.scope ?? 'company');
  const [edit, setEdit] = useState<AdminTag | null>(restored?.edit ?? null);
  const [editDraft, setEditDraft] = useState<Draft>(restored?.editDraft ?? blank);
  const [unknownCreate, setUnknownCreate] = useState(restored?.unknownCreate ?? false);
  const [needsRefresh, setNeedsRefresh] = useState(Boolean(restored?.edit));
  const [tags, setTags] = useState<AdminTag[]>([]);
  const [companyName, setCompanyName] = useState('현재 회사');
  const [loading, setLoading] = useState(true);
  const [pending, setPending] = useState(false);
  const [verifiedList, setVerifiedList] = useState(false);
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
        JSON.stringify({ create: createDraft, scope, unknownCreate, edit, editDraft }),
      );
    } catch {
      /* In-memory drafts remain usable when storage is unavailable. */
    }
  }, [createDraft, scope, unknownCreate, edit, editDraft, storageKey]);
  function expired(failure: unknown) {
    if (failure instanceof TagFailure && failure.status === 401) {
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
      const [target, rows] = await Promise.all([
        api(
          `/api/companies/${companyId}`,
          zWorkspaceCompany.refine((row) => row.id === companyId),
        ),
        api(
          `/api/companies/${companyId}/${kind}-tags?includeInactive=true`,
          z
            .array(output)
            .refine((rows) =>
              rows.every((row) => row.companyId === null || row.companyId === companyId),
            ),
        ),
      ]);
      if (!mounted.current || ticket !== revision.current) return false;
      setCompanyName(target.name);
      setTags(rows);
      setVerifiedList(true);
      return true;
    } catch (failure) {
      if (mounted.current && ticket === revision.current && !expired(failure))
        setError(message(failure));
      return false;
    } finally {
      if (mounted.current && ticket === revision.current) setLoading(false);
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
  function input(draft: Draft) {
    if (!/^-?[0-9]+$/.test(draft.sortOrder)) {
      setError('정렬 순서를 안전한 정수로 입력해 주세요.');
      return null;
    }
    return {
      label: draft.label,
      sortOrder: Number(draft.sortOrder),
      ...(kind === 'work' ? { isCore: draft.isCore } : {}),
    };
  }
  async function create(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (lock.current || loading || unknownCreate || !verifiedList) return;
    const fields = input(createDraft);
    if (!fields) return;
    const parsed = (kind === 'work' ? zWorkTagCreate : zNoteTagCreate).safeParse({
      ...fields,
      scope: scope === 'company' ? { type: 'company', companyId } : { type: 'common' },
    });
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? '태그 입력을 확인해 주세요.');
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
        `/api/${kind}-tags`,
        output.refine((row) => row.companyId === (scope === 'company' ? companyId : null)),
        'POST',
        parsed.data,
      );
      if (!mounted.current) return;
      setTags((rows) =>
        [...rows.filter((row) => row.id !== value.id), value].sort(
          (a, b) => a.sortOrder - b.sortOrder || a.label.localeCompare(b.label),
        ),
      );
      setCreateDraft(blank);
      setUnknownCreate(false);
      setVerifiedList(true);
      setNotice('태그를 만들었습니다.');
    } catch (failure) {
      if (!mounted.current) return;
      if (!uncertain(failure)) {
        setUnknownCreate(false);
        setVerifiedList(!(failure instanceof TagFailure && failure.status === 403));
      }
      if (expired(failure)) return;
      if (uncertain(failure)) {
        const refreshed = await reload();
        if (mounted.current)
          setError(
            refreshed
              ? '생성 결과를 목록에서 확인해 주세요. 같은 이름과 범위의 태그가 이미 있을 수 있습니다.'
              : '태그 생성 결과를 확인할 수 없습니다. 다시 조회해 주세요.',
          );
      } else setError(message(failure));
    } finally {
      lock.current = false;
      if (mounted.current) setPending(false);
    }
  }
  async function update(deactivate = false, reactivate = false) {
    if (!edit || lock.current || loading || needsRefresh) return;
    const fields = deactivate || reactivate ? {} : input(editDraft);
    if (!fields) return;
    const parsed = (
      deactivate ? zTagDeactivate : kind === 'work' ? zWorkTagUpdate : zNoteTagUpdate
    ).safeParse({ ...fields, ...(reactivate ? { isActive: true } : {}), version: edit.version });
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? '태그 입력을 확인해 주세요.');
      return;
    }
    lock.current = true;
    setPending(true);
    setError('');
    setNotice('');
    try {
      const value = await api(
        `/api/${kind}-tags/${edit.id}${deactivate ? '/deactivate' : ''}`,
        output.refine((row) => row.id === edit.id && row.companyId === edit.companyId),
        deactivate ? 'POST' : 'PATCH',
        parsed.data,
      );
      if (!mounted.current) return;
      setTags((rows) =>
        rows
          .map((row) => (row.id === value.id ? value : row))
          .sort((a, b) => a.sortOrder - b.sortOrder || a.label.localeCompare(b.label)),
      );
      setEdit(null);
      setEditDraft(blank);
      setConfirm(false);
      setNeedsRefresh(false);
      setNotice(
        deactivate
          ? '태그를 비활성화했습니다. 과거 연결은 유지됩니다.'
          : reactivate
            ? '태그를 다시 활성화했습니다.'
            : '태그를 저장했습니다.',
      );
    } catch (failure) {
      if (!mounted.current || expired(failure)) return;
      if (
        uncertain(failure) ||
        (failure instanceof TagFailure && failure.code === 'VERSION_CONFLICT')
      ) {
        setNeedsRefresh(true);
        setConfirm(false);
        const refreshed = await reload();
        if (mounted.current)
          setError(
            refreshed
              ? '저장 결과와 최신 목록을 다시 조회했습니다. 입력은 유지됩니다. 최신 태그를 다시 선택하고 확인해 주세요.'
              : '태그 저장 결과를 확인할 수 없습니다. 다시 조회한 뒤 확인해 주세요.',
          );
      } else setError(message(failure));
    } finally {
      lock.current = false;
      if (mounted.current) setPending(false);
    }
  }
  async function remove() {
    if (!edit || lock.current || loading || needsRefresh || confirm !== 'delete') return;
    const parsed = zCompanyEntityDelete.parse({ version: edit.version });
    lock.current = true;
    setPending(true);
    setError('');
    setNotice('');
    try {
      await api(
        `/api/${kind}-tags/${edit.id}`,
        zCompanyEntityDeleted.refine((row) => row.id === edit.id),
        'DELETE',
        parsed,
      );
      if (!mounted.current) return;
      setTags((rows) => rows.filter((row) => row.id !== edit.id));
      setEdit(null);
      setEditDraft(blank);
      setNotice('태그를 삭제했습니다.');
    } catch (failure) {
      if (!mounted.current || expired(failure)) return;
      if (
        uncertain(failure) ||
        (failure instanceof TagFailure && failure.code === 'VERSION_CONFLICT')
      ) {
        setNeedsRefresh(true);
        const refreshed = await reload();
        if (mounted.current)
          setError(
            refreshed
              ? '삭제 결과와 최신 목록을 다시 조회했습니다. 최신 태그를 다시 선택해 주세요.'
              : '삭제 결과를 확인할 수 없습니다. 다시 조회한 뒤 확인해 주세요.',
          );
      } else setError(message(failure));
    } finally {
      lock.current = false;
      if (mounted.current) {
        setPending(false);
        setConfirm(false);
      }
    }
  }
  const disabled = loading || pending;
  function fields(draft: Draft, setDraft: (value: Draft) => void, prefix: string) {
    return (
      <>
        <div className="form-field">
          <label htmlFor={`${prefix}-tag-label`}>
            {prefix === 'new' ? '새 태그 이름' : '수정 태그 이름'}
          </label>
          <input
            id={`${prefix}-tag-label`}
            maxLength={40}
            disabled={disabled}
            required
            value={draft.label}
            onChange={(event) => setDraft({ ...draft, label: event.target.value })}
          />
        </div>
        <div className="form-field">
          <label htmlFor={`${prefix}-tag-sort`}>정렬 순서</label>
          <input
            id={`${prefix}-tag-sort`}
            type="number"
            step={1}
            disabled={disabled}
            value={draft.sortOrder}
            onChange={(event) => setDraft({ ...draft, sortOrder: event.target.value })}
          />
        </div>
        {kind === 'work' && (
          <label className="workspace-check">
            <input
              type="checkbox"
              disabled={disabled}
              checked={draft.isCore}
              onChange={(event) => setDraft({ ...draft, isCore: event.target.checked })}
            />
            핵심 업무 태그
          </label>
        )}
      </>
    );
  }
  return (
    <>
      <h2>
        {companyName} · {kind === 'work' ? '업무 태그' : '노트 태그'}
      </h2>
      {error && (
        <p className="form-message" role="alert">
          {error}
        </p>
      )}
      {notice && <p role="status">{notice}</p>}
      {loading && <p role="status">태그를 불러오고 있습니다.</p>}
      <RefreshButton
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
      <section className="workspace-block" aria-label="기존 태그">
        <h3>기존 태그</h3>
        <p>
          비활성 태그는 새 선택에서 제외되며 과거 연결은 유지됩니다. 연결이 없는 태그만 확인 후
          삭제할 수 있습니다.
        </p>
        {!loading && tags.length === 0 && <p>아직 태그가 없습니다.</p>}
        <ul>
          {tags.map((tag) => (
            <li key={tag.id}>
              <strong>{tag.label}</strong> · {tag.companyId === null ? '공통' : '회사'} ·{' '}
              {tag.isActive ? '활성' : '비활성'}
              {'isCore' in tag && tag.isCore && ' · 핵심'}{' '}
              <button
                className="text-button"
                disabled={disabled || !verifiedList}
                onClick={() => {
                  setEdit(tag);
                  setEditDraft(fromTag(tag));
                  setNeedsRefresh(false);
                  setConfirm(false);
                  setError('');
                  setNotice('');
                }}
              >
                수정: {tag.label} ({tag.companyId === null ? '공통' : '회사'})
              </button>
            </li>
          ))}
        </ul>
      </section>
      {edit && (
        <form
          className="workspace-block"
          aria-label="태그 수정"
          noValidate
          onSubmit={(event) => {
            event.preventDefault();
            void update();
          }}
        >
          <h3>태그 수정</h3>
          <p>범위: {edit.companyId === null ? '공통' : '회사'} (변경 불가)</p>
          {needsRefresh && (
            <p>
              최신 목록에서 태그를 다시 선택한 뒤 저장해 주세요. 입력은 다시 선택하기 전까지
              유지됩니다.
            </p>
          )}
          {fields(editDraft, setEditDraft, 'edit')}
          <button className="button primary" disabled={disabled || needsRefresh}>
            태그 저장
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
          </button>
          {edit.isActive && (
            <button
              type="button"
              className="text-button"
              disabled={disabled || needsRefresh}
              onClick={() => setConfirm('deactivate')}
            >
              비활성화
            </button>
          )}
          {!edit.isActive && (
            <button
              type="button"
              className="text-button"
              disabled={disabled || needsRefresh}
              onClick={() => void update(false, true)}
            >
              다시 활성화
            </button>
          )}
          <button
            type="button"
            className="text-button"
            disabled={disabled || needsRefresh}
            onClick={() => setConfirm('delete')}
          >
            태그 삭제
          </button>
          {confirm === 'delete' && (
            <div role="group" aria-label="태그 삭제 확인">
              <p>
                저장된 태그 “{edit.label}”를 삭제할까요? 입력 중인 수정은 저장하지 않습니다. 연결된
                업무나 프로젝트 기본 태그가 있으면 삭제가 차단됩니다.
                {edit.companyId === null && ' 공통 태그는 본인의 모든 회사에 적용됩니다.'}
              </p>
              <button
                type="button"
                disabled={disabled || needsRefresh}
                onClick={() => void remove()}
              >
                삭제 확인
              </button>
              <button type="button" disabled={disabled} onClick={() => setConfirm(false)}>
                삭제 취소
              </button>
            </div>
          )}
          {confirm === 'deactivate' && (
            <div role="group" aria-label="태그 비활성화 확인">
              <p>
                저장된 태그를 비활성화할까요? 입력 중인 수정은 저장하지 않습니다. 과거 연결은
                유지됩니다.
              </p>
              <button
                type="button"
                disabled={disabled || needsRefresh}
                onClick={() => void update(true)}
              >
                비활성화 확인
              </button>
              <button type="button" disabled={disabled} onClick={() => setConfirm(false)}>
                비활성화 취소
              </button>
            </div>
          )}
        </form>
      )}
      <form
        className="workspace-block"
        aria-label="새 태그 만들기"
        noValidate
        onSubmit={(event) => void create(event)}
      >
        <h3>새 태그 만들기</h3>
        <div className="form-field">
          <label htmlFor="new-tag-scope">적용 범위</label>
          <select
            id="new-tag-scope"
            disabled={disabled || unknownCreate}
            value={scope}
            onChange={(event) => setScope(event.target.value as 'common' | 'company')}
          >
            <option value="company">현재 회사</option>
            <option value="common">본인 공통</option>
          </select>
        </div>
        {fields(createDraft, setCreateDraft, 'new')}
        <button className="button primary" disabled={disabled || unknownCreate || !verifiedList}>
          태그 만들기
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
    </>
  );
}
