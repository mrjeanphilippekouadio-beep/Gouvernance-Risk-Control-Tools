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

/** q188/q189: line of defense of a role or an account, computed by the server (badge only). */
export type DefenseLine = "ADMIN" | "AUDIT" | "LINE_2" | "LINE_1";
export const DEFENSE_LINE_LABELS: Record<DefenseLine, string> = { ADMIN: "Administrateur", AUDIT: "Audit (3e ligne)", LINE_2: "2e ligne", LINE_1: "1re ligne" };
export interface MatrixRole { id: string; name: string; systemGroup: FixedGroup | null; permissions: string[]; line: DefenseLine }
export interface MatrixAccount { id: string; displayName: string; line: DefenseLine }
/** q200 (DECISION-103): one Risk Manager member's widened view (Audit and administrators), confirmed by a third person. */
export interface SensitiveViewGrant {
  id: string;
  userId: string;
  reason: string;
  status: "PENDING" | "APPROVED" | "REJECTED" | "REVOKED";
  requestedBy: string;
  requestedAt: string;
  expiresAt: string | null;
  decisionReason: string | null;
  revokeReason: string | null;
}

/** F7-S3: where an effective permission comes from, as the server computes it. */
export type PermissionSource =
  | { kind: "BASE" }
  | { kind: "DIRECT" }
  /** q200: role.read.sensitive given individually to a Risk Manager member (confirmed by a third person). */
  | { kind: "GRANT" }
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

  /** q188/q189: the matrix rows and the accounts it can open, cut by the server to the reader's lines. */
  matrix: (token: string) => apiRequest<MatrixRole[]>("/api/v1/roles/matrix", { token }),
  accounts: (token: string) => apiRequest<MatrixAccount[]>("/api/v1/roles/accounts", { token }),
  sensitiveViews: (token: string) => apiRequest<SensitiveViewGrant[]>("/api/v1/roles/sensitive-view-grants", { token }),
  /** QA-RL-04: the active Risk Manager members an administrator may pick (role.assign). */
  sensitiveViewCandidates: (token: string) =>
    apiRequest<Array<{ id: string; displayName: string }>>("/api/v1/roles/sensitive-view-grants/candidates", { token }),
  requestSensitiveView: (token: string, userId: string, reason: string) =>
    apiRequest<SensitiveViewGrant>("/api/v1/roles/sensitive-view-grants", { method: "POST", body: { userId, reason }, token }),
  decideSensitiveView: (token: string, id: string, approve: boolean, reason: string) =>
    apiRequest<SensitiveViewGrant>(`/api/v1/roles/sensitive-view-grants/${encodeURIComponent(id)}/${approve ? "approve" : "reject"}`,
      { method: "POST", body: reason ? { reason } : {}, token }),
  revokeSensitiveView: (token: string, id: string, reason: string) =>
    apiRequest<SensitiveViewGrant>(`/api/v1/roles/sensitive-view-grants/${encodeURIComponent(id)}/revoke`, { method: "POST", body: { reason }, token }),

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

  // q212: `reason` is required by the server when the role opens restricted resources of its department (outside the RM group).
  assign: (token: string, id: string, userId: string, reason?: string) =>
    apiRequest<void>(`/api/v1/roles/${id}/assign`, { method: "POST", body: { userId, ...(reason ? { reason } : {}) }, token }),

  revoke: (token: string, id: string, userId: string) =>
    apiRequest<void>(`/api/v1/roles/${id}/revoke`, { method: "POST", body: { userId }, token }),
};
