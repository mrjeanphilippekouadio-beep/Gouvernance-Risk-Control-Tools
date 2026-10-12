import type { AuditEvent } from "./AuditEvent.js";
import type { EvaluationMode } from "./Config.js";

/**
 * B-6a: the Dispositif. A stable identity (`RiskFramework`) and immutable versions
 * (`RiskFrameworkVersion`); every change to the active methodology goes through a
 * `RiskFrameworkChangeRequest` (append-only, decided by a third party).
 * Spec: docs/architecture/RM-V1-B6-Dispositif-spec.md.
 */

export type RiskFrameworkVersionStatus = "DRAFT" | "PENDING_APPROVAL" | "ACTIVE" | "ARCHIVED";
export type ChangeApprover = "RISK_MANAGER" | "AUDIT" | "COMMITTEE" | "AUDIT_AND_COMMITTEE";
export type ApproverGroup = "RISK_MANAGER" | "AUDIT" | "COMMITTEE";

export interface RiskFramework {
  id: string;
  tenantId: string;
  name: string;
  description: string | null;
  isDefault: boolean;
  /** NULL = created by the migration (resumption draft). */
  createdBy: string | null;
  createdAt: Date;
  updatedAt: Date;
  archivedAt: Date | null;
  archivedBy: string | null;
  archiveReason: string | null;
}

/** One appetite threshold carried by a version (spec §2.2); no identity of its own. */
export interface AppetiteThresholdEntry {
  subCategory: string;
  subCategoryId: string | null;
  entity: string | null;
  threshold: number;
  description: string | null;
}

export type MasteryAuthoritativeSource = "RISK_TEAM" | "FIRST_LINE";
export type CommitteeVoteRule = "DEFAULT" | "A" | "B" | "C" | "CUSTOM";

/** B-6b (q91): contract §10 parameters carried by every version; defaults = the contract's implicit behaviour. */
export interface ContractParams {
  /** NULL until the author fills it in; required (and <= n x n) when activation is requested. Read by B-5. */
  lowCriticalityThreshold: number | null;
  /** true = allowed up to the "low" threshold, approved exception beyond; false = forbidden. Read by B-5. */
  riskOwnerExecutorCumulAllowed: boolean;
  /** The Delegate never validates their own execution: that is an invariant, not this parameter. Read by B-5. */
  delegateExecutorCumulAllowed: boolean;
  /** NULL = no ceiling set by the client (B-5 still requires an end date on each dated delegation). */
  delegationMaxDays: number | null;
  /** Read by B-2. */
  hybridPolicyEnabled: boolean;
  /** Read by B-1. */
  masteryAuthoritativeSource: MasteryAuthoritativeSource;
  /** Read by B-12; CUSTOM is refused until B-12 defines its shape. */
  committeeVoteRule: CommitteeVoteRule;
  committeeVoteCustom: Record<string, unknown> | null;
}

/** Contract §10 defaults (= the migration's column DEFAULTs). The "low" threshold has none: it is entered explicitly. */
export const DEFAULT_CONTRACT_PARAMS: ContractParams = {
  lowCriticalityThreshold: null,
  riskOwnerExecutorCumulAllowed: true,
  delegateExecutorCumulAllowed: true,
  delegationMaxDays: null,
  hybridPolicyEnabled: false,
  masteryAuthoritativeSource: "RISK_TEAM",
  committeeVoteRule: "DEFAULT",
  committeeVoteCustom: null,
};

/** The methodology parameters of a version (spec §2.2). */
export interface FrameworkParams extends ContractParams {
  ratingScaleId: string;
  defaultEvaluationMode: EvaluationMode;
  committeeEvaluationMinScore: number;
  committeeEvaluationEnforced: boolean;
  committeeTreatmentMinScore: number | null;
  appetiteThresholds: AppetiteThresholdEntry[];
  changeApprover: ChangeApprover;
  selfProposalAllowed: boolean;
}

/** What a draft may change. Deliberately has no `status`: an edit is never a transition. */
export type UpdateDraftParams = Partial<FrameworkParams>;

export interface RiskFrameworkVersion extends FrameworkParams {
  id: string;
  tenantId: string;
  frameworkId: string;
  versionNumber: number;
  status: RiskFrameworkVersionStatus;
  createdBy: string | null;
  lastEditedBy: string | null;
  createdAt: Date;
  updatedAt: Date;
  activatedAt: Date | null;
  activationRequestId: string | null;
  archivedAt: Date | null;
  archivedBy: string | null;
  archiveReason: string | null;
}

/**
 * B-6b-05 (A13 R4 ii): with FIRST_LINE the first line's entry of the Mastery is the one that counts, so the
 * Dispositif has reduced independence on the Mastery. Derived on read (no column), shown on every read of a version.
 */
export type WithMasteryIndependence<V> = V & { reducedMasteryIndependence: boolean };
export function withMasteryIndependence<V extends { masteryAuthoritativeSource: MasteryAuthoritativeSource }>(
  v: V,
): WithMasteryIndependence<V> {
  return { ...v, reducedMasteryIndependence: v.masteryAuthoritativeSource === "FIRST_LINE" };
}

export type ChangeRequestKind = "ACTIVATE_VERSION" | "ASSIGN_PROCESS" | "SET_DEFAULT";
export type ChangeRequestStatus = "PENDING" | "APPROVED" | "REJECTED" | "WITHDRAWN";
export type DecisionRegime = "NORMAL" | "FALLBACK" | "BOOTSTRAP";

export interface RiskFrameworkChangeRequest {
  id: string;
  tenantId: string;
  kind: ChangeRequestKind;
  frameworkId: string;
  versionId: string | null;
  processId: string | null;
  previousValue: unknown;
  reason: string;
  status: ChangeRequestStatus;
  requestedBy: string;
  createdAt: Date;
  decidedBy: string | null;
  decidedAt: Date | null;
  decisionComment: string | null;
  decisionRegime: DecisionRegime | null;
  deciderGroup: ApproverGroup | null;
  ratificationStatus: "PENDING" | null;
}

/** Everything the repository needs to open an activation request (requestedBy is set by the service). */
/** q90: built from the stored result; the repository inserts these audit_log rows in the SAME transaction as the action. */
export type TransactionalAudit<R> = (result: R) => Array<Omit<AuditEvent, "id" | "timestamp">>;

export interface CreateActivationRequestInput {
  tenantId: string;
  frameworkId: string;
  versionId: string;
  reason: string;
  requestedBy: string;
  previousValue: unknown;
  /** F-B6a-02: replayed by the repository on the version it has just locked (FOR UPDATE); a throw aborts. */
  validateLocked?: (version: RiskFrameworkVersion) => Promise<void>;
  audit?: TransactionalAudit<RiskFrameworkChangeRequest>;
}

export interface RecordDecisionInput {
  outcome: "APPROVED" | "REJECTED";
  decidedBy: string;
  comment: string | null;
  decisionRegime: DecisionRegime;
  deciderGroup: ApproverGroup;
  ratificationStatus: "PENDING" | null;
}

export interface DecisionResult {
  request: RiskFrameworkChangeRequest;
  version: RiskFrameworkVersion;
  /** The ACTIVE version replaced by this approval (null if none, or on a rejection). */
  previousActive: RiskFrameworkVersion | null;
}
