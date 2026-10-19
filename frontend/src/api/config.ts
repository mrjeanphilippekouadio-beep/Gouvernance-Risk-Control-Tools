import { apiRequest, apiRequestFull, type ApiResponse } from "./client";

export type SelfValidationPolicy = "REFUSE" | "DOUBLE_CONFIRMATION";

/** Subset of backend `Config` shown by the governance settings screen. */
export interface GovernanceConfig {
  committeeAuditCumulAllowed: boolean;
  selfValidationPolicy: SelfValidationPolicy;
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
}

const BASE = "/api/v1/config";
const put = <T>(path: string, token: string, body: unknown) => apiRequest<T>(`${BASE}${path}`, { method: "PUT", body, token });

export const configApi = {
  get: (token: string) => apiRequest<GovernanceConfig>(BASE, { token }),
  setCommitteeAuditCumul: (token: string, allowed: boolean, reason: string) => put<GovernanceConfig>("/committee-audit-cumul", token, { allowed, reason }),
  /** 200 = applied; 202 = `pendingRequest` set, `data` is the UNCHANGED config. Callers must look at `status`. */
  setSelfValidationPolicy: (token: string, policy: SelfValidationPolicy, reason: string): Promise<ApiResponse<GovernanceConfig>> =>
    apiRequestFull<GovernanceConfig>(`${BASE}/self-validation-policy`, { method: "PUT", body: { policy, reason }, token }),
  pendingPolicyRequest: (token: string) => apiRequest<SelfValidationPolicyRequest | null>(`${BASE}/self-validation-policy/request`, { token }),
  approvePolicyRequest: (token: string, id: string, reason: string) =>
    apiRequest<GovernanceConfig>(`${BASE}/self-validation-policy/requests/${encodeURIComponent(id)}/approve`, { method: "POST", body: { reason }, token }),
  rejectPolicyRequest: (token: string, id: string, reason: string) =>
    apiRequest<SelfValidationPolicyRequest>(`${BASE}/self-validation-policy/requests/${encodeURIComponent(id)}/reject`, { method: "POST", body: { reason }, token }),
};
