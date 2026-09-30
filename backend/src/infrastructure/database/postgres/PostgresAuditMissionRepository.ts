import type { Pool } from "pg";
import type { AuditMissionRepository } from "../../../domain/repositories/AuditMissionRepository.js";
import type {
  AuditMission,
  AuditMissionListFilters,
  AuditMissionStatus,
  CreateAuditMissionInput,
} from "../../../domain/entities/AuditMission.js";
import { NotFoundError } from "../../../domain/errors/DomainErrors.js";

interface AuditMissionRow {
  id: string;
  tenant_id: string;
  reference: string;
  title: string;
  scope: string;
  status: AuditMissionStatus;
  lead_auditor_id: string;
  auditor_ids: string[];
  planned_start_date: Date;
  planned_end_date: Date;
  actual_start_date: Date | null;
  actual_end_date: Date | null;
  closure_comment: string | null;
  created_by: string;
  created_at: Date;
  updated_at: Date;
}

function toDomain(row: AuditMissionRow): AuditMission {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    reference: row.reference,
    title: row.title,
    scope: row.scope,
    status: row.status,
    leadAuditorId: row.lead_auditor_id,
    auditorIds: row.auditor_ids,
    plannedStartDate: row.planned_start_date,
    plannedEndDate: row.planned_end_date,
    actualStartDate: row.actual_start_date,
    actualEndDate: row.actual_end_date,
    closureComment: row.closure_comment,
    createdBy: row.created_by,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export class PostgresAuditMissionRepository implements AuditMissionRepository {
  constructor(private readonly pool: Pool) {}

  async getById(tenantId: string, id: string): Promise<AuditMission | null> {
    const { rows } = await this.pool.query<AuditMissionRow>(
      `SELECT * FROM audit_missions WHERE tenant_id = $1 AND id = $2`,
      [tenantId, id],
    );
    return rows[0] ? toDomain(rows[0]) : null;
  }

  async list(tenantId: string, filters?: AuditMissionListFilters): Promise<AuditMission[]> {
    const conditions: string[] = ["tenant_id = $1"];
    const params: unknown[] = [tenantId];

    if (filters?.status) {
      params.push(filters.status);
      conditions.push(`status = $${params.length}`);
    }
    if (filters?.leadAuditorId) {
      params.push(filters.leadAuditorId);
      conditions.push(`lead_auditor_id = $${params.length}`);
    }

    const { rows } = await this.pool.query<AuditMissionRow>(
      `SELECT * FROM audit_missions WHERE ${conditions.join(" AND ")} ORDER BY planned_start_date DESC`,
      params,
    );
    return rows.map(toDomain);
  }

  async create(input: CreateAuditMissionInput): Promise<AuditMission> {
    const { rows } = await this.pool.query<AuditMissionRow>(
      `INSERT INTO audit_missions
         (tenant_id, reference, title, scope, lead_auditor_id, auditor_ids, planned_start_date, planned_end_date, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       RETURNING *`,
      [
        input.tenantId,
        input.reference,
        input.title,
        input.scope,
        input.leadAuditorId,
        input.auditorIds ?? [],
        input.plannedStartDate,
        input.plannedEndDate,
        input.createdBy,
      ],
    );
    const row = rows[0];
    if (!row) throw new Error("Insert into audit_missions returned no row");
    return toDomain(row);
  }

  async start(tenantId: string, id: string): Promise<AuditMission> {
    const { rows } = await this.pool.query<AuditMissionRow>(
      `UPDATE audit_missions
       SET status = 'EN_COURS', actual_start_date = now(), updated_at = now()
       WHERE tenant_id = $1 AND id = $2
       RETURNING *`,
      [tenantId, id],
    );
    const row = rows[0];
    if (!row) throw new NotFoundError("AuditMission", id);
    return toDomain(row);
  }

  async close(tenantId: string, id: string, comment: string): Promise<AuditMission> {
    const { rows } = await this.pool.query<AuditMissionRow>(
      `UPDATE audit_missions
       SET status = 'CLOTUREE', actual_end_date = now(), closure_comment = $3, updated_at = now()
       WHERE tenant_id = $1 AND id = $2
       RETURNING *`,
      [tenantId, id, comment],
    );
    const row = rows[0];
    if (!row) throw new NotFoundError("AuditMission", id);
    return toDomain(row);
  }
}
