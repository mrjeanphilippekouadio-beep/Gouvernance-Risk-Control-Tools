import { apiRequest } from "./client";

export type ControlType = "PREVENTIVE" | "DETECTIVE" | "CORRECTIVE";
export type ControlStatus = "DRAFT" | "ACTIVE" | "ARCHIVED";

export interface Control {
  id: string;
  label: string;
  objective: string | null;
  coveredRiskIds: string[];
  process: string | null;
  processId: string | null;
  departmentId: string | null;
  procedureDescription: string | null;
  controlType: ControlType;
  nature: string | null;
  defenseLine: string | null;
  frequency: string;
  executor: string;
  validator: string | null;
  expectedEvidence: string | null;
  complianceCriteria: string;
  status: ControlStatus;
  createdAt: string;
  updatedAt: string;
}

export interface CreateControlInput {
  label: string;
  objective?: string | null;
  coveredRiskIds: string[];
  process?: string | null;
  departmentId?: string | null;
  procedureDescription?: string | null;
  controlType: ControlType;
  nature?: string | null;
  defenseLine?: string | null;
  frequency: string;
  executor: string;
  validator?: string | null;
  expectedEvidence?: string | null;
  complianceCriteria: string;
}

export const controlsApi = {
  list: (token: string, includeArchived = false) =>
    apiRequest<Control[]>(`/api/v1/controls${includeArchived ? "?includeArchived=true" : ""}`, { token }),
  create: (token: string, input: CreateControlInput) =>
    apiRequest<Control>("/api/v1/controls", { method: "POST", body: input, token }),
  archive: (token: string, id: string, reason: string) =>
    apiRequest<{ status: string }>(`/api/v1/controls/${encodeURIComponent(id)}/archive`, { method: "POST", body: { reason }, token }),
};
