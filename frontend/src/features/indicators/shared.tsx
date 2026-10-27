import type { ReactNode } from "react";
import { Button, Modal } from "@djamo/design-system";
import { ApiError } from "../../api/client";
import type { IndicatorFrequency } from "../../api/indicators";

export const FREQUENCY_LABELS: Record<IndicatorFrequency, string> = {
  DAILY: "Quotidienne",
  WEEKLY: "Hebdomadaire",
  MONTHLY: "Mensuelle",
  QUARTERLY: "Trimestrielle",
  ANNUAL: "Annuelle",
};

export const isForbidden = (err: unknown) => err instanceof ApiError && err.status === 403;
/** A 403 "Missing permission": the global PermissionDeniedDialog explains it. Any other 403 is a business refusal to show. */
export const isPermissionDenied = (err: unknown) => err instanceof ApiError && err.missingPermission !== null;
export const isUnauthenticated = (err: unknown) => err instanceof ApiError && err.status === 401;

export function describeError(err: unknown): string {
  if (isUnauthenticated(err)) return "Session expirée : reconnecte-toi pour continuer.";
  if (err instanceof ApiError) return `${err.message}${err.requestId ? ` (réf. ${err.requestId})` : ""}`;
  if (err instanceof TypeError) return "Réseau indisponible : impossible de joindre l'API.";
  return err instanceof Error ? err.message : "Une erreur inattendue est survenue.";
}

/** ISO timestamp from the API -> calendar date (YYYY-MM-DD). Display only. */
export const dateOnly = (iso: string | null) => (iso ? iso.slice(0, 10) : "—");

const numberFmt = new Intl.NumberFormat("fr-FR", { maximumFractionDigits: 4 });
export const fmt = (value: number | null) => (value === null ? "—" : numberFmt.format(value));

export function FormModal({ open, onClose, title, formId, saving, submitLabel, children }: {
  open: boolean; onClose: () => void; title: string; formId: string; saving: boolean; submitLabel: string; children: ReactNode;
}) {
  return (
    <Modal
      open={open}
      onClose={onClose}
      title={title}
      actions={<>
        <Button onClick={onClose} disabled={saving}>Annuler</Button>
        <Button type="submit" form={formId} variant="primary" disabled={saving}>{saving ? "Enregistrement…" : submitLabel}</Button>
      </>}
    >
      {open && children}
    </Modal>
  );
}
