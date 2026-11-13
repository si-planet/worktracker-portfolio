import { HelpHint } from './help-hint';
import { RefreshButton } from './ui-controls';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { z } from 'zod';
import {
  zMonthlyFocusCreate,
  zMonthlyFocusPatch,
  zMonthlyFocusDelete,
  zMonthlyFocusItem,
  zMonthlyFocusMonth,
  type MonthlyFocusItem,
} from '../shared/schema/monthly-focus';
import { workApi, WorkFailure } from './work-entry-api';
import {
  readMonthlyFocus,
  createMonthlyFocus,
  patchMonthlyFocus,
  deleteMonthlyFocus,
  focusValuesMatch,
  monthlyFocusError,
} from './monthly-focus-api';
import './monthly-focus.css';
const zProfile = z.strictObject({
  userId: z.string().min(1).max(128),
  username: z.string().min(1).max(32),
  email: z.email(),
  emailVerified: z.literal(true),
  lastCompanyId: z.uuid().nullable(),
  capabilities: z.strictObject({ manageSignup: z.boolean() }).optional(),
});
const zCommand = z.discriminatedUnion('intent', [
  z.strictObject({ intent: z.literal('create'), body: zMonthlyFocusCreate }),
  z.strictObject({ intent: z.literal('edit'), body: zMonthlyFocusPatch }),
  z.strictObject({ intent: z.literal('delete'), body: zMonthlyFocusDelete }),
]);
type Command = z.output<typeof zCommand>;
const zEditor = z.strictObject({
  id: z.uuid(),
  title: z.string().max(200),
  detail: z.string().max(5000),
  clearDetail: z.boolean(),
  order: z.string().max(32),
  original: zMonthlyFocusItem.nullable(),
  intent: z.enum(['create', 'edit', 'delete']),
  command: zCommand.nullable(),
  completed: z.boolean(),
});
type Editor = z.output<typeof zEditor>;
function fresh(item: MonthlyFocusItem | null = null, intent: Editor['intent'] = 'create'): Editor {
  return {
    id: item?.id ?? crypto.randomUUID(),
    title: item?.title ?? '',
    detail: item?.detail ?? '',
    clearDetail: false,
    order: String(item?.sortOrder ?? 0),
    original: item,
    intent,
    command: null,
    completed: false,
  };
}
function store(key: string, value: unknown) {
  try {
    if (value === null) sessionStorage.removeItem(key);
    else sessionStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* Optional storage. */
  }
}
function read(key: string, company: string, year: number, month: number): Editor | null {
  try {
    const r = zEditor.safeParse(JSON.parse(sessionStorage.getItem(key) ?? 'null'));
    if (
      r.success &&
      (r.data.intent === 'create') === !r.data.original &&
      (!r.data.command || r.data.command.intent === r.data.intent) &&
      (!r.data.command ||
        r.data.command.intent !== 'create' ||
        (r.data.command.body.id === r.data.id &&
          r.data.command.body.year === year &&
          r.data.command.body.month === month)) &&
      (!r.data.command ||
        r.data.command.intent === 'create' ||
        r.data.command.body.version === r.data.original?.version) &&
      (!r.data.original ||
        (r.data.original.id === r.data.id &&
          r.data.original.companyId === company &&
          r.data.original.year === year &&
          r.data.original.month === month))
    )
      return r.data;
  } catch {
    /* Invalid drafts are ignored. */
  }
  return null;
}
export function MonthlyFocus({
  companyId,
  month,
  online,
  disabled = false,
  editable = true,
  onExpired,
  context,
}: {
  companyId: string;
  month: string;
  online: boolean;
  disabled?: boolean;
  editable?: boolean;
  onExpired: (e: unknown) => boolean;
  context: 'week' | 'month';
}) {
  const parsed = zMonthlyFocusMonth.safeParse({
    year: Number(month.slice(0, 4)),
    month: Number(month.slice(5, 7)),
  });
  const [userId, setUserId] = useState<string | null>(null),
    [error, setError] = useState(''),
    [retry, setRetry] = useState(0);
  useEffect(() => {
    let active = true;
    if (!online) return;
    setError('');
    void workApi('/api/me', zProfile)
      .then((v) => {
        if (active) setUserId(v.userId);
      })
      .catch((e) => {
        if (active && !onExpired(e)) setError(monthlyFocusError(e));
      });
    return () => {
      active = false;
    };
  }, [companyId, online, retry]);
  return (
    <section className="monthly-focus" aria-label="월간 주요사항">
      <h3>월간 주요사항 · {month}</h3>
      <p>
        {context === 'week'
          ? '주간 화면에서 선택한 날짜의 달력 월'
          : '월간 화면에서 표시 중인 달력 월'}{' '}
        기준입니다. ISO 주차연도·달력 검색 조건과 별개인 회사 전체 메모입니다.
      </p>
      <HelpHint label="월간 메모">
        현재 월 메모를 표시합니다. 자동 요일 배치·업무 생성·주간 계획·달성률 분모에 연결하지
        않습니다. 실제 할 일은 일반 업무로 별도 등록해 주세요.
      </HelpHint>
      {error && <p role="alert">{error}</p>}
      {!parsed.success && <p role="alert">실제 달력 연도와 월을 확인해 주세요.</p>}
      {!userId && (
        <>
          <p>본인 정보와 계정별 월 메모 초안을 준비하고 있습니다.</p>
          <RefreshButton type="button" disabled={!online} onClick={() => setRetry((n) => n + 1)}>
            주요사항 본인 정보 다시 확인
          </RefreshButton>
        </>
      )}
      {userId && parsed.success && (
        <FocusEditor
          key={`${userId}:${companyId}:${month}`}
          companyId={companyId}
          userId={userId}
          year={parsed.data.year}
          month={parsed.data.month}
          online={online}
          disabled={disabled}
          editable={editable}
          onExpired={onExpired}
        />
      )}
    </section>
  );
}
function FocusEditor({
  companyId,
  userId,
  year,
  month,
  online,
  disabled,
  editable,
  onExpired,
}: {
  companyId: string;
  userId: string;
  year: number;
  month: number;
  online: boolean;
  disabled: boolean;
  editable: boolean;
  onExpired: (e: unknown) => boolean;
}) {
  const key = `wt:monthly-focus:v1:${encodeURIComponent(userId)}:${companyId}:${year}-${month}`;
  const [editor, setEditor] = useState<Editor | null>(() => read(key, companyId, year, month)),
    [items, setItems] = useState<MonthlyFocusItem[]>([]),
    [ready, setReady] = useState(false),
    [loading, setLoading] = useState(false),
    [pending, setPending] = useState(false),
    [denied, setDenied] = useState(false),
    [error, setError] = useState(''),
    [notice, setNotice] = useState(''),
    [reload, setReload] = useState(0);
  const [latest, setLatest] = useState<MonthlyFocusItem | null>(null),
    [verified, setVerified] = useState<'matched' | 'unchanged' | 'different' | null>(null),
    [absent, setAbsent] = useState(false);
  const revision = useRef(0),
    operation = useRef(0),
    lock = useRef(false),
    heading = useRef<HTMLHeadingElement>(null),
    deleteCancel = useRef<HTMLButtonElement>(null),
    current = useRef(editor);
  current.current = editor;
  useEffect(() => {
    store(key, editor);
  }, [key, editor]);
  useEffect(
    () => () => {
      operation.current++;
    },
    [],
  );
  useEffect(() => {
    if (editor?.intent === 'delete' && !editor.command && !editor.completed)
      deleteCancel.current?.focus();
    else if (editor) heading.current?.focus();
  }, [editor?.id, editor?.intent]);
  function fail(value: unknown) {
    store(key, current.current);
    if (onExpired(value)) return true;
    if (value instanceof WorkFailure && value.status === 403) {
      revision.current++;
      setDenied(true);
      setItems([]);
      setLatest(null);
      setError('이 회사의 월간 주요사항에 접근할 수 없습니다. 계정별 초안을 보관합니다.');
      return true;
    }
    return false;
  }
  useEffect(() => {
    const ticket = ++revision.current;
    if (!online || denied) return;
    setLoading(true);
    setError('');
    void readMonthlyFocus(companyId, year, month)
      .then((v) => {
        if (ticket === revision.current) {
          setItems(v.items);
          setReady(true);
        }
      })
      .catch((e) => {
        if (ticket === revision.current && !fail(e)) setError(monthlyFocusError(e));
      })
      .finally(() => {
        if (ticket === revision.current) setLoading(false);
      });
    return () => {
      revision.current++;
    };
  }, [reload, online]);
  function reflected(value: MonthlyFocusItem[], command: Command) {
    if (!editor) return;
    setItems(value);
    setReady(true);
    const item = value.find((i) => i.id === editor.id) ?? null;
    setLatest(item);
    setAbsent(item === null);
    let matched = false;
    if (command.intent === 'delete') matched = item === null;
    else if (item) {
      const before = editor.original;
      const expected =
        command.intent === 'create'
          ? command.body
          : {
              title: command.body.title ?? before!.title,
              detail: command.body.detail === undefined ? before!.detail : command.body.detail,
              sortOrder: command.body.sortOrder ?? before!.sortOrder,
            };
      matched =
        focusValuesMatch(item, expected) &&
        item.version === (command.intent === 'create' ? 1 : before!.version + 1) &&
        (command.intent === 'create' || item.createdAt === before!.createdAt);
    }
    if (matched) {
      setVerified('matched');
      setEditor((old) => (old ? { ...old, command: null, completed: true } : old));
      setNotice(
        command.intent === 'delete'
          ? '소유 회사·월의 전체 목록에서 해당 ID가 현재 없음을 확인했습니다. 삭제 영수증이나 이 요청의 저장 주체로 단정하지 않습니다.'
          : '소유 회사·월의 전체 목록에서 요청한 값과 기대 버전이 반영된 것을 확인했습니다. 명령 영수증이나 저장 주체로 단정하지 않습니다.',
      );
    } else if (
      (command.intent === 'create' && !item) ||
      (item &&
        editor.original &&
        item.version === editor.original.version &&
        item.createdAt === editor.original.createdAt &&
        focusValuesMatch(item, editor.original))
    ) {
      setVerified('unchanged');
      setNotice(
        '현재 월 목록에서 요청한 변경이 반영되지 않은 상태를 확인했습니다. 입력과 고정 ID·원래 버전을 유지하며 자동 재전송하지 않습니다.',
      );
    } else {
      setVerified('different');
      setNotice(
        '현재 메모가 없거나 후속 버전·내용이 다릅니다. 이 요청의 성공 여부를 단정하지 않습니다. 원래 입력과 최신 값을 비교하세요.',
      );
    }
  }
  async function check() {
    if (lock.current || !online || denied || !editor?.command) return;
    lock.current = true;
    setPending(true);
    revision.current++;
    setLoading(false);
    setError('');
    const ticket = operation.current;
    try {
      const v = await readMonthlyFocus(companyId, year, month);
      if (ticket === operation.current) reflected(v.items, editor.command);
    } catch (e) {
      if (ticket === operation.current && !fail(e)) setError(monthlyFocusError(e));
    } finally {
      if (ticket === operation.current) {
        lock.current = false;
        setPending(false);
      }
    }
  }
  function commandFor(value: Editor): Command {
    if (value.intent === 'delete')
      return {
        intent: 'delete',
        body: zMonthlyFocusDelete.parse({ version: value.original!.version }),
      };
    if (!/^-?\d+$/.test(value.order)) throw new Error('순서는 안전한 범위의 정수로 입력해 주세요.');
    const order = Number(value.order);
    if (value.intent === 'create')
      return {
        intent: 'create',
        body: zMonthlyFocusCreate.parse({
          id: value.id,
          year,
          month,
          title: value.title,
          detail: value.clearDetail ? null : value.detail,
          sortOrder: order,
        }),
      };
    return {
      intent: 'edit',
      body: zMonthlyFocusPatch.parse({
        version: value.original!.version,
        title: value.title,
        sortOrder: order,
        ...(value.clearDetail
          ? { detail: null }
          : value.detail !== (value.original!.detail ?? '')
            ? { detail: value.detail }
            : {}),
      }),
    };
  }
  async function submit(event?: FormEvent) {
    event?.preventDefault();
    if (
      lock.current ||
      !online ||
      disabled ||
      !editable ||
      denied ||
      !editor ||
      editor.command ||
      editor.completed
    )
      return;
    let command: Command;
    try {
      command = commandFor(editor);
    } catch (e) {
      setError(
        e instanceof z.ZodError
          ? '제목·메모 길이와 안전한 정수 순서를 확인해 주세요.'
          : e instanceof Error
            ? e.message
            : '입력을 확인해 주세요.',
      );
      return;
    }
    const next = { ...editor, command };
    setEditor(next);
    current.current = next;
    store(key, next);
    setError('');
    setNotice('');
    setLatest(null);
    setVerified(null);
    setAbsent(false);
    lock.current = true;
    setPending(true);
    revision.current++;
    setLoading(false);
    const ticket = operation.current;
    try {
      if (command.intent === 'create') await createMonthlyFocus(companyId, command.body);
      else if (command.intent === 'edit')
        await patchMonthlyFocus(companyId, editor.original!, command.body);
      else await deleteMonthlyFocus(companyId, editor.original!);
      if (ticket !== operation.current) return;
      setEditor((old) => (old ? { ...old, command: null, completed: true } : old));
      setNotice(
        command.intent === 'delete'
          ? '월간 주요사항 메모를 삭제했습니다. 업무·계획·보고·달성률은 변경하지 않았습니다.'
          : '월간 주요사항 메모를 저장했습니다. 업무를 생성하거나 배치하지 않습니다.',
      );
      setReload((n) => n + 1);
    } catch (e) {
      if (ticket !== operation.current || fail(e)) return;
      setError(monthlyFocusError(e));
      if (e instanceof WorkFailure && [400, 422].includes(e.status))
        setEditor((old) => (old ? { ...old, command: null } : old));
      else {
        try {
          const v = await readMonthlyFocus(companyId, year, month);
          if (ticket === operation.current) reflected(v.items, command);
        } catch (f) {
          if (ticket === operation.current && !fail(f)) setError(monthlyFocusError(f));
        }
      }
    } finally {
      if (ticket === operation.current) {
        lock.current = false;
        setPending(false);
      }
    }
  }
  function choose(item: MonthlyFocusItem | null, intent: Editor['intent']) {
    if (!editable) return;
    setEditor(fresh(item, intent));
    setLatest(null);
    setVerified(null);
    setAbsent(false);
    setError('');
    setNotice('');
  }
  const busy = disabled || pending || !online || denied,
    locked = busy || !editable || !!editor?.command || !!editor?.completed;
  if (denied)
    return (
      <>
        <p role="alert">{error}</p>
        <a className="control-link" href="/">
          회사 선택으로 돌아가기
        </a>
      </>
    );
  return (
    <>
      {!online && (
        <p role="status">오프라인 읽기 전용입니다. 월별 초안을 보관하고 자동 저장하지 않습니다.</p>
      )}
      {error && <p role="alert">{error}</p>}
      {notice && <p role="status">{notice}</p>}
      <div className="work-actions">
        <button
          type="button"
          hidden={!editable}
          disabled={busy || !!editor}
          onClick={() => choose(null, 'create')}
        >
          월간 주요사항 추가
        </button>
        <RefreshButton
          type="button"
          disabled={busy || loading || !!editor?.command}
          onClick={() => setReload((n) => n + 1)}
          busy={loading || !!busy}
        >
          월간 주요사항 다시 조회
        </RefreshButton>
      </div>
      {loading && <p role="status">월간 주요사항을 불러오고 있습니다.</p>}
      {ready && !items.length && <p>이 달의 월간 주요사항 메모가 없습니다.</p>}
      <ul aria-label="월간 주요사항 목록" className="work-list">
        {items.map((item) => (
          <li className="work-card" key={item.id}>
            <h4>{item.title}</h4>
            <p className="monthly-focus-detail">{item.detail ?? '메모 없음'}</p>
            <p>
              순서 {item.sortOrder} · 버전 {item.version}
            </p>
            <button
              type="button"
              hidden={!editable}
              aria-label={`주요사항 편집: ${item.title}`}
              disabled={busy || !!editor}
              onClick={() => choose(item, 'edit')}
            >
              편집
            </button>
            <button
              type="button"
              hidden={!editable}
              aria-label={`주요사항 삭제: ${item.title}`}
              disabled={busy || !!editor}
              onClick={() => choose(item, 'delete')}
            >
              삭제
            </button>
          </li>
        ))}
      </ul>
      {editor && (
        <section aria-label="월간 주요사항 검토" className="monthly-focus-editor">
          <h4 ref={heading} tabIndex={-1}>
            {editor.intent === 'create'
              ? '새 월간 주요사항'
              : editor.intent === 'edit'
                ? '월간 주요사항 편집'
                : '월간 주요사항 삭제 검토'}{' '}
            · {year}년 {month}월
          </h4>
          <p>
            현재 계정·회사·월의 독립 메모입니다.{' '}
            {editor.original
              ? `기준 버전 ${editor.original.version}`
              : '새 메모의 고정 ID를 유지합니다.'}
          </p>
          {!editable && !editor.completed && (
            <p role="status">
              작성 중인 월간 주요사항 초안을 유지합니다. 편집 모드에서 이어서 검토하세요.
            </p>
          )}
          {editor.intent === 'delete' ? (
            editor.completed ? (
              <p>삭제 검토를 마쳤습니다. 위 결과 안내를 확인해 주세요.</p>
            ) : (
              <div hidden={!editable} role="alertdialog" aria-label="월간 주요사항 삭제 확인">
                <p>
                  “{editor.title}” 메모를 삭제할까요? 기준 버전 {editor.original?.version}을
                  확인합니다. 업무·과거 보고·목표·계획은 삭제하지 않습니다.
                </p>
                <button type="button" disabled={locked} onClick={() => void submit()}>
                  월간 주요사항 삭제 확정
                </button>
                <button
                  type="button"
                  disabled={busy || !!editor.command}
                  ref={deleteCancel}
                  onClick={() => setEditor(null)}
                >
                  월간 주요사항 삭제 취소
                </button>
              </div>
            )
          ) : (
            <form hidden={!editable} onSubmit={submit}>
              <fieldset disabled={locked}>
                <legend>제목·메모·순서</legend>
                <label>
                  주요사항 제목
                  <input
                    required
                    maxLength={200}
                    value={editor.title}
                    onChange={(e) => setEditor({ ...editor, title: e.target.value })}
                  />
                </label>
                <label>
                  주요사항 메모
                  <textarea
                    maxLength={5000}
                    disabled={editor.clearDetail}
                    value={editor.detail}
                    onChange={(e) => setEditor({ ...editor, detail: e.target.value })}
                  />
                </label>
                <label className="monthly-focus-check">
                  <input
                    type="checkbox"
                    checked={editor.clearDetail}
                    onChange={(e) => setEditor({ ...editor, clearDetail: e.target.checked })}
                  />
                  메모 비우기
                </label>
                <label>
                  주요사항 순서
                  <input
                    type="number"
                    step="1"
                    min={-Number.MAX_SAFE_INTEGER}
                    max={Number.MAX_SAFE_INTEGER}
                    required
                    value={editor.order}
                    onChange={(e) => setEditor({ ...editor, order: e.target.value })}
                  />
                </label>
                <HelpHint label="메모 표시 순서">
                  작은 순서가 먼저 표시됩니다. 같은 순서는 생성 시각과 ID 순으로 정렬하며 다른
                  메모의 순서를 자동으로 바꾸지 않습니다.
                </HelpHint>
                <button type="submit">월간 주요사항 저장</button>
              </fieldset>
            </form>
          )}
          {editor.command && (
            <section aria-label="주요사항 결과 확인">
              <p>
                불명 결과의 입력·ID·버전을 보관하고 재제출을 잠급니다. 소유 회사·월 전체 목록을
                확인합니다.
              </p>
              <RefreshButton
                type="button"
                disabled={busy}
                onClick={() => void check()}
                busy={!!busy}
                showLabel
              >
                주요사항 결과 다시 확인
              </RefreshButton>
              {verified === 'unchanged' && (
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => {
                    setEditor((old) => (old ? { ...old, command: null } : old));
                    setVerified(null);
                    setError('');
                    setNotice(
                      '고정 ID와 입력·원래 버전을 유지했습니다. 다시 검토하고 직접 저장하세요.',
                    );
                  }}
                >
                  고정 ID·버전으로 재시도 준비
                </button>
              )}
            </section>
          )}
          {latest && (
            <section aria-label="최신 주요사항 비교">
              <h4>최신 메모</h4>
              <p>
                {latest.title} · 순서 {latest.sortOrder} · 버전 {latest.version}
              </p>
              <p className="monthly-focus-detail">{latest.detail ?? '메모 없음'}</p>
              {verified === 'different' && (
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => {
                    setEditor((old) =>
                      old
                        ? {
                            ...old,
                            ...(old.intent === 'delete'
                              ? {
                                  title: latest.title,
                                  detail: latest.detail ?? '',
                                  order: String(latest.sortOrder),
                                }
                              : {}),
                            original: latest,
                            intent: old.intent === 'delete' ? 'delete' : 'edit',
                            command: null,
                            completed: false,
                          }
                        : old,
                    );
                    setLatest(null);
                    setVerified(null);
                    setError('');
                    setNotice(
                      '입력을 유지하고 최신 버전을 선택했습니다. 내용을 다시 비교한 뒤 직접 저장·삭제하세요.',
                    );
                  }}
                >
                  주요사항 입력 유지하고 최신 버전 선택
                </button>
              )}
            </section>
          )}
          {verified === 'different' && absent && (
            <p>
              권한이 확인된 이 회사·월 목록에 해당 메모가 없습니다. 원본을 자동으로 다시 만들지
              않습니다.
            </p>
          )}
          <button
            type="button"
            hidden={!editable}
            disabled={busy || (!!editor.command && !(verified === 'different' && absent))}
            onClick={() => {
              setEditor(null);
              setLatest(null);
              setVerified(null);
              setAbsent(false);
              setError('');
              setNotice('');
            }}
          >
            주요사항 검토 닫기 · 초안 비우기
          </button>
        </section>
      )}
    </>
  );
}
