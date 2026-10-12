import type {
  ChangeRequestStatus,
  CreateActivationRequestInput,
  DecisionResult,
  FrameworkParams,
  RecordDecisionInput,
  RiskFramework,
  RiskFrameworkChangeRequest,
  RiskFrameworkVersion,
  UpdateDraftParams,
} from "../entities/RiskFramework.js";

/**
 * Every method is tenant-scoped. There is no generic update and no delete: a version only
 * moves through the narrow methods below, and change requests are append-only (the only
 * mutation after creation is PENDING -> a decision, via recordDecision / withdraw).
 */
export interface RiskFrameworkRepository {
  listFrameworks(tenantId: string): Promise<RiskFramework[]>;
  getFramework(tenantId: string, id: string): Promise<RiskFramework | null>;
  listVersions(tenantId: string, frameworkId: string): Promise<RiskFrameworkVersion[]>;
  getVersion(tenantId: string, frameworkId: string, versionId: string): Promise<RiskFrameworkVersion | null>;
  getActiveVersion(tenantId: string, frameworkId: string): Promise<RiskFrameworkVersion | null>;

  /** One transaction: the identity and its version 1 in DRAFT. */
  createWithDraft(input: {
    tenantId: string;
    name: string;
    description: string | null;
    createdBy: string;
    params: FrameworkParams;
  }): Promise<{ framework: RiskFramework; version: RiskFrameworkVersion }>;
  /** Identity only (name, description); only the provided keys are written. */
  updateIdentity(tenantId: string, id: string, fields: { name?: string; description?: string | null }): Promise<RiskFramework>;

  /** Copies `sourceVersionId` into a new DRAFT (version_number = max + 1). */
  createDraftFrom(tenantId: string, frameworkId: string, sourceVersionId: string, createdBy: string): Promise<RiskFrameworkVersion>;
  /** DRAFT only (0 rows -> error). Only the provided keys are written. */
  updateDraft(tenantId: string, frameworkId: string, versionId: string, fields: UpdateDraftParams, editedBy: string): Promise<RiskFrameworkVersion>;
  /** DRAFT -> ARCHIVED (abandon). */
  discardDraft(tenantId: string, frameworkId: string, versionId: string, archivedBy: string, reason: string): Promise<RiskFrameworkVersion>;

  /** One transaction: version DRAFT -> PENDING_APPROVAL and the request row. */
  createActivationRequest(input: CreateActivationRequestInput): Promise<RiskFrameworkChangeRequest>;
  getRequest(tenantId: string, id: string): Promise<RiskFrameworkChangeRequest | null>;
  listRequests(tenantId: string, filter?: { status?: ChangeRequestStatus }): Promise<RiskFrameworkChangeRequest[]>;
  /**
   * One transaction. APPROVED: reserve the request (FOR UPDATE), version -> ACTIVE, previous ACTIVE ->
   * ARCHIVED, scale mirror, first default. REJECTED: version back to DRAFT.
   */
  recordDecision(tenantId: string, requestId: string, decision: RecordDecisionInput): Promise<DecisionResult>;
  /** Requester's own retraction; version back to DRAFT. The service checks who may call it. */
  withdraw(tenantId: string, requestId: string, comment: string | null): Promise<DecisionResult>;
}
