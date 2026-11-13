import { HelpHint } from './help-hint';
import './work-importance.css';
import { useEffect, useRef, useState } from 'react';
import type { WorkImportanceItem } from '../shared/schema/work-importance';
import { WorkFailure } from './work-entry-api';
import {
  importanceDraftKey,
  readImportanceDraft,
  readWorkImportanceList,
  saveImportanceDraft,
  writeWorkImportance,
} from './work-importance-api';
type Props = {
  userId: string;
  companyId: string;
  entryId: string;
  title: string;
  saved?: boolean;
  disabled?: boolean;
  derivedDefault?: boolean;
  onValue?: (value: boolean) => void;
  onDraftChange?: (value: boolean) => void;
};
export function WorkImportanceCheckbox(props: Props) {
  return <Preference key={`${props.userId}:${props.companyId}:${props.entryId}`} {...props} />;
}
function Preference({
  userId,
  companyId,
  entryId,
  title,
  saved = true,
  disabled = false,
  derivedDefault = false,
  onValue,
  onDraftChange,
}: Props) {
  const key = importanceDraftKey(userId, companyId, entryId);
  const initial = readImportanceDraft(key);
  const [checked, setChecked] = useState(initial?.value ?? derivedDefault);
  const [base, setBase] = useState<WorkImportanceItem>({
    workEntryId: entryId,
    importance: null,
    version: null,
  });
  const [ready, setReady] = useState(!saved);
  const [busy, setBusy] = useState(false);
  const [blocked, setBlocked] = useState(false);
  const [recovery, setRecovery] = useState(false);
  const [message, setMessage] = useState('');
  const [reload, setReload] = useState(0);
  const generation = useRef(0);
  const lock = useRef(false);
  const callback = useRef(onValue);
  callback.current = onValue;
  useEffect(() => callback.current?.(checked), [checked]);
  useEffect(() => {
    const ticket = ++generation.current;
    if (!saved) {
      setReady(true);
      return;
    }
    setReady(false);
    setBlocked(false);
    void readWorkImportanceList(companyId, [entryId]).then(
      (result) => {
        if (ticket !== generation.current) return;
        const item = result[entryId]!;
        const draft = readImportanceDraft(key);
        const actual = item.importance ?? derivedDefault;
        const unsaved = draft !== null && draft.value !== actual;
        if (draft && !unsaved) saveImportanceDraft(key, null);
        setBase(item);
        setChecked(unsaved ? draft.value : actual);
        setRecovery(unsaved);
        setMessage(unsaved ? '이전 선택을 보존했습니다. 적용하려면 선택 저장을 누르세요.' : '');
        setReady(true);
      },
      () => {
        if (ticket !== generation.current) return;
        setBlocked(true);
        setMessage('중요 표시를 확인하지 못했습니다. 기록은 그대로 유지됩니다.');
      },
    );
    return () => {
      generation.current++;
    };
  }, [companyId, entryId, saved, reload, key, derivedDefault]);
  async function commit(value: boolean) {
    if (disabled || busy || lock.current || !ready || blocked) return;
    setChecked(value);
    saveImportanceDraft(key, { value, attempted: false });
    if (!saved) {
      onDraftChange?.(value);
      setMessage('업무 저장 후 중요 표시도 저장됩니다.');
      return;
    }
    if (!navigator.onLine) {
      setBlocked(true);
      setMessage('오프라인입니다. 선택을 보존했습니다.');
      return;
    }
    const ticket = generation.current;
    lock.current = true;
    setBusy(true);
    setMessage('중요 표시 저장 중');
    saveImportanceDraft(key, { value, attempted: true });
    try {
      const item = await writeWorkImportance(companyId, { ...base, importance: value });
      if (readImportanceDraft(key)?.value === value) saveImportanceDraft(key, null);
      if (ticket !== generation.current) return;
      setBase(item);
      setRecovery(false);
      setMessage('중요 표시 저장됨');
    } catch (error) {
      if (ticket !== generation.current) return;
      setBlocked(true);
      setRecovery(true);
      setMessage(
        error instanceof WorkFailure && error.status === 409
          ? '다른 곳에서 중요 표시가 바뀌었습니다. 다시 조회해 확인하세요.'
          : '저장 여부가 불확실합니다. 선택은 보존하며 자동 재시도하지 않습니다.',
      );
    } finally {
      lock.current = false;
      if (ticket === generation.current) setBusy(false);
    }
  }
  return (
    <div className="work-importance-control">
      <label className="workspace-check">
        <input
          type="checkbox"
          aria-label={`${title || '새 업무'} 중요`}
          checked={checked}
          disabled={disabled || busy || !ready || blocked}
          onChange={(event) => void commit(event.target.checked)}
        />
        중요
      </label>
      <small className="field-hint">{saved ? '체크 즉시 저장' : '업무 저장 후 반영'}</small>
      <HelpHint label="중요 표시">
        계정에 저장하는 개인 표시이며 내보내기에는 포함되지 않습니다.
      </HelpHint>
      {message && (
        <p role="status" className="field-hint">
          {message}
        </p>
      )}
      {blocked && (
        <button type="button" disabled={disabled || busy} onClick={() => setReload((v) => v + 1)}>
          중요 표시 다시 조회
        </button>
      )}
      {!blocked && recovery && saved && (
        <button
          type="button"
          disabled={disabled || busy || !ready}
          onClick={() => void commit(checked)}
        >
          중요 선택 저장
        </button>
      )}
    </div>
  );
}
