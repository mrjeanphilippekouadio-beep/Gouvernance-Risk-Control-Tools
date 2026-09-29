import type { Pool } from "pg";
import type { RaciAssignmentRepository } from "../../../domain/repositories/RaciAssignmentRepository.js";
import type { CreateRaciAssignmentInput, RaciAssignment, RaciEntityType, RaciRole } from "../../../domain/entities/RaciAssignment.js";
import { NotFoundError } from "../../../domain/errors/DomainErrors.js";

interface RaciAssignmentRow {
  id: string;
  tenant_id: string;
  entity_type: RaciEntityType;
  entity_id: string;
  user_id: string;
  role: RaciRole;
  created_by: string;
  created_at: Date;
  deleted_at: Date | null;
}

function toDomain(row: RaciAssignmentRow): RaciAssignment {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    entityType: row.entity_type,
    entityId: row.entity_id,
    userId: row.user_id,
    role: row.role,
    createdBy: row.created_by,
    createdAt: row.created_at,
    deletedAt: row.deleted_at,
  };
}

export class PostgresRaciAssignmentRepository implements RaciAssignmentRepository {
  constructor(private readonly pool: Pool) {}

  async create(input: CreateRaciAssignmentInput): Promise<RaciAssignment> {
    const { rows } = await this.pool.query<RaciAssignmentRow>(
      `INSERT INTO raci_assignments (tenant_id, entity_type, entity_id, user_id, role, created_by)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING *`,
      [input.tenantId, input.entityType, input.entityId, input.userId, input.role, input.createdBy],
    );
    const row = rows[0];
    if (!row) throw new Error("Insert into raci_assignments returned no row");
    return toDomain(row);
  }

  async getById(tenantId: string, id: string): Promise<RaciAssignment | null> {
    const { rows } = await this.pool.query<RaciAssignmentRow>(
      `SELECT * FROM raci_assignments WHERE tenant_id = $1 AND id = $2 AND deleted_at IS NULL`,
      [tenantId, id],
    );
    return rows[0] ? toDomain(rows[0]) : null;
  }

  async listForEntity(tenantId: string, entityType: RaciEntityType, entityId: string): Promise<RaciAssignment[]> {
    const { rows } = await this.pool.query<RaciAssignmentRow>(
      `SELECT * FROM raci_assignments
       WHERE tenant_id = $1 AND entity_type = $2 AND entity_id = $3 AND deleted_at IS NULL
       ORDER BY created_at ASC`,
      [tenantId, entityType, entityId],
    );
    return rows.map(toDomain);
  }

  async remove(tenantId: string, id: string): Promise<RaciAssignment> {
    const { rows } = await this.pool.query<RaciAssignmentRow>(
      `UPDATE raci_assignments
       SET deleted_at = now()
       WHERE tenant_id = $1 AND id = $2 AND deleted_at IS NULL
       RETURNING *`,
      [tenantId, id],
    );
    const row = rows[0];
    if (!row) throw new NotFoundError("RaciAssignment", id);
    return toDomain(row);
  }
}
