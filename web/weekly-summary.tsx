import { HelpHint } from './help-hint';
import { displayWeekLabel } from './calendar-display';
import { RefreshButton } from './ui-controls';
import { useEffect, useRef, useState } from 'react';
import { weekCalendar } from '../shared/week-calendar';
import { WorkFailure, workError } from './work-entry-api';
import { readWeeklySummary, type WeeklySummaryData } from './weekly-summary-api';
import { noteWorkURL } from './notes-api';
import './weekly-summary.css';
export function WeeklySummary({
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
  onExpired: (e: unknown) => boolean;
}) {
  const scope = `${companyId}/${isoYear}/${isoWeek}`,
    calendar = weekCalendar(isoYear, isoWeek);
  const [value, setValue] = useState<{ scope: string; data: WeeklySummaryData } | null>(null),
    [failure, setFailure] = useState<{ scope: string; message: string } | null>(null),
    [loading, setLoading] = useState<string | null>(null),
    [reload, setReload] = useState(0);
  const revision = useRef(0),
    current = useRef(value);
  current.current = value;
  useEffect(() => {
    const ticket = ++revision.current;
    if (current.current?.scope !== scope) setValue(null);
    setFailure(null);
    setLoading(null);
    if (!online || !navigator.onLine) return;
    setLoading(scope);
    void readWeeklySummary(companyId, isoYear, isoWeek)
      .then((data) => {
        if (ticket === revision.current) setValue({ scope, data });
      })
      .catch((e) => {
        if (ticket !== revision.current || onExpired(e)) return;
        if (e instanceof WorkFailure && e.status === 403) setValue(null);
        setFailure({ scope, message: workError(e) });
      })
      .finally(() => {
        if (ticket === revision.current) setLoading(null);
      });
    return () => {
      revision.current++;
    };
  }, [scope, refresh, reload, online]);
  const shown = value?.scope === scope ? value.data : null,
    error = failure?.scope === scope ? failure.message : null;
  return (
    <section className="weekly-summary" aria-label="자동 주간 요약">
      <div className="week-heading">
        <h3>자동 주간 요약 · {displayWeekLabel(referenceDate ?? calendar.weekStart)}</h3>
        <RefreshButton
          type="button"
          disabled={!online || loading === scope}
          onClick={() => setReload((n) => n + 1)}
          busy={loading === scope}
        >
          주간 요약 다시 조회
        </RefreshButton>
      </div>
      <p>
        {calendar.weekStart} ~ {calendar.weekEnd} · 한국 시간 · 회사 전체 주간 계획 소속 기준입니다.
        달력 검색 조건·기간을 펼친 표시와 별개입니다.
      </p>
      <p>
        기존 보고·상태·태그·일정 변경 이력과 확인 가능한 현재 노트를 모아 표시합니다. 회고 입력은
        포함하지 않으며 업무를 자동 생성·이동·재개하지 않습니다.
      </p>
      {!online && (
        <p role="status">
          {shown
            ? '오프라인 · 마지막으로 조회한 요약이며 최신 상태가 아닙니다.'
            : '오프라인에서는 이 주의 요약을 새로 조회할 수 없습니다.'}
        </p>
      )}
      {loading === scope && <p role="status">주간 요약을 불러오고 있습니다.</p>}
      {error && <p role="alert">{error}</p>}
      {error && shown && (
        <p>마지막 성공 조회의 요약입니다. 오류를 빈 성공으로 해석하지 말고 다시 조회해 주세요.</p>
      )}
      {shown && <SummaryBody value={shown} />}
    </section>
  );
}

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
function time(value: number) {
  return new Date(value).toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' });
}
function NoteTime({ value }: { value: number }) {
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? (
    <time dateTime={date.toISOString()}>{time(value)}</time>
  ) : (
    <span>시각 표시 범위 밖 (원본 ms: {value})</span>
  );
}
function SummaryBody({ value }: { value: WeeklySummaryData }) {
  const { report, groups, tags, movements, history } = value,
    known = report.coverage !== 'unknown';
  const sources = new Map(report.items.map((item) => [item.sourceEntryId, item]));
  const groupLabels = { completed: '완료', incomplete: '미완료', paused: '중단', canceled: '취소' };
  return (
    <>
      <p>
        <strong>
          {report.mode === 'historical'
            ? report.finalized
              ? '확정된 과거 요약'
              : '미확정 과거 요약'
            : '현재·예정 주 요약 · 미확정'}
        </strong>
      </p>
      <p>보고 기준 시각: {time(report.asOf)} (한국 시간)</p>
      {report.mode === 'historical' && (
        <HelpHint label="보존된 주간 보고">
          당시 보고의 제목·상태·프로젝트·태그와 집계를 표시합니다. 이후 완료·수정·삭제가 당시 결과를
          다시 계산하지 않습니다. 지난주 보고는 기존 확정 규칙을 따릅니다.
        </HelpHint>
      )}
      <p className="summary-coverage">
        {report.coverage === 'complete'
          ? '전체 기간의 보고 근거가 있습니다.'
          : report.coverage === 'partial'
            ? '보고 정보가 일부 기간에만 있습니다. 아래 확인된 항목 수를 전체 주 결과로 해석하지 마세요.'
            : '보고 정보가 없습니다. 0건 또는 달성률 0%로 해석하지 않고 현재 업무로 과거 빈칸을 채우지 않습니다.'}
      </p>
      <section aria-label="상태별 주간 요약">
        <h4>상태별 요약</h4>
        <HelpHint label="상태별 집계">
          모든 종류의 보고 항목을 분류합니다. 중단은 미완료에 포함되며 완료·취소가 아닙니다. 아래
          분류 수를 주간 달성률의 분모로 다시 계산하지 않습니다.
        </HelpHint>
        <ul className="summary-stats" aria-label="주간 상태별 항목 수">
          {(Object.keys(groupLabels) as (keyof typeof groupLabels)[]).map((key) => (
            <li key={key}>
              {groupLabels[key]}
              {key === 'incomplete' ? ' (중단 포함)' : key === 'paused' ? ' (미완료의 일부)' : ''}
              <strong>{known ? `${groups[key].length}건` : '정보 부족'}</strong>
            </li>
          ))}
        </ul>
        <h4>주간 달성률</h4>
        {report.coverage === 'complete' && report.achievement ? (
          <p>
            완료 {report.achievement.completed} / 집계 대상 {report.achievement.total} · 달성률{' '}
            {report.achievement.rate}%
          </p>
        ) : (
          <p>보고 근거가 부족해 달성률을 확인할 수 없습니다.</p>
        )}
        <HelpHint label="달성률 집계 기준">
          업무·회의·외근의 유효 계획을 집계하며 취소·회사행사·휴가·기타는 분자/분모에서 제외합니다.
          마감예정 자동 노출이나 월간 메모는 분모를 추가하지 않습니다.
        </HelpHint>
        {(['completed', 'incomplete', 'canceled'] as const).map((key) => (
          <section key={key} aria-label={`${groupLabels[key]} 요약`}>
            <h4>{groupLabels[key]} 항목</h4>
            {groups[key].length === 0 && (
              <p>
                {known
                  ? '확인된 보고 항목 중 해당 상태가 없습니다.'
                  : '해당 상태의 보고 정보를 확인할 수 없습니다.'}
              </p>
            )}
            <ul
              aria-label={`${groupLabels[key]} 요약 목록`}
              className="summary-scroll"
              tabIndex={groups[key].length > 0 ? 0 : undefined}
            >
              {groups[key].map((id) => {
                const item = sources.get(id)!;
                return (
                  <li key={id}>
                    <h5>{item.title}</h5>
                    <p>
                      {kinds[item.kind]} · {statuses[item.status]} · 보고 버전 {item.sourceVersion}
                    </p>
                    <p>
                      예정일 {item.plannedDate ?? '날짜 미정'}
                      {item.endDate ? ` ~ ${item.endDate}` : ''} · 기한 {item.dueDate ?? '없음'}
                    </p>
                    <p>
                      프로젝트 {item.project?.code ?? '없음'} · 태그{' '}
                      {item.tags.length
                        ? item.tags.map((t) => `${t.label}${t.isCore ? ' (핵심)' : ''}`).join(', ')
                        : '없음'}
                    </p>
                    <p>
                      {item.counted
                        ? item.completed
                          ? '집계 대상 · 완료'
                          : '집계 대상 · 미완료'
                        : '집계 제외'}
                      {item.isCarriedOver ? ' · 이월된 업무' : ''}
                    </p>
                    {item.status === 'paused' && (
                      <p>
                        중단 · 자동 재개·이월 없음
                        {item.resumeStatus
                          ? ` · ${statuses[item.resumeStatus]}으로 명시 재개 가능`
                          : ''}
                      </p>
                    )}
                    {item.sourceDeleted && <p>원본 삭제됨 · 당시 보고는 보존됩니다.</p>}
                  </li>
                );
              })}
            </ul>
          </section>
        ))}
      </section>
      <section aria-label="태그별 주간 요약">
        <h4>태그별 요약</h4>
        <HelpHint label="태그별 집계">
          당시 태그 ID·이름·핵심 여부별 표시입니다. 한 업무는 같은 태그 ID에 한 번 기여하고, 여러
          태그가 있으면 각 태그에 기여하므로 태그별 수를 더해 업무수나 분모로 사용하지 않습니다.
          중단은 미완료의 일부입니다.
        </HelpHint>
        {tags.length === 0 && (
          <p>
            {known
              ? '확인된 보고 항목에 태그 정보가 없습니다.'
              : '태그별 보고 정보를 확인할 수 없습니다.'}
          </p>
        )}
        <ul aria-label="태그별 요약 목록" className="summary-tags">
          {tags.map((tag) => (
            <li key={JSON.stringify([tag.id, tag.label, tag.isCore])}>
              <strong>
                {tag.label}
                {tag.isCore ? ' (핵심)' : ''}
              </strong>
              <p>
                표시 항목 {tag.total} · 집계 대상 {tag.counted} · 완료 {tag.completed} · 미완료{' '}
                {tag.incomplete} (중단 {tag.paused} 포함) · 취소 {tag.canceled}
              </p>
            </li>
          ))}
        </ul>
      </section>
      <section aria-label="일정 이동 이력 요약">
        <h4>일정 이동 이력</h4>
        <HelpHint label="일정 변경 집계">
          이 보고에 속한 업무의 한국 시간 주간 범위와 보고 기준시각 안에서 확인한 일정 변경입니다.
          주중에 다른 주로 나간 변경도 표시할 수 있으며 이동 후 값이 당시 보고 상태를 바꾸지는
          않습니다.
        </HelpHint>
        <p className="summary-coverage">
          {history.coverage === 'complete'
            ? '보고 원본의 연속 버전 이력을 확인했습니다. 삭제된 모든 과거 이벤트를 완전히 복원한다는 뜻은 아닙니다.'
            : history.coverage === 'partial'
              ? '이동 이력이 일부만 확인됩니다. 보이지 않는 변경을 이동 0건으로 해석하지 마세요.'
              : '이동 이력을 확인할 정보가 부족합니다. 이력이 없다고 이동이 없었다고 단정하지 않습니다.'}
        </p>
        {history.toExclusive > history.from ? (
          <p>
            확인 구간: {time(history.from)} 이상 ~ {time(history.toExclusive)} 미만 (한국 시간)
          </p>
        ) : (
          <p>이 주는 아직 시작하지 않아 확인 가능한 주중 이력 구간이 없습니다.</p>
        )}
        {history.missingSourceIds.length > 0 && (
          <p>
            이력이 없거나 중간 버전이 누락된 보고 원본 {history.missingSourceIds.length}건 · 삭제로
            사라진 이력을 추정하지 않습니다.
          </p>
        )}
        {history.legacySourceIds.length > 0 && (
          <p>
            구버전 필드가 일부 기록되지 않은 보고 원본 {history.legacySourceIds.length}건 · 없는
            종류·태그·재개 상태를 현재 값으로 채우지 않습니다. 확인된 일정 변경은 아래에 표시합니다.
          </p>
        )}
        {movements.length === 0 && (
          <p>
            {history.coverage === 'complete'
              ? '확인 구간에서 일정 이동 기록이 없습니다.'
              : '표시할 수 있는 일정 이동 기록이 없습니다. 전체 이동 0건을 뜻하지 않습니다.'}
          </p>
        )}
        <ul
          aria-label="일정 이동 이력 목록"
          className="summary-scroll"
          tabIndex={movements.length > 0 ? 0 : undefined}
        >
          {movements.map((movement) => (
            <li key={movement.changeId}>
              <h5>{sources.get(movement.sourceEntryId)!.title}</h5>
              <p>
                {time(movement.changedAt)} (한국 시간) · 변경 버전 {movement.entryVersion} · 이력
                형식 V{movement.schemaVersion}
              </p>
              <p>
                예정일 {movement.before.plannedDate ?? '날짜 미정'} →{' '}
                {movement.after.plannedDate ?? '날짜 미정'}
              </p>
              <p>
                마감기한 {movement.before.dueDate ?? '없음'} → {movement.after.dueDate ?? '없음'}
              </p>
              <p>
                종료일 {movement.before.endDate ?? '없음'} → {movement.after.endDate ?? '없음'}
              </p>
              <p>
                시각 방식 {movement.before.timeMode === 'exact' ? '정확 시각' : '날짜 기준'} →{' '}
                {movement.after.timeMode === 'exact' ? '정확 시각' : '날짜 기준'}
              </p>
              {(movement.before.startAt !== null ||
                movement.before.endAt !== null ||
                movement.after.startAt !== null ||
                movement.after.endAt !== null) && (
                <p>
                  정확 시각{' '}
                  {movement.before.startAt === null ? '없음' : time(movement.before.startAt)} ~{' '}
                  {movement.before.endAt === null ? '없음' : time(movement.before.endAt)} →{' '}
                  {movement.after.startAt === null ? '없음' : time(movement.after.startAt)} ~{' '}
                  {movement.after.endAt === null ? '없음' : time(movement.after.endAt)} (한국 시간)
                </p>
              )}
              {movement.reason !== null && (
                <p className="summary-reason">
                  사유: {movement.reason === '' ? '빈 사유' : movement.reason}
                </p>
              )}
            </li>
          ))}
        </ul>
      </section>
      <SummaryNotes notes={value.notes} companyId={report.companyId} />
    </>
  );
}

function SummaryNotes({
  notes,
  companyId,
}: {
  notes: WeeklySummaryData['notes'];
  companyId: string;
}) {
  return (
    <section className="summary-notes" aria-label="주간 작성 노트">
      <h4>이 주에 작성한 현재 노트</h4>
      <HelpHint label="주간 작성 노트">
        한국 시간의 선택 주에 작성되어 현재 남아 있는 노트입니다. 과거 보고에 보존된 당시 내용이
        아니며, 노트 수정·삭제나 원업무 삭제로 달라질 수 있습니다. 달성률·태그 집계에는 반영하지
        않습니다.
      </HelpHint>
      {notes === undefined ? (
        <p>이 응답에는 노트 조회 정보가 없습니다. 노트가 없다는 뜻은 아닙니다.</p>
      ) : (
        <>
          <p className="summary-notes-meta">
            노트 관측 시각: <NoteTime value={notes.asOf} /> (한국 시간)
          </p>
          <p className="summary-notes-meta">
            작성 범위: {time(notes.from)} 이상 ~ {time(notes.toExclusive)} 미만 (한국 시간)
          </p>
          {notes.status === 'unsupported' ? (
            <p>현재 자료에서는 업무 노트를 조회할 수 없습니다. 노트 0건을 뜻하지 않습니다.</p>
          ) : notes.items.length === 0 ? (
            <p>이 주에 작성되어 현재 남아 있는 노트가 없습니다.</p>
          ) : (
            <ul className="summary-notes-list" aria-label="주간 작성 노트 목록" tabIndex={0}>
              {notes.items.map(({ note, parent }) => (
                <li key={note.id}>
                  <h5>
                    <a className="control-link" href={noteWorkURL(companyId, parent)}>
                      {parent.title}
                    </a>
                  </h5>
                  <p className="summary-notes-meta">
                    {kinds[parent.kind]} · {parent.projectCode ?? '프로젝트 없음'} · 예정일{' '}
                    {parent.plannedDate ?? '날짜 미정'}
                  </p>
                  <p className="summary-note-body">{note.body}</p>
                  <div className="summary-note-tags" aria-label="노트 태그">
                    {note.tags.length === 0 ? (
                      <span>태그 없음</span>
                    ) : (
                      note.tags.map((tag) => (
                        <span key={tag.id}>
                          {tag.label}
                          {!tag.isActive ? ' (비활성)' : ''}
                        </span>
                      ))
                    )}
                  </div>
                  <p className="summary-notes-meta">
                    작성 <NoteTime value={note.createdAt} />
                    {' · '}수정 <NoteTime value={note.updatedAt} /> (한국 시간)
                  </p>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </section>
  );
}
