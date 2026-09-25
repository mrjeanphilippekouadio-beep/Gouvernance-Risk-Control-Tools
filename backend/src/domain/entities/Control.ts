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
