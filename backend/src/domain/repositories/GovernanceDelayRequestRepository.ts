import type { Config, ConfigPatch } from "../entities/Config.js";
import type { TransactionalAudit } from "../entities/RiskFramework.js";
import type { SelfValidationPolicyRequestStatus } from "./SelfValidationPolicyRequestRepository.js";

/** The governance delays (days, null = not configured) that setGovernanceDelays writes. */
export const GOVERNANCE_DELAY_KEYS = ["exceptionReviewDelayDays", "acceptanceMaxDays", "policyRequestExpiryDays", "riskManagerVacancyMaxDays"] as const;
export type GovernanceDelayKey = (typeof GOVERNANCE_DELAY_KEYS)[number];
export type GovernanceDelays = Pick<ConfigPatch, GovernanceDelayKey>;

/** q182 (DECISION-095): a request to lengthen (or clear) governance delays, waiting for a second person (q158 circuit). */
export interface GovernanceDelayRequest {
  id: string;
  tenantId: string;
  requestedDelays: GovernanceDelays;
  reason: string;
  status: SelfValidationPolicyRequestStatus;
  requestedBy: string;
  requestedAt: Date;
  /** Fixed at submission from the tenant's policyRequestExpiryDays (q174, F-SAD-02); null = no expiry. */
  expiresAt: Date | null;
  decidedBy: string | null;
  decidedAt: Date | null;
  decisionReason: string | null;
}

/** Applied in this order, in ONE transaction with the audit rows (DECISION-079). */
export interface DelayChange {
  /** 1. Claim a PENDING request (0 row = already decided or, for APPLIED, expired -> ConflictError, nothing written). */
  decide?: { id: string; status: Exclude<SelfValidationPolicyRequestStatus, "PENDING">; by: string; reason: string | null };
  /** 2a. Open a new PENDING request. */
  submit?: { delays: GovernanceDelays; reason: string; by: string; expiresAt: Date | null };
  /** 2b. Write the delays on the tenant's config row. */
  setDelays?: { patch: ConfigPatch; updatedBy: string };
}

export interface DelayChangeResult {
  decided: GovernanceDelayRequest | null;
  submitted: GovernanceDelayRequest | null;
  config: Config | null;
}

export interface GovernanceDelayRequestRepository {
  getPending(tenantId: string): Promise<GovernanceDelayRequest | null>;
  getById(tenantId: string, id: string): Promise<GovernanceDelayRequest | null>;
  change(tenantId: string, change: DelayChange, audit: TransactionalAudit<DelayChangeResult>): Promise<DelayChangeResult>;
}
