/**
 * One row per (tenant, email) — see migration 002_tenants_and_users.sql.
 * `roles` is the legacy free-form permission list consumed by
 * server.ts's identity lookup (kept for bootstrapping the first admin
 * before any RBAC Role exists, see permissions.ts's
 * `filterKnownPermissions`/SEC-005). The real, newer mechanism for
 * granting an application role is a RoleAssignment via RoleService
 * (ACT-093/110-118) — ACT-100 ("rôle initial obligatoire") is wired to
 * that RBAC path, not to this column, see UserService.create.
 */
export interface User {
  id: string;
  tenantId: string;
  email: string;
  displayName: string;
  roles: string[];
  createdAt: Date;
  deletedAt: Date | null;
}

export interface CreateUserInput {
  tenantId: string;
  email: string;
  displayName: string;
}

/**
 * ACT-101: profile edit is display name only for now — the `users` table
 * (migration 002) has no `fonction`/`entité` columns, and none are added
 * in this pass (see backlog note: only add them with a real migration if
 * genuinely needed, not speculatively).
 */
export interface UpdateUserInput {
  displayName?: string;
}
