import { apiRequest, type GovernanceConfirmation, type ValidationIndependence } from "./client";
import type { EvaluationMode, Process } from "./processes";

export type EvaluationModeRequestStatus = "PENDING_VALIDATION" | "VALIDATED" | "REJECTED";

/** Mirrors backend `ProcessEvaluationModeRequest` (dates as ISO strings) + q142 `validationIndependence`. */
export interface EvaluationModeRequest {
  id: string;
  processId: string;
  requestedMode: EvaluationMode;
  status: EvaluationModeRequestStatus;
  requestedBy: string;
  requestedAt: string;
  validatedBy: string | null;
  validatedAt: string | null;
  rejectionReason: string | null;
  validationIndependence?: ValidationIndependence;
}

const BASE = "/api/v1/process-evaluation-mode-requests";

export const evaluationModeRequestsApi = {
  /** The route requires a processId: there is no tenant-wide list. */
  listForProcess: (token: string, processId: string) => apiRequest<EvaluationModeRequest[]>(`${BASE}?processId=${encodeURIComponent(processId)}`, { token }),
  propose: (token: string, processId: string, requestedMode: EvaluationMode) =>
    apiRequest<EvaluationModeRequest>(BASE, { method: "POST", body: { processId, requestedMode }, token }),
  /** Answers with the updated Process. A 409 GOVERNANCE_CONFIRMATION_REQUIRED is handled by `useGovernanceConfirm`. */
  validate: (token: string, id: string, governanceConfirmation?: GovernanceConfirmation) =>
    apiRequest<Process>(`${BASE}/${encodeURIComponent(id)}/validate`, { method: "POST", body: { governanceConfirmation }, token }),
  reject: (token: string, id: string, reason: string) =>
    apiRequest<EvaluationModeRequest>(`${BASE}/${encodeURIComponent(id)}/reject`, { method: "POST", body: { reason }, token }),
};
