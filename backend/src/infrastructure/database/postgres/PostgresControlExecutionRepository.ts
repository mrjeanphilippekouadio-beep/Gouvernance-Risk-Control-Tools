import type { Pool } from "pg";
import type { ControlExecutionRepository } from "../../../domain/repositories/ControlExecutionRepository.js";
import type {
  ControlExecution,
  CreateControlExecutionInput,
  ExecutionStatus,
} from "../../../domain/entities/ControlExecution.js";
import { NotFoundError, ValidationError } from "../../../domain/errors/DomainErrors.js";

interface ExecutionRow {
  id: string;
  tenant_id: string;
  control_id: string;
  planned_date: Date | null;
  completed_date: Date | null;
  executed_by: string;
  result: string | null;
  observed_anomalies: string | null;
  justification_if_not_done: string | null;
  status: ExecutionStatus;
  validated_by: string | null;
  validated_at: Date | null;
  created_at: Date;
}

function toDomain(row: ExecutionRow): ControlExecution {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    controlId: row.control_id,
    plannedDate: row.planned_date,
    completedDate: row.completed_date,
    executedBy: row.executed_by,
    result: row.result,
    observedAnomalies: row.observed_anomalies,
    justificationIfNotDone: row.justification_if_not_done,
    status: row.status,
    validatedBy: row.validated_by,
    validatedAt: row.validated_at,
    createdAt: row.created_at,
  };
}

export class PostgresControlExecutionRepository implements ControlExecutionRepository {
  constructor(private readonly pool: Pool) {}

  async getById(tenantId: string, id: string): Promise<ControlExecution | null> {
    const { rows } = await this.pool.query<ExecutionRow>(
      `SELECT * FROM control_executions WHERE tenant_id = $1 AND id = $2`,
      [tenantId, id],
    );
    return rows[0] ? toDomain(rows[0]) : null;
  }

  async listForControl(tenantId: string, controlId: string): Promise<ControlExecution[]> {
    const { rows } = await this.pool.query<ExecutionRow>(
      `SELECT * FROM control_executions
       WHERE tenant_id = $1 AND control_id = $2
       ORDER BY created_at DESC`,
      [tenantId, controlId],
    );
    return rows.map(toDomain);
  }

  async create(input: CreateControlExecutionInput): Promise<ControlExecution> {
    const { rows } = await this.pool.query<ExecutionRow>(
      `INSERT INTO control_executions
         (tenant_id, control_id, planned_date, completed_date, executed_by,
          result, observed_anomalies, justification_if_not_done, status)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       RETURNING *`,
      [
        input.tenantId,
        input.controlId,
        input.plannedDate ?? null,
        input.completedDate ?? null,
        input.executedBy,
        input.result ?? null,
        input.observedAnomalies ?? null,
        input.justificationIfNotDone ?? null,
        input.status,
      ],
    );
    const row = rows[0];
    if (!row) throw new Error("Insert into control_executions returned no row");
    return toDomain(row);
  }

  async recordValidation(
    tenantId: string,
    id: string,
    validatedBy: string,
    appendToResult: string | null,
  ): Promise<ControlExecution> {
    const { rows } = await this.pool.query<ExecutionRow>(
      `UPDATE control_executions
       SET validated_by = $3,
           validated_at = now(),
           result = CASE WHEN $4::text IS NULL THEN result ELSE COALESCE(result, '') || $4 END
       WHERE tenant_id = $1 AND id = $2 AND validated_at IS NULL
       RETURNING *`,
      [tenantId, id, validatedBy, appendToResult ? `\n[Validation] ${appendToResult}` : null],
    );
    const row = rows[0];
    if (!row) {
      // Either the execution doesn't exist in this tenant, or it was
      // already validated (the WHERE clause excludes that case) — the
      // service checks existence first, so this path means a race with
      // another validation.
      const existing = await this.getById(tenantId, id);
      if (!existing) throw new NotFoundError("ControlExecution", id);
      throw new ValidationError("This execution has already been validated");
    }
    return toDomain(row);
  }
}
