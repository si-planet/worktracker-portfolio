import { HelpHint } from './help-hint';
import { useRef, useState } from 'react';
import type { DuplicateWbsReview } from '../shared/schema/work-duplicate';
import type { WbsPlanner } from '../shared/schema/wbs-planner';
import { zWbsYear } from '../shared/schema/wbs';
import { readWbsPlanner } from './wbs-planner-api';
import { workError } from './work-entry-api';

export function duplicateWbsChoices(
  value: WbsPlanner,
  companyId: string,
  projectId: string,
  year: number,
) {
  if (value.companyId !== companyId || value.year !== year) return [];
  return value.projects
    .filter((p) => p.id === projectId && p.isActive)
    .flatMap((p) =>
      p.plans.flatMap((plan) =>
        plan.items.map((item) => ({
          label: `${plan.year} · ${item.title}`,
          target: {
            itemId: item.id,
            itemVersion: item.version,
            planId: plan.id,
            planVersion: plan.version,
          },
        })),
      ),
    );
}

/** Read-only candidates; selection belongs to the parent's persisted duplicate draft. */
export function WorkDuplicateWbs({
  companyId,
  projectId,
  kind,
  year,
  review,
  sourceLabel,
  selectionLabel,
  linkId,
  required,
  disabled,
  online,
  onChange,
}: {
  companyId: string;
  projectId: string;
  kind: string;
  year: number;
  review: DuplicateWbsReview;
  sourceLabel: string;
  selectionLabel: string;
  linkId: string;
  required: boolean;
  disabled: boolean;
  online: boolean;
  onChange: (review: DuplicateWbsReview, label: string) => void;
}) {
  const [selectedYear, setSelectedYear] = useState(String(year));
  const scope = `${companyId}/${projectId}/${kind}/${selectedYear}`;
  const scopeRef = useRef(scope);
  scopeRef.current = scope;
  const revision = useRef(0);
  const [result, setResult] = useState<{
    scope: string;
    choices: ReturnType<typeof duplicateWbsChoices>;
  } | null>(null);
  const [status, setStatus] = useState({ scope: '', loading: false, error: '' });
  const choices = result?.scope === scope ? result.choices : [];
  async function load() {
    const checkedYear = zWbsYear.safeParse(Number(selectedYear));
    if (!checkedYear.success || !projectId || kind !== 'task' || !online || disabled) return;
    const ticket = ++revision.current;
    setStatus({ scope, loading: true, error: '' });
    try {
      const value = await readWbsPlanner(companyId, checkedYear.data);
      if (ticket === revision.current && scopeRef.current === scope) {
        setResult({
          scope,
          choices: duplicateWbsChoices(value, companyId, projectId, checkedYear.data),
        });
        setStatus({ scope, loading: false, error: '' });
      }
    } catch (error) {
      if (ticket === revision.current && scopeRef.current === scope) {
        setResult(null);
        setStatus({ scope, loading: false, error: workError(error) });
      }
    }
  }
  const validSelection = kind === 'task' && review.link?.projectId === projectId;
  const selected = required ? 'pending' : (review.link?.target.itemId ?? '');
  return (
    <fieldset disabled={disabled} aria-label="복사 WBS 연결 검토">
      <legend>새 업무의 WBS 연결</legend>
      <p>
        원본 연결: {review.expectedSource ? sourceLabel : '없음'}. 원본 업무와 기준 계획은 변경하지
        않습니다.
      </p>
      {required && (
        <p role="status">
          프로젝트 또는 종류가 바뀌었습니다. 연결 대상을 다시 선택하거나 연결 없이 복사를
          선택하세요.
        </p>
      )}
      {review.link && validSelection && <p>선택한 연결: {selectionLabel}</p>}
      <label>
        복사 WBS 연결
        <select
          aria-label="복사 WBS 연결"
          value={selected}
          onChange={(event) => {
            if (event.target.value === '') onChange({ ...review, link: null }, '연결 없음');
            else {
              const chosen = choices.find((c) => c.target.itemId === event.target.value);
              if (!chosen && validSelection && review.link?.target.itemId === event.target.value)
                onChange(review, selectionLabel);
              if (chosen)
                onChange(
                  { ...review, link: { id: linkId, projectId, target: chosen.target } },
                  chosen.label,
                );
            }
          }}
        >
          {required && (
            <option value="pending" disabled>
              연결 검토 필요
            </option>
          )}
          <option value="">WBS 연결 없이 일반 복사</option>
          {review.link &&
            validSelection &&
            !choices.some((c) => c.target.itemId === review.link!.target.itemId) && (
              <option value={review.link.target.itemId}>조회한 연결 승계 · {selectionLabel}</option>
            )}
          {kind === 'task' &&
            choices.map((c) => (
              <option key={c.target.itemId} value={c.target.itemId}>
                {c.label}
              </option>
            ))}
        </select>
      </label>
      {kind === 'task' && (
        <>
          <label>
            WBS 계획 연도
            <input
              aria-label="복사 WBS 계획 연도"
              type="number"
              min="1"
              max="9999"
              value={selectedYear}
              onChange={(event) => setSelectedYear(event.target.value)}
            />
          </label>
          <button
            type="button"
            disabled={!online || !projectId || (status.scope === scope && status.loading)}
            onClick={() => void load()}
          >
            선택 프로젝트 WBS 조회 / 새로고침
          </button>
          <HelpHint label="WBS 연결 후보">
            선택 연도·프로젝트의 유효한 항목만 조회합니다. 다른 연도의 계획은 연도를 바꿔
            조회하세요.
          </HelpHint>
          {result?.scope === scope && !choices.length && (
            <p>이 연도·프로젝트에는 연결할 WBS 항목이 없습니다.</p>
          )}
        </>
      )}
      {!online && <p>오프라인에서는 대상 WBS를 조회할 수 없습니다.</p>}
      {status.scope === scope && status.error && <p role="alert">{status.error}</p>}
    </fieldset>
  );
}
