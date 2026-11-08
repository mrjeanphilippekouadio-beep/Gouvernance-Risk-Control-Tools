import { apiRequest, apiRequestFull, type ApiResponse } from "./client";

export type SelfValidationPolicy = "REFUSE" | "DOUBLE_CONFIRMATION";

/** Subset of backend `Config` shown by the governance settings screen. */
export interface GovernanceConfig {
  committeeAuditCumulAllowed: boolean;
  selfValidationPolicy: SelfValidationPolicy;
  /** DECISION-083 (q168, q169, q174): days, null = not configured (no delay applies). */
  exceptionReviewDelayDays: number | null;
  acceptanceMaxDays: number | null;
  policyRequestExpiryDays: number | null;
  /** q178 (DECISION-095): longest Risk Manager vacancy; 60 days by default (PO). */
  riskManagerVacancyMaxDays: number | null;
  /** q221 (DECISION-111): life of a confirmed resource.readall; 90 days by default (PO). */
  resourceReadallMaxDays?: number | null;
  /** R3 (q227): days the « dernière activité » date is kept after the end of an account; 1826 (5 years) by default. */
  lastSeenRetentionDays?: number | null;
  version: number;
  updatedAt: string;
}

export type PolicyRequestStatus = "PENDING" | "APPLIED" | "REJECTED" | "WITHDRAWN";

/** Mirrors backend `SelfValidationPolicyRequest` (dates as ISO strings). */
export interface SelfValidationPolicyRequest {
  id: string;
  requestedPolicy: SelfValidationPolicy;
  reason: string;
  status: PolicyRequestStatus;
  requestedBy: string;
  requestedAt: string;
  decidedBy: string | null;
  decidedAt: string | null;
  decisionReason: string | null;
  /** q174: when it stops being approvable (null = no expiry configured). Computed by the server. */
  expiresAt?: string | null;
}

export type GovernanceDelays = Pick<GovernanceConfig, "exceptionReviewDelayDays" | "acceptanceMaxDays" | "policyRequestExpiryDays" | "riskManagerVacancyMaxDays" | "resourceReadallMaxDays" | "lastSeenRetentionDays">;

/** q182: mirrors backend `GovernanceDelayRequest` — a lengthening of the delays waiting for a second person. */
export interface GovernanceDelayRequest {
  id: string;
  /** D6B-01: may also carry `committeeAuditCumulAllowed: true` (allowing the cumul waits for a second person). */
  requestedDelays: Partial<GovernanceDelays> & { committeeAuditCumulAllowed?: boolean } & Record<string, number | boolean | null | undefined>;
  reason: string;
  status: PolicyRequestStatus;
  requestedBy: string;
  requestedAt: string;
  expiresAt: string | null;
  decidedBy: string | null;
  decidedAt: string | null;
  decisionReason: string | null;
}

const BASE = "/api/v1/config";

export const configApi = {
  get: (token: string) => apiRequest<GovernanceConfig>(BASE, { token }),
  /** 200 = applied; 202 = a lengthening waits for a second person (q182), `data` is the UNCHANGED config. */
  setGovernanceDelays: (token: string, delays: Partial<GovernanceDelays>, reason: string): Promise<ApiResponse<GovernanceConfig>> =>
    apiRequestFull<GovernanceConfig>(`${BASE}/governance-delays`, { method: "PUT", body: { ...delays, reason }, token }),
  pendingDelayRequest: (token: string) => apiRequest<GovernanceDelayRequest | null>(`${BASE}/governance-delays/request`, { token }),
  approveDelayRequest: (token: string, id: string, reason: string) =>
    apiRequest<GovernanceConfig>(`${BASE}/governance-delays/requests/${encodeURIComponent(id)}/approve`, { method: "POST", body: { reason }, token }),
  rejectDelayRequest: (token: string, id: string, reason: string) =>
    apiRequest<GovernanceDelayRequest>(`${BASE}/governance-delays/requests/${encodeURIComponent(id)}/reject`, { method: "POST", body: { reason }, token }),
  /** 200 = applied; 202 = allowing the cumul waits for a second person (D6B-01), `data` is the UNCHANGED config. */
  setCommitteeAuditCumul: (token: string, allowed: boolean, reason: string): Promise<ApiResponse<GovernanceConfig>> =>
    apiRequestFull<GovernanceConfig>(`${BASE}/committee-audit-cumul`, { method: "PUT", body: { allowed, reason }, token }),
  /** 200 = applied; 202 = `pendingRequest` set, `data` is the UNCHANGED config. Callers must look at `status`. */
  setSelfValidationPolicy: (token: string, policy: SelfValidationPolicy, reason: string): Promise<ApiResponse<GovernanceConfig>> =>
    apiRequestFull<GovernanceConfig>(`${BASE}/self-validation-policy`, { method: "PUT", body: { policy, reason }, token }),
  pendingPolicyRequest: (token: string) => apiRequest<SelfValidationPolicyRequest | null>(`${BASE}/self-validation-policy/request`, { token }),
  approvePolicyRequest: (token: string, id: string, reason: string) =>
    apiRequest<GovernanceConfig>(`${BASE}/self-validation-policy/requests/${encodeURIComponent(id)}/approve`, { method: "POST", body: { reason }, token }),
  rejectPolicyRequest: (token: string, id: string, reason: string) =>
    apiRequest<SelfValidationPolicyRequest>(`${BASE}/self-validation-policy/requests/${encodeURIComponent(id)}/reject`, { method: "POST", body: { reason }, token }),
};
