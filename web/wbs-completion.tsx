import { RefreshButton } from './ui-controls';
import { useEffect, useRef, useState } from 'react';
import { z } from 'zod';
import {
  zWbsCompletionSummary,
  zWbsCompletionInput,
  type WbsCompletionSummary,
} from '../shared/schema/wbs-completion';
import { readWbsCompletion, completeWbs } from './wbs-api';
import { WorkFailure, workError } from './work-entry-api';

const zReview = z
  .strictObject({
    companyId: z.uuid(),
    itemId: z.uuid(),
    planId: z.uuid(),
    projectId: z.uuid(),
    title: z.string().min(1).max(200),
    snapshot: zWbsCompletionSummary,
    input: zWbsCompletionInput,
    phase: z.enum(['draft', 'pending', 'rejected', 'observed']),
  })
  .refine(
    (d) =>
      d.snapshot.companyId === d.companyId &&
      d.snapshot.itemId === d.itemId &&
      d.snapshot.planId === d.planId &&
      d.snapshot.projectId === d.projectId &&
      d.snapshot.completion === null &&
      d.input.version === d.snapshot.itemVersion &&
      d.input.planVersion === d.snapshot.planVersion &&
      d.input.expectedStateToken === d.snapshot.stateToken &&
      sameCounts(d.input.expectedCounts, d.snapshot.counts),
  );
type Review = z.output<typeof zReview>;
type Counts = WbsCompletionSummary['counts'];
function sameCounts(a: Counts, b: Counts) {
  return (['total', 'todo', 'doing', 'paused', 'done', 'canceled'] as const).every(
    (k) => a[k] === b[k],
  );
}
export function completionWarning(counts: Counts) {
  if (!counts.total)
    return '연결 업무 없음 · 연결 업무가 없어도 명시 확인 후 WBS를 완료할 수 있습니다.';
  const remaining = counts.total - counts.done;
  return remaining
    ? `연결 업무 ${counts.total}개 중 ${counts.done}개 완료 · 남은 업무 ${remaining}개가 있습니다. 남은 업무를 그대로 두고 WBS만 완료합니다.`
    : `연결 업무 ${counts.total}개 중 ${counts.done}개 완료 · 연결 업무가 모두 완료됐습니다. WBS 완료는 별도 확인이 필요합니다.`;
}
export function observeCompletion(d: Review, s: WbsCompletionSummary) {
  if (
    s.companyId !== d.companyId ||
    s.itemId !== d.itemId ||
    s.planId !== d.planId ||
    s.projectId !== d.projectId
  )
    return 'different';
  const event = s.completion;
  if (event) {
    if (
      event.commandId !== d.input.id ||
      event.itemVersion !== d.input.version + 1 ||
      event.planVersion !== d.input.planVersion + 1 ||
      event.stateTokenAtCompletion !== d.input.expectedStateToken ||
      !sameCounts(event.countsAtCompletion, d.input.expectedCounts)
    )
      return 'different';
    return s.itemVersion === event.itemVersion && s.planVersion === event.planVersion
      ? 'matching-current'
      : 'matching-later';
  }
  return s.itemVersion === d.input.version &&
    s.planVersion === d.input.planVersion &&
    s.stateToken === d.input.expectedStateToken &&
    sameCounts(s.counts, d.input.expectedCounts)
    ? 'currently-absent'
    : 'changed';
}
function readReview(key: string): Review | null {
  try {
    return zReview.parse(JSON.parse(sessionStorage.getItem(key) ?? 'null'));
  } catch {
    return null;
  }
}
function stamp(at: number) {
  return new Intl.DateTimeFormat('ko-KR', {
    timeZone: 'Asia/Seoul',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).format(new Date(at));
}
function CountText({ counts }: { counts: Counts }) {
  return (
    <p>
      미진행 {counts.todo}개 · 진행 중 {counts.doing}개 · 중단 {counts.paused}개 · 완료{' '}
      {counts.done}개 · 취소 {counts.canceled}개
    </p>
  );
}

export function WbsCompletion({
  companyId,
  userId,
  projectId,
  planId,
  itemId,
  itemTitle,
  itemVersion,
  planVersion,
  online,
  disabled,
  expired,
  onChanged,
}: {
  companyId: string;
  userId: string;
  projectId: string;
  planId: string;
  itemId: string;
  itemTitle: string;
  itemVersion: number;
  planVersion: number;
  online: boolean;
  disabled: boolean;
  expired: (e: unknown) => boolean;
  onChanged: () => void;
}) {
  const key = `wt:wbs-completion:v1:${encodeURIComponent(userId)}:${companyId}/${itemId}`;
  const [review, setReview] = useState(() => {
    const d = readReview(key);
    return d?.companyId === companyId &&
      d.itemId === itemId &&
      d.planId === planId &&
      d.projectId === projectId
      ? d
      : null;
  });
  const [summary, setSummary] = useState<WbsCompletionSummary | null>(null),
    [busy, setBusy] = useState(false),
    [denied, setDenied] = useState(false),
    [error, setError] = useState(''),
    [message, setMessage] = useState(''),
    [confirm, setConfirm] = useState(false),
    [savedCompletion, setSavedCompletion] = useState<WbsCompletionSummary['completion']>(null);
  const current = useRef(review),
    lock = useRef(false),
    alive = useRef(true),
    revision = useRef(0),
    modal = useRef<HTMLDialogElement>(null),
    origin = useRef<HTMLElement | null>(null),
    region = useRef<HTMLElement | null>(null);
  current.current = review;
  const blocked = disabled || busy || !online;
  function store(d: Review | null) {
    if (d) sessionStorage.setItem(key, JSON.stringify(zReview.parse(d)));
    else sessionStorage.removeItem(key);
    current.current = d;
    if (alive.current) setReview(d);
  }
  function fail(e: unknown) {
    if (expired(e)) return;
    if (e instanceof WorkFailure && e.status === 403) {
      setDenied(true);
      setSummary(null);
      setSavedCompletion(null);
      setMessage('');
      setConfirm(false);
    }
    setError(
      e instanceof WorkFailure && e.status === 409
        ? '확인 당시 항목·계획 또는 연결 업무가 변경됐습니다. 고정 명령을 유지했습니다. 최신 요약을 조회하고 새로 확인해 주세요.'
        : e instanceof WorkFailure && e.status === 422
          ? '이미 완료됐거나 완료 조건을 확인할 수 없습니다. 결과를 다시 조회해 주세요.'
          : workError(e),
    );
  }
  async function fetchSummary() {
    return readWbsCompletion({ companyId, projectId, planId, itemId });
  }
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      revision.current++;
    };
  }, []);
  useEffect(() => {
    const ticket = ++revision.current;
    if (!online || denied) return;
    setBusy(true);
    setError('');
    void fetchSummary()
      .then((s) => {
        if (ticket === revision.current) setSummary(s);
      })
      .catch((e) => {
        if (ticket === revision.current) fail(e);
      })
      .finally(() => {
        if (ticket === revision.current) setBusy(false);
      });
    return () => {
      revision.current++;
    };
  }, [key, itemVersion, planVersion, online]);
  useEffect(() => {
    if (!confirm || !modal.current) return;
    const node = modal.current;
    if (!node.open) node.showModal();
    node.querySelector<HTMLButtonElement>('[data-completion-cancel]')?.focus();
    return () => {
      if (node.open) node.close();
    };
  }, [confirm]);
  function close() {
    if (lock.current) return;
    setConfirm(false);
    modal.current?.close();
    queueMicrotask(() => {
      const node = origin.current;
      if (node?.isConnected) node.focus();
      else region.current?.focus();
    });
  }
  function open() {
    if (blocked || denied) return;
    origin.current = document.activeElement as HTMLElement;
    setConfirm(true);
  }
  async function prepare() {
    if (blocked || denied || lock.current) return;
    origin.current = document.activeElement as HTMLElement;
    lock.current = true;
    setBusy(true);
    setError('');
    setMessage('');
    const ticket = ++revision.current;
    try {
      const s = await fetchSummary();
      if (!alive.current || ticket !== revision.current) return;
      setSummary(s);
      if (s.completion) {
        setMessage('WBS에 저장된 완료 사실이 있습니다. 다시 완료하지 않습니다.');
        return;
      }
      store({
        companyId,
        itemId,
        planId,
        projectId,
        title: itemTitle,
        snapshot: s,
        input: {
          id: crypto.randomUUID(),
          version: s.itemVersion,
          planVersion: s.planVersion,
          expectedCounts: s.counts,
          expectedStateToken: s.stateToken,
        },
        phase: 'draft',
      });
      setConfirm(true);
    } catch (e) {
      if (alive.current && ticket === revision.current) fail(e);
    } finally {
      lock.current = false;
      if (alive.current && ticket === revision.current) setBusy(false);
    }
  }
  async function recover() {
    if (blocked || denied || lock.current) return;
    lock.current = true;
    setBusy(true);
    setError('');
    setMessage('');
    const ticket = ++revision.current;
    try {
      const s = await fetchSummary();
      if (!alive.current || ticket !== revision.current) return;
      setSummary(s);
      const d = current.current;
      if (!d) return;
      const result = observeCompletion(d, s);
      if (result === 'matching-current' || result === 'matching-later') {
        store({ ...d, phase: 'observed' });
        setMessage(
          result === 'matching-current'
            ? '고정 명령과 같은 완료 사실·결과 버전을 확인했습니다.'
            : '고정 명령과 같은 완료 사실이 있으나 이후 변경이 있습니다. 현재 버전의 성공 주체를 단정하지 않습니다.',
        );
        onChanged();
      } else if (result === 'currently-absent') {
        if (d.phase === 'pending') store({ ...d, phase: 'draft' });
        setMessage(
          '현재 요약에는 완료 사실이 없고 원래 버전·연결 상태가 같습니다. 과거 실패를 확정하지 않으며 같은 고정 명령으로 명시 재확인할 수 있습니다.',
        );
      } else {
        store({ ...d, phase: 'rejected' });
        setMessage(
          result === 'different'
            ? '다른 완료 명령 또는 다른 결과입니다. 이 명령의 성공으로 단정하지 않습니다.'
            : '항목·계획 또는 연결 업무가 변경됐습니다. 기존 명령을 보존했습니다. 최신 요약으로 새 검토가 필요합니다.',
        );
      }
    } catch (e) {
      if (alive.current && ticket === revision.current) fail(e);
    } finally {
      lock.current = false;
      if (alive.current && ticket === revision.current) setBusy(false);
    }
  }
  async function submit() {
    const d = current.current;
    if (!d || d.phase !== 'draft' || blocked || denied || lock.current || !summary) return;
    lock.current = true;
    setBusy(true);
    setError('');
    setMessage('');
    const ticket = ++revision.current;
    let sending = false;
    try {
      store({ ...d, phase: 'pending' });
      sending = true;
      const result = await completeWbs(d);
      if (!alive.current || ticket !== revision.current) return;
      store({ ...d, phase: 'observed' });
      setSummary(null);
      setSavedCompletion({
        ...result.completion,
        itemVersion: result.itemVersion,
        planVersion: result.planVersion,
        countsAtCompletion: result.countsAtCompletion,
        stateTokenAtCompletion: result.stateTokenAtCompletion,
      });
      setMessage('WBS 완료를 저장했습니다. 연결 업무의 상태는 바꾸지 않았습니다.');
      setConfirm(false);
      modal.current?.close();
      queueMicrotask(() => region.current?.focus());
      onChanged();
      // The following safe read refreshes current progress, never the frozen command.
      try {
        const s = await fetchSummary();
        if (alive.current && ticket === revision.current) setSummary(s);
      } catch (e) {
        if (alive.current && ticket === revision.current) fail(e);
      }
    } catch (e) {
      if (!alive.current || ticket !== revision.current) return;
      if (sending && e instanceof WorkFailure && [400, 409, 422].includes(e.status))
        store({ ...d, phase: 'rejected' });
      fail(e);
    } finally {
      lock.current = false;
      if (alive.current && ticket === revision.current) setBusy(false);
    }
  }
  if (denied)
    return (
      <section aria-label={`WBS 완료 접근 제한: ${itemTitle}`}>
        <p role="alert">
          접근할 수 없는 항목입니다. 완료 내용과 초안을 숨겼습니다. 부재나 과거 성공을 확정하지
          않습니다.
        </p>
      </section>
    );
  return (
    <section
      className="wbs-completion"
      ref={region}
      tabIndex={-1}
      aria-label={`WBS 완료 요약: ${itemTitle}`}
    >
      <h4>WBS 수동 완료</h4>
      {!summary && savedCompletion && (
        <div role="region" aria-label="저장된 WBS 완료 사실">
          <p>WBS 완료 · {stamp(savedCompletion.completedAt)} KST</p>
          <p>
            완료 당시 연결 {savedCompletion.countsAtCompletion.total}개 중{' '}
            {savedCompletion.countsAtCompletion.done}개 완료
          </p>
          <p>현재 연결 진행률은 다시 조회해야 합니다.</p>
        </div>
      )}
      {busy && <p role="status">완료 요약·요청을 확인하고 있습니다.</p>}
      {error && <p role="alert">{error}</p>}
      {message && <p role="status">{message}</p>}
      {!online && (
        <p>
          오프라인 · 마지막으로 조회한 자료입니다. 완료 저장과 결과 조회는 연결 후 직접 실행해
          주세요.
        </p>
      )}
      {summary ? (
        <>
          <p>
            현재 연결 진행: {summary.counts.done}/{summary.counts.total} 완료
          </p>
          <p>{completionWarning(summary.counts)}</p>
          <CountText counts={summary.counts} />
          <p>현재 요약 기준 {stamp(summary.asOf)} KST</p>
          {summary.completion ? (
            <div role="region" aria-label="저장된 WBS 완료 사실">
              <p>WBS 완료 · {stamp(summary.completion.completedAt)} KST</p>
              <p>
                완료 당시 연결 {summary.completion.countsAtCompletion.total}개 중{' '}
                {summary.completion.countsAtCompletion.done}개 완료
              </p>
              <p>완료 후 연결·업무 상태가 바뀌어도 WBS 완료 사실을 자동으로 취소하지 않습니다.</p>
            </div>
          ) : (
            <p>WBS 미완료 · 연결 업무의 완료와 별도입니다.</p>
          )}
        </>
      ) : (
        <p>완료 상태와 연결 수를 아직 확인하지 못했습니다. 0개로 해석하지 않습니다.</p>
      )}
      <RefreshButton type="button" disabled={blocked} onClick={() => void recover()} showLabel>
        WBS 완료 결과 다시 확인: {itemTitle}
      </RefreshButton>
      {review && summary && (
        <div role="region" aria-label="보존한 WBS 완료 명령">
          <p>
            고정 완료 명령 {review.input.id} ·{' '}
            {review.phase === 'pending'
              ? '결과 확인 필요'
              : review.phase === 'rejected'
                ? '최신 요약 재검토 필요'
                : review.phase === 'observed'
                  ? '완료 사실 확인됨'
                  : '확인 초안 보존'}
          </p>
          <p>
            확인 당시 {review.snapshot.counts.done}/{review.snapshot.counts.total} 완료 · 항목 버전{' '}
            {review.input.version} · 계획 버전 {review.input.planVersion}
          </p>
          {review.phase === 'draft' && !summary.completion && (
            <button type="button" disabled={blocked} onClick={open}>
              보존한 WBS 완료 검토 다시 열기: {itemTitle}
            </button>
          )}
        </div>
      )}
      {summary &&
        !summary.completion &&
        (!review || review.phase === 'draft' || review.phase === 'rejected') && (
          <button
            type="button"
            disabled={blocked}
            onClick={() => (review?.phase === 'draft' ? open() : void prepare())}
          >
            {review?.phase === 'rejected' ? '최신 요약으로 새 WBS 완료 검토' : 'WBS 수동 완료 검토'}
            : {itemTitle}
          </button>
        )}
      {confirm && review && summary && (
        <dialog
          ref={modal}
          role="alertdialog"
          aria-modal="true"
          aria-labelledby={`completion-title-${itemId}`}
          aria-describedby={`completion-desc-${itemId}`}
          className="wbs-completion-dialog"
          onCancel={(e) => {
            e.preventDefault();
            close();
          }}
        >
          <h3 id={`completion-title-${itemId}`}>WBS 수동 완료 확인</h3>
          <h4>{review.title}</h4>
          <p id={`completion-desc-${itemId}`}>{completionWarning(review.snapshot.counts)}</p>
          <CountText counts={review.snapshot.counts} />
          <p>
            확인 기준 {stamp(review.snapshot.asOf)} KST · 항목 버전 {review.input.version} · 계획
            버전 {review.input.planVersion}
          </p>
          <p>
            WBS만 완료합니다. 연결 업무·확정 보고·목표·영수증은 바꾸지 않습니다. 저장된 완료를
            취소·재개하는 기능은 없습니다.
          </p>
          <p>고정 완료 명령 {review.input.id}</p>
          {error && <p role="alert">{error}</p>}
          {review.phase === 'pending' && (
            <p role="status">
              결과가 확인되지 않았습니다. 창을 닫아도 고정 명령을 보존하며 자동 재제출하지 않습니다.
            </p>
          )}
          {review.phase === 'rejected' && (
            <p role="status">
              현재 명령을 재제출하지 않습니다. 창을 닫고 최신 요약으로 새 검토를 시작해 주세요.
            </p>
          )}
          <button type="button" data-completion-cancel disabled={busy} onClick={close}>
            WBS 완료 확인 취소 · 초안 유지
          </button>
          <button
            type="button"
            className="primary"
            disabled={blocked || review.phase !== 'draft'}
            onClick={() => void submit()}
          >
            확인한 상태로 WBS 완료
          </button>
        </dialog>
      )}
    </section>
  );
}
