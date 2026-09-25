import { apiRequest } from "./client";

export type RiskStatus = "DRAFT" | "ACTIVE" | "ARCHIVED";

export interface Risk {
  id: string;
  tenantId: string;
  process: string;
  description: string;
  ownerDepartmentId: string | null;
  status: RiskStatus;
  createdAt: string;
  updatedAt: string;
}

export interface CreateRiskInput {
  process: string;
  description: string;
}

export const risksApi = {
  list: (token: string) => apiRequest<Risk[]>("/api/v1/risks", { token }),

  create: (token: string, input: CreateRiskInput) =>
    apiRequest<Risk>("/api/v1/risks", { method: "POST", body: input, token }),

  // Mirrors POST /api/v1/risks/:id/submit-style state changes from the
  // architecture doc: the frontend asks, the backend decides.
  updateStatus: (token: string, id: string, status: RiskStatus) =>
    apiRequest<Risk>(`/api/v1/risks/${id}`, { method: "PATCH", body: { status }, token }),
};
