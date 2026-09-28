/**
 * ReviewCycle (ACT-250/251/252): a cartography review campaign — distinct
 * from a single RiskEvaluation, this is the "campaign" wrapper (ADR-style
 * scoping doc calls it a review cycle) that Risk Owners are notified about
 * when it opens. Ticket-lifecycle pattern (same shape as Anomaly/ActionPlan):
 * one row, updated in place through narrow methods, never append-only.
 *
 * Two-step maker-checker on closure (ACT-252), distinct from
 * ActionPlanService.close()'s single-step creator!=closer check: a Risk
 * Manager proposes closure, then a different actor (Direction) validates
 * it — mirrors RiskEvaluationService's evaluator-fills / validator-finalizes
 * shape more than ActionPlan's single-call close.
 */

export type ReviewCycleType = "ANNUELLE" | "ANTICIPEE";

export type ReviewCycleStatus = "OUVERT" | "CLOTURE_PROPOSEE" | "CLOTUREE";

export interface ReviewCycle {
  id: string;
  tenantId: string;
  type: ReviewCycleType;
  title: string;
  /** Free-text description of what's in scope (a department, an entity, or "ALL") — no structured scope model exists yet. */
  scope: string | null;
  /** Mandatory for ANTICIPEE (ACT-251: incident, changement majeur, résultat audit); null for ANNUELLE. */
  reason: string | null;
  status: ReviewCycleStatus;
  createdBy: string;
  proposedClosureBy: string | null;
  proposedClosureAt: Date | null;
  proposedClosureComment: string | null;
  closedBy: string | null;
  closedAt: Date | null;
  closureComment: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface CreateReviewCycleInput {
  tenantId: string;
  type: ReviewCycleType;
  title: string;
  scope: string | null;
  reason: string | null;
  createdBy: string;
}

export interface ListReviewCyclesOptions {
  status?: ReviewCycleStatus;
  type?: ReviewCycleType;
}
