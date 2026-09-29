import type { EvaluationMode } from "./Config.js";

/**
 * DECISION-006 (.claude/agent-context/ACTION_ITEMS.md, gouvernance,
 * 2026-09-29) — the Process-owner path of setting Classique/Participatif:
 * "propriétaire du processus sous réserve de validation par [un valideur
 * dédié]". Append-only in intent (see 031_process_evaluation_mode_requests.sql):
 * a row's only in-place mutation is its own terminal transition
 * (PENDING_VALIDATION -> VALIDATED/REJECTED); a later proposal always
 * creates a new row rather than reusing/overwriting one, so the full
 * history of proposals stays queryable.
 *
 * `Process.evaluationMode` (030_evaluation_mode.sql) is never a pending
 * proposal — it is exclusively the mode *in force*, written only when a
 * request here transitions to VALIDATED (or via the separate, direct
 * Risk-Manager path, `ProcessEvaluationModeRequestService.setMode` /
 * `ProcessService.setEvaluationMode`, which never touches this table).
 */
export type ProcessEvaluationModeRequestStatus = "PENDING_VALIDATION" | "VALIDATED" | "REJECTED";

export interface ProcessEvaluationModeRequest {
  id: string;
  tenantId: string;
  processId: string;
  requestedMode: EvaluationMode;
  status: ProcessEvaluationModeRequestStatus;
  requestedBy: string;
  requestedAt: Date;
  validatedBy: string | null;
  validatedAt: Date | null;
  rejectionReason: string | null;
}

export interface CreateProcessEvaluationModeRequestInput {
  tenantId: string;
  processId: string;
  requestedMode: EvaluationMode;
  requestedBy: string;
}

/**
 * One risk owned by a user, owned within the process under review.
 * DECISION-006 governance finding: risk ownership must be *visible and
 * audited* at validation time, never *authoritative* — this shape is
 * read-only display/audit data, never consulted by any permission check
 * in ProcessEvaluationModeRequestService.
 */
export interface RiskOwnerRef {
  riskId: string;
  ownerId: string;
}
