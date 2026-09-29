import type { Pool } from "pg";
import type { ProcessEvaluationModeRequestRepository } from "../../../domain/repositories/ProcessEvaluationModeRequestRepository.js";
import type {
  CreateProcessEvaluationModeRequestInput,
  ProcessEvaluationModeRequest,
  ProcessEvaluationModeRequestStatus,
} from "../../../domain/entities/ProcessEvaluationModeRequest.js";
import type { EvaluationMode } from "../../../domain/entities/Config.js";
import { NotFoundError, ValidationError } from "../../../domain/errors/DomainErrors.js";

interface ProcessEvaluationModeRequestRow {
  id: string;
  tenant_id: string;
  process_id: string;
  requested_mode: EvaluationMode;
  status: ProcessEvaluationModeRequestStatus;
  requested_by: string;
  requested_at: Date;
  validated_by: string | null;
  validated_at: Date | null;
  rejection_reason: string | null;
}

function toDomain(row: ProcessEvaluationModeRequestRow): ProcessEvaluationModeRequest {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    processId: row.process_id,
    requestedMode: row.requested_mode,
    status: row.status,
    requestedBy: row.requested_by,
    requestedAt: row.requested_at,
    validatedBy: row.validated_by,
    validatedAt: row.validated_at,
    rejectionReason: row.rejection_reason,
  };
}

/** True for a postgres unique_violation (23505) — see `process_evaluation_mode_requests_pending_unique_idx` in migration 031. */
function isUniqueViolation(err: unknown): boolean {
  return typeof err === "object" && err !== null && "code" in err && (err as { code?: unknown }).code === "23505";
}

export class PostgresProcessEvaluationModeRequestRepository implements ProcessEvaluationModeRequestRepository {
  constructor(private readonly pool: Pool) {}

  async getById(tenantId: string, id: string): Promise<ProcessEvaluationModeRequest | null> {
    const { rows } = await this.pool.query<ProcessEvaluationModeRequestRow>(
      `SELECT * FROM process_evaluation_mode_requests WHERE tenant_id = $1 AND id = $2`,
      [tenantId, id],
    );
    return rows[0] ? toDomain(rows[0]) : null;
  }

  async list(
    tenantId: string,
    options?: { processId?: string; status?: ProcessEvaluationModeRequestStatus },
  ): Promise<ProcessEvaluationModeRequest[]> {
    const conditions = ["tenant_id = $1"];
    const values: unknown[] = [tenantId];
    if (options?.processId) {
      values.push(options.processId);
      conditions.push(`process_id = $${values.length}`);
    }
    if (options?.status) {
      values.push(options.status);
      conditions.push(`status = $${values.length}`);
    }
    const { rows } = await this.pool.query<ProcessEvaluationModeRequestRow>(
      `SELECT * FROM process_evaluation_mode_requests WHERE ${conditions.join(" AND ")} ORDER BY requested_at DESC`,
      values,
    );
    return rows.map(toDomain);
  }

  async create(input: CreateProcessEvaluationModeRequestInput): Promise<ProcessEvaluationModeRequest> {
    try {
      const { rows } = await this.pool.query<ProcessEvaluationModeRequestRow>(
        `INSERT INTO process_evaluation_mode_requests (tenant_id, process_id, requested_mode, status, requested_by)
         VALUES ($1, $2, $3, 'PENDING_VALIDATION', $4)
         RETURNING *`,
        [input.tenantId, input.processId, input.requestedMode, input.requestedBy],
      );
      const row = rows[0];
      if (!row) throw new Error("Insert into process_evaluation_mode_requests returned no row");
      return toDomain(row);
    } catch (err) {
      // The partial unique index is the single source of truth for "at
      // most one PENDING_VALIDATION request per process" — a racy
      // pre-check in the service would only narrow, never close, the
      // race window. Map its violation to a clean, expected error.
      if (isUniqueViolation(err)) {
        throw new ValidationError(
          `A pending evaluation-mode request already exists for process ${input.processId} — it must be validated or rejected first`,
        );
      }
      throw err;
    }
  }

  async validate(tenantId: string, id: string, validatedBy: string): Promise<ProcessEvaluationModeRequest> {
    const { rows } = await this.pool.query<ProcessEvaluationModeRequestRow>(
      `UPDATE process_evaluation_mode_requests
       SET status = 'VALIDATED', validated_by = $3, validated_at = now()
       WHERE tenant_id = $1 AND id = $2 AND status = 'PENDING_VALIDATION'
       RETURNING *`,
      [tenantId, id, validatedBy],
    );
    const row = rows[0];
    if (!row) throw new NotFoundError("ProcessEvaluationModeRequest", id);
    return toDomain(row);
  }

  async reject(tenantId: string, id: string, validatedBy: string, reason: string): Promise<ProcessEvaluationModeRequest> {
    const { rows } = await this.pool.query<ProcessEvaluationModeRequestRow>(
      `UPDATE process_evaluation_mode_requests
       SET status = 'REJECTED', validated_by = $3, validated_at = now(), rejection_reason = $4
       WHERE tenant_id = $1 AND id = $2 AND status = 'PENDING_VALIDATION'
       RETURNING *`,
      [tenantId, id, validatedBy, reason],
    );
    const row = rows[0];
    if (!row) throw new NotFoundError("ProcessEvaluationModeRequest", id);
    return toDomain(row);
  }
}
