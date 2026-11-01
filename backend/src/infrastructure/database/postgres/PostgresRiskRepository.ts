import type { Pool } from "pg";
import { riskVisibilityClause } from "./visibilityFilter.js";
import type { ReadScope, Visibility } from "../../../domain/visibility.js";
import { runAudited } from "./PostgresAuditRepository.js";
import type { TransactionalAudit } from "../../../domain/entities/RiskFramework.js";
import type { RiskRepository } from "../../../domain/repositories/RiskRepository.js";
import type { CreateRiskInput, Risk, RiskVisibilityChange, RiskVisibilityState, UpdateRiskInput } from "../../../domain/entities/Risk.js";
import { NotFoundError, ValidationError } from "../../../domain/errors/DomainErrors.js";
import { buildUpdateSet } from "./dynamicUpdate.js";

interface RiskRow {
  id: string;
  tenant_id: string;
  process: string;
  process_id: string | null;
  description: string;
  owner_department_id: string | null;
  owner_id: string | null;
  superior_owner_id: string | null;
  visibility?: Visibility;
  status: Risk["status"];
  created_at: Date;
  updated_at: Date;
  deleted_at: Date | null;
  deleted_by: string | null;
  deletion_reason: string | null;
}

function toDomain(row: RiskRow): Risk {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    process: row.process,
    processId: row.process_id,
    description: row.description,
    ownerDepartmentId: row.owner_department_id,
    ownerId: row.owner_id,
    superiorOwnerId: row.superior_owner_id,
    visibility: row.visibility ?? "CLIENT",
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    deletedAt: row.deleted_at,
    deletedBy: row.deleted_by,
    deletionReason: row.deletion_reason,
  };
}

const CREATION_GRANT_REASON = "Accès accordé à la création du risque";

export class PostgresRiskRepository implements RiskRepository {
  readonly auditsInTransaction = true;

  constructor(private readonly pool: Pool) {}

  async getById(tenantId: string, id: string, scope: ReadScope): Promise<Risk | null> {
    const { rows } = await this.pool.query<RiskRow>(
      `SELECT * FROM risks WHERE tenant_id = $1 AND id = $2 AND deleted_at IS NULL ${riskVisibilityClause(scope)}`,
      [tenantId, id],
    );
    return rows[0] ? toDomain(rows[0]) : null;
  }

  async listByIds(tenantId: string, ids: string[]): Promise<Risk[]> {
    if (ids.length === 0) return [];
    const { rows } = await this.pool.query<RiskRow>(
      `SELECT * FROM risks WHERE tenant_id = $1 AND id = ANY($2) AND deleted_at IS NULL`,
      [tenantId, ids],
    );
    return rows.map(toDomain);
  }

  async list(
    tenantId: string,
    options: {
      includeArchived?: boolean;
      ownerId?: string;
      ownerDepartmentIds?: string[];
      processIds?: string[];
      ids?: string[];
    } | undefined,
    scope: ReadScope,
  ): Promise<Risk[]> {
    const statusFilter = options?.includeArchived ? "" : "AND status <> 'ARCHIVED'";
    const params: unknown[] = [tenantId];
    let ownerFilter = "";
    if (options?.ownerId) {
      params.push(options.ownerId);
      ownerFilter = `AND owner_id = $${params.length}`;
    }

    // DashboardScopeResolver scoping (2026-09-30): a true `= ANY($n)`
    // filter per dimension given, OR'd together — never a post-fetch,
    // in-memory filter. Omitted dimensions impose no constraint.
    const scopeConditions: string[] = [];
    if (options?.ownerDepartmentIds && options.ownerDepartmentIds.length > 0) {
      params.push(options.ownerDepartmentIds);
      scopeConditions.push(`owner_department_id = ANY($${params.length})`);
    }
    if (options?.processIds && options.processIds.length > 0) {
      params.push(options.processIds);
      scopeConditions.push(`process_id = ANY($${params.length})`);
    }
    if (options?.ids && options.ids.length > 0) {
      params.push(options.ids);
      scopeConditions.push(`id = ANY($${params.length})`);
    }
    const scopeFilter = scopeConditions.length > 0 ? `AND (${scopeConditions.join(" OR ")})` : "";

    const { rows } = await this.pool.query<RiskRow>(
      `SELECT * FROM risks
       WHERE tenant_id = $1 AND deleted_at IS NULL ${statusFilter} ${ownerFilter} ${scopeFilter} ${riskVisibilityClause(scope)}
       ORDER BY created_at DESC`,
      params,
    );
    return rows.map(toDomain);
  }

  async create(input: CreateRiskInput): Promise<Risk> {
    const { risk } = await this.insertWithAccess(input, null);
    return risk;
  }

  async createIdempotent(
    input: CreateRiskInput,
    idempotencyKey: string,
  ): Promise<{ risk: Risk; created: boolean }> {
    return this.insertWithAccess(input, idempotencyKey);
  }

  /**
   * Lot V1: the risk, its level and its initial named-people list in ONE transaction — a restricted risk is never visible
   * to the whole client, not even for an instant. Same idempotency rule as before: a replayed key returns the original.
   */
  private async insertWithAccess(input: CreateRiskInput, idempotencyKey: string | null): Promise<{ risk: Risk; created: boolean }> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const inserted = await client.query<RiskRow>(
        `INSERT INTO risks
           (tenant_id, process, description, owner_department_id, status, process_id, idempotency_key, visibility)
         VALUES ($1, $2, $3, $4, 'DRAFT', $5, $6, $7)
         ON CONFLICT (tenant_id, idempotency_key) WHERE idempotency_key IS NOT NULL
         DO NOTHING
         RETURNING *`,
        [
          input.tenantId,
          input.process,
          input.description,
          input.ownerDepartmentId ?? null,
          input.processId ?? null,
          idempotencyKey,
          input.visibility ?? "CLIENT",
        ],
      );
      const row = inserted.rows[0];
      if (!row) {
        await client.query("ROLLBACK");
        const existing = await this.pool.query<RiskRow>(
          `SELECT * FROM risks WHERE tenant_id = $1 AND idempotency_key = $2`,
          [input.tenantId, idempotencyKey],
        );
        if (!existing.rows[0]) throw new Error("Idempotent risk lookup returned no row after conflict");
        return { risk: toDomain(existing.rows[0]), created: false };
      }
      for (const userId of new Set(input.accessUserIds ?? [])) {
        if (!input.grantedBy) throw new Error("Initial access grants need their author");
        await client.query(
          `INSERT INTO resource_access_grants (tenant_id, resource_type, resource_id, user_id, granted_by, grant_reason)
           VALUES ($1, 'RISK', $2, $3, $4, $5)`,
          [input.tenantId, row.id, userId, input.grantedBy, CREATION_GRANT_REASON],
        );
      }
      await client.query("COMMIT");
      return { risk: toDomain(row), created: true };
    } catch (err) {
      await client.query("ROLLBACK").catch(() => undefined);
      throw err;
    } finally {
      client.release();
    }
  }

  async hiddenIds(tenantId: string, ids: string[], scope: ReadScope): Promise<string[]> {
    if (scope.all || ids.length === 0) return [];
    // `riskVisibilityClause` admits the readable rows; here we keep the others.
    const readable = riskVisibilityClause(scope).replace(/^AND /, "");
    const { rows } = await this.pool.query<{ id: string }>(
      `SELECT id FROM risks WHERE tenant_id = $1 AND id = ANY($2::uuid[]) AND NOT ${readable}`,
      [tenantId, ids],
    );
    return rows.map((r) => r.id);
  }

  async listCreationAccess(tenantId: string, riskId: string): Promise<string[]> {
    const { rows } = await this.pool.query<{ user_id: string }>(
      `SELECT user_id FROM resource_access_grants
       WHERE tenant_id = $1 AND resource_type = 'RISK' AND resource_id = $2 AND grant_reason = $3`,
      [tenantId, riskId, CREATION_GRANT_REASON],
    );
    return rows.map((r) => r.user_id);
  }

  async listAccess(tenantId: string, riskId: string): Promise<string[]> {
    const { rows } = await this.pool.query<{ user_id: string }>(
      `SELECT user_id FROM resource_access_grants
       WHERE tenant_id = $1 AND resource_type = 'RISK' AND resource_id = $2 AND revoked_at IS NULL
       ORDER BY granted_at`,
      [tenantId, riskId],
    );
    return rows.map((r) => r.user_id);
  }

  async changeVisibility(
    tenantId: string,
    riskId: string,
    change: RiskVisibilityChange,
    audit?: TransactionalAudit<{ before: RiskVisibilityState; after: RiskVisibilityState; widening?: boolean }>,
  ): Promise<{ before: RiskVisibilityState; after: RiskVisibilityState; widening?: boolean }> {
    return runAudited(this.pool, async (db) => {
      const locked = await db.query<{ visibility: Visibility }>(
        `SELECT visibility FROM risks WHERE tenant_id = $1 AND id = $2 AND deleted_at IS NULL FOR UPDATE`,
        [tenantId, riskId],
      );
      if (!locked.rows[0]) throw new NotFoundError("Risk", riskId);
      const list = async () =>
        (await db.query<{ user_id: string }>(
          `SELECT user_id FROM resource_access_grants
           WHERE tenant_id = $1 AND resource_type = 'RISK' AND resource_id = $2 AND revoked_at IS NULL ORDER BY granted_at`,
          [tenantId, riskId],
        )).rows.map((r) => r.user_id);
      const before: RiskVisibilityState = { visibility: locked.rows[0].visibility, accessUserIds: await list() };
      // Codex P2: "widening" = someone reads the risk after the change who did not before (the real effective sets, by
      // risk_visible_to, under the lock), whatever the level moved to.
      const readersBefore = (await db.query<{ id: string }>(
        `SELECT id FROM users WHERE tenant_id = $1 AND deleted_at IS NULL AND risk_visible_to($1, $2, id)`,
        [tenantId, riskId],
      )).rows.map((r) => r.id);
      // Back to CLIENT revokes the list as read UNDER the lock: a grant added concurrently cannot survive (QA concurrency).
      const revoke = change.visibility === "CLIENT" ? before.accessUserIds : change.revokeUserIds;
      for (const userId of new Set(revoke)) {
        const { rowCount } = await db.query(
          `UPDATE resource_access_grants SET revoked_at = now(), revoked_by = $4, revoke_reason = $5
           WHERE tenant_id = $1 AND resource_type = 'RISK' AND resource_id = $2 AND user_id = $3 AND revoked_at IS NULL`,
          [tenantId, riskId, userId, change.changedBy, change.reason],
        );
        if (!rowCount) throw new ValidationError(`No active access to revoke for user ${userId}`);
      }
      for (const userId of new Set(change.addUserIds)) {
        if (before.accessUserIds.includes(userId)) continue;
        await db.query(
          `INSERT INTO resource_access_grants (tenant_id, resource_type, resource_id, user_id, granted_by, grant_reason)
           VALUES ($1, 'RISK', $2, $3, $4, $5)`,
          [tenantId, riskId, userId, change.changedBy, change.reason],
        );
      }
      await db.query(
        `UPDATE risks SET visibility = $3, updated_at = now() WHERE tenant_id = $1 AND id = $2`,
        [tenantId, riskId, change.visibility],
      );
      const { rows: [gain] } = await db.query<{ widening: boolean }>(
        `SELECT EXISTS (SELECT 1 FROM users WHERE tenant_id = $1 AND deleted_at IS NULL AND risk_visible_to($1, $2, id)
                          AND NOT (id = ANY($3::uuid[]))) AS widening`,
        [tenantId, riskId, readersBefore],
      );
      return { before, after: { visibility: change.visibility, accessUserIds: await list() }, widening: gain?.widening ?? false };
    }, audit);
  }

  async creatorWouldSee(
    tenantId: string,
    userId: string,
    risk: { visibility: Visibility; ownerDepartmentId: string | null; processId: string | null },
  ): Promise<boolean> {
    if (risk.visibility === "CLIENT") return true;
    if (risk.visibility === "NOMINATIF") return false; // no owner and no self-grant at creation (I-3, q194)
    const { rows } = await this.pool.query<{ ok: boolean }>(
      `SELECT (
         EXISTS (SELECT 1 FROM processes p WHERE p.tenant_id = $1 AND p.id = $4 AND p.owner_user_id = $2)
         OR EXISTS (SELECT 1 FROM user_roles ur JOIN roles ro ON ro.id = ur.role_id AND ro.tenant_id = ur.tenant_id
                    WHERE ur.tenant_id = $1 AND ur.user_id = $2 AND ur.revoked_at IS NULL AND ro.deleted_at IS NULL
                      AND ro.department_id IS NOT NULL AND ro.department_id = $3)
       ) AS ok`,
      [tenantId, userId, risk.ownerDepartmentId, risk.processId],
    );
    return rows[0]?.ok === true;
  }

  async update(
    tenantId: string,
    id: string,
    input: UpdateRiskInput,
    audit?: TransactionalAudit<Risk & { perimeterWidening?: boolean }>,
  ): Promise<Risk & { perimeterWidening?: boolean }> {
    // Dynamic SET list, not COALESCE: COALESCE($n, col) can't distinguish
    // "field omitted" from "field explicitly set to null", so a caller
    // could never clear ownerDepartmentId that way.
    const { setClauses, values } = buildUpdateSet(
      {
        process: input.process,
        description: input.description,
        owner_department_id: input.ownerDepartmentId,
        status: input.status,
        process_id: input.processId,
      },
      3,
    );
    if (setClauses.length === 0) throw new ValidationError("No fields to update");

    // Lot V2 (SEC V1-02): a perimeter change is measured on the real effective readers, under the row lock.
    const perimeter = input.ownerDepartmentId !== undefined || input.processId !== undefined;
    const readers = async (db: Pick<Pool, "query">) =>
      (await db.query<{ id: string }>(
        `SELECT id FROM users WHERE tenant_id = $1 AND deleted_at IS NULL AND risk_visible_to($1, $2, id)`,
        [tenantId, id],
      )).rows.map((r) => r.id);
    return runAudited(this.pool, async (db) => {
      let before: string[] = [];
      if (perimeter) {
        await db.query(`SELECT 1 FROM risks WHERE tenant_id = $1 AND id = $2 AND deleted_at IS NULL FOR UPDATE`, [tenantId, id]);
        before = await readers(db);
      }
      const { rows } = await db.query<RiskRow>(
        `UPDATE risks
         SET ${setClauses.join(", ")}, updated_at = now()
         WHERE tenant_id = $1 AND id = $2 AND deleted_at IS NULL
         RETURNING *`,
        [tenantId, id, ...values],
      );
      const row = rows[0];
      if (!row) throw new NotFoundError("Risk", id);
      if (!perimeter) return toDomain(row);
      const perimeterWidening = (await readers(db)).some((u) => !before.includes(u));
      return { ...toDomain(row), perimeterWidening };
    }, audit);
  }

  /** ACT-120/121: narrow write, never through the generic `update()` (see RiskRepository interface). */
  async assignOwner(tenantId: string, id: string, ownerId: string | null): Promise<Risk> {
    const { rows } = await this.pool.query<RiskRow>(
      `UPDATE risks
       SET owner_id = $3, updated_at = now()
       WHERE tenant_id = $1 AND id = $2 AND deleted_at IS NULL
       RETURNING *`,
      [tenantId, id, ownerId],
    );
    const row = rows[0];
    if (!row) throw new NotFoundError("Risk", id);
    return toDomain(row);
  }

  /** ACT-122: narrow write, never through the generic `update()` (see RiskRepository interface). */
  async assignSuperiorOwner(tenantId: string, id: string, superiorOwnerId: string | null): Promise<Risk> {
    const { rows } = await this.pool.query<RiskRow>(
      `UPDATE risks
       SET superior_owner_id = $3, updated_at = now()
       WHERE tenant_id = $1 AND id = $2 AND deleted_at IS NULL
       RETURNING *`,
      [tenantId, id, superiorOwnerId],
    );
    const row = rows[0];
    if (!row) throw new NotFoundError("Risk", id);
    return toDomain(row);
  }

  async softDelete(tenantId: string, id: string, deletedBy: string, reason: string): Promise<void> {
    const { rowCount } = await this.pool.query(
      `UPDATE risks
       SET deleted_at = now(), deleted_by = $3, deletion_reason = $4
       WHERE tenant_id = $1 AND id = $2 AND deleted_at IS NULL`,
      [tenantId, id, deletedBy, reason],
    );
    if (!rowCount) throw new NotFoundError("Risk", id);
  }
}
