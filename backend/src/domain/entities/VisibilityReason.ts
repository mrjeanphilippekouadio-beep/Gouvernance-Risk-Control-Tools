/**
 * Conservation L2a (q246 A, q247 A, migration 096): the text of a visibility reason lives in `visibility_reasons`, never in
 * `audit_log.reason`. An audit event names it by reference; the repository writes the text and the reference in ONE transaction.
 */
export type VisibilityReasonSource =
  | "VISIBILITY_CHANGE"
  | "ACCESS_RENEWAL"
  | "PERIMETER_CHANGE"
  | "RACI_OPENING"
  | "PROCESS_OWNER_OPENING"
  | "DEPARTMENT_GROUP_OPENING"
  | "RISK_DESIGNATION_OPENING"
  | "SENSITIVE_VIEW_REQUEST"
  | "SENSITIVE_VIEW_DECISION"
  | "SENSITIVE_VIEW_REVOCATION";

/** `id` is set when the repository has already stored the reason (the grant rows reference the same one). */
export interface VisibilityReason {
  source: VisibilityReasonSource;
  text: string;
  id?: string;
}

/**
 * The audit fields of an event that carries a visibility reason: never the text in `reason`. A blank text means no reason.
 * Events of one action that share a reason share the returned object, so a single row is stored.
 */
export function visibilityReasonOf(
  source: VisibilityReasonSource,
  text: string | null | undefined,
  id?: string | null,
): { reason: null; visibilityReason?: VisibilityReason } {
  const clean = text?.trim();
  if (!clean) return { reason: null };
  return { reason: null, visibilityReason: { source, text: clean, ...(id ? { id } : {}) } };
}

/** Server-side wording of a reason read back (format decided here, never recomputed by the front). */
export function displayReason(text: string | null, erasedAt: Date | null): string | null {
  if (erasedAt) {
    const d = erasedAt.toLocaleDateString("fr-FR", { day: "2-digit", month: "2-digit", year: "numeric", timeZone: "UTC" });
    return `motif effacé le ${d} (conservation)`;
  }
  return text;
}
