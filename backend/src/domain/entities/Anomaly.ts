export type AnomalySeverity = "LOW" | "MODERATE" | "HIGH" | "MAJOR" | "CRITICAL";
export type AnomalyStatus = "NEW" | "UNDER_ANALYSIS" | "ACTION_IN_PROGRESS" | "CLOSED";

/**
 * Unlike ControlExecution/ControlEffectivenessAssessment, an anomaly is
 * a ticket with a lifecycle on the same row, not an append-only log —
 * see apps-script-legacy/14_Anomalies.gs.
 */
export interface Anomaly {
  id: string;
  tenantId: string;
  controlId: string | null;
  controlExecutionId: string | null;
  riskId: string | null;
  observedAt: Date;
  description: string;
  severity: AnomalySeverity;
  origin: string | null;
  detectedBy: string;
  status: AnomalyStatus;
  associatedActions: string | null;
  closedAt: Date | null;
  closureComment: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface CreateAnomalyInput {
  tenantId: string;
  controlId?: string | null;
  controlExecutionId?: string | null;
  riskId?: string | null;
  description: string;
  severity: AnomalySeverity;
  origin?: string | null;
  detectedBy: string;
}
