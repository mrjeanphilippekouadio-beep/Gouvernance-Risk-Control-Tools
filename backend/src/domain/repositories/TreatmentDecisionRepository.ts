import type {
  CreateTreatmentDecisionInput,
  ListTreatmentDecisionsOptions,
  TreatmentDecision,
} from "../entities/TreatmentDecision.js";

/**
 * Narrow, append-only — no generic update(), no delete(). Matches
 * RiskEvaluationRepository's recordX pattern: each terminal transition has
 * its own method, never a general setter.
 */
export interface TreatmentDecisionRepository {
  getById(tenantId: string, id: string): Promise<TreatmentDecision | null>;
  /** 0..1 — a RiskEvaluation has at most one TreatmentDecision proposed against it. */
  getForEvaluation(tenantId: string, riskEvaluationId: string): Promise<TreatmentDecision | null>;
  /** Most recent first — full history for a risk across its evaluation cycles. */
  listForRisk(tenantId: string, riskId: string, options?: ListTreatmentDecisionsOptions): Promise<TreatmentDecision[]>;
  create(input: CreateTreatmentDecisionInput): Promise<TreatmentDecision>;
  recordConfirmation(tenantId: string, id: string, validatedBy: string, comment: string | null): Promise<TreatmentDecision>;
  recordInvalidation(tenantId: string, id: string, validatedBy: string, comment: string): Promise<TreatmentDecision>;
  recordCommitteeValidation(tenantId: string, id: string, validatedBy: string, comment: string | null): Promise<TreatmentDecision>;
}
