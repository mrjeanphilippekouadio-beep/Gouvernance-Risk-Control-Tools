import { apiRequest, apiRequestFull } from "./client";

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

/** q178: computed by the server (start, limit from the settings, overdue); null when a Risk Manager is in place. */
export interface RiskManagerVacancy {
  since: string;
  maxDays: number | null;
  overdue: boolean;
}

/** designatedBy is never sent: the server sets it to the authenticated user. */
export const governanceDesignationsApi = {
  list: async (token: string, includeEnded: boolean) => {
    const res = await apiRequestFull<GovernanceDesignation[]>(`/api/v1/governance-designations?includeEnded=${includeEnded}`, { token });
    return { rows: res.data, riskManagerVacancy: (res.riskManagerVacancy ?? null) as RiskManagerVacancy | null };
  },
  designate: (token: string, body: { kind: DesignationKind; userId: string; reason: string; validUntil: string | null }) =>
    apiRequest<GovernanceDesignation>("/api/v1/governance-designations", { method: "POST", body, token }),
  end: (token: string, id: string, reason: string) =>
    apiRequest<GovernanceDesignation>(`/api/v1/governance-designations/${id}/end`, { method: "POST", body: { reason }, token }),
};
