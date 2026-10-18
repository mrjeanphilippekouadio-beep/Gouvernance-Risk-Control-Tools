import type { SelfValidationPolicy } from "../governance/selfValidation.js";

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
}

export interface SelfValidationPolicyRequestRepository {
  getPending(tenantId: string): Promise<SelfValidationPolicyRequest | null>;
  getById(tenantId: string, id: string): Promise<SelfValidationPolicyRequest | null>;
  /** One PENDING per tenant (unique index): a second one is a ConflictError. */
  create(tenantId: string, requestedPolicy: SelfValidationPolicy, reason: string, requestedBy: string): Promise<SelfValidationPolicyRequest>;
  /** PENDING -> final status, once (claim). Null when the request is not PENDING any more. */
  decide(
    tenantId: string,
    id: string,
    status: Exclude<SelfValidationPolicyRequestStatus, "PENDING">,
    decidedBy: string,
    decisionReason: string | null,
  ): Promise<SelfValidationPolicyRequest | null>;
  /** Undo a claim whose effect could not be applied. */
  reopen(tenantId: string, id: string): Promise<void>;
}
