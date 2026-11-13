import { HelpHint } from './help-hint';
import { useEffect, useRef, useState } from 'react';
import {
  zWbsExcelPreview,
  zWbsExcelResult,
  type WbsExcelRequest,
} from '../shared/schema/wbs-excel-import';
import { WorkFailure, workApi, workError } from './work-entry-api';
type Preview = ReturnType<typeof zWbsExcelPreview.parse>;
export function WbsExcelImport({
  projectId,
  year,
  onImported,
  busyGuard,
}: {
  projectId: string;
  year: number;
  onImported: () => void;
  busyGuard: { current: () => boolean };
}) {
  const [rows, setRows] = useState<WbsExcelRequest['rows']>([]),
    [sheet, setSheet] = useState(''),
    [filename, setFilename] = useState(''),
    [errors, setErrors] = useState<string[]>([]),
    [warnings, setWarnings] = useState<string[]>([]),
    [ack, setAck] = useState(false),
    [preview, setPreview] = useState<Preview | null>(null),
    [busy, setBusy] = useState(false),
    [message, setMessage] = useState(''),
    [needsLogin, setNeedsLogin] = useState(false);
  const flight = useRef(false),
    generation = useRef(0),
    mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    const guard = () => flight.current;
    busyGuard.current = guard;
    return () => {
      mounted.current = false;
      generation.current++;
      if (busyGuard.current === guard) busyGuard.current = () => false;
    };
  }, [busyGuard]);
  async function choose(file: File | undefined) {
    if (!file || flight.current) return;
    const current = ++generation.current;
    setFilename(file.name);
    setRows([]);
    setErrors([]);
    setWarnings([]);
    setAck(false);
    setPreview(null);
    setMessage('');
    setBusy(true);
    flight.current = true;
    try {
      if (file.size > 8 * 1024 * 1024) {
        setErrors(['XLSX 파일 크기는 8MB 이하여야 합니다.']);
        return;
      }
      const { parseWbsExcel } = await import('./wbs-excel-import-model');
      const parsed = await parseWbsExcel(await file.arrayBuffer(), year);
      if (!mounted.current || current !== generation.current) return;
      setSheet(parsed.sheetName);
      setErrors(parsed.errors);
      setWarnings(parsed.warnings);
      if (parsed.errors.length === 0) setRows(parsed.rows);
    } catch {
      if (mounted.current && current === generation.current)
        setErrors(['파일을 읽을 수 없습니다. 암호화되지 않은 .xlsx 파일을 확인해 주세요.']);
    } finally {
      flight.current = false;
      if (mounted.current && current === generation.current) setBusy(false);
    }
  }
  function fail(e: unknown) {
    setPreview(null);
    setNeedsLogin(e instanceof WorkFailure && e.status === 401);
    setMessage(
      `${workError(e)} 입력은 유지됩니다. 파일을 다시 선택할 필요 없이 중복 확인부터 다시 진행하세요. 로그인 후 화면이 새로 열리면 동일 파일을 선택해 확인하세요.`,
    );
  }
  async function inspect() {
    if (flight.current || !rows.length) return;
    const current = generation.current;
    flight.current = true;
    setBusy(true);
    setPreview(null);
    setMessage('');
    setNeedsLogin(false);
    try {
      if (new TextEncoder().encode(JSON.stringify({ year, rows })).byteLength > 1024 * 1024) {
        setMessage(
          '등록할 항목의 전송 크기가 1MB를 넘습니다. 긴 설명을 줄인 파일로 다시 선택해 주세요.',
        );
        return;
      }
      const result = await workApi(
        `/api/projects/${projectId}/wbs-excel-import/preview`,
        zWbsExcelPreview.refine(
          (v) => v.projectId === projectId && v.year === year && v.rowCount === rows.length,
        ),
        'POST',
        { year, rows },
      );
      if (!mounted.current || current !== generation.current) return;
      setPreview(result);
      if (result.alreadyImported) {
        setMessage(
          `이미 등록된 ${result.rowCount}개 항목을 확인했습니다. 중복 추가하지 않았습니다.`,
        );
        onImported();
      }
    } catch (e) {
      if (mounted.current && current === generation.current) fail(e);
    } finally {
      flight.current = false;
      if (mounted.current && current === generation.current) setBusy(false);
    }
  }
  async function save() {
    if (flight.current || !preview?.canCreate || (warnings.length > 0 && !ack)) return;
    const current = generation.current;
    flight.current = true;
    setBusy(true);
    setMessage('');
    try {
      const result = await workApi(
        `/api/projects/${projectId}/wbs-excel-import`,
        zWbsExcelResult.refine(
          (v) => v.projectId === projectId && v.year === year && v.rowCount === rows.length,
        ),
        'POST',
        { year, rows },
      );
      if (!mounted.current || current !== generation.current) return;
      setMessage(
        result.replayed
          ? `이미 등록된 ${result.rowCount}개 항목을 확인했습니다. 중복 추가하지 않았습니다.`
          : `${result.rowCount}개 WBS 항목을 등록했습니다. 업무는 생성하거나 연결하지 않았습니다.`,
      );
      setPreview(null);
      setRows([]);
      onImported();
    } catch (e) {
      if (mounted.current && current === generation.current) fail(e);
    } finally {
      flight.current = false;
      if (mounted.current && current === generation.current) setBusy(false);
    }
  }
  return (
    <details className="wbs-excel-import">
      <summary>엑셀 WBS 일괄 등록</summary>
      <p>
        선택한 프로젝트의 {year}년 독립 계획으로 등록합니다. 첫 번째 시트만 읽으며 기존 계획은
        덮어쓰지 않습니다.
      </p>
      <HelpHint label="WBS 엑셀 형식">
        첫 탭: A 구분, B 항목, C 기능번호, D 기능, E 세부 설명, F 비고, G 시작일, H 종료일. 최대
        200개 항목입니다. G/H 날짜가 비어 있으면 미정으로 등록합니다.
      </HelpHint>
      <p>업무 자동 생성·연결은 없습니다.</p>
      <label>
        WBS 엑셀 파일
        <input
          type="file"
          accept=".xlsx"
          disabled={busy}
          onChange={(e) => {
            const file = e.currentTarget.files?.[0];
            e.currentTarget.value = '';
            void choose(file);
          }}
        />
      </label>
      {filename && <p>선택한 파일: {filename}</p>}
      {busy && <p role="status">파일 또는 등록 결과를 확인하고 있습니다.</p>}
      {errors.length > 0 && (
        <div role="alert">
          <p>등록할 수 없습니다. 파일을 수정한 뒤 다시 선택해 주세요.</p>
          <ul>
            {errors.map((e, i) => (
              <li key={i}>{e}</li>
            ))}
          </ul>
        </div>
      )}
      {warnings.length > 0 && (
        <div>
          <ul>
            {warnings.map((e, i) => (
              <li key={i}>{e}</li>
            ))}
          </ul>
          <label>
            <input
              type="checkbox"
              checked={ack}
              disabled={busy}
              onChange={(e) => setAck(e.target.checked)}
            />
            날짜와 경고 내용을 확인했습니다.
          </label>
        </div>
      )}
      {rows.length > 0 && (
        <>
          <h3>
            {sheet} · {rows.length}개 항목 미리보기
          </h3>
          <p>날짜를 비우면 미정입니다. 행의 기능번호와 날짜를 확인한 뒤 중복 검사를 진행하세요.</p>
          <div style={{ overflowX: 'auto' }}>
            <table>
              <thead>
                <tr>
                  <th>행</th>
                  <th>기능</th>
                  <th>설명</th>
                  <th>시작</th>
                  <th>종료</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.sourceRow}>
                    <td>{r.sourceRow}</td>
                    <td>{r.title}</td>
                    <td style={{ whiteSpace: 'pre-wrap' }}>{r.description}</td>
                    <td>{r.plannedStartOn ?? '미정'}</td>
                    <td>{r.plannedEndOn ?? '미정'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <button type="button" disabled={busy} onClick={() => void inspect()}>
            기존 계획과 중복 확인
          </button>
        </>
      )}
      {preview && (
        <div role="status">
          {preview.canCreate ? (
            <p>기존 계획이 없습니다. 새 계획과 {preview.rowCount}개 항목을 함께 등록합니다.</p>
          ) : preview.alreadyImported ? (
            <p>이 파일의 항목은 이미 등록되어 있습니다. 다시 확인해도 중복 추가하지 않습니다.</p>
          ) : (
            <p>
              선택한 연도에 기존 계획 {preview.existingCount}개 항목이 있습니다. 입력과 동일한 항목{' '}
              {preview.identicalCount}개. 기존 계획을 보존하기 위해 일괄 등록을 차단했습니다. 다른
              연도를 조회하거나 기존 계획에서 직접 수정하세요.
            </p>
          )}
          <button
            type="button"
            disabled={busy || !preview.canCreate || (warnings.length > 0 && !ack)}
            onClick={() => void save()}
          >
            확인한 WBS 일괄 등록
          </button>
        </div>
      )}
      {message && <p role="status">{message}</p>}
      {needsLogin && (
        <a href={`/login?returnTo=${encodeURIComponent(location.pathname + location.search)}`}>
          로그인 후 다시 확인
        </a>
      )}
    </details>
  );
}
