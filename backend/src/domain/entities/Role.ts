import type { Permission } from "../permissions.js";
import type { DashboardScopeMode } from "./DashboardScope.js";

/** B-8: the three fixed groups every tenant has (migration 049). */
export type SystemGroup = "RISK_MANAGER" | "RISK_COMMITTEE" | "AUDIT";

/**
 * Named, admin-defined bundle of permissions (ACT-110 to ACT-118).
 * Updated in place like Department/Process — a role's permission set
 * changes over its lifetime, it isn't re-created per version.
 */
export interface Role {
  id: string;
  tenantId: string;
  name: string;
  description: string | null;
  permissions: Permission[];
  /**
   * @architect design 2026-09-30 (dashboard.executive scope): configurable
   * perimeter for holders of `dashboard.executive`, defaults to GLOBAL
   * (today's behavior, zero regression). Resolved at read time by
   * DashboardScopeResolver — never itself a computed perimeter. PROCESS is
   * a valid stored value but rejected at RoleService's write boundary
   * (risks.process_id backfill not done) — see RoleService.
   */
  dashboardScopeMode: DashboardScopeMode;
  /** Non-null for the three fixed groups: never disabled, never renamed. */
  systemGroup: SystemGroup | null;
  /** Non-null when this role is the group of a department (unique per tenant). */
  departmentId: string | null;
  createdAt: Date;
  updatedAt: Date;
  deletedAt: Date | null;
}

export interface CreateRoleInput {
  tenantId: string;
  name: string;
  description?: string | null;
  permissions: Permission[];
  /** Defaults to GLOBAL when omitted — see Role.dashboardScopeMode. */
  dashboardScopeMode?: DashboardScopeMode;
  departmentId?: string | null;
}

export interface UpdateRoleInput {
  name?: string;
  description?: string | null;
  permissions?: Permission[];
  dashboardScopeMode?: DashboardScopeMode;
  departmentId?: string | null;
}

/**
 * A grant of a role to a user (ACT-093/113/114). Append-only: revoking
 * never deletes the row, it sets revokedAt — the grant/revoke history
 * is itself audit-relevant.
 */
export interface RoleAssignment {
  id: string;
  tenantId: string;
  roleId: string;
  userId: string;
  grantedBy: string;
  grantedAt: Date;
  revokedAt: Date | null;
}

/**
 * B-8 bis (q45): a change of the Audit group's permissions made by an
 * administrator who is also a Risk Manager waits here until a member of
 * Audit or of the Committee validates it (never the author).
 */
export type RolePermissionChangeStatus = "PENDING" | "APPROVED" | "REJECTED";

export interface RolePermissionChange {
  id: string;
  tenantId: string;
  roleId: string;
  permissions: Permission[];
  requestedBy: string;
  status: RolePermissionChangeStatus;
  decidedBy: string | null;
  createdAt: Date;
  decidedAt: Date | null;
}
