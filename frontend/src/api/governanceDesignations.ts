import { apiRequest } from "./client";

export type DesignationKind = "MANAGER" | "RISK_MANAGER_INTERIM";

export interface GovernanceDesignation {
  id: string;
  kind: DesignationKind;
  userId: string;
  reason: string;
  validUntil: string | null;
  activatedAt: string | null;
  designatedBy: string;
  createdAt: string;
  endedAt: string | null;
  endedBy: string | null;
}

/** designatedBy is never sent: the server sets it to the authenticated user. */
export const governanceDesignationsApi = {
  list: (token: string, includeEnded: boolean) =>
    apiRequest<GovernanceDesignation[]>(`/api/v1/governance-designations?includeEnded=${includeEnded}`, { token }),
  designate: (token: string, body: { kind: DesignationKind; userId: string; reason: string; validUntil: string | null }) =>
    apiRequest<GovernanceDesignation>("/api/v1/governance-designations", { method: "POST", body, token }),
  end: (token: string, id: string, reason: string) =>
    apiRequest<GovernanceDesignation>(`/api/v1/governance-designations/${id}/end`, { method: "POST", body: { reason }, token }),
};
