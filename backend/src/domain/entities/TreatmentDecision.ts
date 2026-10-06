/**
 * TreatmentDecision (RISK_MANAGEMENT_V1_FINAL_DECISIONS.md §8/§12, Lot B):
 * the treatment option chosen for a Risk, rattachée à l'évaluation qui l'a
 * déclenchée. Append-only in the same sense as RiskEscalation/
 * ProcessEvaluationModeRequest — the only in-place mutation is the single
 * terminal transition (PROPOSEE -> CONFIRMEE/INVALIDEE/VALIDEE_COMITE); a
 * retry after invalidation is simply a new row, never a rewrite (OD-3).
 *
 * OD-1: can only be created against a RiskEvaluation already in an
 * AUTHORITATIVE_EVALUATION_STATUSES status (RiskEvaluation.ts) — that
 * evaluation is therefore already immutable, which is why no score/
 * threshold is snapshotted here, just a plain FK (riskEvaluationId).
 *
 * OD-2: `validatorId` is a snapshot of `Risk.superiorOwnerId` taken at
 * proposal time (TreatmentDecisionService.create) — never re-derived from
 * `Risk` when read later, exactly like RiskEscalation.superiorOwnerId.
 */

export const TREATMENT_OPTIONS = ["ACCEPTER", "SURVEILLER", "REDUIRE", "TRANSFERER", "EVITER"] as const;
export type TreatmentOption = (typeof TREATMENT_OPTIONS)[number];

export type TreatmentDecisionStatus = "PROPOSEE" | "CONFIRMEE" | "INVALIDEE" | "VALIDEE_COMITE";

export interface TreatmentDecision {
  id: string;
  tenantId: string;
  riskEvaluationId: string;
  /** Denormalized from the parent evaluation, resolved server-side — never client-supplied. */
  riskId: string;
  option: TreatmentOption;
  justification: string;
  status: TreatmentDecisionStatus;
  /** Snapshot of Risk.superiorOwnerId at proposal time — see file header. */
  validatorId: string;
  /** Never client-supplied — always actor.userId (see TreatmentDecisionService.create). */
  decidedBy: string;
  validatedBy: string | null;
  validatedAt: Date | null;
  /** Optional on confirm, mandatory on invalidate. */
  comment: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface CreateTreatmentDecisionInput {
  tenantId: string;
  riskEvaluationId: string;
  riskId: string;
  option: TreatmentOption;
  justification: string;
  validatorId: string;
  decidedBy: string;
}

export interface ListTreatmentDecisionsOptions {
  status?: TreatmentDecisionStatus;
}
