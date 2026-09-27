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
        `INSERT INTO users (tenant_id, email, display_name) VALUES ($1, $2, $3) RETURNING *`,
        [input.tenantId, input.email, input.displayName],
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
    const { setClauses, values } = buildUpdateSet({ display_name: input.displayName }, 3);
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

  async suspend(tenantId: string, id: string): Promise<void> {
    const { rowCount } = await this.pool.query(
      `UPDATE users SET deleted_at = now() WHERE tenant_id = $1 AND id = $2 AND deleted_at IS NULL`,
      [tenantId, id],
    );
    if (!rowCount) throw new NotFoundError("User", id);
  }

  async reactivate(tenantId: string, id: string): Promise<void> {
    const { rowCount } = await this.pool.query(
      `UPDATE users SET deleted_at = NULL WHERE tenant_id = $1 AND id = $2 AND deleted_at IS NOT NULL`,
      [tenantId, id],
    );
    if (!rowCount) throw new NotFoundError("User", id);
  }
}
