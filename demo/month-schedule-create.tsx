// Public-only creation adapter; product recurring schedules remain unchanged.
import { useEffect, useRef, useState } from 'react';
import type { WorkspaceProject, WorkspaceTag } from '../shared/schema/workspace';
import { WorkEntriesPanel } from '../web/work-entries';
import { workspaceHasUnsavedChanges } from '../web/workspace-draft-state';
import '../web/month-schedule-create.css';

export function MonthScheduleCreate({
  companyId,
  userId,
  date,
  projectId,
  projects,
  tags,
  onClose,
  onDateChange,
}: {
  companyId: string;
  userId: string;
  date: string;
  projectId: string;
  projects: WorkspaceProject[];
  tags: WorkspaceTag[];
  onClose: () => void;
  onChanged: () => void;
  onDateChange: (date: string) => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [pending, setPending] = useState(false);
  useEffect(() => {
    if (dialog.current && !dialog.current.open) dialog.current.showModal();
  }, []);
  function allow() {
    return (
      !pending &&
      (!workspaceHasUnsavedChanges() ||
        window.confirm('작성 중인 가상 일정 초안을 이 브라우저에 보관하고 닫을까요?'))
    );
  }
  function close() {
    if (allow()) {
      dialog.current?.close();
      onClose();
    }
  }
  return (
    <dialog
      ref={dialog}
      className="month-schedule-dialog"
      aria-labelledby="month-schedule-title"
      onCancel={(event) => {
        event.preventDefault();
        close();
      }}
    >
      <div className="month-schedule-heading">
        <div>
          <h2 id="month-schedule-title">일정 추가</h2>
          <p>
            {date} ·{' '}
            {projectId
              ? (projects.find((project) => project.id === projectId)?.code ?? '선택 프로젝트')
              : '프로젝트 선택 없음'}
          </p>
        </div>
        <button type="button" disabled={pending} onClick={close}>
          닫기 · 초안 보관
        </button>
      </div>
      <p className="field-hint">
        같은 회사에 작성하던 초안이 있으면 먼저 복구합니다. 날짜와 프로젝트를 확인한 뒤 저장하세요.
      </p>
      <p className="field-hint demo-schedule-scope">
        가상 1회성 일정을 추가합니다. 반복 일정은 공개 데모에 포함되지 않습니다.
      </p>
      {pending && <p role="status">저장 결과를 확인하고 있습니다.</p>}
      <WorkEntriesPanel
        companyId={companyId}
        userId={userId}
        projects={projects}
        tags={tags}
        selectedProjectId={projectId}
        year={Number(date.slice(0, 4))}
        dayView
        onDateSelect={onDateChange}
        creationContext={{ date, onPendingChange: setPending }}
      />
    </dialog>
  );
}
