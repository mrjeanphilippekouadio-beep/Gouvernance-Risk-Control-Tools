import { apiRequest } from "./client";
import type { Control } from "./controls";
import type { EffectivenessAssessment } from "./controlMonitoring";
import type { Risk } from "./risks";

export type EvaluationType = "AD_HOC" | "ANNUELLE" | "ANTICIPEE";
export type EvaluationStatus = "BROUILLON" | "VALIDATED" | "REJECTED" | "VALIDE_COMITE";

export interface ImpactAxis {
  code: string;
  label: string;
  order: number;
}

export interface ScaleLevel {
  level: number;
  label: string;
}

export interface RatingScale {
  id: string;
  name: string;
  version: string;
  status: "DRAFT" | "ACTIVE" | "ARCHIVED";
  probabilityLevels: number;
  probabilityLabels: ScaleLevel[] | null;
  impactLevels: number;
  impactLabels: ScaleLevel[] | null;
  criticalityThresholds?: { label: string; min: number; max: number }[] | null;
  impactAxes: { axes: ImpactAxis[]; retainedImpactRule: "MAX" | "AVERAGE" | "WEIGHTED_SUM" } | null;
  masteryScale: { levels: ScaleLevel[]; defenseLines: string[]; aggregation: "MIN"; thresholds: { label: string; min: number; max: number }[] | null } | null;
}

export interface MasteryLineScore {
  line: string;
  adequacy: number;
  execution: number;
  effectiveness: number;
}

export interface RiskEvaluation {
  id: string;
  riskId: string;
  evaluationType: EvaluationType;
  status: EvaluationStatus;
  evaluatorId: string;
  subCategory: string;
  entity: string | null;
  evaluationMode: "CLASSIQUE" | "PARTICIPATIF" | null;
  ratingScaleId: string | null;
  ratingScaleVersion: string | null;
  inherentProbability: number | null;
  inherentImpacts: { code: string; value: number }[] | null;
  inherentImpactRetained: number | null;
  inherentScore: number | null;
  masteryLines: MasteryLineScore[] | null;
  masteryGlobal: number | null;
  residualProbability: number | null;
  residualImpacts: { code: string; value: number }[] | null;
  residualImpactRetained: number | null;
  residualScore: number | null;
  residualJustification: string | null;
  appetiteThresholdSuggested: number | null;
  appetiteThresholdOverride: number | null;
  appetiteThresholdApplied: number | null;
  appetiteExceeded: boolean | null;
  validatedBy: string | null;
  validatedAt: string | null;
  /** Optional on validate, mandatory on reject (ACT-157). */
  comment: string | null;
  createdAt: string;
}

export interface CreateEvaluationInput {
  riskId: string;
  evaluationType: EvaluationType;
  subCategory: string;
  entity?: string | null;
}

/**
 * DIV-07, GET /:id/context — read-only composition: the controls actually
 * covering this evaluation's risk, and each one's last known effectiveness.
 * Never a computed mastery score — informs the human mastery judgement,
 * doesn't replace it (see backend RiskEvaluationViewService doc comment).
 */
export interface EvaluationContext {
  evaluation: RiskEvaluation;
  risk: Risk;
  coveringControls: { control: Control; lastEffectiveness: EffectivenessAssessment | null }[];
}

/** ACT-160, GET /:id/vs-appetite — residual score vs the applicable appetite threshold. */
export interface AppetiteComparison {
  residualScore: number;
  threshold: number | null;
  source: "OVERRIDE" | "AUTO" | "NONE";
  exceeded: boolean | null;
}

export const evaluationsApi = {
  listForRisk: (token: string, riskId: string) =>
    apiRequest<RiskEvaluation[]>(`/api/v1/risk-evaluations?riskId=${encodeURIComponent(riskId)}&limit=100`, { token }),
  get: (token: string, id: string) =>
    apiRequest<RiskEvaluation>(`/api/v1/risk-evaluations/${encodeURIComponent(id)}`, { token }),
  create: (token: string, input: CreateEvaluationInput) =>
    apiRequest<RiskEvaluation>("/api/v1/risk-evaluations", { method: "POST", body: input, token }),
  recordInherent: (token: string, id: string, probability: number, impacts: { code: string; value: number }[]) =>
    apiRequest<RiskEvaluation>(`/api/v1/risk-evaluations/${encodeURIComponent(id)}/inherent`, {
      method: "PATCH", body: { probability, impacts }, token,
    }),
  recordMastery: (token: string, id: string, lines: MasteryLineScore[]) =>
    apiRequest<RiskEvaluation>(`/api/v1/risk-evaluations/${encodeURIComponent(id)}/mastery`, {
      method: "PATCH", body: { lines }, token,
    }),
  recordResidual: (
    token: string, id: string, probability: number, impacts: { code: string; value: number }[],
    justification: string, appetiteOverride: number | null,
  ) => apiRequest<RiskEvaluation>(`/api/v1/risk-evaluations/${encodeURIComponent(id)}/residual`, {
    method: "PATCH", body: { probability, impacts, justification, appetiteOverride }, token,
  }),
  validate: (token: string, id: string, comment: string) =>
    apiRequest<RiskEvaluation>(`/api/v1/risk-evaluations/${encodeURIComponent(id)}/validate`, {
      method: "PATCH", body: { comment: comment || null }, token,
    }),
  reject: (token: string, id: string, comment: string) =>
    apiRequest<RiskEvaluation>(`/api/v1/risk-evaluations/${encodeURIComponent(id)}/reject`, {
      method: "PATCH", body: { comment }, token,
    }),
  // ACT-253: distinct maker-checker circuit from validate() — Comité des
  // Risques / Direction, gated server-side to Majeur/Critique residual
  // scores. The frontend never pre-computes that threshold (§8, two
  // independent Comité thresholds, both backend-configurable).
  validateByCommittee: (token: string, id: string, comment: string) =>
    apiRequest<RiskEvaluation>(`/api/v1/risk-evaluations/${encodeURIComponent(id)}/validate-committee`, {
      method: "PATCH", body: { comment: comment || null }, token,
    }),
  // DIV-07: read-only context — covering controls + their last effectiveness.
  getContext: (token: string, id: string) =>
    apiRequest<EvaluationContext>(`/api/v1/risk-evaluations/${encodeURIComponent(id)}/context`, { token }),
  // ACT-160: residual score vs the applicable appetite threshold.
  compareToAppetite: (token: string, id: string) =>
    apiRequest<AppetiteComparison>(`/api/v1/risk-evaluations/${encodeURIComponent(id)}/vs-appetite`, { token }),
};

export const ratingScalesApi = {
  list: (token: string, includeArchived = false) => apiRequest<RatingScale[]>(`/api/v1/rating-scales${includeArchived ? "?includeArchived=true" : ""}`, { token }),
  create: (token: string, input: { name: string; version: string; probabilityLevels: number; impactLevels: number }) =>
    apiRequest<RatingScale>("/api/v1/rating-scales", { method: "POST", body: input, token }),
  activate: (token: string, id: string) =>
    apiRequest<RatingScale>(`/api/v1/rating-scales/${encodeURIComponent(id)}/activate`, { method: "PATCH", token }),
};
