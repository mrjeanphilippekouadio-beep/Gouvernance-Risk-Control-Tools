import { apiRequest } from "./client";

export type RiskStatus = "DRAFT" | "ACTIVE" | "ARCHIVED";

export interface Risk {
  id: string;
  tenantId: string;
  process: string;
  description: string;
  ownerDepartmentId: string | null;
  /** ACT-120/121: individual Risk Owner (a User id) — see backend Risk.ts. Null until explicitly assigned via RiskService.assignOwner. */
  ownerId: string | null;
  /** ACT-122: the owner's N+1, for escalation (ACT-125) — never the same person as ownerId, enforced backend-side. */
  superiorOwnerId: string | null;
  status: RiskStatus;
  createdAt: string;
  updatedAt: string;
}

export interface CreateRiskInput {
  process: string;
  description: string;
  ownerDepartmentId?: string | null;
}

export const risksApi = {
  list: (token: string, includeArchived = false, ownerId?: string) =>
    apiRequest<Risk[]>(
      `/api/v1/risks?${new URLSearchParams({
        ...(includeArchived ? { includeArchived: "true" } : {}),
        ...(ownerId ? { ownerId } : {}),
      }).toString()}`,
      { token },
    ),

  create: (token: string, input: CreateRiskInput, idempotencyKey: string) =>
    apiRequest<Risk>("/api/v1/risks", {
      method: "POST",
      body: input,
      token,
      headers: { "Idempotency-Key": idempotencyKey },
    }),

  // DRAFT -> ACTIVE only. Never ARCHIVED — the backend rejects that on the
  // generic update() and requires the dedicated archive() action with a
  // mandatory reason (see RiskService.update/archive, CLAUDE.md "A generic
  // update() must never allow a transition into the terminal/archived state").
  activate: (token: string, id: string) =>
    apiRequest<Risk>(`/api/v1/risks/${id}`, { method: "PATCH", body: { status: "ACTIVE" }, token }),

  // Terminal transition, requires risk.delete permission + mandatory reason —
  // see POST /:id/archive in risks.routes.ts.
  archive: (token: string, id: string, reason: string) =>
    apiRequest<{ status: string }>(`/api/v1/risks/${id}/archive`, { method: "POST", body: { reason }, token }),

  // ACT-120/121: designate or reassign the individual Risk Owner. `null`
  // clears it. Never folded into a generic update — see RiskService.assignOwner.
  assignOwner: (token: string, id: string, ownerId: string | null) =>
    apiRequest<Risk>(`/api/v1/risks/${id}/owner`, { method: "POST", body: { ownerId }, token }),

  // ACT-122: designate the owner's N+1 (superior owner).
  assignSuperiorOwner: (token: string, id: string, superiorOwnerId: string | null) =>
    apiRequest<Risk>(`/api/v1/risks/${id}/superior-owner`, { method: "POST", body: { superiorOwnerId }, token }),
};
