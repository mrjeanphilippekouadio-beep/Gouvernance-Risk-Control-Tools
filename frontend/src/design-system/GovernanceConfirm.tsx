import { useCallback, useState, type ReactNode } from "react";
import { Button, FormField, MessageBanner, Modal } from "@djamo/design-system";
import { ApiError, isGovernanceConfirmationRequired, type GovernanceConfirmation } from "../api/client";

type Call<T> = (confirmation?: GovernanceConfirmation) => Promise<T>;
interface Pending { call: Call<unknown>; resolve: (v: unknown) => void; reject: (e: unknown) => void; serverMessage: string }


/**
 * Double confirmation of a self-validation. The screen never predicts it: `run` sends the request as is, and only a
 * 409 GOVERNANCE_CONFIRMATION_REQUIRED opens the dialog; the SAME request is then resent with the reason. The server
 * keeps every decision (including refusing a reason: its message is shown as is).
 * Usage: `const gov = useGovernanceConfirm(); await gov.run((c) => api.validate(token, id, comment, c));` and render `{gov.dialog}`.
 */
export function useGovernanceConfirm(): { run: <T>(call: Call<T>) => Promise<T>; dialog: ReactNode } {
  const [pending, setPending] = useState<Pending | null>(null);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const run = useCallback(async function <T>(call: Call<T>): Promise<T> {
    try {
      return await call();
    } catch (err) {
      if (!isGovernanceConfirmationRequired(err)) throw err;
      const serverMessage = (err as ApiError).message.replace(/^GOVERNANCE_CONFIRMATION_REQUIRED:\s*/, "");
      return new Promise<T>((resolve, reject) => {
        setReason(""); setError(null);
        setPending({ call: call as Call<unknown>, resolve: resolve as (v: unknown) => void, reject, serverMessage });
      });
    }
  }, []);

  function cancel() {
    if (busy || !pending) return;
    pending.reject(new Error("Confirmation annulée : l'action n'a pas été appliquée."));
    setPending(null);
  }

  async function confirm() {
    if (!pending || !reason.trim() || busy) return;
    setBusy(true); setError(null);
    try {
      const result = await pending.call({ rule: "noSelfValidation", reason: reason.trim() });
      pending.resolve(result);
      setPending(null);
    } catch (err) {
      // A refused reason (400) stays here for correction; anything else goes back to the screen.
      if (err instanceof ApiError && err.status === 400) setError(err.message);
      else { pending.reject(err); setPending(null); }
    } finally { setBusy(false); }
  }

  const dialog = <Modal
    open={pending !== null}
    onClose={cancel}
    title="Appliquer sans validation indépendante"
    size="md"
    busy={busy}
    actions={<>
      <Button onClick={cancel} disabled={busy}>Annuler</Button>
      <Button variant="primary" disabled={!reason.trim() || busy} onClick={() => void confirm()}>{busy ? "Envoi…" : "Confirmer sans validation indépendante"}</Button>
    </>}
  >
    {pending && <>
      <MessageBanner tone="warning" title="Principe de gouvernance : pas d'auto-validation">
        Vous êtes à l'origine de cet élément et personne d'autre ne peut le valider. {pending.serverMessage}
      </MessageBanner>
      <p>Si vous confirmez, l'action sera appliquée et marquée « Appliqué sans validation indépendante », avec votre motif, dans la traçabilité.</p>
      {error && <MessageBanner tone="danger">{error}</MessageBanner>}
      <FormField label="Motif de la confirmation (obligatoire)" htmlFor="gov-confirm-reason">
        <input id="gov-confirm-reason" value={reason} onChange={(e) => setReason(e.target.value)} maxLength={500} required autoFocus />
      </FormField>
    </>}
  </Modal>;

  return { run, dialog };
}
