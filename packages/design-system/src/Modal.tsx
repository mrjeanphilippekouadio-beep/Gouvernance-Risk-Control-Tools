import type { ReactNode } from "react";
import { useEffect, useId, useRef } from "react";
import "./Modal.css";

interface ModalProps {
  open: boolean;
  /** Called on every dismissal — backdrop-less Escape, close button, native close. */
  onClose: () => void;
  title: string;
  children?: ReactNode;
  /** Action row, usually a secondary "cancel" plus the confirming button. */
  actions?: ReactNode;
  /** An action is in progress: sets `aria-busy` on the dialog. */
  busy?: boolean;
}

/**
 * Confirmation dialog for irreversible actions (design system section
 * "Modale") — never a browser `confirm()`.
 *
 * Built on the native `<dialog>` element: focus trapping, the inert
 * background, the `::backdrop` and Escape-to-close all come for free
 * instead of being re-implemented. The dialog is named by its title
 * (`aria-labelledby`) and the title receives focus on open, unless a
 * child sets `autofocus`.
 */
export function Modal({ open, onClose, title, children, actions, busy }: ModalProps) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleRef = useRef<HTMLHeadingElement>(null);
  const titleId = useId();

  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    if (open && !element.open) {
      element.showModal();
      if (!element.querySelector("[autofocus]")) titleRef.current?.focus();
    }
    if (!open && element.open) element.close();
  }, [open]);

  return (
    <dialog
      ref={ref}
      className="gs-modal"
      aria-labelledby={titleId}
      aria-busy={busy || undefined}
      onClose={onClose}
      onCancel={onClose}
    >
      <h2 ref={titleRef} id={titleId} tabIndex={-1} className="gs-modal-title">
        {title}
      </h2>
      {children !== undefined && <div className="gs-modal-body">{children}</div>}
      {actions && <div className="gs-modal-actions">{actions}</div>}
    </dialog>
  );
}
