import type { Pool } from "pg";
import type { RiskRepository } from "../../../domain/repositories/RiskRepository.js";
import type { CreateRiskInput, Risk, UpdateRiskInput } from "../../../domain/entities/Risk.js";
import { NotFoundError } from "../../../domain/errors/DomainErrors.js";

interface RiskRow {
  id: string;
  tenant_id: string;
  process: string;
  description: string;
  owner_department_id: string | null;
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
    description: row.description,
    ownerDepartmentId: row.owner_department_id,
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

  async list(tenantId: string, options?: { includeArchived?: boolean }): Promise<Risk[]> {
    const statusFilter = options?.includeArchived ? "" : "AND status <> 'ARCHIVED'";
    const { rows } = await this.pool.query<RiskRow>(
      `SELECT * FROM risks
       WHERE tenant_id = $1 AND deleted_at IS NULL ${statusFilter}
       ORDER BY created_at DESC`,
      [tenantId],
    );
    return rows.map(toDomain);
  }

  async create(input: CreateRiskInput): Promise<Risk> {
    const { rows } = await this.pool.query<RiskRow>(
      `INSERT INTO risks (tenant_id, process, description, owner_department_id, status)
       VALUES ($1, $2, $3, $4, 'DRAFT')
       RETURNING *`,
      [input.tenantId, input.process, input.description, input.ownerDepartmentId ?? null],
    );
    const row = rows[0];
    if (!row) throw new Error("Insert into risks returned no row");
    return toDomain(row);
  }

  async update(tenantId: string, id: string, input: UpdateRiskInput): Promise<Risk> {
    const { rows } = await this.pool.query<RiskRow>(
      `UPDATE risks
       SET process = COALESCE($3, process),
           description = COALESCE($4, description),
           owner_department_id = COALESCE($5, owner_department_id),
           status = COALESCE($6, status),
           updated_at = now()
       WHERE tenant_id = $1 AND id = $2 AND deleted_at IS NULL
       RETURNING *`,
      [
        tenantId,
        id,
        input.process ?? null,
        input.description ?? null,
        input.ownerDepartmentId ?? null,
        input.status ?? null,
      ],
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
