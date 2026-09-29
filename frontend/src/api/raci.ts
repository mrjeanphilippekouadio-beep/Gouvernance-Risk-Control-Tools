import { apiRequest } from "./client";

export type RaciEntityType = "Risk" | "Control" | "ActionPlan";
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

  assign: (token: string, entityType: RaciEntityType, entityId: string, userId: string, role: RaciRole) =>
    apiRequest<RaciAssignment>("/api/v1/raci", { method: "POST", body: { entityType, entityId, userId, role }, token }),

  revoke: (token: string, entityType: RaciEntityType, entityId: string, assignmentId: string) =>
    apiRequest<RaciAssignment>(`/api/v1/raci/${assignmentId}?${query(entityType, entityId)}`, {
      method: "DELETE",
      token,
    }),
};
