import type { Visibility } from "../visibility.js";

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
  /**
   * DECISION-100/102 (lot V1): who may read the risk and what inherits from it. Set at creation, then only through
   * `RiskService.setVisibility` (never the generic `update()`). Optional for test fakes built before V1: absent = CLIENT.
   */
  visibility?: Visibility;
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
  /** Lot V1: defaults to CLIENT. A restricted level is checked by the service (the creator must still see the risk). */
  visibility?: Visibility;
  /** Lot V1 (q192): the list of named people, written with the risk in one transaction. Never the creator (q194). */
  accessUserIds?: string[];
  /** Set by the service from `actor.userId`, never by the client: author of the initial access grants. */
  grantedBy?: string;
}

/** Lot V1 (q194): a visibility change after creation — level and list, with its mandatory reason. */
export interface RiskVisibilityChange {
  visibility: Visibility;
  addUserIds: string[];
  revokeUserIds: string[];
  reason: string;
  /** Forced to `actor.userId` by the service. */
  changedBy: string;
}

export interface RiskVisibilityState {
  visibility: Visibility;
  accessUserIds: string[];
  /**
   * q205: names of the named people, for the risk's readers only (PRIV-REV-Q205-001: being named on a risk is visible to
   * those who see it). Filled by the service on reads; a missing account has a null name.
   */
  accessUsers?: Array<{ id: string; displayName: string | null }>;
}

export interface UpdateRiskInput {
  process?: string;
  description?: string;
  ownerDepartmentId?: string | null;
  status?: RiskStatus;
  processId?: string | null;
  /** Lot V1 (SEC V1-02): mandatory when the department or process of a restricted risk changes. Never stored on the risk. */
  reason?: string;
}
