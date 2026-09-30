import { apiRequest } from "./client";

export type ActionPlanSourceType = "RISK" | "CONTROL" | "KRI" | "AUDIT" | "INCIDENT" | "MANAGEMENT" | "FINDING";
export type ActionPlanStoredStatus = "PLANIFIEE" | "EN_COURS" | "TERMINEE";
export type ActionPlanStatus = ActionPlanStoredStatus | "EN_RETARD";
export type ActionPlanPriority = "NORMAL" | "HIGH";
export type ActionLinkResourceType = "RISK" | "CONTROL" | "KRI" | "ANOMALY";

export interface ActionPlan {
  id: string;
  title: string;
  description: string | null;
  sourceType: ActionPlanSourceType;
  sourceId: string | null;
  responsibleUserId: string;
  departmentId: string | null;
  dueDate: string;
  status: ActionPlanStoredStatus;
  computedStatus: ActionPlanStatus;
  priority: ActionPlanPriority;
  progressPercent: number;
  progressComment: string | null;
  evidenceId: string | null;
  createdBy: string;
  closedBy: string | null;
  closedAt: string | null;
  closureComment: string | null;
  createdAt: string;
  updatedAt: string;
}
export interface ActionLink { resourceType: ActionLinkResourceType; resourceId: string; }
export interface CreateActionPlanInput {
  title: string;
  description?: string | null;
  sourceType: ActionPlanSourceType;
  sourceId?: string | null;
  responsibleUserId: string;
  departmentId?: string | null;
  dueDate: string;
}

export const actionPlansApi = {
  list: (token: string, filters?: { status?: ActionPlanStatus; sourceType?: ActionPlanSourceType; responsibleUserId?: string; departmentId?: string }) => {
    const query = new URLSearchParams();
    if (filters?.status) query.set("status", filters.status);
    if (filters?.sourceType) query.set("sourceType", filters.sourceType);
    if (filters?.responsibleUserId) query.set("responsibleUserId", filters.responsibleUserId);
    if (filters?.departmentId) query.set("departmentId", filters.departmentId);
    return apiRequest<ActionPlan[]>(`/api/v1/dashboard/actions${query.size ? `?${query.toString()}` : ""}`, { token });
  },
  create: (token: string, input: CreateActionPlanInput) =>
    apiRequest<ActionPlan>("/api/v1/actions", { method: "POST", body: input, token }),
  start: (token: string, id: string) =>
    apiRequest<ActionPlan>(`/api/v1/actions/${encodeURIComponent(id)}/start`, { method: "PATCH", token }),
  updateProgress: (token: string, id: string, progressPercent: number, comment: string) =>
    apiRequest<ActionPlan>(`/api/v1/actions/${encodeURIComponent(id)}/progress`, { method: "PATCH", body: { progressPercent, comment }, token }),
  escalate: (token: string, id: string) =>
    apiRequest<{ escalated: boolean; action: ActionPlan }>(`/api/v1/actions/${encodeURIComponent(id)}/escalate`, { method: "POST", token }),
  close: (token: string, id: string, evidenceId: string, comment: string) =>
    apiRequest<ActionPlan>(`/api/v1/actions/${encodeURIComponent(id)}/close`, { method: "PATCH", body: { evidenceId, comment }, token }),
};
