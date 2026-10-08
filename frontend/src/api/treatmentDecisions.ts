import { apiRequest } from "./client";

/**
 * Mirrors backend/src/domain/entities/TreatmentDecision.ts (Lot B) and
 * backend/src/api/v1/treatmentDecisions.routes.ts (Lot C audit). See
 * RISK_MANAGEMENT_V1_FINAL_DECISIONS.md §8/§12.
 */
export const TREATMENT_OPTIONS = ["ACCEPTER", "SURVEILLER", "REDUIRE", "TRANSFERER", "EVITER"] as const;
export type TreatmentOption = (typeof TREATMENT_OPTIONS)[number];

export type TreatmentDecisionStatus = "PROPOSEE" | "CONFIRMEE" | "INVALIDEE" | "VALIDEE_COMITE";

export interface TreatmentDecision {
  id: string;
  riskEvaluationId: string;
  riskId: string;
  option: TreatmentOption;
  justification: string;
  status: TreatmentDecisionStatus;
  /** Snapshot of Risk.superiorOwnerId at proposal time — never re-derived. */
  validatorId: string;
  decidedBy: string;
  validatedBy: string | null;
  validatedAt: string | null;
  /** Optional on confirm/committee, mandatory on invalidate. */
  comment: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface CreateTreatmentDecisionInput {
  riskEvaluationId: string;
  option: TreatmentOption;
  justification: string;
}

export const treatmentDecisionsApi = {
  // The real route is GET /?riskId= only — there is no GET /?riskEvaluationId=
  // and TreatmentDecisionService.getForEvaluation is not exposed by any route
  // (read backend/src/api/v1/treatmentDecisions.routes.ts before assuming
  // otherwise). A full history for one risk — across every evaluation cycle —
  // is the real, accessible contract; filtering by riskEvaluationId client-side
  // (see mostRecentForEvaluation/historyForEvaluation below) is how the 0..1
  // "decision for this evaluation" view is derived without inventing an
  // endpoint.
  listForRisk: (token: string, riskId: string) =>
    apiRequest<TreatmentDecision[]>(`/api/v1/treatment-decisions?riskId=${encodeURIComponent(riskId)}`, { token }),
  get: (token: string, id: string) =>
    apiRequest<TreatmentDecision>(`/api/v1/treatment-decisions/${encodeURIComponent(id)}`, { token }),
  create: (token: string, input: CreateTreatmentDecisionInput) =>
    apiRequest<TreatmentDecision>("/api/v1/treatment-decisions", { method: "POST", body: input, token }),
  confirm: (token: string, id: string, comment: string | null) =>
    apiRequest<TreatmentDecision>(`/api/v1/treatment-decisions/${encodeURIComponent(id)}/confirm`, {
      method: "PATCH", body: { comment }, token,
    }),
  invalidate: (token: string, id: string, comment: string) =>
    apiRequest<TreatmentDecision>(`/api/v1/treatment-decisions/${encodeURIComponent(id)}/invalidate`, {
      method: "PATCH", body: { comment }, token,
    }),
  validateByCommittee: (token: string, id: string, comment: string | null) =>
    apiRequest<TreatmentDecision>(`/api/v1/treatment-decisions/${encodeURIComponent(id)}/validate-committee`, {
      method: "PATCH", body: { comment }, token,
    }),
};

/**
 * Pure helpers over the real GET /?riskId= response — backend already
 * orders most-recent-first (created_at DESC, see
 * PostgresTreatmentDecisionRepository.listForRisk), so index 0 after
 * filtering by riskEvaluationId is the active/most recent decision for
 * that evaluation (OD-3: a retry after invalidation is a new row, never
 * a rewrite).
 */
export function decisionsForEvaluation(decisions: TreatmentDecision[], riskEvaluationId: string): TreatmentDecision[] {
  return decisions.filter((decision) => decision.riskEvaluationId === riskEvaluationId);
}
