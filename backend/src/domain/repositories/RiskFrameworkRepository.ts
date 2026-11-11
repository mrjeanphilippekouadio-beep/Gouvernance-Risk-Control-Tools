import type {
  ArchiveFrameworkResult,
  AssignmentResult,
  CreateDefaultRequestInput,
  DefaultResult,
  CreateAssignmentRequestInput,
  BootstrapFacts,
  ChangeApprover,
  ChangeRequestStatus,
  DecisionRegime,
  RecordBootstrapDecisionInput,
  CreateActivationRequestInput,
  DecisionResult,
  FrameworkParams,
  RecordDecisionInput,
  RiskFramework,
  RiskFrameworkChangeRequest,
  RiskFrameworkVersion,
  TransactionalAudit,
  UpdateDraftParams,
} from "../entities/RiskFramework.js";

/**
 * Every method is tenant-scoped. There is no generic update and no delete: a version only
 * moves through the narrow methods below, and change requests are append-only (the only
 * mutation after creation is PENDING -> a decision, via recordDecision / withdraw).
 */
export interface RiskFrameworkRepository {
  /**
   * True when every mutating method below writes the `audit` events it receives inside its own transaction
   * (a failing audit write rolls the action back). When absent/false the caller records the audit itself afterwards.
   */
  readonly auditsInTransaction?: boolean;

  listFrameworks(tenantId: string): Promise<RiskFramework[]>;
  getFramework(tenantId: string, id: string): Promise<RiskFramework | null>;
  listVersions(tenantId: string, frameworkId: string): Promise<RiskFrameworkVersion[]>;
  getVersion(tenantId: string, frameworkId: string, versionId: string): Promise<RiskFrameworkVersion | null>;
  getActiveVersion(tenantId: string, frameworkId: string): Promise<RiskFrameworkVersion | null>;
  /** B-6b: a version by id alone (an evaluation stores only `risk_framework_version_id`). */
  getVersionById(tenantId: string, versionId: string): Promise<RiskFrameworkVersion | null>;
  /** B-6b: the tenant's non-archived Dispositif marked `is_default`, or null. */
  getDefaultFramework(tenantId: string): Promise<RiskFramework | null>;
  /** B-6b: `processes.risk_framework_id` (written by B-6c only); null = not attached. */
  getProcessFrameworkId(tenantId: string, processId: string): Promise<string | null>;

  /** One transaction: the identity and its version 1 in DRAFT. */
  createWithDraft(input: {
    tenantId: string;
    name: string;
    description: string | null;
    createdBy: string;
    params: FrameworkParams;
    audit?: TransactionalAudit<{ framework: RiskFramework; version: RiskFrameworkVersion }>;
  }): Promise<{ framework: RiskFramework; version: RiskFrameworkVersion }>;
  /** Identity only (name, description); only the provided keys are written. */
  updateIdentity(tenantId: string, id: string, fields: { name?: string; description?: string | null }, audit?: TransactionalAudit<RiskFramework>): Promise<RiskFramework>;

  /** Copies `sourceVersionId` into a new DRAFT (version_number = max + 1). */
  createDraftFrom(tenantId: string, frameworkId: string, sourceVersionId: string, createdBy: string, audit?: TransactionalAudit<RiskFrameworkVersion>): Promise<RiskFrameworkVersion>;
  /** DRAFT only (0 rows -> error). Only the provided keys are written. */
  updateDraft(tenantId: string, frameworkId: string, versionId: string, fields: UpdateDraftParams, editedBy: string, audit?: TransactionalAudit<RiskFrameworkVersion>): Promise<RiskFrameworkVersion>;
  /** DRAFT -> ARCHIVED (abandon). */
  discardDraft(tenantId: string, frameworkId: string, versionId: string, archivedBy: string, reason: string, audit?: TransactionalAudit<RiskFrameworkVersion>): Promise<RiskFrameworkVersion>;

  /** One transaction: version DRAFT -> PENDING_APPROVAL and the request row. */
  createActivationRequest(input: CreateActivationRequestInput): Promise<RiskFrameworkChangeRequest>;
  getRequest(tenantId: string, id: string): Promise<RiskFrameworkChangeRequest | null>;
  listRequests(tenantId: string, filter?: { status?: ChangeRequestStatus; regime?: DecisionRegime }): Promise<RiskFrameworkChangeRequest[]>;
  /**
   * One transaction. APPROVED: reserve the request (FOR UPDATE), version -> ACTIVE, previous ACTIVE ->
   * ARCHIVED, scale mirror, first default. REJECTED: version back to DRAFT.
   */
  recordDecision(tenantId: string, requestId: string, decision: RecordDecisionInput, audit?: TransactionalAudit<DecisionResult>): Promise<DecisionResult>;
  /** B-6d, non-locking read for messages only (the decision never relies on it). `requesterId` = would-be decider. */
  getBootstrapFacts?(tenantId: string, requesterId: string): Promise<BootstrapFacts>;
  /**
   * B-6d (spec §5.6 point 9), one transaction: lock the tenant row, reserve the request (FOR UPDATE), read the
   * facts, call `validateLocked(facts)` (a throw aborts), then the approval steps of recordDecision with
   * regime BOOTSTRAP. Optional on the interface (fakes); the service fails closed without it.
   */
  recordBootstrapDecision?(
    tenantId: string,
    requestId: string,
    decision: RecordBootstrapDecisionInput,
    validateLocked: (facts: BootstrapFacts) => Promise<void> | void,
    audit?: TransactionalAudit<DecisionResult>,
  ): Promise<DecisionResult>;
  /** B-6d (q77): the latest BOOTSTRAP decision of the tenant, or null (arrival notices). */
  latestBootstrapRequest?(tenantId: string): Promise<RiskFrameworkChangeRequest | null>;
  /**
   * B-6c (q89), one transaction. Locks the Dispositif of arrival (not archived, has an ACTIVE version) and the process
   * (PROCESS level, not already attached to it, no other PENDING assignment), inserts the ASSIGN_PROCESS request.
   * Optional on the interface (fakes); the service fails closed without it.
   */
  createAssignmentRequest?(input: CreateAssignmentRequestInput): Promise<RiskFrameworkChangeRequest>;
  /**
   * B-6c, one transaction. Reserves the PENDING ASSIGN_PROCESS request (FOR UPDATE) and records the decision;
   * APPROVED also writes `processes.risk_framework_id` (effect on the evaluations created from then on only).
   * `approverRule` is the `changeApprover` the service used to authorise the decider: the ACTIVE version of the
   * Dispositif of arrival is re-read under lock and a different rule is a ConflictError (replay the decision).
   * `soleRiskManager` (q252 A, regime SOLE_RM): the requester decides their own request; under the tenant lock the
   * repository requires the requester to be the only active Risk Manager (409 otherwise: a third party must decide).
   */
  decideAssignment?(tenantId: string, requestId: string, decision: RecordDecisionInput & { approverRule: ChangeApprover; soleRiskManager?: boolean }, audit?: TransactionalAudit<AssignmentResult>): Promise<AssignmentResult>;
  /** B-6c: true when a PENDING ASSIGN_PROCESS request targets this process (ProcessService.archive refuses then). Optional (fakes). */
  hasPendingAssignment?(tenantId: string, processId: string): Promise<boolean>;
  /** B-6c: requester's retraction of a PENDING ASSIGN_PROCESS request (nothing written on the process). Optional (fakes). */
  withdrawAssignment?(tenantId: string, requestId: string, comment: string | null, audit?: TransactionalAudit<AssignmentResult>): Promise<AssignmentResult>;
  /**
   * B-13 (spec 11.1), one transaction. Locks the Dispositif (not archived, has an ACTIVE version, not already the
   * default, no other PENDING SET_DEFAULT for it) and inserts the SET_DEFAULT request. Optional on the interface (fakes).
   */
  createDefaultRequest?(input: CreateDefaultRequestInput): Promise<RiskFrameworkChangeRequest>;
  /**
   * B-13, one transaction. Reserves the PENDING SET_DEFAULT request (FOR UPDATE) and records the decision; APPROVED also
   * moves `is_default` from the current default to the target (effect on the evaluations created from then on only).
   * `approverRule`: same replay contract as decideAssignment.
   */
  decideDefault?(tenantId: string, requestId: string, decision: RecordDecisionInput & { approverRule: ChangeApprover }, audit?: TransactionalAudit<DefaultResult>): Promise<DefaultResult>;
  /** B-13: requester's retraction of a PENDING SET_DEFAULT request. Optional (fakes). */
  withdrawDefault?(tenantId: string, requestId: string, comment: string | null, audit?: TransactionalAudit<DefaultResult>): Promise<DefaultResult>;
  /**
   * B-13, one transaction. Archives an open Dispositif that is not the default, with no live process attached and no
   * PENDING request: its DRAFT and ACTIVE versions go ARCHIVED, the scale mirror follows. Optional (fakes).
   */
  archiveFramework?(tenantId: string, id: string, archivedBy: string, reason: string, audit?: TransactionalAudit<ArchiveFrameworkResult>): Promise<ArchiveFrameworkResult>;
  /** Requester's own retraction; version back to DRAFT. The service checks who may call it. */
  withdraw(tenantId: string, requestId: string, comment: string | null, audit?: TransactionalAudit<DecisionResult>): Promise<DecisionResult>;
}
