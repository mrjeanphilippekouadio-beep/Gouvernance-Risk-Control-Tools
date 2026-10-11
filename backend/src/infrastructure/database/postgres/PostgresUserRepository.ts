import type { Pool } from "pg";
import type { ListUsersOptions, UserRepository } from "../../../domain/repositories/UserRepository.js";
import type { CreateUserInput, UpdateUserInput, User } from "../../../domain/entities/User.js";
import { NotFoundError, ValidationError } from "../../../domain/errors/DomainErrors.js";
import { buildUpdateSet } from "./dynamicUpdate.js";

interface UserRow {
  id: string;
  tenant_id: string;
  email: string;
  display_name: string;
  roles: string[];
  department_id: string | null;
  created_at: Date;
  deleted_at: Date | null;
}

function toDomain(row: UserRow): User {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    email: row.email,
    displayName: row.display_name,
    roles: row.roles,
    departmentId: row.department_id,
    createdAt: row.created_at,
    deletedAt: row.deleted_at,
  };
}

/** True for a postgres unique_violation (23505) — see `users_active_email_idx` / `(tenant_id, email)` in migration 002. */
function isUniqueViolation(err: unknown): boolean {
  return typeof err === "object" && err !== null && "code" in err && (err as { code?: unknown }).code === "23505";
}

export class PostgresUserRepository implements UserRepository {
  constructor(private readonly pool: Pool) {}

  async getById(tenantId: string, id: string): Promise<User | null> {
    const { rows } = await this.pool.query<UserRow>(`SELECT * FROM users WHERE tenant_id = $1 AND id = $2`, [
      tenantId,
      id,
    ]);
    return rows[0] ? toDomain(rows[0]) : null;
  }

  async getByEmail(tenantId: string, email: string, options?: { includeSuspended?: boolean }): Promise<User | null> {
    const suspendedFilter = options?.includeSuspended ? "" : "AND deleted_at IS NULL";
    const { rows } = await this.pool.query<UserRow>(
      `SELECT * FROM users WHERE tenant_id = $1 AND email = $2 ${suspendedFilter}`,
      [tenantId, email],
    );
    return rows[0] ? toDomain(rows[0]) : null;
  }

  async list(tenantId: string, options?: ListUsersOptions): Promise<User[]> {
    const suspendedFilter = options?.includeSuspended ? "" : "AND deleted_at IS NULL";
    const limit = options?.limit ?? 50;
    const offset = options?.offset ?? 0;
    const { rows } = await this.pool.query<UserRow>(
      `SELECT * FROM users WHERE tenant_id = $1 ${suspendedFilter} ORDER BY email LIMIT $2 OFFSET $3`,
      [tenantId, limit, offset],
    );
    return rows.map(toDomain);
  }

  async count(tenantId: string, options?: { includeSuspended?: boolean }): Promise<number> {
    const suspendedFilter = options?.includeSuspended ? "" : "AND deleted_at IS NULL";
    const { rows } = await this.pool.query<{ count: string }>(
      `SELECT COUNT(*) AS count FROM users WHERE tenant_id = $1 ${suspendedFilter}`,
      [tenantId],
    );
    return Number(rows[0]?.count ?? 0);
  }

  async create(input: CreateUserInput): Promise<User> {
    try {
      const { rows } = await this.pool.query<UserRow>(
        `INSERT INTO users (tenant_id, email, display_name, department_id) VALUES ($1, $2, $3, $4) RETURNING *`,
        [input.tenantId, input.email, input.displayName, input.departmentId ?? null],
      );
      const row = rows[0];
      if (!row) throw new Error("Insert into users returned no row");
      return toDomain(row);
    } catch (err) {
      // Racy unique-email pre-checks don't belong here — let the DB's
      // (tenant_id, email) constraint (and the global active-email
      // index) be the single source of truth, and map its violation to
      // a clean, expected ValidationError instead of a raw pg error.
      if (isUniqueViolation(err)) {
        throw new ValidationError(`A user with email "${input.email}" already exists`);
      }
      throw err;
    }
  }

  async update(tenantId: string, id: string, input: UpdateUserInput): Promise<User> {
    const { setClauses, values } = buildUpdateSet(
      { display_name: input.displayName, department_id: input.departmentId },
      3,
    );
    if (setClauses.length === 0) {
      const current = await this.getById(tenantId, id);
      if (!current) throw new NotFoundError("User", id);
      return current;
    }

    const { rows } = await this.pool.query<UserRow>(
      `UPDATE users SET ${setClauses.join(", ")}
       WHERE tenant_id = $1 AND id = $2 AND deleted_at IS NULL
       RETURNING *`,
      [tenantId, id, ...values],
    );
    const row = rows[0];
    if (!row) throw new NotFoundError("User", id);
    return toDomain(row);
  }

  /**
   * F-B8-01: refuses to suspend the last active (non-suspended) member of the
   * Risk Manager group. Same lock as PostgresRoleRepository.revokeFromUser
   * (FOR UPDATE on the group's roles row) so a concurrent revoke/suspend
   * cannot both pass the count. Always on: no service dependency needed.
   */
  async suspend(tenantId: string, id: string): Promise<void> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const { rows: groups } = await client.query<{ id: string }>(
        `SELECT r.id FROM roles r
         JOIN user_roles ur ON ur.role_id = r.id AND ur.tenant_id = r.tenant_id
         WHERE r.tenant_id = $1 AND r.system_group = 'RISK_MANAGER' AND r.deleted_at IS NULL
           AND ur.user_id = $2 AND ur.revoked_at IS NULL
         FOR UPDATE OF r`,
        [tenantId, id],
      );
      const group = groups[0];
      if (group) {
        const { rows } = await client.query<{ count: string }>(
          `SELECT COUNT(*) AS count FROM user_roles ur
           JOIN users u ON u.id = ur.user_id AND u.tenant_id = ur.tenant_id AND u.deleted_at IS NULL
           WHERE ur.tenant_id = $1 AND ur.role_id = $2 AND ur.revoked_at IS NULL AND ur.user_id <> $3`,
          [tenantId, group.id, id],
        );
        if (Number(rows[0]?.count ?? 0) < 1) {
          throw new ValidationError("Cannot remove the last member of the Risk Manager group");
        }
      }
      const { rowCount } = await client.query(
        `UPDATE users SET deleted_at = now() WHERE tenant_id = $1 AND id = $2 AND deleted_at IS NULL`,
        [tenantId, id],
      );
      if (!rowCount) throw new NotFoundError("User", id);
      await client.query("COMMIT");
    } catch (err) {
      await client.query("ROLLBACK");
      throw err;
    } finally {
      client.release();
    }
  }

  async reactivate(tenantId: string, id: string): Promise<void> {
    const { rowCount } = await this.pool.query(
      `UPDATE users SET deleted_at = NULL WHERE tenant_id = $1 AND id = $2 AND deleted_at IS NOT NULL`,
      [tenantId, id],
    );
    if (!rowCount) throw new NotFoundError("User", id);
  }

  async listWithPermission(
    tenantId: string,
    permission: string,
    excludeUserId: string,
  ): Promise<Array<{ id: string; displayName: string }>> {
    const { rows } = await this.pool.query<{ id: string; display_name: string }>(
      `SELECT u.id, u.display_name FROM users u
       WHERE u.tenant_id = $1 AND u.deleted_at IS NULL AND u.id <> $3
         AND ($2 = ANY(u.roles) OR EXISTS (
           SELECT 1 FROM user_roles ur
           JOIN roles r ON r.id = ur.role_id AND r.tenant_id = ur.tenant_id AND r.deleted_at IS NULL
           WHERE ur.tenant_id = u.tenant_id AND ur.user_id = u.id AND ur.revoked_at IS NULL
             AND $2 = ANY(r.permissions)))
       ORDER BY u.display_name`,
      [tenantId, permission, excludeUserId],
    );
    return rows.map((r) => ({ id: r.id, displayName: r.display_name }));
  }
}
