/**
 * RiskEvaluation (ACT-150 to ACT-160): periodic scoring of a Risk.
 * Append-only, like ControlExecution / ControlEffectivenessAssessment —
 * a new row per occurrence. Unlike those two (one mutation method after
 * creation), an evaluation is progressively filled in by several narrow
 * setters (inherent scoring, mastery/control assessment, residual
 * scoring) while status stays BROUILLON, then finalized exactly once via
 * validate or reject. Once VALIDATED or REJECTED it is immutable — a
 * later re-evaluation is a new row, never an edit to a finalized one.
 *
 * Design decision (documented for the orchestrator, not guessed
 * silently): the current Risk entity (backend/src/domain/entities/Risk.ts)
 * does not carry a sub-category or entity field, but RiskAppetite
 * thresholds are keyed on exactly those two (subCategory, entity —
 * see RiskAppetite.ts). apps-script-legacy/10_Evaluation.gs resolves this
 * the same way: `fiche.sousCategorie` / `fiche.entite` are captured as
 * part of the evaluation form data itself (a per-row snapshot), not read
 * from a separate canonical risk record — the legacy RISQUES sheet is
 * denormalized, one row per evaluation, carrying the descriptive "fiche"
 * fields alongside the scores. This module follows that same shape:
 * subCategory/entity are captured on RiskEvaluation at creation (ACT-150)
 * rather than invented as new fields on Risk (out of this module's
 * scope — Risk is owned/shipped already). If a canonical
 * Risk.subCategory/Risk.entity is ever added, ACT-150 could default from
 * it instead of requiring the caller to repeat it; that's an
 * Architecture (A05) call, not made here.
 */

import type { EvaluationMode } from "./Config.js";

export type RiskEvaluationType = "AD_HOC" | "ANNUELLE" | "ANTICIPEE";

/** ACT-253: VALIDE_COMITE is a distinct terminal status from VALIDATED — reachable only via RiskEvaluationService.validateByCommittee, never via validate(). */
export type RiskEvaluationStatus = "BROUILLON" | "VALIDATED" | "REJECTED" | "VALIDE_COMITE";

/** One impact axis score, keyed by the RatingScale.impactAxes code it answers. */
export interface ImpactAxisScore {
  code: string;
  value: number;
}

/** adequacy/execution/effectiveness, each 1..3, for one line of defense (L1/L2/L3). */
export interface MasteryLineScore {
  line: string;
  adequacy: number;
  execution: number;
  effectiveness: number;
}

export interface RiskEvaluation {
  id: string;
  tenantId: string;
  riskId: string;
  evaluationType: RiskEvaluationType;
  status: RiskEvaluationStatus;
  evaluatorId: string;

  /** Snapshot at creation time — see file header for why these live here rather than on Risk. */
  subCategory: string;
  entity: string | null;

  /**
   * DIV-06 wiring (ACTION_ITEMS.md, 2026-09-30): the Classique/Participatif
   * mode resolved once, at creation time only, via
   * `resolveInheritedEvaluationMode` (Process.ts) walking up from
   * `Risk.processId` and falling back to `Config.evaluationMode` — never
   * recomputed by a later setter, same immutable-snapshot treatment as
   * `subCategory`/`entity` above. Null only for evaluations created before
   * this field existed (034_risk_evaluations_evaluation_mode.sql,
   * Expand-only, not backfilled — see that migration's header for why).
   * Every evaluation created from that migration onward always has a
   * non-null value here.
   */
  evaluationMode: EvaluationMode | null;

  /** The active RatingScale used for this evaluation's scoring, captured at inherent-scoring time (ACT-151) so a later methodology change never retroactively alters a finalized evaluation. */
  ratingScaleId: string | null;
  ratingScaleVersion: string | null;

  inherentProbability: number | null;
  inherentImpacts: ImpactAxisScore[] | null;
  /** MAX (or config rule) of inherentImpacts — server-computed, never client-supplied (ACT-154). */
  inherentImpactRetained: number | null;
  /** probability x inherentImpactRetained — server-computed, never client-supplied (ACT-154). */
  inherentScore: number | null;

  masteryLines: MasteryLineScore[] | null;
  /** Average across all adequacy/execution/effectiveness values (ACT-152: "maîtrise globale = moyenne") — server-computed. */
  masteryGlobal: number | null;

  /** Re-assessed by a human after mastery — never derived from inherent by formula (ACT-153). */
  residualProbability: number | null;
  residualImpacts: ImpactAxisScore[] | null;
  residualImpactRetained: number | null;
  /** probability x residualImpactRetained — server-computed, never client-supplied (ACT-154). */
  residualScore: number | null;
  residualJustification: string | null;

  /** RiskAppetite.threshold auto-resolved for (subCategory, entity) at residual-scoring time (ACT-155). */
  appetiteThresholdSuggested: number | null;
  /** Evaluator override, stored verbatim — never blocked (ACT-155: "AUTO_AVEC_SURCHARGE_MANUELLE"). */
  appetiteThresholdOverride: number | null;
  /** override ?? suggested — the value actually used for the vs-appetite comparison (ACT-160). */
  appetiteThresholdApplied: number | null;
  /** residualScore > appetiteThresholdApplied, or null if no threshold applies. */
  appetiteExceeded: boolean | null;

  validatedBy: string | null;
  validatedAt: Date | null;
  /** Optional on validate, mandatory on reject (ACT-157). */
  comment: string | null;

  createdAt: Date;
  updatedAt: Date;
}

export interface CreateRiskEvaluationInput {
  tenantId: string;
  riskId: string;
  evaluationType: RiskEvaluationType;
  /** Never client-supplied — always actor.userId (see RiskEvaluationService.create). */
  evaluatorId: string;
  subCategory: string;
  entity?: string | null;
  /** Never client-supplied — always resolved server-side by RiskEvaluationService.create (see RiskEvaluation.evaluationMode's doc comment). */
  evaluationMode: EvaluationMode;
}

export interface RecordInherentScoringInput {
  ratingScaleId: string;
  ratingScaleVersion: string;
  probability: number;
  impacts: ImpactAxisScore[];
  impactRetained: number;
  score: number;
}

export interface RecordMasteryAssessmentInput {
  lines: MasteryLineScore[];
  masteryGlobal: number;
}

export interface RecordResidualScoringInput {
  probability: number;
  impacts: ImpactAxisScore[];
  impactRetained: number;
  score: number;
  justification: string;
  appetiteThresholdSuggested: number | null;
  appetiteThresholdOverride: number | null;
  appetiteThresholdApplied: number | null;
  appetiteExceeded: boolean | null;
}

export interface ListRiskEvaluationsOptions {
  status?: RiskEvaluationStatus;
  limit?: number;
  offset?: number;
}
