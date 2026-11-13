import { useEffect, useReducer, useRef, useState } from 'react';
import type { WorklogItem } from '../shared/schema/worklog-import';
import type { WorklogSourceItemPage, WorklogSourceRunPage } from '../shared/schema/worklog-source';
import { RefreshButton } from './ui-controls';
import { WorkFailure } from './work-entry-api';
import {
  createSourceRequestGate,
  readSourceItems,
  readSourceRuns,
  readSourceSheets,
  sourceAccessLossStatus,
  sourceLoginUrl,
  type SourceFilter,
  type SourceKind,
  type SourceRun,
} from './worklog-source-api';
import './worklog-source-review.css';

export const SOURCE_KIND_LABELS: Record<SourceKind, string> = {
  row: '행',
  cell: '셀 · 수식',
  sheet: '시트',
  group: '원문 그룹',
  source_membership: '원문 소속',
  interpretation: '날짜 해석',
  iso_membership: 'ISO 주 소속',
  relation: '연결 후보',
};
type Sheets = Extract<WorklogItem, { kind: 'sheet' }>[];
type Page<T> = { page: T; cursor: string | null };
export type SourceView = {
  runs: Page<WorklogSourceRunPage>[];
  runIndex: number;
  selected: SourceRun | null;
  sheets: Sheets;
  filter: SourceFilter;
  items: Page<WorklogSourceItemPage>[];
  itemIndex: number;
};
export const emptySourceView = (): SourceView => ({
  runs: [],
  runIndex: 0,
  selected: null,
  sheets: [],
  filter: { kind: '', sheetId: '' },
  items: [],
  itemIndex: 0,
});
type SourceEvent =
  | { type: 'reset' }
  | { type: 'runs'; page: WorklogSourceRunPage; cursor: string | null }
  | { type: 'runPage'; index: number }
  | { type: 'select'; run: SourceRun | null }
  | { type: 'filter'; filter: SourceFilter }
  | { type: 'items'; page: WorklogSourceItemPage; cursor: string | null; sheets?: Sheets }
  | { type: 'itemPage'; index: number };
export function sourceViewReducer(view: SourceView, event: SourceEvent): SourceView {
  switch (event.type) {
    case 'reset':
      return emptySourceView();
    case 'runs': {
      const runs =
        event.cursor === null
          ? [{ page: event.page, cursor: null }]
          : [...view.runs, { page: event.page, cursor: event.cursor }];
      return { ...emptySourceView(), runs, runIndex: runs.length - 1 };
    }
    case 'runPage':
      return view.runs[event.index]
        ? { ...emptySourceView(), runs: view.runs, runIndex: event.index }
        : view;
    case 'select':
      return {
        ...view,
        selected: event.run,
        sheets: [],
        filter: { kind: '', sheetId: '' },
        items: [],
        itemIndex: 0,
      };
    case 'filter':
      return { ...view, filter: event.filter, items: [], itemIndex: 0 };
    case 'items': {
      if (
        !view.selected ||
        JSON.stringify(view.selected) !== JSON.stringify(event.page.run) ||
        event.page.query.kind !== (view.filter.kind || null) ||
        event.page.query.sheetId !== (view.filter.sheetId || null)
      )
        return view;
      const items =
        event.cursor === null
          ? [{ page: event.page, cursor: null }]
          : [...view.items, { page: event.page, cursor: event.cursor }];
      return { ...view, items, itemIndex: items.length - 1, sheets: event.sheets ?? view.sheets };
    }
    case 'itemPage':
      return view.items[event.index] ? { ...view, itemIndex: event.index } : view;
  }
}

export function WorklogSourceRunSummary({ run }: { run: SourceRun }) {
  return (
    <div className="worklog-source-run">
      <h3>{run.documentKey}</h3>
      <p className="worklog-source-meta">
        회차 {run.id} · 원장 상태 {run.state === 'validated' ? '검증됨' : '적재 중'} ({run.state}) ·
        버전 {run.version}
      </p>
      <p className="worklog-source-meta">
        원본 SHA-256 <code>{run.sourceSha256}</code>
      </p>
      <p>
        이 회차 원문 수:{' '}
        {Object.entries(SOURCE_KIND_LABELS)
          .map(([kind, label]) => `${label} ${run.counts[kind as SourceKind]}개`)
          .join(' · ')}
      </p>
      <details>
        <summary>회차 메타데이터 전체 JSON</summary>
        <pre>{JSON.stringify(run, null, 2)}</pre>
      </details>
    </div>
  );
}
const originalText = (value: unknown) =>
  typeof value === 'string' ? value : JSON.stringify(value, null, 2);
export function WorklogSourceItemDetails({
  item,
  sheetName,
}: {
  item: WorklogItem;
  sheetName?: string | undefined;
}) {
  const label =
    item.kind === 'sheet' ? item.data.tabName : item.kind === 'cell' ? item.data.ref : '';
  const cellRaw =
    item.kind === 'cell' &&
    item.data.raw !== null &&
    typeof item.data.raw === 'object' &&
    !Array.isArray(item.data.raw)
      ? item.data.raw
      : null;
  const hasScalarValue =
    cellRaw &&
    Object.hasOwn(cellRaw, 'value') &&
    (cellRaw.value === null || ['string', 'number', 'boolean'].includes(typeof cellRaw.value));
  return (
    <li>
      <h4>
        {SOURCE_KIND_LABELS[item.kind]}
        {label ? ` · ${label}` : ''}
      </h4>
      <p className="worklog-source-meta">
        원문 ID <code>{item.id}</code>
      </p>
      {item.kind === 'row' && (
        <>
          {['title', 'content', 'remarks']
            .filter((key) => Object.hasOwn(item.data.fields, key))
            .map((key) => (
              <p key={key} className="worklog-source-value">
                <strong>
                  {key === 'title' ? '원문 제목' : key === 'content' ? '원문 본문' : '원문 비고'}
                </strong>{' '}
                {originalText(item.data.fields[key])}
              </p>
            ))}
          <p>원문 분류: {item.data.rawCategory}</p>
          <p className="worklog-source-meta">
            시트 {sheetName ?? item.data.sheetId} · 제목 셀 {item.data.titleCell} · 원문 기록{' '}
            {item.data.sourceRecordId}
          </p>
          <p>
            원문 체크:{' '}
            {item.data.completionState === 'checked'
              ? '체크됨'
              : item.data.completionState === 'unchecked'
                ? '미체크'
                : '빈칸'}{' '}
            · 실제 업무 상태와 별도
          </p>
        </>
      )}
      {item.kind === 'cell' && (
        <>
          <p className="worklog-source-meta">
            시트 {sheetName ?? item.data.sheetId} · 원문 셀 {item.data.ref}
          </p>
          {hasScalarValue ? (
            <p className="worklog-source-value">
              <strong>보존된 셀 값</strong> {originalText(cellRaw.value)}
            </p>
          ) : (
            <p>셀 원문 구조는 전체 JSON에서 확인하세요.</p>
          )}
          {typeof cellRaw?.formula === 'string' && (
            <p className="worklog-source-value">
              <strong>원문 수식</strong> {cellRaw.formula}
            </p>
          )}
          {cellRaw && Object.hasOwn(cellRaw, 'formulaAttributes') && (
            <p>수식 속성 formulaAttributes 원문 있음 · 전체 JSON에서 확인</p>
          )}
          <p className="field-hint">보존된 값과 수식 원문을 표시하며 수식을 계산하지 않습니다.</p>
        </>
      )}
      <details>
        <summary>원문 전체 JSON · 모든 키·값·수식·근거 보기</summary>
        <pre>{JSON.stringify(item, null, 2)}</pre>
      </details>
    </li>
  );
}

/** The keyed boundary removes the previous user's/company's data during the same render. */
type SourceReviewProps = {
  companyId: string;
  userId: string;
  onAccessLost?: (status: 401 | 403) => void;
};
export function WorklogSourceReview(props: SourceReviewProps) {
  return <SourceReviewSession key={`${props.userId}:${props.companyId}`} {...props} />;
}
function SourceReviewSession({ companyId, onAccessLost }: SourceReviewProps) {
  const [view, dispatch] = useReducer(sourceViewReducer, undefined, emptySourceView);
  const [busy, setBusy] = useState(false);
  const [online, setOnline] = useState(() => typeof navigator === 'undefined' || navigator.onLine);
  const [issue, setIssue] = useState<null | 'auth' | 'forbidden' | 'changed' | 'error'>(null);
  const gate = useRef(createSourceRequestGate());
  const accessLost = useRef(onAccessLost);
  accessLost.current = onAccessLost;
  const runPage = view.runs[view.runIndex]?.page;
  const itemPage = view.items[view.itemIndex]?.page;
  const denied = issue === 'auth' || issue === 'forbidden';
  const blocked = busy || !online || denied;
  async function perform(action: (signal: AbortSignal) => Promise<() => void>) {
    if (!online || denied) return;
    const request = gate.current.start();
    if (!request) return;
    setBusy(true);
    setIssue(null);
    try {
      const commit = await action(request.signal);
      if (gate.current.current(request)) commit();
    } catch (error) {
      if (!gate.current.current(request)) return;
      const accessStatus = sourceAccessLossStatus(error);
      if (accessStatus !== null) {
        dispatch({ type: 'reset' });
        setIssue(accessStatus === 401 ? 'auth' : 'forbidden');
        accessLost.current?.(accessStatus);
        if (accessStatus === 401) window.location.assign(sourceLoginUrl(companyId));
      } else if (error instanceof WorkFailure && error.status === 409) {
        dispatch({ type: 'select', run: null });
        setIssue('changed');
      } else {
        // A failed page never becomes a partially displayed response.
        setIssue('error');
      }
    } finally {
      if (gate.current.finish(request)) setBusy(false);
    }
  }
  function refreshRuns() {
    if (blocked) return;
    void perform(async (signal) => {
      dispatch({ type: 'reset' });
      const page = await readSourceRuns(companyId, signal);
      return () => dispatch({ type: 'runs', page, cursor: null });
    });
  }
  function selectRun(run: SourceRun) {
    if (blocked || run.state !== 'validated') return;
    void perform(async (signal) => {
      dispatch({ type: 'select', run });
      const [page, sheets] = await Promise.all([
        readSourceItems(companyId, run, { kind: '', sheetId: '' }, signal),
        readSourceSheets(companyId, run, signal),
      ]);
      return () => dispatch({ type: 'items', page, sheets, cursor: null });
    });
  }
  function changeFilter(filter: SourceFilter) {
    const run = view.selected;
    if (blocked || !run) return;
    void perform(async (signal) => {
      dispatch({ type: 'filter', filter });
      const page = await readSourceItems(companyId, run, filter, signal);
      return () => dispatch({ type: 'items', page, cursor: null });
    });
  }
  function nextRuns() {
    if (blocked || !runPage?.nextCursor) return;
    if (view.runs[view.runIndex + 1]) {
      dispatch({ type: 'runPage', index: view.runIndex + 1 });
      return;
    }
    const cursor = runPage.nextCursor;
    void perform(async (signal) => {
      const page = await readSourceRuns(
        companyId,
        signal,
        cursor,
        view.runs.flatMap(({ page }) => page.items.map((run) => run.id)),
        view.runs.flatMap(({ cursor }) => (cursor ? [cursor] : [])),
      );
      return () => dispatch({ type: 'runs', page, cursor });
    });
  }
  function nextItems() {
    const run = view.selected;
    if (blocked || !run || !itemPage?.nextCursor) return;
    if (view.items[view.itemIndex + 1]) {
      dispatch({ type: 'itemPage', index: view.itemIndex + 1 });
      return;
    }
    const cursor = itemPage.nextCursor;
    void perform(async (signal) => {
      const page = await readSourceItems(
        companyId,
        run,
        view.filter,
        signal,
        cursor,
        view.items.flatMap(({ page }) => page.items.map((item) => item.id)),
        view.items.flatMap(({ cursor }) => (cursor ? [cursor] : [])),
      );
      return () => dispatch({ type: 'items', page, cursor });
    });
  }
  useEffect(() => {
    refreshRuns();
    const change = () => setOnline(navigator.onLine);
    window.addEventListener('online', change);
    window.addEventListener('offline', change);
    const requests = gate.current;
    return () => {
      requests.cancel();
      window.removeEventListener('online', change);
      window.removeEventListener('offline', change);
    };
  }, []);
  return (
    <section className="worklog-source-review" aria-label="보존된 원문 조회" aria-busy={busy}>
      <h2>보존된 원문 조회</h2>
      <p>
        로컬 파일이나 프로젝트 선택 없이 이 회사에서 본인이 보존한 회차를 읽습니다. 원문 체크·날짜
        해석·연결 후보는 실제 업무의 상태·날짜 확정과 별개입니다.
      </p>
      <p>수는 각 회차의 원문 사본 기준입니다. 같은 원본 SHA의 여러 회차를 합산하지 않습니다.</p>
      {busy && <p role="status">원문을 조회하고 있습니다.</p>}
      {!online && (
        <p role="status">
          오프라인입니다. 이미 조회한 원문만 볼 수 있으며 자동 재시도하지 않습니다.
        </p>
      )}
      {issue && (
        <p role="alert">
          {issue === 'auth'
            ? '로그인이 필요합니다. 모든 원문을 숨겼습니다.'
            : issue === 'forbidden'
              ? '이 회사의 원문 조회 권한이 없습니다. 모든 원문을 숨겼습니다.'
              : issue === 'changed'
                ? '회차 버전이나 조회 조건이 바뀌었습니다. 회차 목록을 새로 조회하고 다시 선택해 주세요.'
                : '원문 응답을 확인할 수 없습니다. 실패한 페이지는 표시하지 않습니다. 연결을 확인하고 다시 조회해 주세요.'}
        </p>
      )}
      {denied ? (
        <a className="control-link" href={sourceLoginUrl(companyId)}>
          다시 로그인 후 이 회사로 돌아오기
        </a>
      ) : (
        <>
          <div className="workspace-inline worklog-source-controls">
            <RefreshButton busy={busy} disabled={blocked} showLabel onClick={refreshRuns}>
              회차 목록 새로 조회
            </RefreshButton>
            <button
              type="button"
              className="text-button"
              disabled={blocked || view.runIndex === 0}
              onClick={() => dispatch({ type: 'runPage', index: view.runIndex - 1 })}
            >
              이전 회차 페이지
            </button>
            <span>회차 페이지 {runPage ? view.runIndex + 1 : '—'}</span>
            <button
              type="button"
              className="text-button"
              disabled={blocked || !runPage?.nextCursor}
              onClick={nextRuns}
            >
              다음 회차 페이지
            </button>
          </div>
          {!busy && runPage?.items.length === 0 && (
            <p role="status">이 회사에서 본인이 보존한 원문 회차가 없습니다.</p>
          )}
          <ul className="worklog-source-runs">
            {runPage?.items.map((run) => (
              <li key={run.id}>
                <WorklogSourceRunSummary run={run} />
                <button
                  type="button"
                  className="text-button"
                  disabled={blocked || run.state !== 'validated'}
                  aria-pressed={view.selected?.id === run.id}
                  onClick={() => selectRun(run)}
                >
                  {run.state === 'validated'
                    ? '이 회차 원문 조회'
                    : '적재 중 · 검증 후 원문 조회 가능'}
                </button>
              </li>
            ))}
          </ul>
          {view.selected && (
            <section aria-label="선택한 회차 원문">
              <h3>
                선택한 회차 {view.selected.id} · 버전 {view.selected.version}
              </h3>
              <div className="workspace-inline worklog-source-controls">
                <label>
                  원문 종류{' '}
                  <select
                    value={view.filter.kind}
                    disabled={blocked}
                    onChange={(event) =>
                      changeFilter({ kind: event.target.value as SourceKind | '', sheetId: '' })
                    }
                  >
                    <option value="">전체 8종</option>
                    {Object.entries(SOURCE_KIND_LABELS).map(([kind, label]) => (
                      <option key={kind} value={kind}>
                        {label}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  시트{' '}
                  <select
                    value={view.filter.sheetId}
                    disabled={blocked || !['cell', 'row', 'group'].includes(view.filter.kind)}
                    onChange={(event) =>
                      changeFilter({ ...view.filter, sheetId: event.target.value })
                    }
                  >
                    <option value="">모든 시트</option>
                    {view.sheets.map((sheet) => (
                      <option key={sheet.id} value={sheet.id}>
                        {sheet.data.tabName} · {sheet.data.key}
                      </option>
                    ))}
                  </select>
                </label>
                <RefreshButton
                  busy={busy}
                  disabled={blocked}
                  showLabel
                  onClick={() => selectRun(view.selected!)}
                >
                  선택 회차 처음부터 다시 조회
                </RefreshButton>
              </div>
              <p className="field-hint">
                시트 필터는 행·셀·원문 그룹에 적용됩니다. 전체 JSON에서 수식·공유 속성·셀 값과 모든
                근거를 확인할 수 있습니다.
              </p>
              <div className="workspace-inline worklog-source-controls">
                <button
                  type="button"
                  className="text-button"
                  disabled={blocked || view.itemIndex === 0}
                  onClick={() => dispatch({ type: 'itemPage', index: view.itemIndex - 1 })}
                >
                  이전 원문 페이지
                </button>
                <span>
                  원문 페이지 {itemPage ? view.itemIndex + 1 : '—'} · 현재{' '}
                  {itemPage?.items.length ?? 0}개
                </span>
                <button
                  type="button"
                  className="text-button"
                  disabled={blocked || !itemPage?.nextCursor}
                  onClick={nextItems}
                >
                  다음 원문 페이지
                </button>
              </div>
              {!busy && itemPage?.items.length === 0 && (
                <p role="status">선택 조건에 해당하는 원문이 없습니다.</p>
              )}
              <ul className="worklog-source-items">
                {itemPage?.items.map((item) => {
                  const sheetId = 'sheetId' in item.data ? item.data.sheetId : undefined;
                  const sheetName = view.sheets.find((sheet) => sheet.id === sheetId)?.data.tabName;
                  return (
                    <WorklogSourceItemDetails key={item.id} item={item} sheetName={sheetName} />
                  );
                })}
              </ul>
            </section>
          )}
        </>
      )}
    </section>
  );
}
