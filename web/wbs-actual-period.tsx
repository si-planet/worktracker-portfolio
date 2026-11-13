import { HelpHint } from './help-hint';
import { RefreshButton } from './ui-controls';
import { useEffect, useRef, useState } from 'react';
import type { WbsActualPeriod as ActualPeriod } from '../shared/schema/wbs-actual-period';
import { readWbsActualPeriod, type WbsActualPeriodScope } from './wbs-actual-period-api';
import { WorkFailure, workError } from './work-entry-api';

type Props = WbsActualPeriodScope & {
  userId: string;
  itemTitle: string;
  online: boolean;
  expired: (error: unknown) => boolean;
};
const range = (start: string | null, end: string | null) => `${start ?? '미정'} ~ ${end ?? '미정'}`;
function difference(days: number | null) {
  if (days === null) return '미정';
  if (days === 0) return '0일 · 동일';
  return `${days > 0 ? '+' : ''}${days}일 · ${days > 0 ? '늦음' : '빠름'}`;
}
function stamp(at: number) {
  const date = new Date(at);
  if (!Number.isFinite(date.valueOf())) return `${at} ms (Unix 기준)`;
  return `${new Intl.DateTimeFormat('ko-KR', {
    timeZone: 'Asia/Seoul',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).format(date)} (KST)`;
}

export function WbsActualPeriod(props: Props) {
  // Remount before rendering another user's scope or another schedule version.
  const key = JSON.stringify([
    props.userId,
    props.companyId,
    props.projectId,
    props.planId,
    props.itemId,
    props.itemVersion,
    props.planVersion,
  ]);
  return <ActualPeriodDetails key={key} {...props} />;
}

function ActualPeriodDetails({
  companyId,
  projectId,
  planId,
  itemId,
  itemVersion,
  planVersion,
  itemTitle,
  online,
  expired,
}: Props) {
  const [snapshot, setSnapshot] = useState<ActualPeriod | null>(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  const alive = useRef(false),
    revision = useRef(0),
    lock = useRef(false),
    connected = useRef(online);
  connected.current = online;
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      revision.current++;
    };
  }, []);
  useEffect(() => {
    setBusy(false);
    lock.current = false;
    return () => {
      revision.current++;
    };
  }, [online]);

  async function refresh() {
    if (!online || lock.current) return;
    const ticket = ++revision.current;
    const current = () => alive.current && connected.current && ticket === revision.current;
    lock.current = true;
    setBusy(true);
    setError('');
    try {
      const result = await readWbsActualPeriod({
        companyId,
        projectId,
        planId,
        itemId,
        itemVersion,
        planVersion,
      });
      if (current()) setSnapshot(result);
    } catch (e) {
      if (!current()) return;
      if (e instanceof WorkFailure && (e.status === 401 || e.status === 403)) setSnapshot(null);
      if (expired(e)) return;
      if (e instanceof WorkFailure && e.code === 'ACTUAL_PERIOD_CHANGED') {
        setSnapshot(null);
        setError(
          '항목·계획 버전이 바뀌었습니다. 현재 입력을 유지한 채 WBS 목록을 다시 조회한 뒤 실제 수행기간을 펼쳐 주세요.',
        );
      } else setError(workError(e));
    } finally {
      if (current()) {
        lock.current = false;
        setBusy(false);
      }
    }
  }

  return (
    <details
      className="wbs-optional"
      aria-label={`${itemTitle} 실제 수행기간`}
      onToggle={(event) => {
        if (event.currentTarget.open) void refresh();
      }}
    >
      <summary>실제 수행기간 · 계획 차이</summary>
      <HelpHint label="실제 수행기간 계산">
        연결 업무 중 핵심 태그(core)가 있고 진행 중(doing) 또는 완료(done)이며 예정일(plannedDate)이
        있는 업무의 가장 이른 예정일과 가장 늦은 예정일입니다.
      </HelpHint>
      <RefreshButton
        type="button"
        disabled={!online || busy}
        onClick={() => void refresh()}
        busy={!!busy}
      >
        실제 수행기간 새로고침
      </RefreshButton>
      {busy && <p role="status">실제 수행기간 조회 중입니다.</p>}
      {!online && (
        <p role="status">
          오프라인 ·{' '}
          {snapshot
            ? '같은 항목·계획 버전의 마지막 성공 조회입니다.'
            : '저장된 조회 결과가 없습니다.'}{' '}
          온라인에서 펼치거나 새로고침해 주세요.
        </p>
      )}
      {error && <p role="alert">{error}</p>}
      {snapshot && (
        <>
          <p>
            기준 시각 {stamp(snapshot.asOf)} · 마지막 성공 조회 · 전체 연결 {snapshot.linkedCount}개
            · 계산 대상 {snapshot.eligibleCount}개
          </p>
          <p>
            실제 수행기간 {range(snapshot.actual.startOn, snapshot.actual.endOn)}
            {snapshot.eligibleCount === 0 && ' · 대상 업무 없음'}
          </p>
          {(busy || error) && <p role="status">아래는 마지막 성공 조회 기준의 비교입니다.</p>}
          <div className="wbs-dates">
            <div>
              <strong>원래 계획 · 조회 기준</strong>
              <p>{range(snapshot.originalPlan.startOn, snapshot.originalPlan.endOn)}</p>
              <p>
                시작 차이 {difference(snapshot.difference.original.startDays)} · 종료 차이{' '}
                {difference(snapshot.difference.original.endDays)}
              </p>
            </div>
            <div>
              <strong>
                적용 계획 ·{' '}
                {snapshot.effectivePlan.source === 'revised' ? '변경 계획' : '원래 계획'}
              </strong>
              <p>{range(snapshot.effectivePlan.startOn, snapshot.effectivePlan.endOn)}</p>
              <p>
                시작 차이 {difference(snapshot.difference.effective.startDays)} · 종료 차이{' '}
                {difference(snapshot.difference.effective.endDays)}
              </p>
            </div>
          </div>
          <HelpHint label="계획과 실제 날짜 차이">
            실제일 − 계획일의 달력 일수입니다. 양수는 늦음, 음수는 빠름, 0일은 동일이며 대응 날짜가
            없으면 미정입니다.
          </HelpHint>
          <p>
            항목 버전 {snapshot.itemVersion} · 계획 버전 {snapshot.planVersion}
          </p>
        </>
      )}
    </details>
  );
}
