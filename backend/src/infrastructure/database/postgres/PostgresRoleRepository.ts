import type { Pool } from "pg";
import type { RoleRepository } from "../../../domain/repositories/RoleRepository.js";
import type { CreateRoleInput, Role, RoleAssignment, SystemGroup, UpdateRoleInput } from "../../../domain/entities/Role.js";
import type { Permission } from "../../../domain/permissions.js";
import type { DashboardScopeMode } from "../../../domain/entities/DashboardScope.js";
import { ConflictError, NotFoundError, ValidationError } from "../../../domain/errors/DomainErrors.js";
import { buildUpdateSet } from "./dynamicUpdate.js";

interface RoleRow {
  id: string;
  tenant_id: string;
  name: string;
  description: string | null;
  permissions: string[];
  dashboard_scope_mode: DashboardScopeMode;
  system_group: SystemGroup | null;
  department_id: string | null;
  created_at: Date;
  updated_at: Date;
  deleted_at: Date | null;
}

interface UserRoleRow {
  id: string;
  tenant_id: string;
  role_id: string;
  user_id: string;
  granted_by: string;
  granted_at: Date;
  revoked_at: Date | null;
}

/** F-B8-03: unique_violation (23505) on roles_active_department_idx — two groups for one department. */
function rethrowDepartmentConflict(err: unknown): never {
  if (typeof err === "object" && err !== null && (err as { code?: unknown }).code === "23505"
      && (err as { constraint?: unknown }).constraint === "roles_active_department_idx") {
    throw new ValidationError("This department already has a group");
  }
  throw err;
}

function toDomain(row: RoleRow): Role {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    name: row.name,
    description: row.description,
    permissions: row.permissions as Permission[],
    dashboardScopeMode: row.dashboard_scope_mode,
    systemGroup: row.system_group,
    departmentId: row.department_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    deletedAt: row.deleted_at,
  };
}

function assignmentToDomain(row: UserRoleRow): RoleAssignment {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    roleId: row.role_id,
    userId: row.user_id,
    grantedBy: row.granted_by,
    grantedAt: row.granted_at,
    revokedAt: row.revoked_at,
  };
}

export class PostgresRoleRepository implements RoleRepository {
  constructor(private readonly pool: Pool) {}

  async getById(tenantId: string, id: string): Promise<Role | null> {
    const { rows } = await this.pool.query<RoleRow>(
      `SELECT * FROM roles WHERE tenant_id = $1 AND id = $2 AND deleted_at IS NULL`,
      [tenantId, id],
    );
    return rows[0] ? toDomain(rows[0]) : null;
  }

  async getByName(tenantId: string, name: string): Promise<Role | null> {
    const { rows } = await this.pool.query<RoleRow>(
      `SELECT * FROM roles WHERE tenant_id = $1 AND name = $2 AND deleted_at IS NULL`,
      [tenantId, name],
    );
    return rows[0] ? toDomain(rows[0]) : null;
  }

  async list(tenantId: string, options?: { includeDisabled?: boolean }): Promise<Role[]> {
    const disabledFilter = options?.includeDisabled ? "" : "AND deleted_at IS NULL";
    const { rows } = await this.pool.query<RoleRow>(
      `SELECT * FROM roles WHERE tenant_id = $1 ${disabledFilter} ORDER BY name`,
      [tenantId],
    );
    return rows.map(toDomain);
  }

  async create(input: CreateRoleInput): Promise<Role> {
    const { rows } = await this.pool
      .query<RoleRow>(
        `INSERT INTO roles (tenant_id, name, description, permissions, dashboard_scope_mode, department_id)
         VALUES ($1, $2, $3, $4, $5, $6)
         RETURNING *`,
        [
          input.tenantId,
          input.name,
          input.description ?? null,
          input.permissions,
          input.dashboardScopeMode ?? "GLOBAL",
          input.departmentId ?? null,
        ],
      )
      .catch(rethrowDepartmentConflict);
    const row = rows[0];
    if (!row) throw new Error("Insert into roles returned no row");
    return toDomain(row);
  }

  async update(tenantId: string, id: string, input: UpdateRoleInput): Promise<Role> {
    const { setClauses, values } = buildUpdateSet(
      {
        name: input.name,
        description: input.description,
        permissions: input.permissions,
        dashboard_scope_mode: input.dashboardScopeMode,
        department_id: input.departmentId,
      },
      3,
    );
    if (setClauses.length === 0) {
      const current = await this.getById(tenantId, id);
      if (!current) throw new NotFoundError("Role", id);
      return current;
    }

    const { rows } = await this.pool
      .query<RoleRow>(
        `UPDATE roles SET ${setClauses.join(", ")}, updated_at = now()
         WHERE tenant_id = $1 AND id = $2 AND deleted_at IS NULL
         RETURNING *`,
        [tenantId, id, ...values],
      )
      .catch(rethrowDepartmentConflict);
    const row = rows[0];
    if (!row) throw new NotFoundError("Role", id);
    return toDomain(row);
  }

  async disable(tenantId: string, id: string): Promise<void> {
    const { rowCount } = await this.pool.query(
      `UPDATE roles SET deleted_at = now(), updated_at = now()
       WHERE tenant_id = $1 AND id = $2 AND deleted_at IS NULL`,
      [tenantId, id],
    );
    if (!rowCount) throw new NotFoundError("Role", id);
  }

  async countActiveAssignments(tenantId: string, roleId: string): Promise<number> {
    const { rows } = await this.pool.query<{ count: string }>(
      // F-B8-01: a suspended user (users.deleted_at set) is not an active member.
      `SELECT COUNT(*) AS count FROM user_roles ur
       JOIN users u ON u.id = ur.user_id AND u.tenant_id = ur.tenant_id AND u.deleted_at IS NULL
       WHERE ur.tenant_id = $1 AND ur.role_id = $2 AND ur.revoked_at IS NULL`,
      [tenantId, roleId],
    );
    return Number(rows[0]?.count ?? 0);
  }

  async assignToUser(tenantId: string, roleId: string, userId: string, grantedBy: string): Promise<RoleAssignment> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      // F-B8q-01: same row lock as revokeFromUser; it orders this insert against a concurrent roles UPDATE
      // (which row-locks the same line) and refuses a role disabled in the meantime.
      const locked = await client.query(
        `SELECT id FROM roles WHERE tenant_id = $1 AND id = $2 AND deleted_at IS NULL FOR UPDATE`,
        [tenantId, roleId],
      );
      if (!locked.rowCount) throw new NotFoundError("Role", roleId);
      const { rows } = await client.query<UserRoleRow>(
        `INSERT INTO user_roles (tenant_id, role_id, user_id, granted_by)
         VALUES ($1, $2, $3, $4)
         RETURNING *`,
        [tenantId, roleId, userId, grantedBy],
      );
      await client.query("COMMIT");
      const row = rows[0];
      if (!row) throw new Error("Insert into user_roles returned no row");
      return assignmentToDomain(row);
    } catch (err) {
      await client.query("ROLLBACK");
      // q65-02: the loser of two simultaneous assignments hits user_roles_active_idx (23505) -> 409, not 500.
      if (typeof err === "object" && err !== null && (err as { code?: unknown }).code === "23505"
          && (err as { constraint?: unknown }).constraint === "user_roles_active_idx") {
        throw new ConflictError("This user already holds this role", roleId);
      }
      throw err;
    } finally {
      client.release();
    }
  }

  async revokeFromUser(
    tenantId: string,
    roleId: string,
    userId: string,
    options?: { minRemaining?: number },
  ): Promise<void> {
    const minRemaining = options?.minRemaining ?? 0;
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      // Serialises concurrent revokes on the same role so the count below is reliable.
      await client.query(`SELECT id FROM roles WHERE tenant_id = $1 AND id = $2 FOR UPDATE`, [tenantId, roleId]);
      if (minRemaining > 0) {
        const { rows } = await client.query<{ count: string }>(
          `SELECT COUNT(*) AS count FROM user_roles ur
           JOIN users u ON u.id = ur.user_id AND u.tenant_id = ur.tenant_id AND u.deleted_at IS NULL
           WHERE ur.tenant_id = $1 AND ur.role_id = $2 AND ur.revoked_at IS NULL AND ur.user_id <> $3`,
          [tenantId, roleId, userId],
        );
        if (Number(rows[0]?.count ?? 0) < minRemaining) {
          throw new ValidationError("Cannot remove the last member of this group");
        }
      }
      const { rowCount } = await client.query(
        `UPDATE user_roles SET revoked_at = now()
         WHERE tenant_id = $1 AND role_id = $2 AND user_id = $3 AND revoked_at IS NULL`,
        [tenantId, roleId, userId],
      );
      if (!rowCount) throw new NotFoundError("RoleAssignment", `${roleId}:${userId}`);
      await client.query("COMMIT");
    } catch (err) {
      await client.query("ROLLBACK");
      throw err;
    } finally {
      client.release();
    }
  }

  async listForUser(tenantId: string, userId: string): Promise<Role[]> {
    const { rows } = await this.pool.query<RoleRow>(
      `SELECT r.* FROM roles r
       JOIN user_roles ur ON ur.role_id = r.id
       WHERE ur.tenant_id = $1 AND ur.user_id = $2 AND ur.revoked_at IS NULL AND r.deleted_at IS NULL
       ORDER BY r.name`,
      [tenantId, userId],
    );
    return rows.map(toDomain);
  }

  async listDisabledForUser(tenantId: string, userId: string): Promise<Role[]> {
    const { rows } = await this.pool.query<RoleRow>(
      `SELECT r.* FROM roles r
       JOIN user_roles ur ON ur.role_id = r.id AND ur.tenant_id = r.tenant_id
       WHERE ur.tenant_id = $1 AND ur.user_id = $2 AND ur.revoked_at IS NULL AND r.deleted_at IS NOT NULL
       ORDER BY r.name`,
      [tenantId, userId],
    );
    return rows.map(toDomain);
  }

  async listAssignments(tenantId: string, roleId: string): Promise<RoleAssignment[]> {
    const { rows } = await this.pool.query<UserRoleRow>(
      `SELECT * FROM user_roles WHERE tenant_id = $1 AND role_id = $2 ORDER BY granted_at DESC`,
      [tenantId, roleId],
    );
    return rows.map(assignmentToDomain);
  }
}
