import type { Pool } from "pg";
import type { RiskRepository } from "../../../domain/repositories/RiskRepository.js";
import type { CreateRiskInput, Risk, UpdateRiskInput } from "../../../domain/entities/Risk.js";
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
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    deletedAt: row.deleted_at,
    deletedBy: row.deleted_by,
    deletionReason: row.deletion_reason,
  };
}

export class PostgresRiskRepository implements RiskRepository {
  constructor(private readonly pool: Pool) {}

  async getById(tenantId: string, id: string): Promise<Risk | null> {
    const { rows } = await this.pool.query<RiskRow>(
      `SELECT * FROM risks WHERE tenant_id = $1 AND id = $2 AND deleted_at IS NULL`,
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
    options?: {
      includeArchived?: boolean;
      ownerId?: string;
      ownerDepartmentIds?: string[];
      processIds?: string[];
      ids?: string[];
    },
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
       WHERE tenant_id = $1 AND deleted_at IS NULL ${statusFilter} ${ownerFilter} ${scopeFilter}
       ORDER BY created_at DESC`,
      params,
    );
    return rows.map(toDomain);
  }

  async create(input: CreateRiskInput): Promise<Risk> {
    const { rows } = await this.pool.query<RiskRow>(
      `INSERT INTO risks (tenant_id, process, description, owner_department_id, status, process_id)
       VALUES ($1, $2, $3, $4, 'DRAFT', $5)
       RETURNING *`,
      [input.tenantId, input.process, input.description, input.ownerDepartmentId ?? null, input.processId ?? null],
    );
    const row = rows[0];
    if (!row) throw new Error("Insert into risks returned no row");
    return toDomain(row);
  }

  async createIdempotent(
    input: CreateRiskInput,
    idempotencyKey: string,
  ): Promise<{ risk: Risk; created: boolean }> {
    const inserted = await this.pool.query<RiskRow>(
      `INSERT INTO risks
         (tenant_id, process, description, owner_department_id, status, process_id, idempotency_key)
       VALUES ($1, $2, $3, $4, 'DRAFT', $5, $6)
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
      ],
    );

    if (inserted.rows[0]) {
      return { risk: toDomain(inserted.rows[0]), created: true };
    }

    const existing = await this.pool.query<RiskRow>(
      `SELECT * FROM risks WHERE tenant_id = $1 AND idempotency_key = $2`,
      [input.tenantId, idempotencyKey],
    );
    if (!existing.rows[0]) {
      throw new Error("Idempotent risk lookup returned no row after conflict");
    }
    return { risk: toDomain(existing.rows[0]), created: false };
  }

  async update(tenantId: string, id: string, input: UpdateRiskInput): Promise<Risk> {
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

    const { rows } = await this.pool.query<RiskRow>(
      `UPDATE risks
       SET ${setClauses.join(", ")}, updated_at = now()
       WHERE tenant_id = $1 AND id = $2 AND deleted_at IS NULL
       RETURNING *`,
      [tenantId, id, ...values],
    );
    const row = rows[0];
    if (!row) throw new NotFoundError("Risk", id);
    return toDomain(row);
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
