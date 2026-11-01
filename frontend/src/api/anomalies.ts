import type { RiskVisibility } from "./risks";
import { apiRequest } from "./client";

export type AnomalySeverity = "LOW" | "MODERATE" | "HIGH" | "MAJOR" | "CRITICAL";
export type AnomalyStatus = "NEW" | "UNDER_ANALYSIS" | "ACTION_IN_PROGRESS" | "CLOSED";

export interface Anomaly {
  /** Lot V2: absent on an older server = CLIENT. */
  visibility?: RiskVisibility;
  id: string;
  controlId: string | null;
  controlExecutionId: string | null;
  riskId: string | null;
  observedAt: string;
  description: string;
  severity: AnomalySeverity;
  origin: string | null;
  detectedBy: string;
  status: AnomalyStatus;
  associatedActions: string | null;
  closedAt: string | null;
  closureComment: string | null;
  createdAt: string;
  updatedAt: string;
}

/** No `detectedBy`: the backend forces it to the authenticated user. */
export interface CreateAnomalyInput {
  controlId?: string | null;
  controlExecutionId?: string | null;
  riskId?: string | null;
  description: string;
  severity: AnomalySeverity;
  origin?: string | null;
}

export const anomaliesApi = {
  list: (token: string, status?: AnomalyStatus) =>
    apiRequest<Anomaly[]>(`/api/v1/anomalies${status ? `?status=${encodeURIComponent(status)}` : ""}`, { token }),
  get: (token: string, id: string) => apiRequest<Anomaly>(`/api/v1/anomalies/${encodeURIComponent(id)}`, { token }),
  create: (token: string, input: CreateAnomalyInput) =>
    apiRequest<Anomaly>("/api/v1/anomalies", { method: "POST", body: input, token }),
  updateStatus: (token: string, id: string, status: AnomalyStatus, comment?: string | null) =>
    apiRequest<Anomaly>(`/api/v1/anomalies/${encodeURIComponent(id)}/status`, { method: "PATCH", body: { status, comment: comment ?? null }, token }),
};
