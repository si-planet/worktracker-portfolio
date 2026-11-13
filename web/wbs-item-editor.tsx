import { HelpHint } from './help-hint';
import { useEffect, useRef } from 'react';
export type ItemFields = {
  id: string;
  originalId: string | null;
  title: string;
  description: string;
  sortOrder: string;
  startOn: string;
  endOn: string;
  revise: boolean;
  revisedStartOn: string;
  revisedEndOn: string;
  reason: string;
};
export function newItemFields(): ItemFields {
  return {
    id: crypto.randomUUID(),
    originalId: null,
    title: '',
    description: '',
    sortOrder: '0',
    startOn: '',
    endOn: '',
    revise: false,
    revisedStartOn: '',
    revisedEndOn: '',
    reason: '',
  };
}
export function WbsItemEditor({
  value,
  onChange,
  onSave,
  onClose,
  disabled,
  originalLabel,
}: {
  value: ItemFields;
  onChange: (v: ItemFields) => void;
  onSave: () => void;
  onClose: () => void;
  disabled: boolean;
  originalLabel: string;
}) {
  const title = useRef<HTMLInputElement>(null);
  useEffect(() => {
    title.current?.focus();
  }, [value.id]);
  const set = (key: keyof ItemFields, text: string | boolean) =>
    onChange({ ...value, [key]: text });
  const formatId = `wbs-item-format-${value.id}`,
    datesId = `wbs-item-dates-${value.id}`,
    orderId = `wbs-item-order-${value.id}`;
  return (
    <section className="wbs-editor" aria-label="WBS 항목 검토">
      <h2>{value.originalId ? 'WBS 항목 수정' : 'WBS 항목 추가'}</h2>
      <p>{originalLabel}</p>
      <HelpHint label="WBS 입력 형식" id={formatId}>
        제목은 필수(1~200자), 설명은 선택(최대 5,000자)입니다. 날짜는 비워두면 미정입니다.
      </HelpHint>
      <details className="wbs-input-guide">
        <summary>입력 예시와 형식</summary>
        <dl>
          <dt>항목 제목</dt>
          <dd>로그인 화면 구현</dd>
          <dt>항목 설명 (선택)</dt>
          <dd>완료 기준: 로그인 성공·실패 안내 확인</dd>
          <dt>표시 순서</dt>
          <dd>0, 10, 20처럼 정수 입력. 작은 숫자부터 표시합니다.</dd>
          <dt>{value.originalId ? '변경 계획 일정 (선택)' : '원래 계획 일정 (선택)'}</dt>
          <dd>2026-10-26 ~ 2026-10-30 또는 공란(미정). 한쪽 날짜만 입력할 수도 있습니다.</dd>
          {value.originalId && (
            <>
              <dt>일정 변경 사유 (선택 · 최대 5,000자)</dt>
              <dd>연동 API 일정에 맞춰 종료일 조정</dd>
            </>
          )}
        </dl>
        <p className="wbs-field-help">참고용 예시입니다. 입력칸에 자동으로 채워지지 않습니다.</p>
      </details>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          onSave();
        }}
      >
        <fieldset disabled={disabled}>
          <legend>제목·설명·계획 일정</legend>
          <label>
            항목 제목
            <input
              ref={title}
              value={value.title}
              maxLength={200}
              required
              placeholder="예: 로그인 화면 구현"
              aria-describedby={formatId}
              onChange={(e) => set('title', e.target.value)}
            />
          </label>
          <label>
            항목 설명
            <textarea
              value={value.description}
              maxLength={5000}
              placeholder="예: 완료 기준: 로그인 성공·실패 안내 확인"
              aria-describedby={formatId}
              onChange={(e) => set('description', e.target.value)}
            />
          </label>
          <label>
            표시 순서
            <input
              type="number"
              step="1"
              min={-Number.MAX_SAFE_INTEGER}
              max={Number.MAX_SAFE_INTEGER}
              required
              value={value.sortOrder}
              aria-describedby={orderId}
              onChange={(e) => set('sortOrder', e.target.value)}
            />
          </label>
          <HelpHint label="표시 순서" id={orderId}>
            작은 숫자부터 표시 · 정수만 입력 · 0과 음수도 가능합니다.
          </HelpHint>
          <HelpHint label="계획 날짜" id={datesId}>
            날짜 형식: YYYY-MM-DD · 두 날짜를 입력하면 종료일은 시작일과 같거나 늦어야 합니다.
          </HelpHint>
          {!value.originalId ? (
            <>
              <label>
                원래 계획 시작일
                <input
                  type="date"
                  min="0001-01-01"
                  max="9999-12-31"
                  value={value.startOn}
                  aria-describedby={datesId}
                  onChange={(e) => set('startOn', e.target.value)}
                />
              </label>
              <label>
                원래 계획 종료일
                <input
                  type="date"
                  min={value.startOn || '0001-01-01'}
                  max="9999-12-31"
                  value={value.endOn}
                  aria-describedby={datesId}
                  onChange={(e) => set('endOn', e.target.value)}
                />
              </label>
            </>
          ) : (
            <>
              <p>
                원래 계획은 보존됩니다. 원래 계획 정정은 현재 지원하지 않으며 삭제·재생성으로
                정정하지 않습니다.
              </p>
              <label className="wbs-check">
                <input
                  type="checkbox"
                  checked={value.revise}
                  onChange={(e) => set('revise', e.target.checked)}
                />
                변경 계획을 함께 저장
              </label>
              {value.revise && (
                <>
                  <p>
                    두 날짜를 전체 쌍으로 저장합니다. 공란은 미정이며 원래 날짜로 자동 채우지
                    않습니다.
                  </p>
                  <label>
                    변경 계획 시작일
                    <input
                      type="date"
                      min="0001-01-01"
                      max="9999-12-31"
                      value={value.revisedStartOn}
                      aria-describedby={datesId}
                      onChange={(e) => set('revisedStartOn', e.target.value)}
                    />
                  </label>
                  <label>
                    변경 계획 종료일
                    <input
                      type="date"
                      min={value.revisedStartOn || '0001-01-01'}
                      max="9999-12-31"
                      value={value.revisedEndOn}
                      aria-describedby={datesId}
                      onChange={(e) => set('revisedEndOn', e.target.value)}
                    />
                  </label>
                  <label>
                    일정 변경 사유
                    <textarea
                      value={value.reason}
                      maxLength={5000}
                      placeholder="예: 연동 API 일정에 맞춰 종료일 조정 (선택)"
                      onChange={(e) => set('reason', e.target.value)}
                    />
                  </label>
                </>
              )}
            </>
          )}
          <button type="submit" className="primary">
            WBS 항목 저장
          </button>
        </fieldset>
      </form>
      <button type="button" onClick={onClose}>
        항목 검토 닫기 · 초안 유지
      </button>
    </section>
  );
}
