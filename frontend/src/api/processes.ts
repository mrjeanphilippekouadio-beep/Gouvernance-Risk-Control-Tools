import { apiRequest } from "./client";

export type ProcessLevel = "PROCESS" | "SUBPROCESS" | "ACTIVITY";
export type ProcessDocumentType = "CHARTER" | "POLICY" | "PROCEDURES_MANUAL" | "PROCEDURE" | "WORK_INSTRUCTION";
export type EvaluationMode = "CLASSIQUE" | "PARTICIPATIF";

/** evaluationMode is the stored value (null = inherited); the server resolves inheritance, never the client. */
export interface Process {
  id: string;
  parentId: string | null;
  level: ProcessLevel;
  name: string;
  description: string | null;
  documentType: ProcessDocumentType | null;
  documentReference: string | null;
  owner: string | null;
  active: boolean;
  evaluationMode: EvaluationMode | null;
  departmentId: string | null;
  updatedAt: string;
}

/** evaluationMode is not part of create/update: it has its own route and permission. */
export interface ProcessInput {
  parentId?: string | null;
  level: ProcessLevel;
  name: string;
  description?: string | null;
  documentType?: ProcessDocumentType | null;
  documentReference?: string | null;
  owner?: string | null;
  active?: boolean;
  departmentId?: string | null;
}

export const processesApi = {
  list: (token: string, includeInactive = false) =>
    apiRequest<Process[]>(`/api/v1/processes${includeInactive ? "?includeInactive=true" : ""}`, { token }),
  create: (token: string, body: ProcessInput & { departmentId: string }) =>
    apiRequest<Process>("/api/v1/processes", { method: "POST", body, token }),
  update: (token: string, id: string, body: Partial<ProcessInput>) =>
    apiRequest<Process>(`/api/v1/processes/${id}`, { method: "PATCH", body, token }),
  archive: (token: string, id: string, reason: string) =>
    apiRequest<{ status: string }>(`/api/v1/processes/${id}/archive`, { method: "POST", body: { reason }, token }),
};
