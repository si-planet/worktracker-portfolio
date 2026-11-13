import { useEffect, useRef, useState } from 'react';
import { RefreshButton } from './ui-controls';
import { RealWorklogCalendar, ReviewSourceDetail, originalCell } from './real-worklog-calendar';
import {
  realReviewMonths,
  realReviewProjection,
  type RealReviewCalendarView,
  type RealReviewMonth,
} from './real-worklog-calendar-model';
import {
  isLocalReviewHost,
  LocalReviewFailure,
  readLocalWorklogReview,
  type LocalReviewRange,
  type LocalReviewRecord,
  type LocalWorklogReview,
} from './real-worklog-review-api';
import './real-worklog-review.css';

const modes = [
  ['month', '월간 달력'],
  ['week', '주간 달력'],
  ['source', '원문 검토 목록'],
] as const;
type Mode = RealReviewCalendarView | 'source';
const cell = originalCell;

function failureText(error: unknown) {
  if (!(error instanceof LocalReviewFailure)) return '검토 자료를 확인하지 못했습니다.';
  const messages: Record<LocalReviewFailure['code'], string> = {
    LOCAL_ONLY: '이 검토 화면은 localhost 전용입니다. 서비스 배포 환경에서는 사용할 수 없습니다.',
    OFFLINE: '오프라인입니다. 연결한 뒤 검토 자료를 다시 조회하세요.',
    AUTH_REQUIRED: '인증 세션을 확인해야 합니다. 검토 자료는 숨겼습니다.',
    FORBIDDEN: '이 검토 자료에 접근할 수 없습니다. 표시하던 원문을 숨겼습니다.',
    NOT_AVAILABLE: '로컬 검토 endpoint가 준비되지 않았습니다. DB에 반영된 자료가 아닙니다.',
    INVALID_DATA: '검토 자료의 구조·범위 또는 출처를 확인해야 합니다. 원문을 표시하지 않습니다.',
    TIMEOUT: '검토 자료 조회 시간이 지났습니다. 다시 조회를 직접 실행하세요.',
    ABORTED: '조회가 취소되었습니다.',
    UNAVAILABLE: '로컬 검토 자료를 읽지 못했습니다. 다시 조회를 직접 실행하세요.',
  };
  return messages[error.code];
}

export function ReviewRecordList({
  records,
  value,
}: {
  records: LocalReviewRecord[];
  value: LocalWorklogReview;
}) {
  const overlap = new Set(value.overlapGroups.flatMap((group) => group.recordIds));
  if (!records.length)
    return <p>이 보기에 표시할 원문이 없습니다. 날짜 후보는 확정하지 않았습니다.</p>;
  return (
    <div className="real-review-table-scroll" role="region" aria-label="원문 검토 표" tabIndex={0}>
      <table className="real-review-table">
        <caption>
          원문별 제목·구분·비고·체크·출처입니다. 같은 제목도 별도 행으로 보존합니다.
        </caption>
        <thead>
          <tr>
            <th scope="col">원문 영역 · 날짜</th>
            <th scope="col">제목 · 구분</th>
            <th scope="col">비고</th>
            <th scope="col">원문 체크</th>
            <th scope="col">시트 · 셀</th>
          </tr>
        </thead>
        <tbody>
          {records.map((row) => (
            <tr key={row.sourceRecordId}>
              <td>
                <span>{row.section === 'weeklySummary' ? '주간 총괄 원문' : '일간 원문'}</span>
                <span>
                  {row.activityDate ??
                    (row.section === 'daily' ? '날짜 검토 필요' : '개별 날짜 없음 · 검토 필요')}
                </span>
                <span className="real-review-review">상태·프로젝트 검토 필요</span>
              </td>
              <td>
                <strong className="real-review-text">{row.fields.title}</strong>
                <span className="real-review-text">구분: {cell(row.fields.category)}</span>
                <span>
                  원문 번호 {row.fields.number} · 우선순위 {cell(row.fields.priority)}
                </span>
                {overlap.has(row.sourceRecordId) && (
                  <span className="real-review-review">겹침 후보 · 별도 원문 유지</span>
                )}
              </td>
              <td className="real-review-text">{cell(row.fields.remarks)}</td>
              <td>
                <span className="real-review-text">{cell(row.fields.completion)}</span>
                <span className="real-review-muted">원문 체크이며 업무 완료 상태가 아닙니다.</span>
              </td>
              <td>
                <ReviewSourceDetail row={row} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function ReviewDesk({ initialRange }: { initialRange: LocalReviewRange }) {
  const [range, setRange] = useState(initialRange);
  const [selection, setSelection] = useState<{ month: RealReviewMonth; date: string | null }>({
    month: initialRange === 'sep-oct' ? '2026-09' : '2026-08',
    date: null,
  });
  const { month } = selection;
  const [mode, setMode] = useState<Mode>('month');
  const [reload, setReload] = useState(0);
  const [snapshot, setSnapshot] = useState<{
    range: LocalReviewRange;
    value: LocalWorklogReview;
  } | null>(null);
  const value = snapshot?.range === range ? snapshot.value : null;
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [authenticationRequired, setAuthenticationRequired] = useState(false);
  const [online, setOnline] = useState(() => typeof navigator === 'undefined' || navigator.onLine);
  const revision = useRef(0);
  const local = typeof location !== 'undefined' && isLocalReviewHost(location.hostname);
  useEffect(() => {
    const update = () => setOnline(navigator.onLine);
    window.addEventListener('online', update);
    window.addEventListener('offline', update);
    return () => {
      window.removeEventListener('online', update);
      window.removeEventListener('offline', update);
    };
  }, []);
  useEffect(() => {
    const ticket = ++revision.current;
    const controller = new AbortController();
    setSnapshot(null);
    setError('');
    setAuthenticationRequired(false);
    setBusy(false);
    if (local && online) {
      setBusy(true);
      void readLocalWorklogReview(range, controller.signal)
        .then((data) => {
          if (ticket === revision.current) setSnapshot({ range, value: data });
        })
        .catch((failure: unknown) => {
          if (ticket !== revision.current) return;
          setError(failureText(failure));
          setAuthenticationRequired(
            failure instanceof LocalReviewFailure && failure.code === 'AUTH_REQUIRED',
          );
        })
        .finally(() => {
          if (ticket === revision.current) setBusy(false);
        });
    }
    return () => {
      revision.current++;
      controller.abort();
    };
  }, [range, reload, local, online]);
  const projection = value ? realReviewProjection(value, month) : null;
  const selectRange = (next: RealReviewMonth) => {
    if (next === '2026-08') setRange('aug-sep');
    if (next === '2026-10') setRange('sep-oct');
  };
  const changeMonth = (next: RealReviewMonth) => {
    selectRange(next);
    setSelection({ month: next, date: null });
  };
  const changeDate = (date: string) => {
    const next = realReviewMonths.find((item) => item === date.slice(0, 7));
    if (next) {
      selectRange(next);
      setSelection({ month: next, date });
    }
  };

  return (
    <section className="real-worklog-review" aria-labelledby="real-review-title">
      <header className="real-review-header">
        <div>
          <span className="real-review-kicker">실제 Excel 원문 · 읽기 전용</span>
          <h1 id="real-review-title">실제 업무일지 달력</h1>
          <p>원문에 명시된 날짜와 주간 총괄을 앱 화면에서 검토합니다.</p>
        </div>
        <span className="real-review-readonly">DB 미반영</span>
      </header>
      <div className="real-review-toolbar real-review-main-toolbar">
        <div className="real-review-switch" role="group" aria-label="검토 월 선택">
          {realReviewMonths.map((option) => (
            <button
              key={option}
              type="button"
              aria-pressed={month === option}
              onClick={() => changeMonth(option)}
            >
              {Number(option.slice(5))}월
            </button>
          ))}
        </div>
        <div className="real-review-switch" role="group" aria-label="검토 보기">
          {modes.map(([id, label]) => (
            <button key={id} type="button" aria-pressed={mode === id} onClick={() => setMode(id)}>
              {label}
            </button>
          ))}
        </div>
        <RefreshButton
          busy={busy}
          disabled={!local || !online}
          onClick={() => setReload((n) => n + 1)}
        >
          검토 자료 다시 조회
        </RefreshButton>
      </div>
      {!local && <p role="alert">localhost 전용입니다. 프로덕션에서는 원문을 조회하지 않습니다.</p>}
      {!online && <p role="status">오프라인 · 원문은 브라우저 저장소에 보관하지 않습니다.</p>}
      {busy && <p role="status">선택 범위의 원문을 조회하고 있습니다.</p>}
      {error && <p role="alert">{error}</p>}
      {authenticationRequired && (
        <a
          className="control-link"
          href={`/login?${new URLSearchParams({ returnTo: `/worklog-review?range=${range}` })}`}
        >
          인증 세션 확인
        </a>
      )}
      {value && projection && (
        <>
          <div className="real-review-context">
            <strong>{value.companyContext.companyName} · 실제 원문 검토</strong>
            <span>업무 상태 미정 · 기존 업무·프로젝트와 연결하지 않은 자료입니다.</span>
          </div>
          <dl className="real-review-counts" aria-label="선택 월 검토 현황">
            <div>
              <dt>명시일 일간 원문</dt>
              <dd>
                {projection.monthDaily.length}
                <small>행 · {projection.monthDates.length}일</small>
              </dd>
            </div>
            <div>
              <dt>기간 내 주간 총괄</dt>
              <dd>
                {projection.monthSummaries.length}
                <small>행 · 별도 원문</small>
              </dd>
            </div>
            <div>
              <dt>이 달 시트 날짜 검토</dt>
              <dd>
                {projection.unresolved.length}
                <small>행 · 후보·빈 날짜</small>
              </dd>
            </div>
            <div>
              <dt>DB 반영 · 자동 병합</dt>
              <dd>
                0<small>건 · 완료 KPI 미산정</small>
              </dd>
            </div>
          </dl>
          {mode === 'source' ? (
            <section aria-label="선택 월 시트 원문 목록">
              <div className="real-review-toolbar">
                <h2>
                  {Number(month.slice(5))}월 시트 원문 {projection.sourceMonthRecords.length}행
                </h2>
              </div>
              <p className="real-review-muted">
                선택 월 시트에 있던 원문 전체입니다. 달력의 명시일·주 시작 날짜와 시트 월이 다를 수
                있습니다. 같은 제목과 겹침 후보도 각각 보존했습니다.
              </p>
              <ReviewRecordList records={projection.sourceMonthRecords} value={value} />
            </section>
          ) : (
            <RealWorklogCalendar
              value={value}
              month={month}
              selectedDate={selection.date}
              view={mode}
              onMonthChange={changeMonth}
              onDateChange={changeDate}
            />
          )}
          <details className="real-review-source-context">
            <summary>자료 범위 · 근무 문맥 · 원본 지문</summary>
            <p>
              인증된 localhost에서 {range === 'aug-sep' ? '8·9월' : '9·10월'} 검토 원문{' '}
              {value.records.length}행을 조회했습니다. 원문 체크로 업무 상태를 추정하지 않습니다.
              자동 병합·삭제·완료 전파 0건입니다.
            </p>
            <p>
              사용자 설명의 근무 문맥: {value.companyContext.companyName} ·{' '}
              {value.companyContext.employmentStartMonth}~
              {value.companyContext.currentEmployment ? '현재' : '종료 시점 검토 필요'}. Excel 작성
              기간을 뜻하지 않습니다.
            </p>
            <p>원문 출처 지문 {value.source.byteSha256}</p>
            <p>
              겹침 검토 후보 {value.overlapGroups.length}묶음 · 주간/일간 연관 후보{' '}
              {value.weeklyDailyCandidates.length}건. 기존 업무·탭·노트·연차·입력 초안에 등록하지
              않습니다.
            </p>
          </details>
        </>
      )}
    </section>
  );
}

export function RealWorklogReview({
  userId,
  initialRange = 'aug-sep',
}: {
  userId: string;
  initialRange?: LocalReviewRange;
}) {
  return <ReviewDesk key={userId} initialRange={initialRange} />;
}
