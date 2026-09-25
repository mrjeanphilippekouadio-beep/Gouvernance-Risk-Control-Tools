import type { Pool } from "pg";
import type { AnomalyRepository } from "../../../domain/repositories/AnomalyRepository.js";
import type {
  Anomaly,
  AnomalySeverity,
  AnomalyStatus,
  CreateAnomalyInput,
} from "../../../domain/entities/Anomaly.js";
import { NotFoundError } from "../../../domain/errors/DomainErrors.js";

interface AnomalyRow {
  id: string;
  tenant_id: string;
  control_id: string | null;
  control_execution_id: string | null;
  risk_id: string | null;
  observed_at: Date;
  description: string;
  severity: AnomalySeverity;
  origin: string | null;
  detected_by: string;
  status: AnomalyStatus;
  associated_actions: string | null;
  closed_at: Date | null;
  closure_comment: string | null;
  created_at: Date;
  updated_at: Date;
}

function toDomain(row: AnomalyRow): Anomaly {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    controlId: row.control_id,
    controlExecutionId: row.control_execution_id,
    riskId: row.risk_id,
    observedAt: row.observed_at,
    description: row.description,
    severity: row.severity,
    origin: row.origin,
    detectedBy: row.detected_by,
    status: row.status,
    associatedActions: row.associated_actions,
    closedAt: row.closed_at,
    closureComment: row.closure_comment,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export class PostgresAnomalyRepository implements AnomalyRepository {
  constructor(private readonly pool: Pool) {}

  async getById(tenantId: string, id: string): Promise<Anomaly | null> {
    const { rows } = await this.pool.query<AnomalyRow>(
      `SELECT * FROM anomalies WHERE tenant_id = $1 AND id = $2`,
      [tenantId, id],
    );
    return rows[0] ? toDomain(rows[0]) : null;
  }

  async list(tenantId: string, options?: { status?: AnomalyStatus }): Promise<Anomaly[]> {
    const statusFilter = options?.status ? "AND status = $2" : "";
    const params = options?.status ? [tenantId, options.status] : [tenantId];
    const { rows } = await this.pool.query<AnomalyRow>(
      `SELECT * FROM anomalies WHERE tenant_id = $1 ${statusFilter} ORDER BY observed_at DESC`,
      params,
    );
    return rows.map(toDomain);
  }

  async create(input: CreateAnomalyInput): Promise<Anomaly> {
    const { rows } = await this.pool.query<AnomalyRow>(
      `INSERT INTO anomalies
         (tenant_id, control_id, control_execution_id, risk_id, description, severity, origin, detected_by, status)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'NEW')
       RETURNING *`,
      [
        input.tenantId,
        input.controlId ?? null,
        input.controlExecutionId ?? null,
        input.riskId ?? null,
        input.description,
        input.severity,
        input.origin ?? null,
        input.detectedBy,
      ],
    );
    const row = rows[0];
    if (!row) throw new Error("Insert into anomalies returned no row");
    return toDomain(row);
  }

  async updateStatus(
    tenantId: string,
    id: string,
    newStatus: AnomalyStatus,
    note: string | null,
  ): Promise<Anomaly> {
    const isClosing = newStatus === "CLOSED";
    const { rows } = await this.pool.query<AnomalyRow>(
      `UPDATE anomalies
       SET status = $3,
           updated_at = now(),
           closed_at = CASE WHEN $4 THEN now() ELSE closed_at END,
           closure_comment = CASE WHEN $4 THEN $5 ELSE closure_comment END,
           associated_actions = CASE
             WHEN $4 OR $5::text IS NULL THEN associated_actions
             ELSE COALESCE(associated_actions, '') || $6
           END
       WHERE tenant_id = $1 AND id = $2
       RETURNING *`,
      [tenantId, id, newStatus, isClosing, note, note ? `\n[${newStatus}] ${note}` : null],
    );
    const row = rows[0];
    if (!row) throw new NotFoundError("Anomaly", id);
    return toDomain(row);
  }
}
