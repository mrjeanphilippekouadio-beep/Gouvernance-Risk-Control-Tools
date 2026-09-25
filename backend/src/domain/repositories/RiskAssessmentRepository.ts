import type { CreateRiskAssessmentInput, RiskAssessment } from "../entities/RiskAssessment.js";

export interface RiskAssessmentRepository {
  getLatest(tenantId: string, riskId: string): Promise<RiskAssessment | null>;
  getHistory(tenantId: string, riskId: string): Promise<RiskAssessment[]>;
  /** Effective-dated as of a given date — for "what was the map on 2025-12-31?" */
  getAsOf(tenantId: string, riskId: string, asOf: Date): Promise<RiskAssessment | null>;
  create(input: CreateRiskAssessmentInput): Promise<RiskAssessment>;
}
