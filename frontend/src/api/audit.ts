import { apiRequest } from "./client";

export type AuditMissionStatus = "PLANIFIEE" | "EN_COURS" | "CLOTUREE";
export interface AuditMission {
  id: string;
  reference: string;
  title: string;
  scope: string;
  status: AuditMissionStatus;
  leadAuditorId: string;
  auditorIds: string[];
  plannedStartDate: string;
  plannedEndDate: string;
  actualStartDate: string | null;
  actualEndDate: string | null;
  closureComment: string | null;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
}

export type FindingSeverity = "LOW" | "MODERATE" | "HIGH" | "MAJOR" | "CRITICAL";
export type FindingStatus = "OUVERT" | "EN_TRAITEMENT" | "CLOS";
export type RelatedObjectType = "RISK" | "CONTROL" | "INCIDENT" | "ANOMALY";
export interface Finding {
  id: string;
  auditMissionId: string;
  title: string;
  description: string;
  severity: FindingSeverity;
  recommendation: string | null;
  relatedObjectType: RelatedObjectType | null;
  relatedObjectId: string | null;
  status: FindingStatus;
  raisedBy: string;
  closedBy: string | null;
  closedAt: string | null;
  closureComment: string | null;
  createdAt: string;
  updatedAt: string;
}
export interface CreateFindingInput {
  auditMissionId: string;
  title: string;
  description: string;
  severity: FindingSeverity;
  recommendation?: string | null;
  relatedObjectType?: RelatedObjectType | null;
  relatedObjectId?: string | null;
}

export const auditMissionsApi = {
  list: (token: string, status?: AuditMissionStatus) =>
    apiRequest<AuditMission[]>(`/api/v1/audit-missions${status ? `?status=${encodeURIComponent(status)}` : ""}`, { token }),
};

export const findingsApi = {
  list: (token: string, filters?: { auditMissionId?: string; status?: FindingStatus; severity?: FindingSeverity }) => {
    const query = new URLSearchParams();
    if (filters?.auditMissionId) query.set("auditMissionId", filters.auditMissionId);
    if (filters?.status) query.set("status", filters.status);
    if (filters?.severity) query.set("severity", filters.severity);
    const suffix = query.size ? `?${query.toString()}` : "";
    return apiRequest<Finding[]>(`/api/v1/findings${suffix}`, { token });
  },
  create: (token: string, input: CreateFindingInput) =>
    apiRequest<Finding>("/api/v1/findings", { method: "POST", body: input, token }),
  startTreatment: (token: string, id: string) =>
    apiRequest<Finding>(`/api/v1/findings/${encodeURIComponent(id)}/start-treatment`, { method: "POST", token }),
  close: (token: string, id: string, comment: string) =>
    apiRequest<Finding>(`/api/v1/findings/${encodeURIComponent(id)}/close`, { method: "POST", body: { comment }, token }),
};
