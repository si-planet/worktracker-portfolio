import { HelpHint } from './help-hint';
import { displayWeekLabel } from './calendar-display';
import { RefreshButton } from './ui-controls';
import { useEffect, useRef, useState } from 'react';
import { zPlanReport, type PlanReport } from '../shared/schema/plan-report';
import { weekCalendar } from '../shared/week-calendar';
import { WorkFailure, workApi, workError } from './work-entry-api';

const kinds = {
  task: '업무',
  meeting: '회의',
  field: '외근',
  event: '회사 행사',
  leave: '휴가',
  etc: '기타',
};
const statuses = {
  todo: '미진행',
  doing: '진행 중',
  paused: '중단',
  planned: '예정',
  done: '완료',
  canceled: '취소',
};

export function WeekReport({
  companyId,
  isoYear,
  isoWeek,
  referenceDate,
  online,
  refresh,
  onExpired,
}: {
  companyId: string;
  isoYear: number;
  isoWeek: number;
  referenceDate?: string;
  online: boolean;
  refresh: number;
  onExpired: (failure: unknown) => boolean;
}) {
  const calendar = weekCalendar(isoYear, isoWeek);
  const scope = `${companyId}/${isoYear}/${isoWeek}`;
  const [value, setValue] = useState<{ scope: string; report: PlanReport } | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [reload, setReload] = useState(0);
  const revision = useRef(0);
  useEffect(() => {
    const ticket = ++revision.current;
    setValue(null);
    setError('');
    setLoading(false);
    if (!online || !navigator.onLine) return;
    setLoading(true);
    void workApi(
      `/api/companies/${companyId}/weeks/${isoYear}/${isoWeek}/report`,
      zPlanReport.refine(
        (data) =>
          data.companyId === companyId &&
          data.isoYear === isoYear &&
          data.isoWeek === isoWeek &&
          Number.isFinite(new Date(data.asOf).getTime()) &&
          new Set(data.items.map((item) => item.sourceEntryId)).size === data.items.length,
      ),
    )
      .then((report) => {
        if (ticket === revision.current) setValue({ scope, report });
      })
      .catch((failure) => {
        if (ticket !== revision.current || onExpired(failure)) return;
        if (failure instanceof WorkFailure && failure.status === 403) setValue(null);
        setError(workError(failure));
      })
      .finally(() => {
        if (ticket === revision.current) setLoading(false);
      });
    return () => {
      revision.current++;
    };
  }, [scope, refresh, reload, online]);
  const report = value?.scope === scope ? value.report : null;
  return (
    <section aria-label="주간 계획 집계" className="work-history">
      <div className="week-heading">
        <h3>주간 계획 집계 · {displayWeekLabel(referenceDate ?? calendar.weekStart)}</h3>
        <RefreshButton
          type="button"
          disabled={!online || loading}
          onClick={() => setReload((n) => n + 1)}
          busy={loading}
        >
          주간 계획 집계 다시 조회
        </RefreshButton>
      </div>
      <p>
        {calendar.weekStart} ~ {calendar.weekEnd} · 한국 시간
      </p>
      {!online && <p role="status">오프라인에서는 주간 계획 집계를 조회할 수 없습니다.</p>}
      {loading && <p role="status">주간 계획 집계를 불러오고 있습니다.</p>}
      {error && <p role="alert">{error}</p>}
      {report && (
        <>
          <p>
            <strong>
              {report.mode === 'historical'
                ? report.finalized
                  ? '주 종료 후 자동 보존된 기록'
                  : '과거 기록 · 자동 보존 전'
                : '현재 계획 집계 · 주 종료 전'}
            </strong>
          </p>
          <p>
            기준 시각: {new Date(report.asOf).toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' })}{' '}
            (한국 시간)
          </p>
          {report.mode === 'historical' && (
            <HelpHint label="과거 보고 보존">
              당시 제목·상태·프로젝트·태그와 집계를 표시합니다. 이후 업무 변경이나 원본 삭제와
              별개로 보존됩니다.
            </HelpHint>
          )}
          <p>
            {report.coverage === 'complete'
              ? '전체 기간의 보고 근거가 있습니다.'
              : report.coverage === 'partial'
                ? '일부 기간만 확인할 수 있습니다. 전체 기간의 결과로 해석하지 마세요.'
                : '확인 가능한 과거 근거가 없습니다. 현재 기록으로 과거 결과를 채우지 않습니다.'}
          </p>
          <h4>주간 달성률</h4>
          <HelpHint label="주간 집계 기준">
            회사 전체 기록의 계획 소속 주 기준이며 달력 검색 조건은 적용하지 않습니다. 주간 계획에
            속한 업무·회의·외근 중 완료 비율입니다. 취소·회사 행사·휴가·기타는 제외합니다. 날짜 미정
            업무와 마감예정 자동 노출만으로는 분모에 추가하지 않습니다. 요일을 명시 배치하면 그 주
            계획에 연결됩니다. 다음 주에 완료해도 이월 전 주의 미완료 결과는 다시 계산하지 않습니다.
          </HelpHint>
          {report.achievement ? (
            <p>
              완료 {report.achievement.completed} / 집계 대상 {report.achievement.total} · 달성률{' '}
              {report.achievement.rate}%
            </p>
          ) : (
            <p>달성률을 확인할 수 없습니다.</p>
          )}
          {report.items.length === 0 && (
            <p>
              {report.coverage === 'complete'
                ? '이 주의 보고 기록이 없습니다.'
                : '표시할 수 있는 보고 기록이 없습니다.'}
            </p>
          )}
          <ul aria-label="주간 계획 집계 기록 목록" className="work-list">
            {report.items.map((item) => (
              <li className="work-card" key={item.sourceEntryId}>
                <h4>{item.title}</h4>
                <p>
                  {kinds[item.kind]} · {statuses[item.status]} · 당시 버전 {item.sourceVersion}
                </p>
                <p>
                  {item.plannedDate ?? '날짜 미정'}
                  {item.endDate ? ` ~ ${item.endDate}` : ''}
                  {item.dueDate ? ` · 기한 ${item.dueDate}` : ''}
                </p>
                <p>
                  프로젝트: {item.project?.code ?? '없음'} · 태그:{' '}
                  {item.tags.length
                    ? item.tags
                        .map((tag) => `${tag.label}${tag.isCore ? ' (핵심)' : ''}`)
                        .join(', ')
                    : '없음'}
                </p>
                <p>
                  {item.counted
                    ? item.completed
                      ? '집계 대상 · 완료'
                      : '집계 대상 · 미완료'
                    : '집계 제외'}
                  {item.isCarriedOver ? ' · 이연된 업무' : ''}
                </p>
                {item.status === 'paused' && (
                  <p>
                    중단 · 자동 이월 없음
                    {item.resumeStatus ? ` · ${statuses[item.resumeStatus]}으로 재개` : ''}
                  </p>
                )}
                {item.sourceDeleted && <p>원본 삭제됨 · 보고는 보존됩니다.</p>}
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  );
}
