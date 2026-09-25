/**
 * A dated, versioned cotation of a Risk. Never overwritten — a new
 * assessment is inserted and becomes the latest version for its
 * effective period. This is what answers "what was the risk map on
 * 2025-12-31?" without reconstructing history.
 */
export interface RiskAssessment {
  id: string;
  tenantId: string;
  riskId: string;
  version: number;
  probability: number;
  impact: number;
  inherentScore: number;
  residualProbability: number | null;
  residualImpact: number | null;
  residualScore: number | null;
  scoringConfigVersion: string;
  effectiveFrom: Date;
  effectiveUntil: Date | null;
  createdBy: string;
  createdAt: Date;
}

export interface CreateRiskAssessmentInput {
  tenantId: string;
  riskId: string;
  probability: number;
  impact: number;
  residualProbability?: number | null;
  residualImpact?: number | null;
  scoringConfigVersion: string;
  effectiveFrom: Date;
  createdBy: string;
}
