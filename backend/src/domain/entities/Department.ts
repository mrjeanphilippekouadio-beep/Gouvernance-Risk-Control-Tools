/**
 * Mirrors apps-script-legacy R_DEPARTEMENTS (06_Departements.gs):
 * updated-in-place (not historized, unlike Risk/ControlExecution).
 * manager/riskOwner are free-text (name or email) — the legacy sheet
 * never constrained them to a system user, and neither does this.
 */
export interface Department {
  id: string;
  tenantId: string;
  name: string;
  entity: string | null;
  manager: string;
  riskOwner: string;
  riskOwnerDesignatedBy: string | null;
  riskOwnerDesignatedAt: Date | null;
  linkedProcesses: string | null;
  active: boolean;
  createdAt: Date;
  updatedAt: Date;
  deletedAt: Date | null;
  deletedBy: string | null;
  deletionReason: string | null;
}

export interface CreateDepartmentInput {
  tenantId: string;
  name: string;
  entity?: string | null;
  manager: string;
  /** If omitted, the manager becomes the risk owner by default (legacy rule). */
  riskOwner?: string | null;
  riskOwnerDesignatedBy?: string | null;
  linkedProcesses?: string | null;
  active?: boolean;
}

export interface UpdateDepartmentInput {
  name?: string;
  entity?: string | null;
  manager?: string;
  riskOwner?: string | null;
  riskOwnerDesignatedBy?: string | null;
  linkedProcesses?: string | null;
  active?: boolean;
}
