import { apiRequest } from "./client";

export interface DepartmentSummary {
  id: string;
  name: string;
  entity: string | null;
  active: boolean;
}

/** Full department as returned by GET /api/v1/departments[/:id] (dates are ISO strings). */
export interface Department extends DepartmentSummary {
  manager: string;
  riskOwner: string;
  riskOwnerDesignatedBy: string | null;
  riskOwnerDesignatedAt: string | null;
  linkedProcesses: string | null;
  deletionReason?: string | null;
}

/** riskOwner is accepted on creation only; a later change goes through designateRiskOwner (audited). */
export interface DepartmentCreateInput {
  name: string;
  manager: string;
  entity?: string | null;
  riskOwner?: string | null;
  linkedProcesses?: string | null;
  active?: boolean;
}

export type DepartmentUpdateInput = Partial<Omit<DepartmentCreateInput, "riskOwner">>;

/**
 * GET /api/v1/departments requires "department.read" — not every Risk
 * Owner carries it. Callers should treat a 403 here as "no directory
 * available" and fall back to showing the raw department id (same posture
 * as usersApi), never as a fatal error.
 */
export const departmentsApi = {
  list: (token: string, includeInactive = false) =>
    apiRequest<DepartmentSummary[]>(`/api/v1/departments${includeInactive ? "?includeInactive=true" : ""}`, { token }),
  listFull: (token: string, includeInactive = false) =>
    apiRequest<Department[]>(`/api/v1/departments${includeInactive ? "?includeInactive=true" : ""}`, { token }),
  create: (token: string, body: DepartmentCreateInput) =>
    apiRequest<Department>("/api/v1/departments", { method: "POST", body, token }),
  update: (token: string, id: string, body: DepartmentUpdateInput) =>
    apiRequest<Department>(`/api/v1/departments/${id}`, { method: "PATCH", body, token }),
  designateRiskOwner: (token: string, id: string, riskOwner: string) =>
    apiRequest<Department>(`/api/v1/departments/${id}/designate-risk-owner`, { method: "POST", body: { riskOwner }, token }),
  archive: (token: string, id: string, reason: string) =>
    apiRequest<{ status: string }>(`/api/v1/departments/${id}/archive`, { method: "POST", body: { reason }, token }),
};
