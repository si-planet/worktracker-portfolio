import { HelpHint } from './help-hint';
import { useEffect, useId, useRef, useState, type CSSProperties } from 'react';
import { zWorkColor, type WorkColorItem } from '../shared/schema/work-color';
import { monthWorkAppearance } from './month-work-appearance';
import { readWorkColors, writeWorkColor } from './work-color-api';
import { WorkFailure } from './work-entry-api';
import './work-color-picker.css';
export const WORK_COLOR_PALETTE = [
  ['슬레이트', '#64748b'],
  ['블루', '#587da8'],
  ['청록', '#4f8883'],
  ['그린', '#75875f'],
  ['샌드', '#b18c58'],
  ['테라코타', '#b57761'],
  ['로즈', '#ae7186'],
  ['라벤더', '#8d7eac'],
] as const;
type Props = {
  companyId: string;
  entryId: string;
  title: string;
  saved?: boolean;
  disabled?: boolean;
};
export function WorkColorPicker({
  companyId,
  entryId,
  title,
  saved = true,
  disabled = false,
}: Props) {
  const id = useId();
  const initial: WorkColorItem = { workEntryId: entryId, color: null, version: null };
  const [base, setBase] = useState(initial);
  const pendingKey = `work-tracker:work-color-pending:${companyId}:${entryId}`;
  const [color, setColor] = useState<string | null>(() => {
    try {
      const stored = zWorkColor.safeParse(sessionStorage.getItem(pendingKey));
      return stored.success ? stored.data : null;
    } catch {
      return null;
    }
  });
  const [ready, setReady] = useState(!saved);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [blocked, setBlocked] = useState(false);
  const [reload, setReload] = useState(0);
  const choice = useRef<string | null>(color);
  const wasDraft = useRef(!saved);
  const generation = useRef(0);
  const lock = useRef(false);
  const select = (value: string | null) => {
    choice.current = value;
    if (!saved) {
      try {
        if (value === null) sessionStorage.removeItem(pendingKey);
        else sessionStorage.setItem(pendingKey, value);
      } catch {
        /* Optional draft recovery. */
      }
    }
    setColor(value);
    setMessage('');
  };
  useEffect(() => {
    const ticket = ++generation.current;
    if (!saved) return;
    const pendingKey = `work-tracker:work-color-pending:${companyId}:${entryId}`;
    const creationColor = wasDraft.current ? choice.current : null;
    wasDraft.current = false;
    let recoveryColor: string | null = null;
    try {
      if (creationColor !== null) sessionStorage.setItem(pendingKey, creationColor);
      const stored = zWorkColor.safeParse(sessionStorage.getItem(pendingKey));
      if (stored.success) recoveryColor = stored.data;
    } catch {
      /* The request still completes if browser storage is unavailable. */
    }
    setReady(false);
    setBlocked(false);
    setBusy(creationColor !== null);
    void (async () => {
      try {
        let result = (await readWorkColors(companyId, [entryId]))[entryId]!;
        // The work is already durably saved. Finish this explicitly chosen color
        // for the captured ID even if its form closes while the read is in flight.
        // UI updates are still discarded on navigation; a later mount never retries.
        if (creationColor !== null && result.version === null) {
          result = await writeWorkColor(companyId, { ...result, color: creationColor });
        }
        if (recoveryColor === result.color) {
          try {
            if (sessionStorage.getItem(pendingKey) === recoveryColor)
              sessionStorage.removeItem(pendingKey);
          } catch {
            /* Optional recovery. */
          }
          recoveryColor = null;
        }
        if (ticket !== generation.current) return;
        setBase(result);
        select(recoveryColor ?? result.color);
        if (recoveryColor !== null)
          setMessage(
            '업무는 저장되었습니다. 이전에 고른 색상을 유지했으니 확인 후 색상 저장을 눌러 주세요.',
          );
        else if (creationColor !== null) setMessage('업무 색상을 저장했습니다.');
        setReady(true);
      } catch (error) {
        if (ticket !== generation.current) return;
        setBlocked(true);
        setMessage(
          error instanceof WorkFailure && error.status === 401
            ? '로그인이 필요합니다. 다시 로그인한 뒤 색상을 조회하세요.'
            : '색상 저장 여부를 확인할 수 없습니다. 업무 기록은 유지됩니다. 색상 다시 조회로 확인하세요.',
        );
      } finally {
        if (ticket === generation.current) setBusy(false);
      }
    })();
    return () => {
      generation.current++;
    };
  }, [companyId, entryId, saved, reload]);
  async function commit() {
    if (lock.current || !saved || !ready || blocked || disabled || !navigator.onLine) return;
    lock.current = true;
    setBusy(true);
    setMessage('');
    const ticket = generation.current;
    const target = color;
    let pendingAtStart: string | null = null;
    try {
      pendingAtStart = sessionStorage.getItem(pendingKey);
    } catch {
      /* Optional recovery. */
    }
    try {
      const result = await writeWorkColor(companyId, { ...base, color: target });
      try {
        if (sessionStorage.getItem(pendingKey) === pendingAtStart)
          sessionStorage.removeItem(pendingKey);
      } catch {
        /* Optional recovery. */
      }
      if (ticket !== generation.current) return;
      setBase(result);
      setMessage('업무 색상을 저장했습니다.');
    } catch (error) {
      if (ticket !== generation.current) return;
      setBlocked(true);
      setMessage(
        error instanceof WorkFailure && error.status === 409
          ? '다른 곳에서 색상이 바뀌었습니다. 색상 다시 조회로 확인한 뒤 다시 선택하세요.'
          : error instanceof WorkFailure && error.status === 401
            ? '로그인이 필요합니다. 다시 로그인한 뒤 색상을 조회하세요.'
            : '색상 저장 여부가 불확실합니다. 자동 재시도하지 않습니다. 색상 다시 조회로 확인하세요.',
      );
    } finally {
      lock.current = false;
      if (ticket === generation.current) setBusy(false);
    }
  }
  const unavailable = disabled || busy || !ready || blocked;
  return (
    <fieldset className="work-color-picker" aria-describedby={`${id}-help`}>
      <legend>업무 색상</legend>
      <div className="work-color-preview" style={monthWorkAppearance(entryId, color)}>
        <span aria-hidden="true" />
        <strong>{title || '업무 미리보기'}</strong>
        <small>{color ?? '기본 자동색'}</small>
      </div>
      <div className="work-color-options" role="group" aria-label="추천 업무 색상">
        <button
          type="button"
          disabled={unavailable}
          className="work-color-default"
          aria-pressed={color === null}
          onClick={() => select(null)}
        >
          기본{color === null ? ' ✓' : ''}
        </button>
        {WORK_COLOR_PALETTE.map(([name, value]) => (
          <button
            type="button"
            key={value}
            disabled={unavailable}
            aria-label={`${name} 색상`}
            title={name}
            aria-pressed={color === value}
            className="work-color-option"
            onClick={() => select(value)}
            style={{ '--color-swatch': value } as CSSProperties}
          >
            <span aria-hidden="true" />
            {color === value && <b aria-hidden="true">✓</b>}
          </button>
        ))}
      </div>
      <label className="work-color-custom">
        직접 선택
        <input
          type="color"
          disabled={unavailable}
          aria-label="직접 업무 색상 선택"
          value={color ?? '#64748b'}
          onChange={(event) => select(event.target.value)}
        />
      </label>
      {!saved && <p className="field-hint">업무를 저장하면 선택한 색상도 저장됩니다.</p>}
      <HelpHint id={`${id}-help`} label="업무 색상">
        같은 업무의 모든 날짜에 적용됩니다. 이 데모 브라우저에 저장됩니다.
      </HelpHint>
      {saved && (
        <div className="work-color-actions">
          <button
            type="button"
            className="button secondary"
            disabled={unavailable || color === base.color || !navigator.onLine}
            onClick={() => void commit()}
          >
            {busy ? '색상 저장 중…' : '색상 저장'}
          </button>
          <button
            type="button"
            className="text-button"
            disabled={busy || disabled}
            onClick={() => {
              setBlocked(false);
              setReload((value) => value + 1);
            }}
          >
            색상 다시 조회
          </button>
        </div>
      )}
      {message && <p role="status">{message}</p>}
    </fieldset>
  );
}
export function WorkColorControl(props: Props) {
  const [open, setOpen] = useState(false);
  return (
    <details className="work-color-control" onToggle={(event) => setOpen(event.currentTarget.open)}>
      <summary>업무 색상 변경</summary>
      {open && <WorkColorPicker key={`${props.companyId}:${props.entryId}`} {...props} />}
    </details>
  );
}
