import type { Pool } from "pg";
import type { RiskEvaluationRepository } from "../../../domain/repositories/RiskEvaluationRepository.js";
import type {
  CreateRiskEvaluationInput,
  ImpactAxisScore,
  ListRiskEvaluationsOptions,
  MasteryLineScore,
  RecordInherentScoringInput,
  RecordMasteryAssessmentInput,
  RecordResidualScoringInput,
  RiskEvaluation,
} from "../../../domain/entities/RiskEvaluation.js";
import { NotFoundError } from "../../../domain/errors/DomainErrors.js";

interface RiskEvaluationRow {
  id: string;
  tenant_id: string;
  risk_id: string;
  evaluation_type: RiskEvaluation["evaluationType"];
  status: RiskEvaluation["status"];
  evaluator_id: string;
  sub_category: string;
  entity: string | null;
  rating_scale_id: string | null;
  rating_scale_version: string | null;
  inherent_probability: number | null;
  inherent_impacts: ImpactAxisScore[] | null;
  inherent_impact_retained: number | null;
  inherent_score: number | null;
  mastery_lines: MasteryLineScore[] | null;
  mastery_global: string | null;
  residual_probability: number | null;
  residual_impacts: ImpactAxisScore[] | null;
  residual_impact_retained: number | null;
  residual_score: number | null;
  residual_justification: string | null;
  appetite_threshold_suggested: number | null;
  appetite_threshold_override: number | null;
  appetite_threshold_applied: number | null;
  appetite_exceeded: boolean | null;
  validated_by: string | null;
  validated_at: Date | null;
  comment: string | null;
  created_at: Date;
  updated_at: Date;
}

function toDomain(row: RiskEvaluationRow): RiskEvaluation {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    riskId: row.risk_id,
    evaluationType: row.evaluation_type,
    status: row.status,
    evaluatorId: row.evaluator_id,
    subCategory: row.sub_category,
    entity: row.entity,
    ratingScaleId: row.rating_scale_id,
    ratingScaleVersion: row.rating_scale_version,
    inherentProbability: row.inherent_probability,
    inherentImpacts: row.inherent_impacts,
    inherentImpactRetained: row.inherent_impact_retained,
    inherentScore: row.inherent_score,
    masteryLines: row.mastery_lines,
    masteryGlobal: row.mastery_global === null ? null : Number(row.mastery_global),
    residualProbability: row.residual_probability,
    residualImpacts: row.residual_impacts,
    residualImpactRetained: row.residual_impact_retained,
    residualScore: row.residual_score,
    residualJustification: row.residual_justification,
    appetiteThresholdSuggested: row.appetite_threshold_suggested,
    appetiteThresholdOverride: row.appetite_threshold_override,
    appetiteThresholdApplied: row.appetite_threshold_applied,
    appetiteExceeded: row.appetite_exceeded,
    validatedBy: row.validated_by,
    validatedAt: row.validated_at,
    comment: row.comment,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export class PostgresRiskEvaluationRepository implements RiskEvaluationRepository {
  constructor(private readonly pool: Pool) {}

  async getById(tenantId: string, id: string): Promise<RiskEvaluation | null> {
    const { rows } = await this.pool.query<RiskEvaluationRow>(
      `SELECT * FROM risk_evaluations WHERE tenant_id = $1 AND id = $2`,
      [tenantId, id],
    );
    return rows[0] ? toDomain(rows[0]) : null;
  }

  async listForRisk(
    tenantId: string,
    riskId: string,
    options?: ListRiskEvaluationsOptions,
  ): Promise<RiskEvaluation[]> {
    const conditions = ["tenant_id = $1", "risk_id = $2"];
    const values: unknown[] = [tenantId, riskId];

    if (options?.status) {
      if (Array.isArray(options.status)) {
        values.push(options.status);
        conditions.push(`status = ANY($${values.length}::text[])`);
      } else {
        values.push(options.status);
        conditions.push(`status = $${values.length}`);
      }
    }

    const limit = options?.limit ?? 50;
    const offset = options?.offset ?? 0;
    values.push(limit);
    const limitIdx = values.length;
    values.push(offset);
    const offsetIdx = values.length;

    const { rows } = await this.pool.query<RiskEvaluationRow>(
      `SELECT * FROM risk_evaluations
       WHERE ${conditions.join(" AND ")}
       ORDER BY created_at DESC
       LIMIT $${limitIdx} OFFSET $${offsetIdx}`,
      values,
    );
    return rows.map(toDomain);
  }

  async create(input: CreateRiskEvaluationInput): Promise<RiskEvaluation> {
    const { rows } = await this.pool.query<RiskEvaluationRow>(
      `INSERT INTO risk_evaluations
         (tenant_id, risk_id, evaluation_type, status, evaluator_id, sub_category, entity)
       VALUES ($1, $2, $3, 'BROUILLON', $4, $5, $6)
       RETURNING *`,
      [input.tenantId, input.riskId, input.evaluationType, input.evaluatorId, input.subCategory, input.entity ?? null],
    );
    const row = rows[0];
    if (!row) throw new Error("Insert into risk_evaluations returned no row");
    return toDomain(row);
  }

  async recordInherentScoring(
    tenantId: string,
    id: string,
    input: RecordInherentScoringInput,
  ): Promise<RiskEvaluation> {
    const { rows } = await this.pool.query<RiskEvaluationRow>(
      `UPDATE risk_evaluations
       SET rating_scale_id = $3,
           rating_scale_version = $4,
           inherent_probability = $5,
           inherent_impacts = $6,
           inherent_impact_retained = $7,
           inherent_score = $8,
           updated_at = now()
       WHERE tenant_id = $1 AND id = $2
       RETURNING *`,
      [
        tenantId,
        id,
        input.ratingScaleId,
        input.ratingScaleVersion,
        input.probability,
        JSON.stringify(input.impacts),
        input.impactRetained,
        input.score,
      ],
    );
    const row = rows[0];
    if (!row) throw new NotFoundError("RiskEvaluation", id);
    return toDomain(row);
  }

  async recordMasteryAssessment(
    tenantId: string,
    id: string,
    input: RecordMasteryAssessmentInput,
  ): Promise<RiskEvaluation> {
    const { rows } = await this.pool.query<RiskEvaluationRow>(
      `UPDATE risk_evaluations
       SET mastery_lines = $3,
           mastery_global = $4,
           updated_at = now()
       WHERE tenant_id = $1 AND id = $2
       RETURNING *`,
      [tenantId, id, JSON.stringify(input.lines), input.masteryGlobal],
    );
    const row = rows[0];
    if (!row) throw new NotFoundError("RiskEvaluation", id);
    return toDomain(row);
  }

  async recordResidualScoring(
    tenantId: string,
    id: string,
    input: RecordResidualScoringInput,
  ): Promise<RiskEvaluation> {
    const { rows } = await this.pool.query<RiskEvaluationRow>(
      `UPDATE risk_evaluations
       SET residual_probability = $3,
           residual_impacts = $4,
           residual_impact_retained = $5,
           residual_score = $6,
           residual_justification = $7,
           appetite_threshold_suggested = $8,
           appetite_threshold_override = $9,
           appetite_threshold_applied = $10,
           appetite_exceeded = $11,
           updated_at = now()
       WHERE tenant_id = $1 AND id = $2
       RETURNING *`,
      [
        tenantId,
        id,
        input.probability,
        JSON.stringify(input.impacts),
        input.impactRetained,
        input.score,
        input.justification,
        input.appetiteThresholdSuggested,
        input.appetiteThresholdOverride,
        input.appetiteThresholdApplied,
        input.appetiteExceeded,
      ],
    );
    const row = rows[0];
    if (!row) throw new NotFoundError("RiskEvaluation", id);
    return toDomain(row);
  }

  async recordValidation(tenantId: string, id: string, validatedBy: string, comment: string | null): Promise<RiskEvaluation> {
    const { rows } = await this.pool.query<RiskEvaluationRow>(
      `UPDATE risk_evaluations
       SET status = 'VALIDATED', validated_by = $3, validated_at = now(), comment = $4, updated_at = now()
       WHERE tenant_id = $1 AND id = $2
       RETURNING *`,
      [tenantId, id, validatedBy, comment],
    );
    const row = rows[0];
    if (!row) throw new NotFoundError("RiskEvaluation", id);
    return toDomain(row);
  }

  async recordRejection(tenantId: string, id: string, validatedBy: string, comment: string): Promise<RiskEvaluation> {
    const { rows } = await this.pool.query<RiskEvaluationRow>(
      `UPDATE risk_evaluations
       SET status = 'REJECTED', validated_by = $3, validated_at = now(), comment = $4, updated_at = now()
       WHERE tenant_id = $1 AND id = $2
       RETURNING *`,
      [tenantId, id, validatedBy, comment],
    );
    const row = rows[0];
    if (!row) throw new NotFoundError("RiskEvaluation", id);
    return toDomain(row);
  }

  async recordCommitteeValidation(tenantId: string, id: string, validatedBy: string, comment: string | null): Promise<RiskEvaluation> {
    const { rows } = await this.pool.query<RiskEvaluationRow>(
      `UPDATE risk_evaluations
       SET status = 'VALIDE_COMITE', validated_by = $3, validated_at = now(), comment = $4, updated_at = now()
       WHERE tenant_id = $1 AND id = $2
       RETURNING *`,
      [tenantId, id, validatedBy, comment],
    );
    const row = rows[0];
    if (!row) throw new NotFoundError("RiskEvaluation", id);
    return toDomain(row);
  }
}
