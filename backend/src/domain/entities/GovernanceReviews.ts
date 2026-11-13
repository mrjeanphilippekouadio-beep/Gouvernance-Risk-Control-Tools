export type ExceptionReviewOutcome = "REVIEWED" | "CONTESTED";

/**
 * DECISION-074 R-1 line 3 / q157 (lot D5): a third party's review of an action applied without a second validation.
 * Add-only. CONTESTED changes no business state (the Audit never decides): it only warns the Risk Manager and the Committee.
 */
export interface GovernanceExceptionReview {
  id: string;
  tenantId: string;
  auditLogId: string;
  outcome: ExceptionReviewOutcome;
  reviewedBy: string;
  reviewedAt: Date;
  comment: string;
}

/** The audit entry a review points at (read from audit_log, tenant-scoped). */
export interface ReviewableAuditEntry {
  id: string;
  userId: string;
  entityType: string;
  entityId: string;
  action: string;
  governanceException: string | null;
  /** Marked as an exception, or the submission of a profile that lowers the organization size (q157). */
  reviewable: boolean;
}

export type AcceptanceStatus = "PENDING" | "ACTIVE" | "REJECTED" | "REVOKED";
/** ALONE = accepted with no second validation (no third party existed); CONFIRMED = confirmed by someone else. */
export type AcceptanceRegime = "ALONE" | "CONFIRMED";

/** Journal marker written when an acceptance becomes ACTIVE with no second validation. */
export const PRINCIPLE_ACCEPTANCE_ALONE_EXCEPTION = "principle.acceptance.alone";
/** q181 (DECISION-095): an acceptance made alone renewing a previous one made alone that nobody could review (« renouvelé sans revue »). */
export const PRINCIPLE_ACCEPTANCE_RENEWED_WITHOUT_REVIEW_EXCEPTION = "principle.acceptance.renewedWithoutReview";

/** Journal marker (audit_log.governance_exception) of a SOLE_RM confirmation (q252 A, ASSIGN_PROCESS and SET_DEFAULT): decided alone by the only Risk Manager. */
export const SOLE_RM_EXCEPTION = "riskFramework.soleRiskManager";
/** q266 A / CMP-B6C-03 (pattern q181): a SOLE_RM confirmation made while a previous one was still not reviewed. Never blocked, marked and counted; frozen at write. */
export const SOLE_RM_WITHOUT_PRIOR_REVIEW_EXCEPTION = "riskFramework.soleRiskManager.withoutPriorReview";
export const SOLE_RM_EXCEPTIONS: readonly string[] = [SOLE_RM_EXCEPTION, SOLE_RM_WITHOUT_PRIOR_REVIEW_EXCEPTION];
/**
 * q266 A (DECISION-128): a SOLE_RM confirmation always has a review delay. The tenant's `exceptionReviewDelayDays` (q168)
 * wins; this value only applies when the tenant has not set one. q291, en attente PO (A = 30 days recommended): change it here.
 */
export const SOLE_RM_REVIEW_DEFAULT_DAYS = 30;

/**
 * DECISION-074 R-5 / q138: a dated acceptance of a principle that is not respected. Content immutable; expiry is not a
 * stored state (expiresAt < now => the principle is "not respected" again on read).
 */
export interface GovernancePrincipleAcceptance {
  id: string;
  tenantId: string;
  principleId: string;
  catalogVersion: string;
  offendersSnapshot: unknown[];
  reason: string;
  expiresAt: Date;
  status: AcceptanceStatus;
  regime: AcceptanceRegime | null;
  acceptedBy: string;
  acceptedAt: Date;
  confirmedBy: string | null;
  confirmedAt: Date | null;
  endedBy: string | null;
  endedAt: Date | null;
  endReason: string | null;
}
