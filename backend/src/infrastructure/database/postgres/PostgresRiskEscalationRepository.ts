import type { Pool } from "pg";
import type { RiskEscalationRepository } from "../../../domain/repositories/RiskEscalationRepository.js";
import type { CreateRiskEscalationInput, RiskEscalation } from "../../../domain/entities/RiskEscalation.js";

interface RiskEscalationRow {
  id: string;
  tenant_id: string;
  risk_id: string;
  escalated_by: string;
  superior_owner_id: string;
  reason: string;
  created_at: Date;
}

function toDomain(row: RiskEscalationRow): RiskEscalation {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    riskId: row.risk_id,
    escalatedBy: row.escalated_by,
    superiorOwnerId: row.superior_owner_id,
    reason: row.reason,
    createdAt: row.created_at,
  };
}

/** Append-only — no update/delete, see RiskEscalationRepository. */
export class PostgresRiskEscalationRepository implements RiskEscalationRepository {
  constructor(private readonly pool: Pool) {}

  async create(input: CreateRiskEscalationInput): Promise<RiskEscalation> {
    const { rows } = await this.pool.query<RiskEscalationRow>(
      `INSERT INTO risk_escalations (tenant_id, risk_id, escalated_by, superior_owner_id, reason)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING *`,
      [input.tenantId, input.riskId, input.escalatedBy, input.superiorOwnerId, input.reason],
    );
    const row = rows[0];
    if (!row) throw new Error("Insert into risk_escalations returned no row");
    return toDomain(row);
  }

  async listForRisk(tenantId: string, riskId: string): Promise<RiskEscalation[]> {
    const { rows } = await this.pool.query<RiskEscalationRow>(
      `SELECT * FROM risk_escalations
       WHERE tenant_id = $1 AND risk_id = $2
       ORDER BY created_at DESC`,
      [tenantId, riskId],
    );
    return rows.map(toDomain);
  }
}
