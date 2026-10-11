import type { ReactNode } from "react";
import { Button } from "./Button";
import { Modal } from "./Modal";
import "./RefusalDialog.css";

interface RefusalDialogProps {
  open: boolean;
  onClose: () => void;
  /** Name of the refused action, e.g. "Valider la version". */
  action: string;
  /** Why it was refused — provided by the caller (the backend decides). */
  reason: string;
  /** Names of people who can do it. Never invented here; ignored when `sensitive`. */
  authorized?: string[];
  /** Sensitive permission: no name is shown, only the compliance contact message. */
  sensitive?: boolean;
  /** Extra content, e.g. a "Copier la demande" button. */
  children?: ReactNode;
}

/**
 * Generic refusal window (DECISION-025 q02), built on `Modal`.
 *
 * In `sensitive` mode no holder name is rendered, but `action`, `reason`
 * and `children` are shown as given: callers must never put a name there.
 * For sensitive permissions the backend should not send the holder list at
 * all; this component only hides what it receives.
 */
export function RefusalDialog({ open, onClose, action, reason, authorized = [], sensitive, children }: RefusalDialogProps) {
  return (
    <Modal open={open} onClose={onClose} title="Action refusée" actions={<Button onClick={onClose}>Fermer</Button>}>
      <p className="gs-refusal-action">{action}</p>
      <p>{reason}</p>
      {sensitive ? (
        <p className="gs-refusal-contact">Contactez la fonction conformité.</p>
      ) : (
        <>
          <h3 className="gs-refusal-heading">Personnes autorisées</h3>
          {authorized.length > 0 ? (
            <ul className="gs-refusal-list">
              {authorized.map((name, i) => (
                <li key={`${name}-${i}`}>{name}</li>
              ))}
            </ul>
          ) : (
            <p>Aucune personne n'est indiquée.</p>
          )}
        </>
      )}
      {children}
    </Modal>
  );
}
