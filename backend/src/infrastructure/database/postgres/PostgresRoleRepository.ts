import type { Pool } from "pg";
import type { HandOverInput, RoleRepository } from "../../../domain/repositories/RoleRepository.js";
import type { AuditEvent } from "../../../domain/entities/AuditEvent.js";
import type { TransactionalAudit } from "../../../domain/entities/RiskFramework.js";
import { insertAuditEvent, runAudited } from "./PostgresAuditRepository.js";
import type { CreateRoleInput, Role, RoleAssignment, SystemGroup, UpdateRoleInput } from "../../../domain/entities/Role.js";
import type { Permission } from "../../../domain/permissions.js";
import type { DashboardScopeMode } from "../../../domain/entities/DashboardScope.js";
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from "../../../domain/errors/DomainErrors.js";
import type { RoleAssignRecheck, RoleUpdateRecheck } from "../../../domain/repositories/RoleRepository.js";
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
const ROLES_OF_USER_SQL = `SELECT r.* FROM roles r
       JOIN user_roles ur ON ur.role_id = r.id
       WHERE ur.tenant_id = $1 AND ur.user_id = $2 AND ur.revoked_at IS NULL AND r.deleted_at IS NULL
       ORDER BY r.name`;

/** A failing ROLLBACK (dead connection) must not replace the error that caused it. */
async function rollbackQuietly(client: { query(sql: string): Promise<unknown> }): Promise<void> {
  try {
    await client.query("ROLLBACK");
  } catch {
    /* the original error is the one to report */
  }
}

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
  readonly assignAuditsInTransaction = true;
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

  async update(tenantId: string, id: string, input: UpdateRoleInput, recheck?: RoleUpdateRecheck): Promise<Role> {
    if (recheck) return this.updateUnderLock(tenantId, id, input, recheck);
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

  async setGroupPermissions(
    tenantId: string,
    changes: Array<{ id: string; permissions: Permission[] }>,
    audit: (roles: Role[]) => Array<Omit<AuditEvent, "id" | "timestamp">>,
    actorUserId?: string,
  ): Promise<Role[]> {
    return runAudited(this.pool, async (db) => {
      if (actorUserId) {
        // Same lock order as assignToUser (user THEN role): an assignment of the actor to a target group either
        // committed before (seen below) or waits for this transaction.
        await db.query(`SELECT id FROM users WHERE tenant_id = $1 AND id = $2 FOR UPDATE`, [tenantId, actorUserId]);
        const ids = changes.map((c) => c.id); // locked in id order by the ORDER BY below
        await db.query(`SELECT id FROM roles WHERE tenant_id = $1 AND id = ANY($2::uuid[]) ORDER BY id FOR UPDATE`, [tenantId, ids]);
        const { rows: held } = await db.query<RoleRow>(ROLES_OF_USER_SQL, [tenantId, actorUserId]);
        if (held.some((r) => ids.includes(r.id))) {
          throw new ForbiddenError("You cannot change the permissions of a group you belong to — ask another admin");
        }
      }
      const out: Role[] = [];
      for (const c of changes) {
        const { rows } = await db.query<RoleRow>(
          `UPDATE roles SET permissions = $3, updated_at = now()
           WHERE tenant_id = $1 AND id = $2 AND deleted_at IS NULL AND system_group IS NOT NULL
           RETURNING *`,
          [tenantId, c.id, c.permissions],
        );
        if (!rows[0]) throw new NotFoundError("Role", c.id);
        out.push(toDomain(rows[0]));
      }
      return out;
    }, audit);
  }

  /**
   * F-B8s-01: lock order is always users (by id) THEN the role, like assignToUser. The holders are re-read
   * after the role lock; a holder that appeared meanwhile was not locked, so we refuse (retry) rather than guess.
   */
  private async updateUnderLock(tenantId: string, id: string, input: UpdateRoleInput, recheck: RoleUpdateRecheck): Promise<Role> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const holdersSql = `SELECT DISTINCT user_id FROM user_roles WHERE tenant_id = $1 AND role_id = $2 AND revoked_at IS NULL`;
      const first = await client.query<{ user_id: string }>(holdersSql, [tenantId, id]);
      const ids = first.rows.map((r) => r.user_id).sort();
      if (ids.length > 0) {
        await client.query(`SELECT id FROM users WHERE tenant_id = $1 AND id = ANY($2::uuid[]) ORDER BY id FOR UPDATE`, [tenantId, ids]);
      }
      const locked = await client.query<RoleRow>(
        `SELECT * FROM roles WHERE tenant_id = $1 AND id = $2 AND deleted_at IS NULL FOR UPDATE`,
        [tenantId, id],
      );
      if (!locked.rows[0]) throw new NotFoundError("Role", id);
      const second = await client.query<{ user_id: string }>(holdersSql, [tenantId, id]);
      if (second.rows.some((r) => !ids.includes(r.user_id))) {
        throw new ConflictError("Role assignments changed concurrently; retry");
      }
      const holders: { userId: string; roles: Role[] }[] = [];
      for (const userId of ids) {
        const { rows } = await client.query<RoleRow>(ROLES_OF_USER_SQL, [tenantId, userId]);
        holders.push({ userId, roles: rows.map(toDomain) });
      }
      await recheck(toDomain(locked.rows[0]), holders);
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
      if (setClauses.length === 0) throw new Error("update with recheck needs at least one field");
      const { rows } = await client
        .query<RoleRow>(
          `UPDATE roles SET ${setClauses.join(", ")}, updated_at = now() WHERE tenant_id = $1 AND id = $2 RETURNING *`,
          [tenantId, id, ...values],
        )
        .catch(rethrowDepartmentConflict);
      await client.query("COMMIT");
      if (!rows[0]) throw new NotFoundError("Role", id);
      return toDomain(rows[0]);
    } catch (err) {
      await rollbackQuietly(client);
      throw err;
    } finally {
      client.release();
    }
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

  async assignToUser(
    tenantId: string,
    roleId: string,
    userId: string,
    grantedBy: string,
    recheck?: RoleAssignRecheck,
    audit?: TransactionalAudit<RoleAssignment>,
  ): Promise<RoleAssignment> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      // F-B8s-01: lock the target user first (one lock common to every role assigned to them), then the role.
      // Same order as updateUnderLock, so no deadlock between an assignment and a role update.
      const user = await client.query(
        `SELECT id FROM users WHERE tenant_id = $1 AND id = $2 AND deleted_at IS NULL FOR UPDATE`,
        [tenantId, userId],
      );
      if (!user.rowCount) throw new NotFoundError("User", userId);
      // F-B8q-01: orders this insert against a concurrent roles UPDATE and refuses a role disabled meanwhile.
      const locked = await client.query<RoleRow>(
        `SELECT * FROM roles WHERE tenant_id = $1 AND id = $2 AND deleted_at IS NULL FOR UPDATE`,
        [tenantId, roleId],
      );
      if (!locked.rowCount) throw new NotFoundError("Role", roleId);
      if (recheck) {
        // Replay the cumul rules on what is committed NOW, under both locks (the service's first check may be stale).
        const held = await client.query<RoleRow>(ROLES_OF_USER_SQL, [tenantId, userId]);
        await recheck(toDomain(locked.rows[0] as RoleRow), held.rows.map(toDomain));
      }
      const { rows } = await client.query<UserRoleRow>(
        `INSERT INTO user_roles (tenant_id, role_id, user_id, granted_by)
         VALUES ($1, $2, $3, $4)
         RETURNING *`,
        [tenantId, roleId, userId, grantedBy],
      );
      const row = rows[0];
      if (!row) throw new Error("Insert into user_roles returned no row");
      const assignment = assignmentToDomain(row);
      // QA-V3-03: the audit rows of the assignment (and of the access it opens) commit or roll back with it.
      if (audit) for (const event of audit(assignment)) await insertAuditEvent(client, event);
      await client.query("COMMIT");
      return assignment;
    } catch (err) {
      await rollbackQuietly(client);
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
    options?: { minRemaining?: number; auditEvents?: Array<Omit<AuditEvent, "id" | "timestamp">> },
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
      for (const event of options?.auditEvents ?? []) await insertAuditEvent(client, event);
      await client.query("COMMIT");
    } catch (err) {
      await rollbackQuietly(client);
      throw err;
    } finally {
      client.release();
    }
  }

  async handOverLastRiskManager(input: HandOverInput): Promise<RoleAssignment> {
    const { tenantId, roleId, leavingUserId, interimUserId, designationId } = input;
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      // Lock order (same as assignToUser / update): users by id, then the role, then the tenant, then the designation.
      const users = await client.query<{ id: string; deleted_at: Date | null }>(
        `SELECT id, deleted_at FROM users WHERE tenant_id = $1 AND id = ANY($2::uuid[]) ORDER BY id FOR UPDATE`,
        [tenantId, [leavingUserId, interimUserId]],
      );
      const interim = users.rows.find((u) => u.id === interimUserId);
      if (!interim || interim.deleted_at) throw new ValidationError("The designated interim is not an active user");
      const locked = await client.query<RoleRow>(
        `SELECT * FROM roles WHERE tenant_id = $1 AND id = $2 AND deleted_at IS NULL FOR UPDATE`,
        [tenantId, roleId],
      );
      if (!locked.rowCount) throw new NotFoundError("Role", roleId);
      const role = toDomain(locked.rows[0] as RoleRow);
      if (role.systemGroup !== "RISK_MANAGER") throw new ValidationError("The hand-over only applies to the Risk Manager group");
      await client.query(`SELECT 1 FROM tenants WHERE id = $1 FOR NO KEY UPDATE`, [tenantId]);
      const des = await client.query(
        `SELECT 1 FROM governance_designations
         WHERE tenant_id = $1 AND id = $2 AND kind = 'RISK_MANAGER_INTERIM' AND user_id = $3
           AND ended_at IS NULL AND activated_at IS NULL AND valid_until > now()
         FOR UPDATE`,
        [tenantId, designationId, interimUserId],
      );
      if (!des.rowCount) throw new ConflictError("The interim designation is no longer usable (ended, used or past its end date)", designationId);

      // The leaving member must still be the last ACTIVE member (a member added meanwhile means: retry the ordinary path).
      const others = await client.query<{ count: string }>(
        `SELECT COUNT(*) AS count FROM user_roles ur
         JOIN users u ON u.id = ur.user_id AND u.tenant_id = ur.tenant_id AND u.deleted_at IS NULL
         WHERE ur.tenant_id = $1 AND ur.role_id = $2 AND ur.revoked_at IS NULL AND ur.user_id <> $3`,
        [tenantId, roleId, leavingUserId],
      );
      if (Number(others.rows[0]?.count ?? 0) > 0) {
        throw new ConflictError("The Risk Manager group has another active member now; retry", roleId);
      }
      if (input.recheck) {
        const held = await client.query<RoleRow>(ROLES_OF_USER_SQL, [tenantId, interimUserId]);
        await input.recheck(role, held.rows.map(toDomain));
      }
      // Revoke FIRST: 062's AFTER INSERT trigger counts RM members, two at once would end the bootstrap for good.
      const revoked = await client.query(
        `UPDATE user_roles SET revoked_at = now()
         WHERE tenant_id = $1 AND role_id = $2 AND user_id = $3 AND revoked_at IS NULL`,
        [tenantId, roleId, leavingUserId],
      );
      if (!revoked.rowCount) throw new NotFoundError("RoleAssignment", `${roleId}:${leavingUserId}`);
      const inserted = await client.query<UserRoleRow>(
        `INSERT INTO user_roles (tenant_id, role_id, user_id, granted_by) VALUES ($1, $2, $3, $4) RETURNING *`,
        [tenantId, roleId, interimUserId, input.grantedBy],
      );
      const row = inserted.rows[0];
      if (!row) throw new Error("Insert into user_roles returned no row");
      await client.query(
        `UPDATE governance_designations SET activated_at = now(), activated_ref = $3 WHERE tenant_id = $1 AND id = $2`,
        [tenantId, designationId, row.id],
      );
      const assignment = assignmentToDomain(row);
      for (const event of input.audit(assignment)) await insertAuditEvent(client, event);
      const after = await client.query<{ count: string }>(
        `SELECT COUNT(*) AS count FROM user_roles ur
         JOIN users u ON u.id = ur.user_id AND u.tenant_id = ur.tenant_id AND u.deleted_at IS NULL
         WHERE ur.tenant_id = $1 AND ur.role_id = $2 AND ur.revoked_at IS NULL`,
        [tenantId, roleId],
      );
      if (Number(after.rows[0]?.count ?? 0) !== 1) throw new Error("Hand-over would not leave exactly one Risk Manager");
      await client.query("COMMIT");
      return assignment;
    } catch (err) {
      await rollbackQuietly(client);
      if (typeof err === "object" && err !== null && (err as { code?: unknown }).code === "23505"
          && (err as { constraint?: unknown }).constraint === "user_roles_active_idx") {
        throw new ConflictError("The interim already holds this role", roleId);
      }
      throw err;
    } finally {
      client.release();
    }
  }

  async listForUser(tenantId: string, userId: string): Promise<Role[]> {
    const { rows } = await this.pool.query<RoleRow>(ROLES_OF_USER_SQL, [tenantId, userId]);
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

  async listActiveGrants(tenantId: string, userId: string): Promise<Array<{ role: Role; grantedBy: string; grantedAt: Date }>> {
    const { rows } = await this.pool.query<RoleRow & { granted_by: string; granted_at: Date }>(
      `SELECT r.*, ur.granted_by, ur.granted_at FROM roles r
       JOIN user_roles ur ON ur.role_id = r.id AND ur.tenant_id = r.tenant_id
       WHERE ur.tenant_id = $1 AND ur.user_id = $2 AND ur.revoked_at IS NULL AND r.deleted_at IS NULL
       ORDER BY r.name`,
      [tenantId, userId],
    );
    return rows.map((r) => ({ role: toDomain(r), grantedBy: r.granted_by, grantedAt: r.granted_at }));
  }

  async listAssignments(tenantId: string, roleId: string): Promise<RoleAssignment[]> {
    const { rows } = await this.pool.query<UserRoleRow>(
      `SELECT * FROM user_roles WHERE tenant_id = $1 AND role_id = $2 ORDER BY granted_at DESC`,
      [tenantId, roleId],
    );
    return rows.map(assignmentToDomain);
  }
}
