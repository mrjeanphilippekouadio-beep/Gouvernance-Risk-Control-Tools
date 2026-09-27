import type { CreateRiskEscalationInput, RiskEscalation } from "../entities/RiskEscalation.js";

/**
 * Append-only, like AuditRepository — no update/delete exposed, matching
 * RiskEscalation's design (see that entity's doc comment).
 */
export interface RiskEscalationRepository {
  create(input: CreateRiskEscalationInput): Promise<RiskEscalation>;
  /** Most recent first — history for one risk. */
  listForRisk(tenantId: string, riskId: string): Promise<RiskEscalation[]>;
}
