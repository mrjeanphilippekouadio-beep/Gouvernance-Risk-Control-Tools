import type { ReactNode } from "react";
import { useEffect, useRef } from "react";
import "./Modal.css";

interface ModalProps {
  open: boolean;
  /** Called on every dismissal — backdrop-less Escape, close button, native close. */
  onClose: () => void;
  title: string;
  children?: ReactNode;
  /** Action row, usually a secondary "cancel" plus the confirming button. */
  actions?: ReactNode;
}

/**
 * Confirmation dialog for irreversible actions (design system section
 * "Modale") — never a browser `confirm()`.
 *
 * Built on the native `<dialog>` element: focus trapping, the inert
 * background, the `::backdrop` and Escape-to-close all come for free
 * instead of being re-implemented.
 */
export function Modal({ open, onClose, title, children, actions }: ModalProps) {
  const ref = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    if (open && !element.open) element.showModal();
    if (!open && element.open) element.close();
  }, [open]);

  return (
    <dialog ref={ref} className="gs-modal" onClose={onClose} onCancel={onClose}>
      <h2 className="gs-modal-title">{title}</h2>
      {children !== undefined && <div className="gs-modal-body">{children}</div>}
      {actions && <div className="gs-modal-actions">{actions}</div>}
    </dialog>
  );
}
