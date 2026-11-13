import { useEffect, useId, useRef, useState } from 'react';
import { isCalendarMonth } from '../shared/month-calendar';
import { zWorkEntryId } from '../shared/schema/work-entry';
import { readWbsPlanner } from './wbs-planner-api';
import { WorkFailure, workError } from './work-entry-api';
import { monthlyWbsReference, type MonthlyWbsReference } from './wbs-month-reference-model';
import { plannerRangeText } from './wbs-planner-calendar';
import './wbs-month-reference.css';

export function WbsMonthReferenceContent({ value }: { value: MonthlyWbsReference }) {
  function list(rows: MonthlyWbsReference['items']) {
    return (
      <ul>
        {rows.map(({ project, item, range }) => (
          <li key={item.id} data-wbs-item-id={item.id}>
            <strong>
              {project.code} · {item.title}
            </strong>
            <span>원래 계획 {plannerRangeText(range)}</span>
          </li>
        ))}
      </ul>
    );
  }
  return (
    <>
      <h4>이달과 겹치는 정규 계획</h4>
      {value.items.length ? (
        list(value.items)
      ) : (
        <p>원래 계획 기간이 이달과 겹치는 정규 WBS 항목이 없습니다.</p>
      )}
      {value.uncertain.length > 0 && (
        <div className="wbs-month-reference-uncertain">
          <h4>선택 연도 계획 중 기간 미정 · 이달 해당 여부 미확정</h4>
          {list(value.uncertain)}
        </div>
      )}
    </>
  );
}

export function WbsMonthReference({
  companyId,
  month,
  projectId,
  online,
  refresh = 0,
  onExpired,
}: {
  companyId: string;
  month: string;
  projectId: string;
  online: boolean;
  refresh?: number;
  onExpired?: (error: unknown) => boolean;
}) {
  const id = useId();
  const valid =
    isCalendarMonth(month) &&
    zWorkEntryId.safeParse(companyId).success &&
    (!projectId || zWorkEntryId.safeParse(projectId).success);
  const scope = valid ? `${companyId}/${month}/${projectId}` : '';
  const [snapshot, setSnapshot] = useState<{ scope: string; value: MonthlyWbsReference } | null>(
    null,
  );
  const [status, setStatus] = useState<{
    scope: string;
    loading: boolean;
    error: string;
    denied: boolean;
  }>({ scope: '', loading: false, error: '', denied: false });
  const [retry, setRetry] = useState(0);
  const revision = useRef(0),
    expired = useRef(onExpired);
  expired.current = onExpired;
  useEffect(() => {
    const ticket = ++revision.current;
    setStatus({ scope, loading: !!scope && online, error: '', denied: false });
    if (!scope || !online) return;
    void readWbsPlanner(companyId, Number(month.slice(0, 4)))
      .then((value) => {
        if (ticket !== revision.current) return;
        setSnapshot({ scope, value: monthlyWbsReference(value, companyId, month, projectId) });
        setStatus({ scope, loading: false, error: '', denied: false });
      })
      .catch((failure) => {
        if (ticket !== revision.current) return;
        const denied = failure instanceof WorkFailure && [401, 403].includes(failure.status);
        if (denied) {
          setSnapshot(null);
          expired.current?.(failure);
        }
        setStatus({
          scope,
          loading: false,
          denied,
          error:
            failure instanceof WorkFailure && failure.status === 401
              ? '로그인이 만료되었습니다. 다시 로그인한 뒤 참고 자료를 조회해 주세요.'
              : failure instanceof WorkFailure && failure.status === 403
                ? '이 회사의 정규 WBS 참고 자료에 접근할 수 없습니다.'
                : workError(failure),
        });
      });
    return () => {
      revision.current++;
    };
  }, [scope, online, refresh, retry]);
  const shown = snapshot?.scope === scope && valid ? snapshot.value : null;
  const current = status.scope === scope ? status : null;
  return (
    <section className="wbs-month-reference" aria-labelledby={id}>
      <div className="wbs-month-reference-heading">
        <h3 id={id}>이 달 정규 WBS · 참고</h3>
        <button
          type="button"
          disabled={!valid || !online || current?.loading}
          onClick={() => setRetry((n) => n + 1)}
        >
          정규 WBS 다시 조회
        </button>
      </div>
      <p className="wbs-month-reference-context">
        {month} · {projectId ? '선택 프로젝트' : '전체 프로젝트'} · 선택 연도의 정규 계획
      </p>
      <p>
        원래 계획 기간을 참고합니다. 직접 작성하는 목표·월간 메모와 내 일정은 별도이며, 날짜를
        바꿔도 정규 기준은 유지됩니다.
      </p>
      {!valid && <p role="alert">회사와 실제 달력 월·프로젝트를 확인해 주세요.</p>}
      {!online && (
        <p role="status">
          오프라인 ·{' '}
          {shown
            ? '마지막 성공 조회이며 최신 상태가 아닙니다.'
            : '정규 WBS 참고 자료를 아직 조회하지 못했습니다.'}
        </p>
      )}
      {current?.loading && <p role="status">정규 WBS 참고 자료를 불러오고 있습니다.</p>}
      {current?.error && <p role="alert">{current.error}</p>}
      {shown && !current?.denied && (
        <>
          {(current?.loading || current?.error) && (
            <p>마지막으로 조회한 같은 회사·월·프로젝트의 참고 자료입니다.</p>
          )}
          <WbsMonthReferenceContent value={shown} />
        </>
      )}
    </section>
  );
}
