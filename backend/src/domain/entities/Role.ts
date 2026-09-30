import type { Permission } from "../permissions.js";
import type { DashboardScopeMode } from "./DashboardScope.js";

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
}

export interface UpdateRoleInput {
  name?: string;
  description?: string | null;
  permissions?: Permission[];
  dashboardScopeMode?: DashboardScopeMode;
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
