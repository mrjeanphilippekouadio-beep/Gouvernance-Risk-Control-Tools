import type { Permission } from "../permissions.js";

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
  createdAt: Date;
  updatedAt: Date;
  deletedAt: Date | null;
}

export interface CreateRoleInput {
  tenantId: string;
  name: string;
  description?: string | null;
  permissions: Permission[];
}

export interface UpdateRoleInput {
  name?: string;
  description?: string | null;
  permissions?: Permission[];
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
