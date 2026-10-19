import type {
  AcceptanceRegime,
  AcceptanceStatus,
  ExceptionReviewOutcome,
  GovernanceExceptionReview,
  GovernancePrincipleAcceptance,
  ReviewableAuditEntry,
} from "../entities/GovernanceReviews.js";
import type { TransactionalAudit } from "../entities/RiskFramework.js";

export interface InsertExceptionReviewInput {
  tenantId: string;
  auditLogId: string;
  outcome: ExceptionReviewOutcome;
  reviewedBy: string;
  comment: string;
}

export interface GovernanceExceptionReviewRepository {
  getAuditEntry(tenantId: string, auditLogId: string): Promise<ReviewableAuditEntry | null>;
  /** One transaction: INSERT + audit events. Duplicate (same reviewer, same entry) -> ConflictError. */
  insert(input: InsertExceptionReviewInput, audit: TransactionalAudit<GovernanceExceptionReview>): Promise<GovernanceExceptionReview>;
}

export interface InsertAcceptanceInput {
  tenantId: string;
  principleId: string;
  catalogVersion: string;
  offendersSnapshot: unknown[];
  reason: string;
  expiresAt: Date;
  acceptedBy: string;
  /** PENDING waits for a second confirmation; ACTIVE only with regime ALONE (no third party). */
  status: "PENDING" | "ACTIVE";
  regime: Extract<AcceptanceRegime, "ALONE"> | null;
}

/** The row written and the expired open acceptance of the same principle it replaced (closed REVOKED in the same transaction). */
export interface AcceptanceCreated {
  acceptance: GovernancePrincipleAcceptance;
  expiredClosed: GovernancePrincipleAcceptance | null;
}

export interface GovernancePrincipleAcceptanceRepository {
  list(tenantId: string, limit: number): Promise<GovernancePrincipleAcceptance[]>;
  getById(tenantId: string, id: string): Promise<GovernancePrincipleAcceptance | null>;
  /**
   * One transaction under a tenant+principle lock: an open (PENDING or ACTIVE) acceptance of this principle that has
   * EXPIRED is closed REVOKED first; a still-valid one -> ConflictError. Then INSERT, then the audit events.
   */
  create(input: InsertAcceptanceInput, audit: TransactionalAudit<AcceptanceCreated>): Promise<AcceptanceCreated>;
  /** PENDING -> ACTIVE (CONFIRMED), conditional on the status (0 row -> ConflictError), + audit, one transaction. */
  confirm(
    tenantId: string,
    id: string,
    confirmedBy: string,
    audit: TransactionalAudit<GovernancePrincipleAcceptance>,
  ): Promise<GovernancePrincipleAcceptance>;
  /** PENDING -> REJECTED or PENDING | ACTIVE -> REVOKED, conditional on the current status (0 row -> ConflictError), + audit. */
  end(
    tenantId: string,
    id: string,
    to: Extract<AcceptanceStatus, "REJECTED" | "REVOKED">,
    endedBy: string,
    reason: string,
    audit: TransactionalAudit<GovernancePrincipleAcceptance>,
  ): Promise<GovernancePrincipleAcceptance>;
}
