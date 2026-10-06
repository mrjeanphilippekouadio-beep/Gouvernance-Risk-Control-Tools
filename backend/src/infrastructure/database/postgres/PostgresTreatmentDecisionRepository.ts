import type { Pool } from "pg";
import type { TreatmentDecisionRepository } from "../../../domain/repositories/TreatmentDecisionRepository.js";
import type {
  CreateTreatmentDecisionInput,
  ListTreatmentDecisionsOptions,
  TreatmentDecision,
} from "../../../domain/entities/TreatmentDecision.js";
import { NotFoundError } from "../../../domain/errors/DomainErrors.js";

interface TreatmentDecisionRow {
  id: string;
  tenant_id: string;
  risk_evaluation_id: string;
  risk_id: string;
  option: TreatmentDecision["option"];
  justification: string;
  status: TreatmentDecision["status"];
  validator_id: string;
  decided_by: string;
  validated_by: string | null;
  validated_at: Date | null;
  comment: string | null;
  created_at: Date;
  updated_at: Date;
}

function toDomain(row: TreatmentDecisionRow): TreatmentDecision {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    riskEvaluationId: row.risk_evaluation_id,
    riskId: row.risk_id,
    option: row.option,
    justification: row.justification,
    status: row.status,
    validatorId: row.validator_id,
    decidedBy: row.decided_by,
    validatedBy: row.validated_by,
    validatedAt: row.validated_at,
    comment: row.comment,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export class PostgresTreatmentDecisionRepository implements TreatmentDecisionRepository {
  constructor(private readonly pool: Pool) {}

  async getById(tenantId: string, id: string): Promise<TreatmentDecision | null> {
    const { rows } = await this.pool.query<TreatmentDecisionRow>(
      `SELECT * FROM treatment_decisions WHERE tenant_id = $1 AND id = $2`,
      [tenantId, id],
    );
    return rows[0] ? toDomain(rows[0]) : null;
  }

  async getForEvaluation(tenantId: string, riskEvaluationId: string): Promise<TreatmentDecision | null> {
    const { rows } = await this.pool.query<TreatmentDecisionRow>(
      `SELECT * FROM treatment_decisions WHERE tenant_id = $1 AND risk_evaluation_id = $2
       ORDER BY created_at DESC LIMIT 1`,
      [tenantId, riskEvaluationId],
    );
    return rows[0] ? toDomain(rows[0]) : null;
  }

  async listForRisk(
    tenantId: string,
    riskId: string,
    options?: ListTreatmentDecisionsOptions,
  ): Promise<TreatmentDecision[]> {
    const conditions = ["tenant_id = $1", "risk_id = $2"];
    const values: unknown[] = [tenantId, riskId];

    if (options?.status) {
      values.push(options.status);
      conditions.push(`status = $${values.length}`);
    }

    const { rows } = await this.pool.query<TreatmentDecisionRow>(
      `SELECT * FROM treatment_decisions
       WHERE ${conditions.join(" AND ")}
       ORDER BY created_at DESC`,
      values,
    );
    return rows.map(toDomain);
  }

  async create(input: CreateTreatmentDecisionInput): Promise<TreatmentDecision> {
    const { rows } = await this.pool.query<TreatmentDecisionRow>(
      `INSERT INTO treatment_decisions
         (tenant_id, risk_evaluation_id, risk_id, option, justification, status, validator_id, decided_by)
       VALUES ($1, $2, $3, $4, $5, 'PROPOSEE', $6, $7)
       RETURNING *`,
      [
        input.tenantId,
        input.riskEvaluationId,
        input.riskId,
        input.option,
        input.justification,
        input.validatorId,
        input.decidedBy,
      ],
    );
    const row = rows[0];
    if (!row) throw new Error("Insert into treatment_decisions returned no row");
    return toDomain(row);
  }

  async recordConfirmation(tenantId: string, id: string, validatedBy: string, comment: string | null): Promise<TreatmentDecision> {
    const { rows } = await this.pool.query<TreatmentDecisionRow>(
      `UPDATE treatment_decisions
       SET status = 'CONFIRMEE', validated_by = $3, validated_at = now(), comment = $4, updated_at = now()
       WHERE tenant_id = $1 AND id = $2
       RETURNING *`,
      [tenantId, id, validatedBy, comment],
    );
    const row = rows[0];
    if (!row) throw new NotFoundError("TreatmentDecision", id);
    return toDomain(row);
  }

  async recordInvalidation(tenantId: string, id: string, validatedBy: string, comment: string): Promise<TreatmentDecision> {
    const { rows } = await this.pool.query<TreatmentDecisionRow>(
      `UPDATE treatment_decisions
       SET status = 'INVALIDEE', validated_by = $3, validated_at = now(), comment = $4, updated_at = now()
       WHERE tenant_id = $1 AND id = $2
       RETURNING *`,
      [tenantId, id, validatedBy, comment],
    );
    const row = rows[0];
    if (!row) throw new NotFoundError("TreatmentDecision", id);
    return toDomain(row);
  }

  async recordCommitteeValidation(tenantId: string, id: string, validatedBy: string, comment: string | null): Promise<TreatmentDecision> {
    const { rows } = await this.pool.query<TreatmentDecisionRow>(
      `UPDATE treatment_decisions
       SET status = 'VALIDEE_COMITE', validated_by = $3, validated_at = now(), comment = $4, updated_at = now()
       WHERE tenant_id = $1 AND id = $2
       RETURNING *`,
      [tenantId, id, validatedBy, comment],
    );
    const row = rows[0];
    if (!row) throw new NotFoundError("TreatmentDecision", id);
    return toDomain(row);
  }
}
