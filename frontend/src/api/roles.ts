import { apiRequest, apiRequestFull } from "./client";

export interface Role {
  id: string;
  name: string;
  description: string | null;
  permissions: string[];
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
  /** Set on the three fixed groups, null on an ordinary role. */
  systemGroup?: FixedGroup | null;
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
export const FIXED_GROUP_LABELS: Record<FixedGroup, string> = { RISK_MANAGER: "Risk Manager", RISK_COMMITTEE: "Comité des risques", AUDIT: "Audit" };

/** F7-S3: where an effective permission comes from, as the server computes it. */
export type PermissionSource =
  | { kind: "BASE" }
  | { kind: "DIRECT" }
  | { kind: "ROLE"; roleId: string; roleName: string; systemGroup: FixedGroup | null };
export interface EffectivePermission {
  permission: string;
  sources: PermissionSource[];
}
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

  /** F7-S3: a user's held roles and effective permissions with their origin (role.read). */
  forUser: (token: string, userId: string) => apiRequest<Role[]>(`/api/v1/roles/users/${encodeURIComponent(userId)}`, { token }),
  /** A suspended account holds nothing: empty list, `suspended` true (F7S3-01). */
  permissionSources: async (token: string, userId: string) => {
    const r = await apiRequestFull<EffectivePermission[]>(`/api/v1/roles/users/${encodeURIComponent(userId)}/permission-sources`, { token });
    return { permissions: r.data, suspended: r.suspended === true };
  },

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
