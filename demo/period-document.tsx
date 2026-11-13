import type { PeriodDocumentProps } from '../web/period-document';
import '../web/period-document.css';

const labels = {
  daily_note: '일간 메모',
  weekly_note: '주간 메모',
  weekly_report: '작성 주간보고',
} as const;

// The public fixture has no document persistence. Do not mount the product
// editor: its draft and save workflow would suggest an unavailable capability.
export function PeriodDocument({ kind }: PeriodDocumentProps) {
  const label = labels[kind];
  return (
    <section className="period-document" aria-label={label}>
      <div className="period-document-heading">
        <h3>{label}</h3>
      </div>
      <p className="field-hint">공개 데모에서는 {label} 작성·저장을 제공하지 않습니다.</p>
    </section>
  );
}
