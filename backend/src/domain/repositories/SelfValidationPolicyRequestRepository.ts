import type { SelfValidationPolicy } from "../governance/selfValidation.js";
import type { Config, ConfigPatch } from "../entities/Config.js";
import type { TransactionalAudit } from "../entities/RiskFramework.js";

/** q158 (DECISION-078): a request to relax the self-validation policy, waiting for a second person. */
export type SelfValidationPolicyRequestStatus = "PENDING" | "APPLIED" | "REJECTED" | "WITHDRAWN";

export interface SelfValidationPolicyRequest {
  id: string;
  tenantId: string;
  requestedPolicy: SelfValidationPolicy;
  reason: string;
  status: SelfValidationPolicyRequestStatus;
  requestedBy: string;
  requestedAt: Date;
  decidedBy: string | null;
  decidedAt: Date | null;
  decisionReason: string | null;
  /** q174 (DECISION-083): fixed at submission from the tenant's delay; null = no expiry. Never recomputed (F-SAD-02). */
  expiresAt?: Date | null;
}

/** DECISION-079: what one policy action changes. Applied in this order, in ONE transaction, audit rows included. */
export interface PolicyChange {
  /** 1. Claim a PENDING request (0 row = already decided -> ConflictError, nothing else written). */
  decide?: { id: string; status: Exclude<SelfValidationPolicyRequestStatus, "PENDING">; by: string; reason: string | null };
  /** 2a. Open a new PENDING request. */
  submit?: { policy: SelfValidationPolicy; reason: string; by: string; expiresAt?: Date | null };
  /** 2b. Write the policy on the tenant's config row. */
  setPolicy?: { patch: ConfigPatch; updatedBy: string };
}

export interface PolicyChangeResult {
  decided: SelfValidationPolicyRequest | null;
  submitted: SelfValidationPolicyRequest | null;
  config: Config | null;
}

export interface SelfValidationPolicyRequestRepository {
  /** DECISION-079: true when `change` exists and inserts the events built by `audit` in the same transaction. Absent = the service chains the plain methods and records the audit after (test fakes). */
  readonly auditsInTransaction?: boolean;
  change?(tenantId: string, change: PolicyChange, audit: TransactionalAudit<PolicyChangeResult>): Promise<PolicyChangeResult>;
  getPending(tenantId: string): Promise<SelfValidationPolicyRequest | null>;
  getById(tenantId: string, id: string): Promise<SelfValidationPolicyRequest | null>;
  /** One PENDING per tenant (unique index): a second one is a ConflictError. */
  create(
    tenantId: string,
    requestedPolicy: SelfValidationPolicy,
    reason: string,
    requestedBy: string,
    expiresAt?: Date | null,
  ): Promise<SelfValidationPolicyRequest>;
  /** PENDING -> final status, once (claim). Null when the request is not PENDING any more. */
  decide(
    tenantId: string,
    id: string,
    status: Exclude<SelfValidationPolicyRequestStatus, "PENDING">,
    decidedBy: string,
    decisionReason: string | null,
  ): Promise<SelfValidationPolicyRequest | null>;
  /**
   * Test fakes only (non-transactional fallback). The PostgreSQL repository has none: a decided request is never reopened
   * (SEC-PNL2-03, guarded by a trigger); its transactional `change` rolls the claim back with the rest.
   */
  reopen?(tenantId: string, id: string): Promise<void>;
}
