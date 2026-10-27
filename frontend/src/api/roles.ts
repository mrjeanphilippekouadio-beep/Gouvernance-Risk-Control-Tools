import { apiRequest } from "./client";

export interface Role {
  id: string;
  name: string;
  description: string | null;
  permissions: string[];
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
}

export interface CreateRoleInput {
  name: string;
  description?: string;
  permissions: string[];
}

export interface Grantors {
  permission: string;
  grantors: { displayName: string }[];
}

export type FixedGroup = "RISK_MANAGER" | "RISK_COMMITTEE" | "AUDIT";
/** q179 (DECISION-095): the fixed groups carrying one governance decision right. */
export interface GovernanceRight {
  permission: string;
  groups: FixedGroup[];
}

export const rolesApi = {
  governanceRights: (token: string) => apiRequest<GovernanceRight[]>("/api/v1/roles/governance-rights", { token }),
  /** The server refuses contradictions (Audit never confirms nor approves, q157); an Audit change may wait for validation. */
  setGovernanceRight: (token: string, permission: string, groups: FixedGroup[], reason: string) =>
    apiRequest<GovernanceRight & { auditChangePending: boolean }>("/api/v1/roles/governance-rights", { method: "PUT", body: { permission, groups, reason }, token }),

  grantors: (token: string, permission: string) =>
    apiRequest<Grantors>(`/api/v1/roles/grantors?permission=${encodeURIComponent(permission)}`, { token }),

  list: (token: string, includeDisabled = false) =>
    apiRequest<Role[]>(`/api/v1/roles${includeDisabled ? "?includeDisabled=true" : ""}`, { token }),

  create: (token: string, input: CreateRoleInput) =>
    apiRequest<Role>("/api/v1/roles", { method: "POST", body: input, token }),

  disable: (token: string, id: string) =>
    apiRequest<void>(`/api/v1/roles/${id}/disable`, { method: "POST", token }),

  assign: (token: string, id: string, userId: string) =>
    apiRequest<void>(`/api/v1/roles/${id}/assign`, { method: "POST", body: { userId }, token }),

  revoke: (token: string, id: string, userId: string) =>
    apiRequest<void>(`/api/v1/roles/${id}/revoke`, { method: "POST", body: { userId }, token }),
};
