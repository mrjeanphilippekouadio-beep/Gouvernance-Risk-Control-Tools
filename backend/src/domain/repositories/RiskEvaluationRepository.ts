import type {
  CreateRiskEvaluationInput,
  ListRiskEvaluationsOptions,
  RecordInherentScoringInput,
  RecordMasteryAssessmentInput,
  RecordResidualScoringInput,
  RiskEvaluation,
} from "../entities/RiskEvaluation.js";

export interface RiskEvaluationRepository {
  getById(tenantId: string, id: string): Promise<RiskEvaluation | null>;
  /** ACT-159: full history for a risk, most recent first, paginated, optional status filter. */
  listForRisk(tenantId: string, riskId: string, options?: ListRiskEvaluationsOptions): Promise<RiskEvaluation[]>;
  create(input: CreateRiskEvaluationInput): Promise<RiskEvaluation>;

  /** ACT-151/ACT-154: the only way inherent scoring fields are ever written. */
  recordInherentScoring(tenantId: string, id: string, input: RecordInherentScoringInput): Promise<RiskEvaluation>;
  /** ACT-152: the only way mastery/control-assessment fields are ever written. */
  recordMasteryAssessment(tenantId: string, id: string, input: RecordMasteryAssessmentInput): Promise<RiskEvaluation>;
  /** ACT-153/ACT-154/ACT-155: the only way residual scoring + appetite fields are ever written. */
  recordResidualScoring(tenantId: string, id: string, input: RecordResidualScoringInput): Promise<RiskEvaluation>;

  /** ACT-156: terminal, maker-checker validation. */
  recordValidation(tenantId: string, id: string, validatedBy: string, comment: string | null): Promise<RiskEvaluation>;
  /** ACT-157: terminal, mandatory comment. */
  recordRejection(tenantId: string, id: string, validatedBy: string, comment: string): Promise<RiskEvaluation>;
  /** ACT-253: terminal, distinct from recordValidation — Comité des Risques / Direction validation for Majeur/Critique residual scores. */
  recordCommitteeValidation(tenantId: string, id: string, validatedBy: string, comment: string | null): Promise<RiskEvaluation>;

  /**
   * R-01: whether any evaluation in this tenant (any status — a BROUILLON
   * still needs its rating scale readable, not just finalized ones)
   * captured `ratingScaleId`. Used to refuse soft-deleting a rating scale
   * that is still referenced, so historical interpretability can never be
   * silently revoked.
   */
  existsForRatingScale(tenantId: string, ratingScaleId: string): Promise<boolean>;
}
