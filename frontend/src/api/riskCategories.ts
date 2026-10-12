import { apiRequest } from "./client";

export interface RiskCategory {
  id: string;
  name: string;
  parentId: string | null;
  active: boolean;
  updatedAt: string;
}

export interface RiskCategoryInput {
  name?: string;
  parentId?: string | null;
  active?: boolean;
}

/** Reads need config.read, writes config.manage (server-side). No archive route exists: deactivation is active=false. */
export const riskCategoriesApi = {
  list: (token: string, includeInactive = false) =>
    apiRequest<RiskCategory[]>(`/api/v1/risk-categories${includeInactive ? "?includeInactive=true" : ""}`, { token }),
  create: (token: string, body: RiskCategoryInput & { name: string }) =>
    apiRequest<RiskCategory>("/api/v1/risk-categories", { method: "POST", body, token }),
  update: (token: string, id: string, body: RiskCategoryInput) =>
    apiRequest<RiskCategory>(`/api/v1/risk-categories/${id}`, { method: "PUT", body, token }),
};
