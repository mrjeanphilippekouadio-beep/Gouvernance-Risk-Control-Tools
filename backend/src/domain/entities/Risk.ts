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
  /**
   * DIV-05 (.claude/agent-context/ACTION_ITEMS.md, @architect audit
   * 2026-09-29): real FK to `processes`, added alongside the free-text
   * `process` field above — not replacing it. Nullable, never
   * backfilled: `process` free text doesn't reliably match an existing
   * `processes.name`, so a migration would have to guess. Left null
   * until a caller explicitly links a risk to a real Process row.
   */
  processId: string | null;
  description: string;
  ownerDepartmentId: string | null;
  /**
   * ACT-120/121: individual Risk Owner (a `User`, unlike
   * Department.riskOwner which is free-text — see that entity's doc
   * comment for why the two are deliberately different shapes). Never
   * set via the generic `update()` — only through
   * `RiskService.assignOwner`, which validates the target is an active
   * user in the tenant and always audits the change.
   */
  ownerId: string | null;
  /**
   * ACT-122: the owner's N+1 for escalation purposes (ACT-125). Set only
   * through `RiskService.assignSuperiorOwner`. `regles_critiques`
   * "hiérarchie owner < superior_owner" is enforced as: a superior owner
   * can never be the same person as the owner — see assignOwner/
   * assignSuperiorOwner in RiskService for the bidirectional check.
   */
  superiorOwnerId: string | null;
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
  processId?: string | null;
}

export interface UpdateRiskInput {
  process?: string;
  description?: string;
  ownerDepartmentId?: string | null;
  status?: RiskStatus;
  processId?: string | null;
}
