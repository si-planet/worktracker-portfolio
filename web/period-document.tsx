import { RefreshButton } from './ui-controls';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { z } from 'zod';
import { createPortal } from 'react-dom';
import {
  zPeriodDocumentScope,
  zPeriodDocumentResult,
  zPeriodDocumentPut,
  zPeriodDocumentConfirm,
  periodDocumentPath,
  assertPeriodDocumentBodyBytes,
  type PeriodDocumentKind,
  type PeriodDocumentScope,
  type PeriodDocument as DocumentRecord,
} from '../shared/schema/period-document';
import { workApi, WorkFailure, workError } from './work-entry-api';
import { setWorkspaceDraftDirty } from './workspace-draft-state';
import './period-document.css';
import { editablePeriodNote, replacePeriodNote, periodNoteCapacity } from './imported-period-note';
const zPending = z.discriminatedUnion('action', [
  z.strictObject({ action: z.literal('save'), ...zPeriodDocumentPut.shape }),
  z.strictObject({
    action: z.literal('confirm'),
    ...zPeriodDocumentConfirm.shape,
    body: z.string().max(5000),
  }),
]);
const zDraft = z.strictObject({
  body: z.string().max(5000),
  baseBody: z.string().max(5000),
  version: z.number().int().positive().max(Number.MAX_SAFE_INTEGER).nullable(),
  pending: zPending.nullable(),
  conflicted: z.boolean(),
});
type Draft = z.output<typeof zDraft>;
export type PeriodDocumentProps = {
  companyId: string;
  userId: string;
  kind: PeriodDocumentKind;
  periodStart: string;
  editing: boolean;
  reportEntry?: boolean;
  externalRefresh?: number;
  mobileControls?: ReactNode;
  primaryAction?: ReactNode;
  online: boolean;
  onExpired: (failure: unknown) => boolean;
};
const labels: Record<PeriodDocumentKind, string> = {
  weekly_report: '작성 주간보고',
  weekly_note: '주간 메모',
  daily_note: '일간 메모',
};
const clean = (document: DocumentRecord | null): Draft => ({
  body: document?.body ?? '',
  baseBody: document?.body ?? '',
  version: document?.version ?? null,
  pending: null,
  conflicted: false,
});
function load(key: string): Draft | null {
  try {
    return zDraft.parse(JSON.parse(sessionStorage.getItem(key) ?? 'null'));
  } catch {
    return null;
  }
}
export function PeriodDocument(props: PeriodDocumentProps) {
  const scope = zPeriodDocumentScope.safeParse({
    companyId: props.companyId,
    kind: props.kind,
    periodStart: props.periodStart,
  });
  if (!scope.success)
    return <p role="alert">문서 날짜를 확인해 주세요. 주간 문서는 해당 주 월요일을 선택하세요.</p>;
  return (
    <PeriodDocumentScopeEditor
      key={`${props.userId}/${props.companyId}/${props.kind}/${props.periodStart}`}
      {...props}
      scope={scope.data}
    />
  );
}
function PeriodDocumentScopeEditor({
  userId,
  kind,
  periodStart,
  editing,
  reportEntry = false,
  externalRefresh,
  mobileControls,
  primaryAction,
  online,
  onExpired,
  scope,
}: PeriodDocumentProps & { scope: PeriodDocumentScope }) {
  const [reportView, setReportView] = useState<'list' | 'review' | 'edit'>('list');
  const entry = reportEntry && kind === 'weekly_report';
  const canEdit = entry ? reportView === 'edit' : editing;
  const editor = useRef<HTMLDivElement>(null);
  const entryButton = useRef<HTMLButtonElement>(null);
  const reportFocusOrigin = useRef<HTMLElement | null>(null);
  function focusReport() {
    const origin = reportFocusOrigin.current;
    if (!origin) return;
    if (document.activeElement !== origin) {
      reportFocusOrigin.current = null;
      return;
    }
    const target = editor.current?.querySelector<HTMLElement>(
      reportView === 'edit' ? 'textarea:not(:disabled)' : '[tabindex="-1"]',
    );
    if (target) {
      reportFocusOrigin.current = null;
      target.focus();
    }
  }
  function openReport(next: 'review' | 'edit') {
    reportFocusOrigin.current =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;
    setReportView(next);
    if (next === reportView) requestAnimationFrame(focusReport);
  }
  function reportList() {
    reportFocusOrigin.current = null;
    setReportView('list');
    requestAnimationFrame(() => entryButton.current?.focus());
  }
  const key = `wt:period-document:v1:${encodeURIComponent(userId)}:${scope.companyId}/${kind}/${periodStart}`;
  const [draft, setDraft] = useState<Draft | null>(() => load(key));
  const current = useRef(draft);
  current.current = draft;
  const [server, setServer] = useState<{ document: DocumentRecord | null } | null>(null);
  const [error, setError] = useState(''),
    [message, setMessage] = useState(''),
    [busy, setBusy] = useState(false),
    [denied, setDenied] = useState(false),
    [confirming, setConfirming] = useState(false),
    [storageFailed, setStorageFailed] = useState(false),
    [reviewReady, setReviewReady] = useState(false),
    [navigation, setNavigation] = useState<{ href: string; origin: HTMLAnchorElement } | null>(
      null,
    );
  const alive = useRef(true),
    revision = useRef(0),
    lock = useRef(false),
    dialog = useRef<HTMLDialogElement>(null),
    navigationDialog = useRef<HTMLDialogElement>(null),
    allowNavigation = useRef(false),
    confirmOrigin = useRef<HTMLButtonElement | null>(null),
    heading = useRef<HTMLHeadingElement>(null);
  const dirty = !!draft && (draft.body !== draft.baseBody || !!draft.pending || draft.conflicted);
  const dirtyRef = useRef(dirty);
  dirtyRef.current = dirty;
  const confirmed = server?.document?.confirmedAt != null;
  const blocked = busy || !online || !navigator.onLine || !server || denied;
  useEffect(() => {
    if (!entry || reportView === 'list') return;
    const frame = requestAnimationFrame(focusReport);
    return () => cancelAnimationFrame(frame);
  }, [entry, reportView, !!draft, busy, denied, confirmed]);
  function update(value: Draft) {
    current.current = value;
    setDraft(value);
    try {
      sessionStorage.setItem(key, JSON.stringify(value));
    } catch {
      setStorageFailed(true);
    }
  }
  function fail(e: unknown) {
    if (e instanceof WorkFailure && e.status === 401) {
      const preserved = current.current;
      if (preserved) {
        try {
          sessionStorage.setItem(key, JSON.stringify(preserved));
        } catch {
          setStorageFailed(true);
        }
      }
      allowNavigation.current = true;
      if (onExpired(e)) return;
      allowNavigation.current = false;
    } else if (onExpired(e)) return;
    if (e instanceof WorkFailure && e.status === 403) {
      setDenied(true);
      setServer(null);
    }
    setError(
      e instanceof WorkFailure && e.status === 409
        ? '다른 저장이나 확정이 있습니다. 입력을 유지하고 최신 버전을 검토하세요.'
        : e instanceof WorkFailure && e.reason === 'PERIOD_DOCUMENT_EMPTY_REPORT'
          ? '공란 보고는 확정할 수 없습니다. 내용을 저장하세요.'
          : workError(e),
    );
  }
  const schema = zPeriodDocumentResult.refine(
    (v) => v.companyId === scope.companyId && v.kind === kind && v.periodStart === periodStart,
  );
  async function read(recover = false) {
    if (!online || !navigator.onLine || lock.current) return;
    const ticket = ++revision.current;
    lock.current = true;
    setBusy(true);
    setError('');
    try {
      const result = await workApi(periodDocumentPath(scope), schema);
      if (!alive.current || ticket !== revision.current) return;
      setDenied(false);
      setServer({ document: result.document });
      setReviewReady(true);
      const existing = current.current;
      if (
        !existing ||
        (!existing.pending && !existing.conflicted && existing.body === existing.baseBody)
      )
        update(clean(result.document));
      else if (recover && existing.pending) {
        const pending = existing.pending,
          doc = result.document;
        const matched =
          !!doc &&
          doc.body === pending.body &&
          doc.version === (pending.version === null ? 1 : pending.version + 1) &&
          (pending.action === 'save'
            ? doc.confirmedAt === null
            : doc.confirmationId === pending.commandId);
        if (matched) {
          update(clean(doc));
          setMessage(
            pending.action === 'confirm'
              ? '보존한 확정 명령과 일치하는 확정 결과를 확인했습니다.'
              : '서버에서 제출 내용과 기대 버전을 확인했습니다.',
          );
        } else
          setMessage(
            '제출 내용·버전·확정 명령과 일치하는 결과를 확인하지 못했습니다. 입력과 요청을 보존했습니다.',
          );
      } else if (!existing.pending && existing.version !== (result.document?.version ?? null))
        update({ ...existing, conflicted: true });
    } catch (e) {
      if (alive.current && ticket === revision.current) fail(e);
    } finally {
      lock.current = false;
      if (alive.current && ticket === revision.current) setBusy(false);
    }
  }
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  useEffect(() => {
    void read(externalRefresh !== undefined && !!current.current?.pending);
  }, [online, externalRefresh]);
  useEffect(() => {
    setWorkspaceDraftDirty(key, dirty);
    return () => setWorkspaceDraftDirty(key, false);
  }, [key, dirty]);
  useEffect(() => {
    const before = (e: BeforeUnloadEvent) => {
      if (!dirtyRef.current || e.defaultPrevented || allowNavigation.current) return;
      e.preventDefault();
      e.returnValue = '';
    };
    const click = (e: MouseEvent) => {
      if (
        !dirtyRef.current ||
        e.defaultPrevented ||
        e.button !== 0 ||
        e.metaKey ||
        e.ctrlKey ||
        e.shiftKey ||
        e.altKey
      )
        return;
      const a = e.target instanceof Element ? e.target.closest('a[href]') : null;
      if (
        !(a instanceof HTMLAnchorElement) ||
        a.target ||
        a.download ||
        a.origin !== location.origin ||
        a.href === location.href
      )
        return;
      e.preventDefault();
      setNavigation({ href: a.href, origin: a });
    };
    window.addEventListener('beforeunload', before);
    document.addEventListener('click', click, true);
    return () => {
      window.removeEventListener('beforeunload', before);
      document.removeEventListener('click', click, true);
    };
  }, []);
  useEffect(() => {
    if (confirming && dialog.current && !dialog.current.open) {
      dialog.current.showModal();
      dialog.current.querySelector<HTMLButtonElement>('button')?.focus();
    }
  }, [confirming]);
  useEffect(() => {
    if (navigation && navigationDialog.current && !navigationDialog.current.open) {
      navigationDialog.current.showModal();
      navigationDialog.current.querySelector<HTMLButtonElement>('button')?.focus();
    }
  }, [navigation]);
  function cancelConfirmation() {
    dialog.current?.close();
    setConfirming(false);
    confirmOrigin.current?.focus();
  }
  function cancelNavigation() {
    const origin = navigation?.origin;
    navigationDialog.current?.close();
    setNavigation(null);
    origin?.focus();
  }
  async function send(action: 'save' | 'confirm') {
    const d = current.current;
    if (!d || blocked || lock.current || !canEdit || confirmed || d.pending || d.conflicted) return;
    const pending =
      action === 'save'
        ? { action: 'save' as const, body: d.body, version: d.version }
        : {
            action: 'confirm' as const,
            body: d.body,
            version: d.version!,
            commandId: crypto.randomUUID(),
          };
    if (action === 'confirm' && (d.version === null || d.body !== d.baseBody || !d.body.trim()))
      return;
    try {
      assertPeriodDocumentBodyBytes(
        action === 'save'
          ? { body: pending.body, version: pending.version }
          : {
              version: pending.version,
              commandId: 'commandId' in pending ? pending.commandId : '',
            },
      );
    } catch {
      setError('저장 요청은 8,192바이트까지입니다. 본문을 줄여 주세요.');
      return;
    }
    lock.current = true;
    const ticket = ++revision.current;
    setBusy(true);
    setReviewReady(false);
    setError('');
    setMessage('');
    update({ ...d, pending });
    setConfirming(false);
    dialog.current?.close();
    try {
      const request =
        action === 'save'
          ? { body: d.body, version: d.version }
          : { version: d.version, commandId: 'commandId' in pending ? pending.commandId : '' };
      const result = await workApi(
        periodDocumentPath(scope) + (action === 'confirm' ? '/confirm' : ''),
        schema.refine(
          (v) =>
            v.document !== null &&
            v.document.body === d.body &&
            v.document.version === (d.version === null ? 1 : d.version + 1) &&
            (action === 'save'
              ? v.document.confirmedAt === null
              : v.document.confirmationId === ('commandId' in pending ? pending.commandId : '')),
        ),
        action === 'save' ? 'PUT' : 'POST',
        request,
      );
      if (!alive.current || ticket !== revision.current) return;
      setServer({ document: result.document });
      update(clean(result.document));
      setMessage(action === 'save' ? '저장했습니다.' : '보고를 확정했습니다.');
      if (entry && action === 'save') reportList();
      if (action === 'confirm') requestAnimationFrame(() => heading.current?.focus());
    } catch (e) {
      if (!alive.current || ticket !== revision.current) return;
      if (e instanceof WorkFailure && [400, 409, 422].includes(e.status))
        update({ ...d, pending: null, conflicted: e.status === 409 });
      fail(e);
    } finally {
      lock.current = false;
      if (alive.current && ticket === revision.current) setBusy(false);
    }
  }
  function unreadMessage(loading: string) {
    if (!online) return '오프라인입니다. 연결 후 다시 조회해 주세요.';
    if (busy) return loading;
    return error ? '문서를 불러오지 못했습니다. 다시 조회해 주세요.' : '문서를 조회해 주세요.';
  }
  const label = labels[kind];
  return (
    <section
      className={`period-document${entry ? ' weekly-report-entry' : ''}${entry && reportView === 'list' ? ' is-report-list' : ''}${entry && server?.document === null && !dirty && !error && !busy ? ' is-empty' : ''}`}
      aria-label={label}
    >
      {entry && (
        <>
          <div className="period-document-heading">
            {primaryAction}
            <div>
              <h3>작성 주간보고</h3>
            </div>
            <button
              type="button"
              ref={entryButton}
              onClick={() => openReport(confirmed ? 'review' : 'edit')}
            >
              주간보고 작성
            </button>
            {mobileControls}
          </div>
          {server?.document ? (
            <div className="weekly-report-row">
              <span>
                {periodStart} 주간보고 · {confirmed ? '확정됨' : '저장됨'} · 버전{' '}
                {server.document.version}
              </span>
              <div>
                <button type="button" onClick={() => openReport('review')}>
                  보고서 열기
                </button>
                {!confirmed && (
                  <button type="button" onClick={() => openReport('edit')}>
                    보고서 편집
                  </button>
                )}
              </div>
            </div>
          ) : (
            <p className="field-hint">
              {server
                ? '이 주에 저장한 보고가 없습니다.'
                : unreadMessage('저장된 보고를 확인하고 있습니다.')}
            </p>
          )}
          {dirty && <p className="field-hint">미저장 초안을 이 탭에 보관하고 있습니다.</p>}
          {reportView !== 'list' && (
            <div className="weekly-report-actions" aria-label="주간보고 보기 모드">
              <button
                type="button"
                aria-pressed={reportView === 'review'}
                onClick={() => openReport('review')}
              >
                보고 확인
              </button>
              {!confirmed && (
                <button
                  type="button"
                  aria-pressed={reportView === 'edit'}
                  onClick={() => openReport('edit')}
                >
                  보고 편집
                </button>
              )}
              <button type="button" onClick={reportList}>
                목록으로 · 초안 유지
              </button>
              <button
                type="button"
                disabled={busy || !!draft?.pending || !server}
                onClick={() => {
                  if (dirty && !window.confirm('미저장 보고 입력을 취소할까요?')) return;
                  update(clean(server!.document));
                  setMessage('미저장 입력을 취소했습니다.');
                  reportList();
                }}
              >
                작성 취소
              </button>
            </div>
          )}
        </>
      )}
      {entry && reportView === 'list' && (error || message || busy) && (
        <p role={error ? 'alert' : 'status'}>{error || message || '문서를 확인하고 있습니다.'}</p>
      )}
      <div ref={editor} hidden={entry && reportView === 'list'}>
        <div className="period-document-heading">
          <h3 ref={heading} tabIndex={-1}>
            {label}
          </h3>
          {externalRefresh === undefined && (
            <RefreshButton
              type="button"
              disabled={busy || !online}
              onClick={() => void read(!!draft?.pending)}
              busy={!!busy}
              showLabel
              aria-label={draft?.pending ? '저장 결과 확인' : '문서 조회'}
              title={draft?.pending ? '저장 결과 확인' : '문서 조회'}
            >
              {draft?.pending ? '저장 결과 확인' : '문서 조회'}
            </RefreshButton>
          )}
        </div>
        <p>
          {periodStart}
          {kind === 'daily_note' ? '' : ' 시작 주'} ·{' '}
          {confirmed ? '확정됨' : server ? (server.document ? '저장됨' : '미등록') : '확인 전'}
        </p>
        {!online && <p role="status">오프라인 · 입력을 보관하며 서버에 저장하지 않습니다.</p>}
        {busy && <p role="status">문서를 확인하고 있습니다.</p>}
        {error && <p role="alert">{error}</p>}
        {message && <p role="status">{message}</p>}
        {storageFailed && (
          <p role="alert">탭 저장소를 사용할 수 없어 현재 화면에서만 입력을 유지합니다.</p>
        )}
        {denied ? (
          <p>접근할 수 없는 문서입니다. 계정별 초안은 보관했습니다.</p>
        ) : (
          <>
            {(!canEdit || confirmed) && (
              <p className="period-document-body">
                {(server?.document?.body ? editablePeriodNote(server.document.body) : '') ||
                  (server ? '저장된 내용이 없습니다.' : unreadMessage('문서를 불러오고 있습니다.'))}
              </p>
            )}
            {confirmed && <p>확정한 보고는 수정할 수 없습니다.</p>}
            {draft?.pending && (
              <p role="status">
                저장 결과 확인이 필요합니다. 입력·버전
                {draft.pending.action === 'confirm' ? '·확정 명령' : ''}을 보존했으며 자동
                재전송하지 않습니다.
              </p>
            )}
            {(!canEdit || confirmed) && dirty && (
              <details>
                <summary>보관된 입력 초안</summary>
                <p className="period-document-body">
                  {draft?.body ? editablePeriodNote(draft.body) : '(공란)'}
                </p>
              </details>
            )}
            {canEdit && !confirmed && draft && (
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  void send('save');
                }}
              >
                <label>
                  {label} 내용
                  <textarea
                    maxLength={periodNoteCapacity(draft.body)}
                    value={editablePeriodNote(draft.body)}
                    disabled={busy || !!draft.pending || !server}
                    placeholder={
                      kind === 'weekly_report'
                        ? '이번 주 진행 내용, 이슈, 다음 계획을 직접 작성하세요.'
                        : '필요한 내용을 자유롭게 적으세요.'
                    }
                    onChange={(e) =>
                      update({ ...draft, body: replacePeriodNote(draft.body, e.target.value) })
                    }
                  />
                </label>
                <p>
                  최대 5,000자 · 입력 후 저장하세요.
                  {kind === 'weekly_report' ? ' 저장과 확정은 별도입니다.' : ''}
                </p>
                <button type="submit" disabled={blocked || !!draft.pending || draft.conflicted}>
                  저장
                </button>
                {kind === 'weekly_report' && (
                  <button
                    type="button"
                    disabled={blocked || dirty || draft.version === null || !draft.body.trim()}
                    onClick={(e) => {
                      confirmOrigin.current = e.currentTarget;
                      setConfirming(true);
                    }}
                  >
                    보고 확정
                  </button>
                )}
              </form>
            )}
            {canEdit && draft && dirty && (
              <button
                type="button"
                disabled={busy || !!draft.pending || !server}
                onClick={() => {
                  update(clean(server!.document));
                  setMessage('미저장 입력을 취소했습니다.');
                }}
              >
                입력 취소
              </button>
            )}
            {canEdit && draft && server && reviewReady && (draft.conflicted || draft.pending) && (
              <button
                type="button"
                disabled={busy}
                onClick={() => {
                  update({
                    ...draft,
                    baseBody: server.document?.body ?? '',
                    version: server.document?.version ?? null,
                    pending: null,
                    conflicted: false,
                  });
                  setMessage('입력을 유지하고 조회한 버전으로 검토합니다. 저장은 직접 실행하세요.');
                }}
              >
                입력 유지하고 조회 버전 검토
              </button>
            )}
          </>
        )}
      </div>
      {navigation &&
        createPortal(
          <dialog
            className="period-document-dialog"
            ref={navigationDialog}
            aria-label="미저장 문서 이동 확인"
            onCancel={(e) => {
              e.preventDefault();
              cancelNavigation();
            }}
          >
            <h4>미저장 문서 입력이 있습니다.</h4>
            <p>이 탭의 초안을 보관하고 이동할까요?</p>
            <button type="button" onClick={cancelNavigation}>
              이동 취소
            </button>
            <button
              type="button"
              onClick={() => {
                allowNavigation.current = true;
                location.assign(navigation.href);
              }}
            >
              초안 보관하고 이동
            </button>
          </dialog>,
          document.body,
        )}
      {confirming &&
        createPortal(
          <dialog
            className="period-document-dialog"
            ref={dialog}
            aria-labelledby={`period-confirm-${kind}-${periodStart}`}
            onCancel={(e) => {
              e.preventDefault();
              cancelConfirmation();
            }}
          >
            <h4 id={`period-confirm-${kind}-${periodStart}`}>저장된 보고를 확정할까요?</h4>
            <p>확정한 본문은 수정하거나 확정을 취소할 수 없습니다.</p>
            <button type="button" onClick={cancelConfirmation}>
              확정 취소
            </button>
            <button type="button" disabled={blocked} onClick={() => void send('confirm')}>
              저장된 보고 확정
            </button>
          </dialog>,
          document.body,
        )}
    </section>
  );
}
