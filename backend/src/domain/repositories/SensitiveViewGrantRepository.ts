import type { TransactionalAudit } from "../entities/RiskFramework.js";

/**
 * q188/q189/q200 (DECISION-101, DECISION-103): `role.read.sensitive` given to ONE Risk Manager member (migration 079).
 * Requested by an administrator, confirmed or refused by a Committee/Audit member (never the author nor the
 * beneficiary), revoked by an administrator. The right is effective while APPROVED — read here, never copied into a role.
 */
export type SensitiveViewGrantStatus = "PENDING" | "APPROVED" | "REJECTED" | "REVOKED";
/** Lot V4 (migration 084): the same circuit gives `resource.readall` to one administrator (q197 A3). */
export type SensitiveViewGrantKind = "ROLE_READ_SENSITIVE" | "RESOURCE_READALL";

export interface SensitiveViewGrant {
  id: string;
  tenantId: string;
  userId: string;
  /** Absent on rows written before 084 by test fakes: read as ROLE_READ_SENSITIVE. */
  kind?: SensitiveViewGrantKind;
  /**
   * The three reasons read as text (or « motif effacé le … (conservation) » once erased) — joined from visibility_reasons (096).
   * The `...Ref` fields name the stored reason: what the audit rows carry instead of the text.
   */
  reason: string;
  reasonRef?: string | null;
  status: SensitiveViewGrantStatus;
  requestedBy: string;
  requestedAt: Date;
  /** Fixed at the request from policyRequestExpiryDays (q174); an expired PENDING grant can no longer be confirmed. */
  expiresAt: Date | null;
  /** q221 (DECISION-111): end of an APPROVED RESOURCE_READALL, fixed at the confirmation, never recalculated. */
  accessExpiresAt?: Date | null;
  decidedBy: string | null;
  decidedAt: Date | null;
  decisionReason: string | null;
  decisionReasonRef?: string | null;
  revokedBy: string | null;
  revokedAt: Date | null;
  revokeReason: string | null;
  revokeReasonRef?: string | null;
}

export interface SensitiveViewGrantRepository {
  /** Most recent first, bounded. */
  list(tenantId: string): Promise<SensitiveViewGrant[]>;
  getById(tenantId: string, id: string): Promise<SensitiveViewGrant | null>;
  /** `kind` defaults to ROLE_READ_SENSITIVE. */
  isApproved(tenantId: string, userId: string, kind?: SensitiveViewGrantKind): Promise<boolean>;
  /** ConflictError when the account already has a live (PENDING or APPROVED) grant. Audit in the same transaction. */
  create(
    input: { tenantId: string; userId: string; reason: string; requestedBy: string; expiresAt: Date | null; kind?: SensitiveViewGrantKind },
    audit: TransactionalAudit<SensitiveViewGrant>,
  ): Promise<SensitiveViewGrant>;
  /** Claims the grant in `from` (APPROVED: never once expired) -> ConflictError when 0 row. Audit in the same transaction. */
  decide(
    tenantId: string,
    id: string,
    /** `accessDays`: q221, set on the approval of a RESOURCE_READALL grant only. */
    change: { status: "APPROVED" | "REJECTED"; by: string; reason: string | null; accessDays?: number },
    audit: TransactionalAudit<SensitiveViewGrant>,
  ): Promise<SensitiveViewGrant>;
  /** Locks the live grant, revokes it; the audit sees the locked row and the updated one. ConflictError when not live. */
  revoke(tenantId: string, id: string, change: { by: string; reason: string }, audit: TransactionalAudit<RevokedGrant>): Promise<SensitiveViewGrant>;
  /**
   * Codex P2 (PR #226): the live grant of ONE account and kind that is past its term (PENDING past `expiresAt`, or q221
   * RESOURCE_READALL APPROVED past `accessExpiresAt`), locked and closed (REVOKED) — frees the live index for a new
   * request. Null when there is none. Optional for older test fakes.
   */
  closeStaleLive?(tenantId: string, userId: string, kind: SensitiveViewGrantKind, change: { by: string; reason: string }, audit: TransactionalAudit<RevokedGrant>): Promise<SensitiveViewGrant | null>;
  /** SEC-RL-05: the live grant of ONE account (targeted lookup, locked), revoked; null when it has none. */
  revokeLiveOf(tenantId: string, userId: string, change: { by: string; reason: string }, audit: TransactionalAudit<RevokedGrant>, kind?: SensitiveViewGrantKind): Promise<SensitiveViewGrant | null>;
}

/** A revocation as written in its transaction: the locked row and the updated one. */
export interface RevokedGrant {
  before: SensitiveViewGrant;
  after: SensitiveViewGrant;
}
