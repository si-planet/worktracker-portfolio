import { HelpHint } from './help-hint';
import { useEffect, useRef, useState, type CSSProperties } from 'react';
import type { CategoryColorItem } from '../shared/schema/category-color';
import type { WorkspaceProject, WorkspaceTag } from '../shared/schema/workspace';
import { categoryKey, writeCategoryColor } from './category-colors';
import { WORK_COLOR_PALETTE } from './work-color-picker';
import { WorkFailure } from './work-entry-api';
import './category-color-control.css';

type Props = {
  companyId: string;
  projects: WorkspaceProject[];
  tags: WorkspaceTag[];
  colors: Record<string, CategoryColorItem>;
  ready: boolean;
  error: boolean;
  disabled: boolean;
  onSaved: (item: CategoryColorItem) => void;
  onReload: () => void;
};
export function CategoryColorControl(props: Props) {
  const [open, setOpen] = useState(false);
  const [kind, setKind] = useState<'project' | 'tag'>('project');
  const [selected, setSelected] = useState('');
  const options =
    kind === 'project'
      ? props.projects.map((p) => ({ id: p.id, label: p.code }))
      : props.tags.map((t) => ({ id: t.id, label: t.label }));
  const targetId = options.some((item) => item.id === selected) ? selected : (options[0]?.id ?? '');
  return (
    <section className="category-color-control" aria-label="프로젝트·태그 색상 설정">
      <button
        type="button"
        className="button secondary"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
      >
        프로젝트·태그 색상
      </button>
      {open && (
        <div className="category-color-panel">
          <div className="category-color-target">
            <label>
              분류
              <select
                aria-label="색상 분류"
                value={kind}
                onChange={(event) => {
                  setKind(event.target.value as 'project' | 'tag');
                  setSelected('');
                }}
              >
                <option value="project">프로젝트</option>
                <option value="tag">태그</option>
              </select>
            </label>
            <label>
              적용 대상
              <select
                aria-label="색상 적용 대상"
                disabled={!options.length}
                value={targetId}
                onChange={(event) => setSelected(event.target.value)}
              >
                {options.map((option) => (
                  <option value={option.id} key={option.id}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>
          </div>
          {targetId ? (
            <CategoryPicker
              key={`${props.companyId}:${kind}:${targetId}`}
              {...props}
              kind={kind}
              targetId={targetId}
              label={options.find((item) => item.id === targetId)!.label}
            />
          ) : (
            <p>등록된 {kind === 'project' ? '프로젝트' : '태그'}가 없습니다.</p>
          )}
          <HelpHint label="분류 색상 적용">
            한 번 지정하면 해당 분류의 모든 업무에 적용됩니다. 지정한 태그색이 프로젝트색보다
            우선하며, 여러 태그는 태그 관리 순서를 따릅니다. 이 브라우저에 저장되며 내보내기에는 포함되지
            않습니다.
          </HelpHint>
        </div>
      )}
    </section>
  );
}
function CategoryPicker({
  kind,
  targetId,
  label,
  ...props
}: Props & { kind: 'project' | 'tag'; targetId: string; label: string }) {
  const base = props.colors[categoryKey(kind, targetId)];
  const [color, setColor] = useState<string | null>(base?.color ?? null);
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const [blocked, setBlocked] = useState(false);
  const lock = useRef(false);
  useEffect(() => {
    setColor(base?.color ?? null);
    setBlocked(false);
  }, [base]);
  const disabled = props.disabled || busy || !props.ready || props.error || !base || blocked;
  async function save() {
    if (disabled || lock.current || !base) return;
    lock.current = true;
    setBusy(true);
    setMessage('');
    try {
      const result = await writeCategoryColor(props.companyId, { ...base, color });
      props.onSaved(result);
      setMessage(`${label} 분류 색상을 저장했습니다.`);
    } catch (error) {
      setBlocked(true);
      setMessage(
        error instanceof WorkFailure && error.status === 409
          ? '다른 곳에서 색상이 바뀌었습니다. 다시 조회한 뒤 선택해 주세요.'
          : '저장 결과를 확인하지 못했습니다. 다시 조회해 확인하세요.',
      );
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }
  return (
    <div>
      <div className="work-color-options" role="group" aria-label={`${label} 분류 색상`}>
        <button
          type="button"
          className="work-color-default"
          aria-pressed={color === null}
          disabled={disabled}
          onClick={() => setColor(null)}
        >
          기본
        </button>
        {WORK_COLOR_PALETTE.map(([name, value]) => (
          <button
            key={value}
            type="button"
            className="work-color-option"
            style={{ '--color-swatch': value } as CSSProperties}
            aria-label={`${name} 색상`}
            aria-pressed={color === value}
            disabled={disabled}
            onClick={() => setColor(value)}
          >
            <span aria-hidden="true" />
            {color === value && <b aria-hidden="true">✓</b>}
          </button>
        ))}
        <label className="work-color-custom">
          직접 선택
          <input
            type="color"
            aria-label="직접 분류 색상 선택"
            value={color ?? '#64748b'}
            disabled={disabled}
            onChange={(event) => setColor(event.target.value)}
          />
        </label>
      </div>
      <div className="work-color-actions">
        <button
          type="button"
          className="button secondary"
          disabled={disabled || color === base?.color}
          onClick={() => void save()}
        >
          {busy ? '저장 중…' : '분류 색상 저장'}
        </button>
        <button
          type="button"
          className="text-button"
          disabled={busy || props.disabled}
          onClick={() => {
            setMessage('');
            props.onReload();
          }}
        >
          색상 다시 조회
        </button>
      </div>
      {props.error && <p role="status">분류 색상을 불러오지 못했습니다. 다시 조회해 주세요.</p>}
      {message && <p role="status">{message}</p>}
    </div>
  );
}
