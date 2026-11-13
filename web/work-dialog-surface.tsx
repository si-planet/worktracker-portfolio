import { useEffect, useRef, type ReactNode } from 'react';
import './work-dialog-surface.css';

/** Native modal keeps focus inside one work item and restores its triggering control. */
export function WorkDialogSurface({
  modal,
  open,
  label,
  onClose,
  children,
}: {
  modal: boolean;
  open: boolean;
  label: string;
  onClose: () => void;
  children: ReactNode;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    if (!modal) return;
    if (open && !dialog.current?.open) dialog.current?.showModal();
    if (!open && dialog.current?.open) dialog.current?.close();
  }, [modal, open]);
  if (!modal) return <>{children}</>;
  return (
    <dialog
      ref={dialog}
      className="work-item-dialog"
      aria-label={label}
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
    >
      <div className="work-dialog-toolbar">
        <strong>{label}</strong>
        <button type="button" aria-label={`${label} 닫기`} onClick={onClose}>
          닫기
        </button>
      </div>
      {children}
    </dialog>
  );
}
