export type ControlType = "PREVENTIVE" | "DETECTIVE" | "CORRECTIVE";
export type ControlStatus = "DRAFT" | "ACTIVE" | "ARCHIVED";

/**
 * Definition only — mirrors apps-script-legacy R03_MATRICE_CONTROLES.
 * Execution and effectiveness are separate entities (ControlExecution,
 * not yet ported), same separation the legacy sheet already had.
 */
export interface Control {
  id: string;
  tenantId: string;
  label: string;
  objective: string | null;
  coveredRiskIds: string[];
  process: string | null;
  /**
   * DIV-05 (.claude/agent-context/ACTION_ITEMS.md, @architect audit
   * 2026-09-29): real FK to `processes`, added alongside the free-text
   * `process` field above — not replacing it. Nullable, never
   * backfilled: `process` free text doesn't reliably match an existing
   * `processes.name`, so a migration would have to guess. Left null
   * until a caller explicitly links a control to a real Process row.
   */
  processId: string | null;
  departmentId: string | null;
  procedureDescription: string | null;
  controlType: ControlType;
  nature: string | null;
  defenseLine: string | null;
  frequency: string;
  executor: string;
  validator: string | null;
  expectedEvidence: string | null;
  complianceCriteria: string;
  status: ControlStatus;
  createdAt: Date;
  updatedAt: Date;
  deletedAt: Date | null;
  deletedBy: string | null;
  deletionReason: string | null;
}

export interface CreateControlInput {
  tenantId: string;
  label: string;
  objective?: string | null;
  coveredRiskIds: string[];
  process?: string | null;
  processId?: string | null;
  departmentId?: string | null;
  procedureDescription?: string | null;
  controlType: ControlType;
  nature?: string | null;
  defenseLine?: string | null;
  frequency: string;
  executor: string;
  validator?: string | null;
  expectedEvidence?: string | null;
  complianceCriteria: string;
}

export interface UpdateControlInput {
  label?: string;
  objective?: string | null;
  coveredRiskIds?: string[];
  process?: string | null;
  processId?: string | null;
  departmentId?: string | null;
  procedureDescription?: string | null;
  controlType?: ControlType;
  nature?: string | null;
  defenseLine?: string | null;
  frequency?: string;
  executor?: string;
  validator?: string | null;
  expectedEvidence?: string | null;
  complianceCriteria?: string;
  status?: ControlStatus;
}
