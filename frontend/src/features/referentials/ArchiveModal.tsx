import { useState } from "react";
import { Button, FormField, MessageBanner, Modal } from "@djamo/design-system";
import { describeError } from "../indicators/shared";

/**
 * Archive confirmation with the mandatory reason. The server owns every rule
 * (references still pointing at the item, permission): its message is shown as is.
 */
export function ArchiveModal({ open, subject, title, onClose, onConfirm }: {
  open: boolean; subject: string; title: string; onClose: () => void; onConfirm: (reason: string) => Promise<void>;
}) {
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function close() { if (!busy) { setReason(""); setError(null); onClose(); } }

  async function confirm() {
    if (!reason.trim() || busy) return;
    setBusy(true); setError(null);
    try { await onConfirm(reason.trim()); setReason(""); }
    catch (err) { setError(describeError(err)); }
    finally { setBusy(false); }
  }

  return <Modal
    open={open}
    onClose={close}
    title={title}
    actions={<>
      <Button onClick={close} disabled={busy}>Annuler</Button>
      <Button variant="destructive" disabled={!reason.trim() || busy} onClick={() => void confirm()}>{busy ? "Archivage…" : "Confirmer l'archivage"}</Button>
    </>}
  >
    {open && <>
      <p>« {subject} » sera archivé. Un motif est obligatoire et sera conservé dans la traçabilité.</p>
      {error && <MessageBanner tone="danger">{error}</MessageBanner>}
      <FormField label="Motif d'archivage" htmlFor="archive-reason">
        <textarea id="archive-reason" value={reason} onChange={(e) => setReason(e.target.value)} rows={4} required autoFocus />
      </FormField>
    </>}
  </Modal>;
}
