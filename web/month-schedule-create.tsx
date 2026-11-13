import { useEffect, useRef, useState } from 'react';
import type { WorkspaceProject, WorkspaceTag } from '../shared/schema/workspace';
import { WorkEntriesPanel } from './work-entries';
import { NewRecurrenceSchedule } from './recurrence';
import { workspaceHasUnsavedChanges } from './workspace-draft-state';
import './month-schedule-create.css';

export function MonthScheduleCreate({
  companyId,
  userId,
  date,
  projectId,
  projects,
  tags,
  onClose,
  onChanged,
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
  const [mode, setMode] = useState<'once' | 'repeat'>('once');
  const [pending, setPending] = useState(false);
  useEffect(() => {
    if (dialog.current && !dialog.current.open) dialog.current.showModal();
  }, []);
  function allow() {
    return (
      !pending &&
      (!workspaceHasUnsavedChanges() ||
        window.confirm(
          '작성 중인 초안과 미확인 결과를 이 회사에 보관하고 이동할까요? 서버에는 자동 저장하지 않습니다.',
        ))
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
      <div className="month-schedule-modes" role="group" aria-label="일정 작성 방식">
        <button
          type="button"
          aria-pressed={mode === 'once'}
          disabled={pending}
          onClick={() => {
            if (mode !== 'once' && allow()) setMode('once');
          }}
        >
          1회성 일정
        </button>
        <button
          type="button"
          aria-pressed={mode === 'repeat'}
          disabled={pending}
          onClick={() => {
            if (mode !== 'repeat' && allow()) setMode('repeat');
          }}
        >
          반복 일정
        </button>
      </div>
      {pending && (
        <p role="status">
          요청 결과를 확인하고 있습니다. 확인이 끝나면 작성 방식이나 창을 바꿀 수 있습니다.
        </p>
      )}
      {mode === 'once' ? (
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
      ) : (
        <NewRecurrenceSchedule
          companyId={companyId}
          userId={userId}
          date={date}
          projectId={projectId}
          onChanged={onChanged}
          onPendingChange={setPending}
        />
      )}
    </dialog>
  );
}
