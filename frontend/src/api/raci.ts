import { apiRequest } from "./client";

export type RaciEntityType = "RISK" | "CONTROL" | "ACTION_PLAN";
export type RaciRole = "R" | "A" | "C" | "I";

export interface RaciAssignment {
  id: string;
  tenantId: string;
  entityType: RaciEntityType;
  entityId: string;
  userId: string;
  role: RaciRole;
  createdBy: string;
  createdAt: string;
  deletedAt: string | null;
}

function query(entityType: RaciEntityType, entityId: string): string {
  return `entityType=${encodeURIComponent(entityType)}&entityId=${encodeURIComponent(entityId)}`;
}

export const raciApi = {
  list: (token: string, entityType: RaciEntityType, entityId: string) =>
    apiRequest<RaciAssignment[]>(`/api/v1/raci?${query(entityType, entityId)}`, { token }),

  // q207: `reason` is required by the server when the assignment opens a restricted resource (author outside the RM group).
  assign: (token: string, entityType: RaciEntityType, entityId: string, userId: string, role: RaciRole, reason?: string) =>
    apiRequest<RaciAssignment>("/api/v1/raci", { method: "POST", body: { entityType, entityId, userId, role, ...(reason ? { reason } : {}) }, token }),

  revoke: (token: string, entityType: RaciEntityType, entityId: string, assignmentId: string) =>
    apiRequest<RaciAssignment>(`/api/v1/raci/${assignmentId}?${query(entityType, entityId)}`, {
      method: "DELETE",
      token,
    }),
};
