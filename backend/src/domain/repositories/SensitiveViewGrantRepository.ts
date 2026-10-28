import type { TransactionalAudit } from "../entities/RiskFramework.js";

/**
 * q188/q189/q200 (DECISION-101, DECISION-103): `role.read.sensitive` given to ONE Risk Manager member (migration 079).
 * Requested by an administrator, confirmed or refused by a Committee/Audit member (never the author nor the
 * beneficiary), revoked by an administrator. The right is effective while APPROVED — read here, never copied into a role.
 */
export type SensitiveViewGrantStatus = "PENDING" | "APPROVED" | "REJECTED" | "REVOKED";

export interface SensitiveViewGrant {
  id: string;
  tenantId: string;
  userId: string;
  reason: string;
  status: SensitiveViewGrantStatus;
  requestedBy: string;
  requestedAt: Date;
  /** Fixed at the request from policyRequestExpiryDays (q174); an expired PENDING grant can no longer be confirmed. */
  expiresAt: Date | null;
  decidedBy: string | null;
  decidedAt: Date | null;
  decisionReason: string | null;
  revokedBy: string | null;
  revokedAt: Date | null;
  revokeReason: string | null;
}

export interface SensitiveViewGrantRepository {
  /** Most recent first, bounded. */
  list(tenantId: string): Promise<SensitiveViewGrant[]>;
  getById(tenantId: string, id: string): Promise<SensitiveViewGrant | null>;
  isApproved(tenantId: string, userId: string): Promise<boolean>;
  /** ConflictError when the account already has a live (PENDING or APPROVED) grant. Audit in the same transaction. */
  create(
    input: { tenantId: string; userId: string; reason: string; requestedBy: string; expiresAt: Date | null },
    audit: TransactionalAudit<SensitiveViewGrant>,
  ): Promise<SensitiveViewGrant>;
  /** Claims the grant in `from` (APPROVED: never once expired) -> ConflictError when 0 row. Audit in the same transaction. */
  decide(
    tenantId: string,
    id: string,
    change: { status: "APPROVED" | "REJECTED"; by: string; reason: string | null },
    audit: TransactionalAudit<SensitiveViewGrant>,
  ): Promise<SensitiveViewGrant>;
  revoke(tenantId: string, id: string, change: { by: string; reason: string }, audit: TransactionalAudit<SensitiveViewGrant>): Promise<SensitiveViewGrant>;
}
