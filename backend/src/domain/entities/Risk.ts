export type RiskStatus = "DRAFT" | "ACTIVE" | "ARCHIVED";

/**
 * Core risk record. Scoring itself lives on RiskAssessment (versioned) —
 * a Risk never carries a mutable score directly, per ADR-001 §"Versionner
 * le modèle métier".
 */
export interface Risk {
  id: string;
  tenantId: string;
  process: string;
  description: string;
  ownerDepartmentId: string | null;
  status: RiskStatus;
  createdAt: Date;
  updatedAt: Date;
  deletedAt: Date | null;
  deletedBy: string | null;
  deletionReason: string | null;
}

export interface CreateRiskInput {
  tenantId: string;
  process: string;
  description: string;
  ownerDepartmentId?: string | null;
}

export interface UpdateRiskInput {
  process?: string;
  description?: string;
  ownerDepartmentId?: string | null;
  status?: RiskStatus;
}
