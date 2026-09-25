import type { Pool } from "pg";
import type { ControlEffectivenessRepository } from "../../../domain/repositories/ControlEffectivenessRepository.js";
import type {
  ControlEffectivenessAssessment,
  CreateEffectivenessAssessmentInput,
  EffectivenessAssessmentStatus,
  EffectivenessRating,
  EffectivenessResult,
} from "../../../domain/entities/ControlEffectivenessAssessment.js";
import { NotFoundError, ValidationError } from "../../../domain/errors/DomainErrors.js";

interface AssessmentRow {
  id: string;
  tenant_id: string;
  control_id: string;
  eval_date: Date;
  eval_type: string | null;
  evaluated_by: string;
  design_adequacy: string | null;
  execution_quality: string | null;
  operational_effectiveness: EffectivenessRating;
  result: EffectivenessResult | null;
  limitations: string | null;
  compensating_controls: string | null;
  conclusion: string | null;
  justification: string;
  control_version_snapshot: string | null;
  status: EffectivenessAssessmentStatus;
  validated_by: string | null;
  validated_at: Date | null;
  created_at: Date;
}

function toDomain(row: AssessmentRow): ControlEffectivenessAssessment {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    controlId: row.control_id,
    evalDate: row.eval_date,
    evalType: row.eval_type,
    evaluatedBy: row.evaluated_by,
    designAdequacy: row.design_adequacy,
    executionQuality: row.execution_quality,
    operationalEffectiveness: row.operational_effectiveness,
    result: row.result,
    limitations: row.limitations,
    compensatingControls: row.compensating_controls,
    conclusion: row.conclusion,
    justification: row.justification,
    controlVersionSnapshot: row.control_version_snapshot,
    status: row.status,
    validatedBy: row.validated_by,
    validatedAt: row.validated_at,
    createdAt: row.created_at,
  };
}

export class PostgresControlEffectivenessRepository implements ControlEffectivenessRepository {
  constructor(private readonly pool: Pool) {}

  async getById(tenantId: string, id: string): Promise<ControlEffectivenessAssessment | null> {
    const { rows } = await this.pool.query<AssessmentRow>(
      `SELECT * FROM control_effectiveness_assessments WHERE tenant_id = $1 AND id = $2`,
      [tenantId, id],
    );
    return rows[0] ? toDomain(rows[0]) : null;
  }

  async listForControl(tenantId: string, controlId: string): Promise<ControlEffectivenessAssessment[]> {
    const { rows } = await this.pool.query<AssessmentRow>(
      `SELECT * FROM control_effectiveness_assessments
       WHERE tenant_id = $1 AND control_id = $2
       ORDER BY created_at DESC`,
      [tenantId, controlId],
    );
    return rows.map(toDomain);
  }

  async create(input: CreateEffectivenessAssessmentInput): Promise<ControlEffectivenessAssessment> {
    const { rows } = await this.pool.query<AssessmentRow>(
      `INSERT INTO control_effectiveness_assessments
         (tenant_id, control_id, eval_type, evaluated_by, design_adequacy, execution_quality,
          operational_effectiveness, result, limitations, compensating_controls, conclusion,
          justification, control_version_snapshot, status)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, COALESCE($14, 'COMPLETED'))
       RETURNING *`,
      [
        input.tenantId,
        input.controlId,
        input.evalType ?? null,
        input.evaluatedBy,
        input.designAdequacy ?? null,
        input.executionQuality ?? null,
        input.operationalEffectiveness,
        input.result ?? null,
        input.limitations ?? null,
        input.compensatingControls ?? null,
        input.conclusion ?? null,
        input.justification,
        input.controlVersionSnapshot ?? null,
        input.status ?? null,
      ],
    );
    const row = rows[0];
    if (!row) throw new Error("Insert into control_effectiveness_assessments returned no row");
    return toDomain(row);
  }

  async recordValidation(
    tenantId: string,
    id: string,
    validatedBy: string,
    appendToJustification: string | null,
  ): Promise<ControlEffectivenessAssessment> {
    const { rows } = await this.pool.query<AssessmentRow>(
      `UPDATE control_effectiveness_assessments
       SET validated_by = $3,
           validated_at = now(),
           justification = CASE WHEN $4::text IS NULL THEN justification ELSE justification || $4 END
       WHERE tenant_id = $1 AND id = $2 AND validated_at IS NULL
       RETURNING *`,
      [tenantId, id, validatedBy, appendToJustification ? `\n[Validation] ${appendToJustification}` : null],
    );
    const row = rows[0];
    if (!row) {
      const existing = await this.getById(tenantId, id);
      if (!existing) throw new NotFoundError("ControlEffectivenessAssessment", id);
      throw new ValidationError("This assessment has already been validated");
    }
    return toDomain(row);
  }
}
