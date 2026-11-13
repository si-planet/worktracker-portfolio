import { useWorkImportance } from './work-importance-state';
import type { WorkEntryFinal } from '../shared/schema/work-entry';
import type { WorkspaceProject, WorkspaceTag } from '../shared/schema/workspace';
import { dailySheetDetails } from './daily-sheet-model';
import './daily-work-sheet.css';

const statuses = {
  todo: '미진행',
  doing: '진행 중',
  paused: '중단',
  planned: '예정',
  done: '완료',
  canceled: '취소',
};
const kinds = {
  task: '업무',
  meeting: '회의',
  field: '외근',
  event: '회사 행사',
  leave: '휴가',
  etc: '기타',
};
export function DailyWorkSheet({
  userId,
  companyId,
  refresh,
  entries,
  projects,
  tags,
  categories,
  disabled,
  onEdit,
  onStatus,
}: {
  userId: string;
  companyId: string;
  refresh: number;
  entries: readonly WorkEntryFinal[];
  projects: readonly WorkspaceProject[];
  tags: readonly WorkspaceTag[];
  categories: (entry: WorkEntryFinal) => readonly string[];
  disabled: boolean;
  onEdit: (entry: WorkEntryFinal) => void;
  onStatus: (entry: WorkEntryFinal, status: WorkEntryFinal['status']) => void;
}) {
  const importance = useWorkImportance(userId, companyId, entries, refresh);
  return (
    <div className="daily-sheet-wrap">
      <table className="daily-work-sheet" aria-label="일간 업무 목록">
        <colgroup>
          <col className="daily-number" />
          <col className="daily-category" />
          <col />
          <col className="daily-priority" />
          <col className="daily-completion" />
          <col className="daily-remarks" />
        </colgroup>
        <thead>
          <tr>
            <th className="daily-number">No.</th>
            <th>구분</th>
            <th>업무</th>
            <th className="daily-priority">중요</th>
            <th>완료</th>
            <th>비고</th>
          </tr>
        </thead>
        <tbody>
          {entries.map((entry, index) => {
            const detail = dailySheetDetails(entry.content);
            const important = importance(entry);
            const source = categories(entry);
            const category =
              source.join(' · ') ||
              detail.category ||
              projects.find((project) => project.id === entry.projectId)?.code ||
              tags
                .filter((tag) => entry.tagIds.includes(tag.id))
                .map((tag) => tag.label)
                .join(' · ') ||
              kinds[entry.kind];
            const canComplete =
              entry.kind !== 'leave' &&
              entry.status !== 'paused' &&
              entry.status !== 'canceled' &&
              !!entry.plannedDate;
            return (
              <tr
                key={entry.id}
                id={`work-entry-${entry.id}`}
                tabIndex={-1}
                data-status={entry.status}
              >
                <td className="daily-number">{index + 1}</td>
                <td className="daily-category-cell">{category}</td>
                <td className="daily-title-cell">
                  <button
                    type="button"
                    className="daily-title"
                    aria-label={`업무 상세: ${entry.title}`}
                    disabled={disabled}
                    onClick={() => onEdit(entry)}
                  >
                    {entry.title}
                  </button>
                  {entry.status !== 'todo' && entry.status !== 'done' && (
                    <small>{statuses[entry.status]}</small>
                  )}
                  {important && <small className="daily-mobile-priority">✓ 중요</small>}
                </td>
                <td
                  className="daily-priority"
                  aria-label={`중요: ${entry.title} ${important === undefined ? '확인 필요' : important ? '예' : '아니오'}`}
                >
                  {important === undefined ? '…' : important ? '✓' : ''}
                </td>
                <td className="daily-completion-cell">
                  {canComplete ? (
                    <label className="daily-check">
                      <input
                        type="checkbox"
                        aria-label={`완료: ${entry.title}`}
                        checked={entry.status === 'done'}
                        disabled={disabled}
                        onChange={(event) =>
                          onStatus(
                            entry,
                            event.target.checked
                              ? 'done'
                              : entry.kind === 'task'
                                ? 'todo'
                                : 'planned',
                          )
                        }
                      />
                    </label>
                  ) : (
                    <span title={statuses[entry.status]}>
                      {entry.status === 'done' ? '✓' : '–'}
                    </span>
                  )}
                </td>
                <td className="daily-remarks-cell">
                  <span>{detail.notes || '–'}</span>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
