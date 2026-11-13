import { Fragment, useEffect, useRef, useState } from 'react';
import { zWorkspaceId, type WorkspaceCompany } from '../shared/schema/workspace';
import {
  readExportAuthority,
  readExportCompanies,
  readExportSnapshotV6,
  exportFailureMessage,
  exportLogin,
} from './export-api';
import {
  prepareExportPair,
  disposeExportPair,
  type PreparedExportPair,
} from './export-worker-client';
import { WorkFailure } from './work-entry-api';
import {
  EXPORT_EXCLUSIONS,
  EXPORT_UNSUPPORTED_V4,
  EXPORT_UNSUPPORTED_CALENDAR_V4,
  zExportContext,
  zExportRangeScope,
  type ExportDatasetV5,
  type ExportDatasetV6,
} from '../shared/schema/export-dataset';
import { prepareExportDatasetV5, type PreparedExportDatasetV5 } from '../shared/export/dataset';
import { exportTableMapV5 } from '../shared/export/workbook-model';
import './export.css';

type Stage = 'idle' | 'reading' | 'building' | 'validating' | 'ready';
type Format = 'xlsx' | 'json';
type RangeReview = {
  dataset: ExportDatasetV5;
  envelope: ExportDatasetV6;
  scopeKey: string;
  exportId: string;
  requestedAt: number;
  realizedScope: PreparedExportDatasetV5['realizedScope'];
};
const primaryReasons: Record<string, string> = {
  company: '선택 회사',
  scheduled_overlap: '예정 기간 겹침',
  undated: '날짜 미정 업무',
  day: '기간 내 저장 날짜',
  note_created: '기간 내 작성 노트',
  week_overlap: '대상 주 겹침',
  month_overlap: '대상 월 겹침',
  period_overlap: '문서 대상 기간 겹침',
  occurrence_date: '저장 회차 날짜',
  primary_work_occurrence: '직접 선택 업무의 회차',
};
const supportReasons: Record<string, string> = {
  relation: '참조 관계',
  work_sidecar: '업무 상세·태그·보유 이력',
  note_tags: '노트 태그',
  project_defaults: '프로젝트 기본 태그',
  goal_provenance: '목표 배치·원 출처',
  wbs_context: '관련 WBS 맥락',
  recurrence_cluster: '관련 반복 규칙·개정·명령 묶음',
  leave_ledger_cluster: '현재 연차 장부·배분·감사 묶음',
  year_settings: '관련 연도 설정',
};
function RangeSummary({ value }: { value: PreparedExportDatasetV5['realizedScope'] }) {
  return (
    <>
      <p>
        <strong>
          직접 대상 {value.primaryRows}행 + 보완 {value.supportRows}행 = 합계{' '}
          {value.primaryRows + value.supportRows}행
        </strong>
      </p>
      <p>
        날짜 미정 업무: 직접 {value.undated.primary}행 · 보완 {value.undated.support}행
      </p>
      <p>
        선택 기간 밖의 원문도 필요한 참조·전체 주 문서·반복·장부 관계를 보존하기 위해 포함될 수
        있습니다. 회사 전체 백업이나 과거 상태 복원이 아닙니다.
      </p>
      <details>
        <summary>직접 선정·보완 사유와 자료별 건수</summary>
        <p>
          직접 대상 행에도 보완 사유가 함께 기록될 수 있습니다. 한 행의 여러 사유를 행 합계로 더하지
          않습니다.
        </p>
        <dl className="export-scope">
          {Object.entries(value.primaryReasonCounts)
            .filter(([, n]) => n > 0)
            .map(([reason, n]) => (
              <Fragment key={reason}>
                <dt>{primaryReasons[reason] ?? reason}</dt>
                <dd>직접 선정 사유 {n}행</dd>
              </Fragment>
            ))}
          {Object.entries(value.supportReasonCounts)
            .filter(([, n]) => n > 0)
            .map(([reason, n]) => (
              <Fragment key={reason}>
                <dt>{supportReasons[reason] ?? reason}</dt>
                <dd>보완 사유 {n}행</dd>
              </Fragment>
            ))}
        </dl>
        <dl className="export-scope">
          {exportTableMapV5.map(({ entity, sheet }) => (
            <Fragment key={entity}>
              <dt>{sheet}</dt>
              <dd>
                직접 {value.entityCounts[entity].primary} · 보완{' '}
                {value.entityCounts[entity].support} · 합계 {value.entityCounts[entity].total}
              </dd>
            </Fragment>
          ))}
        </dl>
      </details>
    </>
  );
}

const stages: { value: Stage; label: string }[] = [
  { value: 'reading', label: '1. 자료 읽기' },
  { value: 'building', label: '2. 두 파일 생성' },
  { value: 'validating', label: '3. 쌍 검증' },
  { value: 'ready', label: '4. 다운로드 준비' },
];

const exclusions: Record<(typeof EXPORT_EXCLUSIONS)[number], string> = {
  'account-settings': '계정 설정',
  'authentication-and-security': '계정·로그인·보안 정보',
  'raw-actor-identifiers': '원시 계정 식별자',
  'import-staging-and-upload-originals': '원본 업로드와 처리 중간자료',
  'runtime-resource-identifiers-and-logs': '내부 자원 식별자와 로그',
};
const unsupported: Record<(typeof EXPORT_UNSUPPORTED_V4)[number], string> = {
  'leave-ledger-opening_balance': '기초잔액 자동 산정',
  'leave-ledger-history_restore': '과거 연차 상태 복원',
  'leave-ledger-opening-adjustment': '특별 기초 조정',
  'leave-ledger-statutory-auto-grants': '법정 연차 자동 부여',
  'leave-ledger-partial-carryover': '일부 연차 자동 승계',
  'leave-ledger-automatic-yearly-carryover': '연도별 연차 자동 이월',
  'leave-ledger-unlimited-or-unknown-expiry': '기한이 없거나 확인되지 않은 부여',
  'leave-ledger-automatic-existing-allocation-rebalance': '기존 연차 배분 자동 재정렬',
  'leave-ledger-generic-work-writer-integration': '일반 업무 저장과 연차 장부의 연결',
  'recurrence-daily': '일간 반복',
  'recurrence-monthly': '월간 반복',
  'recurrence-exact-time': '정확 시각 반복',
  'recurrence-leave': '휴가 반복',
  'recurrence-event': '회사 행사 반복',
  'recurrence-automatic-materialization': '반복 업무 자동 생성',
  'recurrence-automatic-carryover': '반복 업무 자동 이월',
  'recurrence-automatic-holiday-move': '공휴일 자동 이동',
  kpi: 'KPI',
  'application-restore': '앱으로 다시 가져오기와 전체 복원',
};

export function ExportPage({ companyId, userId }: { companyId: string; userId: string }) {
  if (!zWorkspaceId.safeParse(companyId).success || !userId)
    return (
      <section className="export-page">
        <h1>내보내기 주소를 확인해 주세요.</h1>
        <a className="control-link" href="/">
          회사 선택으로 이동
        </a>
      </section>
    );
  return <CompanyExport key={`${userId}/${companyId}`} companyId={companyId} userId={userId} />;
}

function CompanyExport({ companyId, userId }: { companyId: string; userId: string }) {
  const [company, setCompany] = useState<WorkspaceCompany | null>(null);
  const [companies, setCompanies] = useState<WorkspaceCompany[] | null>(null);
  const [period, setPeriod] = useState<'all' | 'range'>('all');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [includeUndated, setIncludeUndated] = useState(true);
  const [rangeReview, setRangeReview] = useState<RangeReview | null>(null);
  const [rangeConfirmed, setRangeConfirmed] = useState(false);
  const rangeReviewRef = useRef<RangeReview | null>(null);
  const scopeKey = JSON.stringify({ companyId, period, from, to, includeUndated });
  const currentScope = useRef(scopeKey);
  currentScope.current = scopeKey;
  const [stage, setStage] = useState<Stage>('idle');
  const [selected, setSelected] = useState(false);
  const [checking, setChecking] = useState(true);
  const [online, setOnline] = useState(navigator.onLine);
  const [denied, setDenied] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [requested, setRequested] = useState({ xlsx: false, json: false });
  const [downloading, setDownloading] = useState<Format | null>(null);
  const alive = useRef(false);
  const revision = useRef(0);
  const locked = useRef(false);
  const checkingRef = useRef(false);
  const controller = useRef<AbortController | null>(null);
  const authorityController = useRef<AbortController | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const result = useRef<PreparedExportPair | null>(null);
  const urls = useRef<Partial<Record<Format, string>>>({});
  const busy = stage === 'reading' || stage === 'building' || stage === 'validating';

  function clearMemory() {
    revision.current += 1;
    controller.current?.abort();
    controller.current = null;
    authorityController.current?.abort();
    authorityController.current = null;
    if (timer.current !== null) clearTimeout(timer.current);
    timer.current = null;
    for (const url of Object.values(urls.current)) URL.revokeObjectURL(url);
    urls.current = {};
    if (result.current) disposeExportPair(result.current);
    result.current = null;
    rangeReviewRef.current = null;
    locked.current = false;
    checkingRef.current = false;
  }

  function discard(message = '', keepChoice = false) {
    clearMemory();
    setStage('idle');
    setRangeReview(null);
    setRangeConfirmed(false);
    if (!keepChoice) setSelected(false);
    setRequested({ xlsx: false, json: false });
    setDownloading(null);
    setChecking(false);
    setNotice(message);
  }

  function fail(failure: unknown) {
    discard();
    if (failure instanceof WorkFailure && failure.status === 401) {
      setDenied(true);
      setCompany(null);
      setCompanies(null);
      exportLogin(companyId);
      return;
    }
    if (failure instanceof WorkFailure && failure.status === 403) {
      setDenied(true);
      setCompany(null);
      setCompanies(null);
    }
    setError(exportFailureMessage(failure));
  }

  useEffect(() => {
    alive.current = true;
    async function refreshAuthority() {
      if (!alive.current || locked.current || checkingRef.current) return;
      if (!navigator.onLine) {
        discard();
        setOnline(false);
        setError('오프라인으로 전환되어 준비된 파일을 폐기했습니다. 연결 후 다시 생성해 주세요.');
        return;
      }
      checkingRef.current = true;
      setChecking(true);
      const next = new AbortController();
      authorityController.current = next;
      const ticket = revision.current;
      try {
        const available = await readExportCompanies(next.signal);
        if (!alive.current || ticket !== revision.current) return;
        const listed = available.find((row) => row.id === companyId);
        if (!listed) {
          discard();
          setCompany(null);
          setCompanies(available);
          setError(
            available.length === 0
              ? '소유 회사가 없습니다. 회사 선택 화면에서 확인해 주세요.'
              : '선택한 회사를 목록에서 확인할 수 없습니다. 다른 회사를 선택해 주세요.',
          );
          return;
        }
        const value = await readExportAuthority(companyId, userId, next.signal);
        if (!alive.current || ticket !== revision.current) return;
        if (listed.name !== value.name) throw new WorkFailure(409, 'INVALID_RESPONSE');
        setCompany(value);
        setCompanies(available);
        setDenied(false);
        setError('');
      } catch (failure) {
        if (alive.current && ticket === revision.current) {
          setCompany(null);
          setCompanies(null);
          fail(failure);
        }
      } finally {
        if (authorityController.current === next) authorityController.current = null;
        if (alive.current && ticket === revision.current) {
          checkingRef.current = false;
          setChecking(false);
        }
      }
    }
    void refreshAuthority();
    const offline = () => {
      setOnline(false);
      discard();
      setError('오프라인으로 전환되어 준비된 파일을 폐기했습니다. 연결 후 다시 생성해 주세요.');
    };
    const onlineAgain = () => {
      setOnline(true);
      void refreshAuthority();
    };
    const focus = () => void refreshAuthority();
    const visibility = () => {
      if (document.visibilityState === 'visible') void refreshAuthority();
    };
    const pagehide = () => discard();
    window.addEventListener('offline', offline);
    window.addEventListener('online', onlineAgain);
    window.addEventListener('focus', focus);
    window.addEventListener('pageshow', focus);
    window.addEventListener('pagehide', pagehide);
    document.addEventListener('visibilitychange', visibility);
    return () => {
      alive.current = false;
      clearMemory();
      window.removeEventListener('offline', offline);
      window.removeEventListener('online', onlineAgain);
      window.removeEventListener('focus', focus);
      window.removeEventListener('pageshow', focus);
      window.removeEventListener('pagehide', pagehide);
      document.removeEventListener('visibilitychange', visibility);
    };
  }, [companyId, userId]);

  function changeCompany(value: string) {
    if (value === companyId) return;
    if (!zWorkspaceId.safeParse(value).success || !companies?.some((row) => row.id === value))
      return;
    discard();
    setCompany(null);
    setCompanies(null);
    setChecking(true);
    setError('');
    setNotice('선택한 회사의 내보내기 화면으로 이동합니다. 전체 기간을 다시 확인해 주세요.');
    window.location.assign(`/c/${value}/export`);
  }

  function changeScope(update: () => void) {
    discard('범위가 바뀌어 이전 조회·확인과 준비된 파일을 모두 폐기했습니다.');
    setError('');
    update();
  }

  async function reviewRange() {
    if (
      locked.current ||
      checkingRef.current ||
      !company ||
      !selected ||
      denied ||
      period !== 'range'
    )
      return;
    const parsed = zExportRangeScope.safeParse({
      companyId,
      period: 'range',
      from,
      to,
      dateBasis: 'scheduled_overlap',
      includeUndated,
      scopeVersion: 2,
    });
    if (!parsed.success) {
      setError('실제 KST 시작일·종료일을 선택하고 시작일이 종료일보다 늦지 않은지 확인하세요.');
      return;
    }
    const requestedScope = scopeKey;
    discard('', true);
    setError('');
    setNotice('');
    locked.current = true;
    setStage('reading');
    const next = new AbortController();
    controller.current = next;
    const ticket = revision.current;
    const requestedAt = Date.now(),
      exportId = crypto.randomUUID();
    try {
      const authority = await readExportAuthority(companyId, userId, next.signal);
      if (authority.name !== company.name) {
        setCompany(authority);
        throw new WorkFailure(409, 'INVALID_RESPONSE');
      }
      const envelope = await readExportSnapshotV6(parsed.data, next.signal);
      if (envelope.base.formatVersion !== 5) throw new WorkFailure(0, 'INVALID_RESPONSE');
      const dataset = envelope.base;
      const prepared = prepareExportDatasetV5(dataset);
      if (!alive.current || ticket !== revision.current || requestedScope !== currentScope.current)
        return;
      if (dataset.data.companies[0]?.name !== authority.name)
        throw new WorkFailure(409, 'INVALID_RESPONSE');
      const value: RangeReview = {
        dataset: prepared.dataset,
        envelope,
        scopeKey: requestedScope,
        exportId,
        requestedAt,
        realizedScope: prepared.realizedScope,
      };
      rangeReviewRef.current = value;
      setRangeReview(value);
      setStage('idle');
      setNotice(
        '확인한 관측 자료를 메모리에 보관했습니다. 직접·보완 범위를 확인한 뒤 같은 자료로 두 파일을 생성하세요.',
      );
    } catch (failure) {
      if (alive.current && ticket === revision.current) fail(failure);
    } finally {
      if (alive.current && ticket === revision.current) {
        locked.current = false;
        controller.current = null;
      }
    }
  }

  async function generate() {
    if (locked.current || checkingRef.current || !company || !selected || denied) return;
    const reviewed = period === 'range' ? rangeReviewRef.current : null;
    if (period === 'range' && (!rangeConfirmed || !reviewed || reviewed.scopeKey !== scopeKey)) {
      setError('현재 회사·기간의 범위를 먼저 확인하고 직접·보완 자료 포함에 동의해 주세요.');
      return;
    }
    discard();
    if (!navigator.onLine) {
      setError('오프라인에서는 내보낼 수 없습니다. 연결 후 다시 생성해 주세요.');
      return;
    }
    setError('');
    setNotice('');
    locked.current = true;
    setStage('reading');
    const requestedAt = reviewed?.requestedAt ?? Date.now();
    const exportId = reviewed?.exportId ?? crypto.randomUUID();
    const next = new AbortController();
    controller.current = next;
    const ticket = revision.current;
    let timedOut = false;
    timer.current = setTimeout(() => {
      timedOut = true;
      next.abort();
    }, 30_000);
    try {
      const authority = await readExportAuthority(companyId, userId, next.signal);
      if (authority.name !== company.name) {
        setCompany(authority);
        throw new WorkFailure(409, 'INVALID_RESPONSE');
      }
      const snapshot =
        reviewed?.envelope ??
        (await readExportSnapshotV6({ companyId, period: 'all', scopeVersion: 1 }, next.signal));
      if (!alive.current || ticket !== revision.current) return;
      setStage('building');
      const context = zExportContext.parse({
        exportId,
        requestedAt,
        generatedAt: Date.now(),
        appRevision: null,
      });
      const pair = await prepareExportPair(snapshot, context, next.signal, () => {
        if (alive.current && ticket === revision.current) setStage('validating');
      });
      if (!alive.current || ticket !== revision.current) {
        disposeExportPair(pair);
        return;
      }
      // Publish neither file until current authority and both generated files are valid.
      try {
        const latest = await readExportAuthority(companyId, userId, next.signal);
        if (!alive.current || ticket !== revision.current) {
          disposeExportPair(pair);
          return;
        }
        if (latest.name !== pair.manifest.scope.companyName) {
          setCompany(latest);
          throw new WorkFailure(409, 'INVALID_RESPONSE');
        }
        setCompany(latest);
      } catch (failure) {
        disposeExportPair(pair);
        throw failure;
      }
      result.current = pair;
      setStage('ready');
    } catch (failure) {
      if (!alive.current || ticket !== revision.current) return;
      if (timedOut) {
        discard();
        setError('30초 안에 두 파일을 준비하지 못해 취소했습니다. 잠시 후 다시 생성해 주세요.');
      } else fail(failure);
    } finally {
      if (alive.current && ticket === revision.current) {
        locked.current = false;
        controller.current = null;
        if (timer.current !== null) clearTimeout(timer.current);
        timer.current = null;
      }
    }
  }

  async function download(format: Format) {
    const pair = result.current;
    if (!pair || locked.current || checkingRef.current || stage !== 'ready' || denied) return;
    if (!navigator.onLine) {
      discard();
      setError('오프라인에서는 권한을 확인할 수 없어 파일을 폐기했습니다. 다시 생성해 주세요.');
      return;
    }
    locked.current = true;
    setDownloading(format);
    setError('');
    const next = new AbortController();
    controller.current = next;
    const ticket = revision.current;
    try {
      const latest = await readExportAuthority(companyId, userId, next.signal);
      if (!alive.current || ticket !== revision.current || result.current !== pair) return;
      setCompany(latest);
      if (latest.name !== pair.manifest.scope.companyName)
        throw new WorkFailure(409, 'INVALID_RESPONSE');
      let url = urls.current[format];
      if (!url) {
        url = URL.createObjectURL(new Blob([pair[format].bytes], { type: pair[format].mime }));
        urls.current[format] = url;
      }
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = pair[format].name;
      anchor.hidden = true;
      document.body.appendChild(anchor);
      try {
        anchor.click();
      } finally {
        anchor.remove();
      }
      setRequested((current) => ({ ...current, [format]: true }));
    } catch (failure) {
      if (alive.current && ticket === revision.current) fail(failure);
    } finally {
      if (alive.current && ticket === revision.current) {
        locked.current = false;
        controller.current = null;
        setDownloading(null);
      }
    }
  }

  const pair = stage === 'ready' ? result.current : null;
  const shortId = pair?.manifest.exportId.slice(0, 8);
  const reportedUnsupported =
    pair?.manifest.unsupportedFeatures ??
    (rangeReview
      ? rangeReview.dataset.schemaFamilies.includes('0012')
        ? EXPORT_UNSUPPORTED_CALENDAR_V4
        : EXPORT_UNSUPPORTED_V4
      : null);
  const displayedUnsupported = reportedUnsupported ?? EXPORT_UNSUPPORTED_CALENDAR_V4;
  return (
    <section className="export-page" aria-labelledby="export-title">
      <header className="export-heading">
        <p className="eyebrow">개인 보관 파일</p>
        <h1 id="export-title">XLSX + JSON 내보내기</h1>
        <p>한 번 읽은 같은 회사 자료로 엑셀 확인용 파일과 보관용 파일을 함께 준비합니다.</p>
      </header>
      <section className="export-card" aria-labelledby="export-scope-title">
        <h2 id="export-scope-title">내보낼 범위 선택</h2>
        <dl className="export-scope">
          <dt>
            <label htmlFor="export-company-select">회사 선택</label>
          </dt>
          <dd>
            <select
              id="export-company-select"
              value={companies?.some((row) => row.id === companyId) ? companyId : ''}
              disabled={!companies?.length || denied || !online}
              aria-describedby="export-company-hint"
              onChange={(event) => changeCompany(event.target.value)}
            >
              <option value="" disabled>
                {checking ? '소유 회사 확인 중…' : '회사를 선택해 주세요.'}
              </option>
              {companies?.map((row) => (
                <option key={row.id} value={row.id}>
                  {row.name}
                  {row.isCurrent ? ' · 재직' : ''}
                </option>
              ))}
            </select>
          </dd>
          <dt>
            <label htmlFor="export-period">기간 모드</label>
          </dt>
          <dd>
            <select
              id="export-period"
              value={period}
              disabled={!company || checking || denied || !online}
              onChange={(event) =>
                changeScope(() => setPeriod(event.target.value === 'range' ? 'range' : 'all'))
              }
            >
              <option value="all">전체 기간 보관 · V6 (V4 본체 포함)</option>
              <option value="range">기간 자료 추출 · V6 (V5 본체 포함)</option>
            </select>
          </dd>
          {period === 'range' && (
            <>
              <dt>
                <label htmlFor="export-from">시작일 (KST)</label>
              </dt>
              <dd className="form-field">
                <input
                  id="export-from"
                  type="date"
                  min="0001-01-01"
                  max="9999-12-31"
                  value={from}
                  disabled={checking || denied || !online}
                  onChange={(event) => changeScope(() => setFrom(event.target.value))}
                />
              </dd>
              <dt>
                <label htmlFor="export-to">종료일 (KST)</label>
              </dt>
              <dd className="form-field">
                <input
                  id="export-to"
                  type="date"
                  min="0001-01-01"
                  max="9999-12-31"
                  value={to}
                  disabled={checking || denied || !online}
                  onChange={(event) => changeScope(() => setTo(event.target.value))}
                />
              </dd>
            </>
          )}
          {period === 'all' && (
            <>
              <dt>날짜 기준</dt>
              <dd>전체 기간 · 날짜 미정과 과거 연도 포함</dd>
            </>
          )}
        </dl>
        {period === 'range' && (
          <div className="export-disclosure" id="export-range-description">
            <p>
              저장된 예정 기간이 선택 기간과 겹치는 업무·일정을 추출합니다. 시작일·종료일은 KST 날짜
              양 끝 포함이며 마감일·현재 진행 기간·완료 처리일로 대신하지 않습니다.
            </p>
            <label className="export-choice">
              <input
                type="checkbox"
                checked={includeUndated}
                disabled={checking || denied || !online}
                onChange={(event) => changeScope(() => setIncludeUndated(event.target.checked))}
              />
              <span>날짜 미정 업무를 직접 추출 대상에 포함</span>
            </label>
            <p>
              이 선택을 꺼도 필요한 참조를 보존하는 날짜 미정 업무는 보완자료로 포함될 수 있습니다.
            </p>
          </div>
        )}
        <p className="export-hint" id="export-company-hint">
          이번에 내보낼 회사 한 곳을 선택하세요. 회사가 바뀌면 준비 중이거나 준비된 파일을 폐기하고
          선택한 회사에서 기간 조건을 다시 확인합니다.{' '}
          <a className="control-link" href="/">
            회사 선택 화면
          </a>
        </p>
        <div className="export-disclosure" id="export-disclosure">
          <p>
            <strong>포함:</strong> 선택 회사의 업무·휴가·프로젝트·태그·설정·계획·목표·WBS·작성
            메모·업무 노트와 노트태그 연결·반복 규칙과 개정·회차·생성 범위·명령 기록·연차
            장부·정책·부여·전환·휴가 연결·배분·명령 기록·현재 보유 이력과 관계, 정식 등록된 업무의
            출처 기록.
          </p>
          <p>
            <strong>제외:</strong> 다른 회사 자료,{' '}
            {EXPORT_EXCLUSIONS.map((key) => exclusions[key]).join(', ')}.
          </p>
          <p>
            <strong>{reportedUnsupported ? '이 파일의 미지원:' : '공통 미지원:'}</strong>{' '}
            {displayedUnsupported.map((key) => unsupported[key] ?? key).join(', ')}.
            {!reportedUnsupported && (
              <span> 일간·월간 반복 포함 여부는 자료 구조를 확인한 뒤 표시합니다.</span>
            )}
          </p>
        </div>
        <label className="export-choice">
          <input
            type="checkbox"
            checked={selected}
            disabled={!company || checking || busy || !!downloading || denied || !online || !!pair}
            onChange={(event) => {
              if (!event.target.checked) discard();
              else setSelected(true);
            }}
            aria-describedby="export-disclosure"
          />
          <span>
            {company?.name ?? '현재 회사'} 한 곳의 {period === 'all' ? '전체 기간' : '선택 기간'}{' '}
            자료를 선택합니다.
          </span>
        </label>
        {period === 'range' && rangeReview?.scopeKey === scopeKey && (
          <section aria-label="추출 범위 확인 결과" className="export-disclosure">
            <h3>추출 범위 확인</h3>
            <p>
              {rangeReview.dataset.scope.from} ~ {rangeReview.dataset.scope.to} · KST 양 끝 포함 ·
              예정 기간 겹침
            </p>
            <p>관측 시각 {new Date(rangeReview.dataset.snapshotAt).toISOString()} (UTC)</p>
            <RangeSummary value={rangeReview.realizedScope} />
            <label className="export-choice">
              <input
                type="checkbox"
                checked={rangeConfirmed}
                onChange={(event) => setRangeConfirmed(event.target.checked)}
              />
              <span>
                기간 밖 보완자료와 위 직접·보완 범위를 확인했습니다. 이 관측 자료로 두 파일을
                생성합니다.
              </span>
            </label>
          </section>
        )}
        <p className="export-hint">
          {period === 'range'
            ? 'V6는 V5 범위 본체와 회사 전체 복구 원장·출처를 46개 시트에 보관합니다. 복구 원장은 선택 기간 밖의 자료도 포함하며 전체 기간 백업을 대체하지 않습니다.'
            : 'V6는 V4 전체 기간 본체와 회사 전체 복구 원장·출처를 45개 시트에 보관합니다.'}
          원문 출처는 보유 원문과 해시로 검증한 외부 참조이며 원문 그래프의 별도 SQL 백업이
          필요합니다. 노트가 없는 회사도 회사 정보와 안내를 담은 두 파일을 만들 수 있습니다. 두
          파일에는 개인 기록이 포함되므로 비공개로 보관하세요. 연차 정보는 관측 시점에 저장된
          배분이며 과거 당시 잔액을 복원하지 않습니다.
        </p>
        <div className="export-actions">
          {period === 'range' && (
            <button
              type="button"
              className="button secondary"
              disabled={
                !company ||
                !selected ||
                checking ||
                busy ||
                !!downloading ||
                denied ||
                !online ||
                !!pair
              }
              onClick={() => void reviewRange()}
            >
              범위 확인
            </button>
          )}
          <button
            type="button"
            className="button primary"
            disabled={
              !company ||
              !selected ||
              (period === 'range' && (!rangeConfirmed || rangeReview?.scopeKey !== scopeKey)) ||
              checking ||
              busy ||
              !!downloading ||
              denied ||
              !online ||
              !!pair
            }
            onClick={() => void generate()}
          >
            XLSX + JSON 생성
          </button>
          {busy && (
            <button
              type="button"
              className="button secondary"
              onClick={() => discard('생성을 취소했습니다. 파일은 다운로드되지 않았습니다.')}
            >
              생성 취소
            </button>
          )}
          {!busy && !pair && (
            <a className="control-link" href={`/c/${companyId}/week`}>
              업무 화면으로
            </a>
          )}
        </div>
      </section>
      {(busy || pair) && (
        <section className="export-card" aria-label="내보내기 진행" aria-busy={busy}>
          <ol className="export-progress">
            {stages.map((step) => (
              <li key={step.value} aria-current={stage === step.value ? 'step' : undefined}>
                {step.label}
              </li>
            ))}
          </ol>
          {busy && (
            <p role="status">
              {stages.find((step) => step.value === stage)?.label} 중입니다. 취소하면 준비 중인 두
              파일을 모두 폐기합니다.
            </p>
          )}
          {pair && (
            <>
              <h2>두 파일 다운로드 준비 완료</h2>
              <dl className="export-scope">
                <dt>회사 · 기간</dt>
                <dd>
                  {pair.manifest.scope.companyName} ·{' '}
                  {pair.manifest.scope.period === 'all'
                    ? '전체 기간'
                    : `${pair.manifest.scope.from} ~ ${pair.manifest.scope.to} (KST 양 끝 포함)`}
                </dd>
                <dt>파일 규격</dt>
                <dd>
                  V{pair.manifest.formatVersion} · 투영 {pair.manifest.projectionVersion} ·{' '}
                  {pair.manifest.formatVersion === 6
                    ? pair.manifest.sheetCount
                    : pair.manifest.formatVersion === 5
                      ? 43
                      : 42}
                  개 시트 · {Object.keys(pair.manifest.entityCounts).length}종 자료 ·{' '}
                  {pair.manifest.schemaFamilies.length}개 구조 버전
                </dd>
                <dt>관측 시각</dt>
                <dd>
                  <time dateTime={new Date(pair.manifest.snapshotAt).toISOString()}>
                    {new Date(pair.manifest.snapshotAt).toISOString()} (UTC)
                  </time>
                </dd>
                <dt>내보내기 ID</dt>
                <dd>
                  <code>{pair.manifest.exportId}</code>
                </dd>
              </dl>
              {pair.manifest.formatVersion === 5 && (
                <RangeSummary value={pair.manifest.selection} />
              )}
              {pair.manifest.formatVersion === 6 && (
                <p>
                  회사 전체 복구 기록: 복구 원장 {pair.manifest.provenanceCounts.recoveries}행 ·
                  원문 출처 {pair.manifest.provenanceCounts.sourceClaims}행. 선택 기간 밖과 삭제된
                  업무의 근거도 보존합니다.
                </p>
              )}
              {pair.manifest.formatVersion === 6 && pair.manifest.selection && (
                <RangeSummary value={pair.manifest.selection} />
              )}
              <div className="export-downloads">
                {(['xlsx', 'json'] as const).map((format) => (
                  <div className="export-download" key={format}>
                    <strong>
                      {format === 'xlsx' ? 'XLSX · 엑셀에서 확인' : 'JSON · 원문과 관계 보관'}
                    </strong>
                    <code>{pair[format].name}</code>
                    <span className="export-hint">
                      {pair.manifest.scope.period === 'all'
                        ? '전체 기간'
                        : `${pair.manifest.scope.from}~${pair.manifest.scope.to}`}{' '}
                      · {shortId} · {new Date(pair.manifest.snapshotAt).toISOString()}
                    </span>
                    <button
                      type="button"
                      className="button secondary"
                      disabled={!!downloading || checking || !online || denied}
                      onClick={() => void download(format)}
                    >
                      {downloading === format
                        ? '권한 확인 중…'
                        : `${format.toUpperCase()} ${requested[format] ? '다시 다운로드' : '다운로드'} · ${shortId}`}
                    </button>
                    <p className="export-requested">
                      {requested[format] ? '다운로드 요청됨' : '아직 다운로드 요청하지 않음'}
                    </p>
                  </div>
                ))}
              </div>
              <p className="export-result-note" role="status">
                두 파일을 각각 눌러 저장하고 같은 내보내기 ID인지 확인하세요. 다운로드 요청만으로
                실제 디스크 저장을 확인할 수는 없습니다.
              </p>
              <p className="export-hint">
                재다운로드는 준비된 동일 파일을 사용합니다. 닫기·회사/기간/미정 선택 변경·로그인
                만료·오프라인 전환 시 메모리의 파일을 폐기합니다.
              </p>
              <div className="export-actions">
                <button
                  type="button"
                  className="button secondary"
                  onClick={() =>
                    discard(
                      '준비된 파일을 메모리에서 폐기했습니다. 다시 선택해 새 파일을 생성할 수 있습니다.',
                    )
                  }
                >
                  결과 닫기 · 파일 폐기
                </button>
              </div>
            </>
          )}
        </section>
      )}
      {checking && <p role="status">현재 사용자와 회사 권한을 확인하고 있습니다.</p>}
      {error && (
        <p className="export-error" role="alert">
          {error}
        </p>
      )}
      {notice && <p role="status">{notice}</p>}
      {denied && (
        <a className="control-link" href="/">
          회사 선택으로 이동
        </a>
      )}
    </section>
  );
}
