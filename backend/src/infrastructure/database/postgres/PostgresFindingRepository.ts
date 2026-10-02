import type { Pool } from "pg";
import type { FindingRepository } from "../../../domain/repositories/FindingRepository.js";
import type {
  CreateFindingInput,
  Finding,
  FindingListFilters,
  FindingRelatedObjectType,
  FindingSeverity,
  FindingStatus,
} from "../../../domain/entities/Finding.js";
import { NotFoundError, ValidationError } from "../../../domain/errors/DomainErrors.js";

interface FindingRow {
  id: string;
  tenant_id: string;
  audit_mission_id: string;
  title: string;
  description: string;
  severity: FindingSeverity;
  recommendation: string | null;
  related_object_type: FindingRelatedObjectType | null;
  related_object_id: string | null;
  status: FindingStatus;
  raised_by: string;
  closed_by: string | null;
  closed_at: Date | null;
  closure_comment: string | null;
  created_at: Date;
  updated_at: Date;
}

function toDomain(row: FindingRow): Finding {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    auditMissionId: row.audit_mission_id,
    title: row.title,
    description: row.description,
    severity: row.severity,
    recommendation: row.recommendation,
    relatedObjectType: row.related_object_type,
    relatedObjectId: row.related_object_id,
    status: row.status,
    raisedBy: row.raised_by,
    closedBy: row.closed_by,
    closedAt: row.closed_at,
    closureComment: row.closure_comment,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export class PostgresFindingRepository implements FindingRepository {
  constructor(private readonly pool: Pool) {}

  async getById(tenantId: string, id: string): Promise<Finding | null> {
    const { rows } = await this.pool.query<FindingRow>(
      `SELECT * FROM findings WHERE tenant_id = $1 AND id = $2`,
      [tenantId, id],
    );
    return rows[0] ? toDomain(rows[0]) : null;
  }

  async list(tenantId: string, filters?: FindingListFilters): Promise<Finding[]> {
    const conditions: string[] = ["tenant_id = $1"];
    const params: unknown[] = [tenantId];

    if (filters?.auditMissionId) {
      params.push(filters.auditMissionId);
      conditions.push(`audit_mission_id = $${params.length}`);
    }
    if (filters?.status) {
      params.push(filters.status);
      conditions.push(`status = $${params.length}`);
    }
    if (filters?.severity) {
      params.push(filters.severity);
      conditions.push(`severity = $${params.length}`);
    }

    const { rows } = await this.pool.query<FindingRow>(
      `SELECT * FROM findings WHERE ${conditions.join(" AND ")} ORDER BY created_at DESC`,
      params,
    );
    return rows.map(toDomain);
  }

  async create(input: CreateFindingInput): Promise<Finding> {
    const { rows } = await this.pool.query<FindingRow>(
      `INSERT INTO findings
         (tenant_id, audit_mission_id, title, description, severity, recommendation, related_object_type, related_object_id, raised_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       RETURNING *`,
      [
        input.tenantId,
        input.auditMissionId,
        input.title,
        input.description,
        input.severity,
        input.recommendation ?? null,
        input.relatedObjectType ?? null,
        input.relatedObjectId ?? null,
        input.raisedBy,
      ],
    );
    const row = rows[0];
    if (!row) throw new Error("Insert into findings returned no row");
    return toDomain(row);
  }

  async updateStatus(tenantId: string, id: string, status: "EN_TRAITEMENT"): Promise<Finding> {
    const { rows } = await this.pool.query<FindingRow>(
      `UPDATE findings
       SET status = $3, updated_at = now()
       WHERE tenant_id = $1 AND id = $2 AND status = 'OUVERT'
       RETURNING *`,
      [tenantId, id, status],
    );
    const row = rows[0];

    if (!row) {
      const existing = await this.getById(tenantId, id);
      if (!existing) throw new NotFoundError("Finding", id);
      throw new ValidationError("Finding status must be OUVERT to start treatment");
    }

    return toDomain(row);
  }

  async close(tenantId: string, id: string, closedBy: string, comment: string): Promise<Finding> {
    const { rows } = await this.pool.query<FindingRow>(
      `UPDATE findings
       SET status = 'CLOS', closed_by = $3, closed_at = now(), closure_comment = $4, updated_at = now()
       WHERE tenant_id = $1 AND id = $2 AND status = 'EN_TRAITEMENT'
       RETURNING *`,
      [tenantId, id, closedBy, comment],
    );
    const row = rows[0];

    if (!row) {
      const existing = await this.getById(tenantId, id);
      if (!existing) throw new NotFoundError("Finding", id);
      throw new ValidationError("Finding status must be EN_TRAITEMENT to close");
    }

    return toDomain(row);
  }
}
