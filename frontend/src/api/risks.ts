import { apiRequest } from "./client";

export type RiskStatus = "DRAFT" | "ACTIVE" | "ARCHIVED";

/** Lot V1 (DECISION-102): who may read a risk. The rule itself is applied by the server only. */
export type RiskVisibility = "CLIENT" | "PERIMETRE" | "NOMINATIF";

export const RISK_VISIBILITY_LABELS: Record<RiskVisibility, string> = {
  CLIENT: "Tout le client",
  PERIMETRE: "Restreint au périmètre",
  NOMINATIF: "Personnes nommées",
};

export const RISK_VISIBILITY_HELP: Record<RiskVisibility, string> = {
  CLIENT: "Visible par tous les comptes du client.",
  PERIMETRE: "Propriétaire, N+1, RACI, responsable du processus, membres du groupe du département, et la liste ci-dessous.",
  NOMINATIF: "Le propriétaire et les seules personnes de la liste.",
};

export interface RiskVisibilityState {
  visibility: RiskVisibility;
  accessUserIds: string[];
  /** q205: names of the named people (null = account not found). */
  accessUsers?: Array<{ id: string; displayName: string | null }>;
}

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
  /** Lot V1: absent on an older server = CLIENT. */
  visibility?: RiskVisibility;
  createdAt: string;
  updatedAt: string;
}

export interface CreateRiskInput {
  process: string;
  description: string;
  ownerDepartmentId?: string | null;
  visibility?: RiskVisibility;
  /** Named people (never yourself: the server refuses it). */
  accessUserIds?: string[];
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
  // q212: `reason` is required by the server when the designation opens a restricted risk (outside the RM group).
  assignOwner: (token: string, id: string, ownerId: string | null, reason?: string) =>
    apiRequest<Risk>(`/api/v1/risks/${id}/owner`, { method: "POST", body: { ownerId, ...(reason ? { reason } : {}) }, token }),

  // ACT-122: designate the owner's N+1 (superior owner).
  assignSuperiorOwner: (token: string, id: string, superiorOwnerId: string | null, reason?: string) =>
    apiRequest<Risk>(`/api/v1/risks/${id}/superior-owner`, { method: "POST", body: { superiorOwnerId, ...(reason ? { reason } : {}) }, token }),

  // Lot V1: visibility level and named-people list of a risk.
  getVisibility: (token: string, id: string) =>
    apiRequest<RiskVisibilityState>(`/api/v1/risks/${encodeURIComponent(id)}/visibility`, { token }),

  // Risk Manager group or risk owner only, mandatory reason; the server checks everything.
  setVisibility: (
    token: string,
    id: string,
    input: { visibility: RiskVisibility; addUserIds?: string[]; revokeUserIds?: string[]; reason: string },
  ) => apiRequest<RiskVisibilityState>(`/api/v1/risks/${encodeURIComponent(id)}/visibility`, { method: "PUT", body: input, token }),
};
