import { apiRequest } from "./client";

export interface RiskAppetite {
  id: string;
  subCategory: string;
  subCategoryId: string | null;
  entity: string | null;
  threshold: number;
  methodologyVersion: string;
  description: string | null;
  active: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface SetRiskAppetiteInput {
  subCategoryId?: string | null;
  entity?: string | null;
  threshold: number;
  methodologyVersion: string;
  description?: string | null;
  active?: boolean;
}

export const riskAppetiteApi = {
  list: (token: string, includeInactive = false) =>
    apiRequest<RiskAppetite[]>(`/api/v1/appetite${includeInactive ? "?includeInactive=true" : ""}`, { token }),
  set: (token: string, subCategory: string, input: SetRiskAppetiteInput) =>
    apiRequest<RiskAppetite>(`/api/v1/appetite/${encodeURIComponent(subCategory)}`, { method: "PUT", body: input, token }),
  archive: (token: string, id: string, reason: string) =>
    apiRequest<{ status: string }>(`/api/v1/appetite/${encodeURIComponent(id)}/archive`, { method: "POST", body: { reason }, token }),
};
