import type { AuditRepository } from "../domain/repositories/AuditRepository.js";
import type { RatingScaleRepository } from "../domain/repositories/RatingScaleRepository.js";
import type { RiskCategoryRepository } from "../domain/repositories/RiskCategoryRepository.js";
import type { RiskFrameworkRepository } from "../domain/repositories/RiskFrameworkRepository.js";
import type { RoleRepository } from "../domain/repositories/RoleRepository.js";
import type { UserRepository } from "../domain/repositories/UserRepository.js";
import type { SystemGroup } from "../domain/entities/Role.js";
import type { AuditEvent } from "../domain/entities/AuditEvent.js";
import {
  DEFAULT_CONTRACT_PARAMS,
  type AppetiteThresholdEntry,
  ApproverGroup,
  type BootstrapDeclaration,
  type BootstrapJustification,
  type BootstrapFacts,
  type DecisionRegime,
  ChangeApprover,
  ChangeRequestStatus,
  FrameworkParams,
  DecisionResult,
  RiskFramework,
  RiskFrameworkChangeRequest,
  RiskFrameworkVersion,
  TransactionalAudit,
  UpdateDraftParams,
  withMasteryIndependence,
  type WithMasteryIndependence,
} from "../domain/entities/RiskFramework.js";
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from "../domain/errors/DomainErrors.js";
import { requirePermission } from "../domain/permissions.js";
import {
  BOOTSTRAP_ASKED_ADMIN_MAY_BE_SELF,
  bootstrapRefusal,
  bootstrapNoticeMessage,
  contractDefaultViolations,
  foldVoteBeforeB12,
  resolveDecider,
  type BootstrapContext,
  type BootstrapRefusal,
  type EligibleMembers,
  type FallbackCause,
} from "../domain/frameworkApproval.js";
import { ADMIN_PERMISSIONS } from "../domain/fixedGroupPermissions.js";
import { assertReadyToActivate } from "../domain/ratingScaleRules.js";
import { ABSOLUTE_MAX_SCORE, defaultCommitteeThreshold, maxScoreForScale } from "../domain/scoring.js";
import type { AuthenticatedUser } from "../infrastructure/identity/IdentityProvider.js";
import type { NotificationService } from "./NotificationService.js";
import type { RiskRepository } from "../domain/repositories/RiskRepository.js";
import type { ProcessRepository } from "../domain/repositories/ProcessRepository.js";
import { resolveApplicableVersion } from "./riskFrameworkResolution.js";

const MAX_NAME = 120;
const MAX_DESCRIPTION = 1000;
const MAX_REASON = 500;
const MAX_COMMENT = 1000;
const MAX_APPETITE_ENTRIES = 200;
const MAX_LABEL = 200;

const EVALUATION_MODES = ["CLASSIQUE", "PARTICIPATIF"];
const MASTERY_SOURCES = ["RISK_TEAM", "FIRST_LINE"];
const VOTE_RULES = ["DEFAULT", "A", "B", "C", "CUSTOM"];
/** Technical guard against abuse, not a business rule (the client fixes the real duration). */
const MAX_DELEGATION_DAYS = 3650;
const PARAM_KEYS = [
  "ratingScaleId", "defaultEvaluationMode", "committeeEvaluationMinScore", "committeeEvaluationEnforced",
  "committeeTreatmentMinScore", "appetiteThresholds", "changeApprover", "selfProposalAllowed",
  "lowCriticalityThreshold", "riskOwnerExecutorCumulAllowed", "delegateExecutorCumulAllowed", "delegationMaxDays",
  "hybridPolicyEnabled", "masteryAuthoritativeSource", "committeeVoteRule", "committeeVoteCustom",
];
const APPROVERS: ChangeApprover[] = ["RISK_MANAGER", "AUDIT", "COMMITTEE", "AUDIT_AND_COMMITTEE"];

const SYSTEM_GROUP_OF: Record<ApproverGroup, SystemGroup> = {
  RISK_MANAGER: "RISK_MANAGER",
  AUDIT: "AUDIT",
  COMMITTEE: "RISK_COMMITTEE",
};

export interface FrameworkSummary extends RiskFramework {
  activeVersion: { id: string; versionNumber: number; activatedAt: Date | null; ratingScaleId: string; reducedMasteryIndependence: boolean } | null;
}

export interface CreateRiskFrameworkInput {
  name: string;
  description?: string | null;
  ratingScaleId: string;
  params?: Partial<Omit<FrameworkParams, "ratingScaleId">>;
}

function cleanText(value: string | null | undefined, field: string, max: number, required: boolean): string | null {
  const v = value?.trim() ?? "";
  if (!v) {
    if (required) throw new ValidationError(`${field} is required`);
    return null;
  }
  if (v.length > max) throw new ValidationError(`${field} must be at most ${max} characters`);
  return v;
}

function assertScore(value: number, field: string): void {
  if (!Number.isInteger(value) || value < 1 || value > ABSOLUTE_MAX_SCORE) {
    throw new ValidationError(`${field} must be an integer between 1 and ${ABSOLUTE_MAX_SCORE}`);
  }
}

/** Shape + uniqueness of the appetite list (the ceiling n² is checked when activation is requested). */
function normalizeAppetite(entries: AppetiteThresholdEntry[]): AppetiteThresholdEntry[] {
  if (entries.length > MAX_APPETITE_ENTRIES) {
    throw new ValidationError(`appetiteThresholds cannot have more than ${MAX_APPETITE_ENTRIES} entries`);
  }
  const seen = new Set<string>();
  return entries.map((e) => {
    const subCategory = cleanText(e.subCategory, "appetite subCategory", MAX_LABEL, true)!;
    const entity = cleanText(e.entity, "appetite entity", MAX_LABEL, false);
    assertScore(e.threshold, `appetite threshold of "${subCategory}"`);
    const key = `${subCategory}\u0000${entity ?? ""}`;
    if (seen.has(key)) throw new ValidationError(`Duplicate appetite for "${subCategory}"${entity ? ` / ${entity}` : ""}`);
    seen.add(key);
    return {
      subCategory,
      subCategoryId: e.subCategoryId ?? null,
      entity,
      threshold: e.threshold,
      description: cleanText(e.description, "appetite description", MAX_DESCRIPTION, false),
    };
  });
}

/** q87 / C-B6a-02: a Committee/Audit vote does not exist before B-12; such a Dispositif could never change again. */
function assertApproverAllowed(approver: ChangeApprover): void {
  if (approver !== "RISK_MANAGER") {
    throw new ValidationError("Seul l'approbateur RISK_MANAGER est possible pour l'instant : le vote Comité/Audit sera disponible avec B-12");
  }
}

type AuditInput = Omit<AuditEvent, "id" | "timestamp">;

/** Validates (and normalizes) whichever parameters are present. */
function checkParams<T extends UpdateDraftParams>(input: T): T {
  // Whitelist: only the parameters of §2.2 survive, whatever the caller passed (never a `status`).
  const p = Object.fromEntries(Object.entries(input).filter(([k, v]) => PARAM_KEYS.includes(k) && v !== undefined)) as T;
  if (p.defaultEvaluationMode !== undefined && !EVALUATION_MODES.includes(p.defaultEvaluationMode)) {
    throw new ValidationError("defaultEvaluationMode must be CLASSIQUE or PARTICIPATIF");
  }
  if (p.changeApprover !== undefined && !APPROVERS.includes(p.changeApprover)) {
    throw new ValidationError(`changeApprover must be one of: ${APPROVERS.join(", ")}`);
  }
  if (p.changeApprover !== undefined) assertApproverAllowed(p.changeApprover);
  if (p.masteryAuthoritativeSource !== undefined && !MASTERY_SOURCES.includes(p.masteryAuthoritativeSource)) {
    throw new ValidationError(`masteryAuthoritativeSource must be one of: ${MASTERY_SOURCES.join(", ")}`);
  }
  if (p.committeeVoteRule !== undefined && !VOTE_RULES.includes(p.committeeVoteRule)) {
    throw new ValidationError(`committeeVoteRule must be one of: ${VOTE_RULES.join(", ")}`);
  }
  // Same principle as q87: a setting no code can apply yet is not accepted (B-12 defines the CUSTOM shape).
  if (p.committeeVoteRule === "CUSTOM" || (p.committeeVoteCustom !== undefined && p.committeeVoteCustom !== null)) {
    throw new ValidationError("La règle de vote personnalisée sera disponible avec B-12 (vote du Comité)");
  }
  if (p.lowCriticalityThreshold !== undefined && p.lowCriticalityThreshold !== null) assertScore(p.lowCriticalityThreshold, "lowCriticalityThreshold");
  if (p.delegationMaxDays !== undefined && p.delegationMaxDays !== null
      && (!Number.isInteger(p.delegationMaxDays) || p.delegationMaxDays < 1 || p.delegationMaxDays > MAX_DELEGATION_DAYS)) {
    throw new ValidationError(`delegationMaxDays must be an integer between 1 and ${MAX_DELEGATION_DAYS}`);
  }
  for (const flag of ["riskOwnerExecutorCumulAllowed", "delegateExecutorCumulAllowed", "hybridPolicyEnabled"] as const) {
    if (p[flag] !== undefined && typeof p[flag] !== "boolean") throw new ValidationError(`${flag} must be a boolean`);
  }
  if (p.committeeEvaluationMinScore !== undefined) assertScore(p.committeeEvaluationMinScore, "committeeEvaluationMinScore");
  if (p.committeeTreatmentMinScore !== undefined && p.committeeTreatmentMinScore !== null) {
    assertScore(p.committeeTreatmentMinScore, "committeeTreatmentMinScore");
  }
  return p.appetiteThresholds === undefined ? p : { ...p, appetiteThresholds: normalizeAppetite(p.appetiteThresholds) };
}

/**
 * B-6a (spec RM-V1-B6-Dispositif-spec.md): the Dispositif — identity, immutable versions, and the
 * change-request circuit that activates a version. Only a third party decides (maker-checker); before
 * B-12 a request that needs an Audit/Committee vote stays PENDING (409 on decide, fail-closed).
 * B-6b (resolution, evaluation snapshot, closing the concurrent writes) is NOT here.
 */
export class RiskFrameworkService {
  constructor(
    private readonly frameworks: RiskFrameworkRepository,
    private readonly ratingScales: Pick<RatingScaleRepository, "getById">,
    /** Fixed groups are roles with a `systemGroup`; members come from role assignments. */
    private readonly roles: Pick<RoleRepository, "list" | "listForUser" | "listAssignments" | "listActiveGrants">,
    private readonly users: Pick<UserRepository, "getById" | "listWithPermission">,
    private readonly audit: AuditRepository,
    /** Fail-closed: an appetite entry naming a subCategoryId is refused when this is not wired. */
    private readonly riskCategories?: Pick<RiskCategoryRepository, "getById">,
    /** Optional: notifications are best effort. */
    private readonly notifications?: Pick<NotificationService, "record"> & Partial<Pick<NotificationService, "emit">>,
    /** B-6b, GET /applicable: optional; without `risks` a riskId is refused, without `processes` the process chain is not walked. */
    private readonly risks?: Pick<RiskRepository, "getById">,
    private readonly processes?: Pick<ProcessRepository, "getById">,
  ) {}

  /** B-6b (spec §7), read-only: the ACTIVE version that applies to a risk (through its process) or to a process; null if none. */
  async getApplicable(actor: AuthenticatedUser, q: { riskId?: string; processId?: string }) {
    requirePermission(actor, "riskframework.read");
    let processId: string | null = q.processId ?? null;
    if (q.riskId) {
      requirePermission(actor, "risk.read"); // F-B6b-03: the existence of a risk must not be deducible without it
      if (!this.risks) throw new ValidationError("Risk lookup is not available");
      const risk = await this.risks.getById(actor.tenantId, q.riskId);
      if (!risk) throw new NotFoundError("Risk", q.riskId);
      processId = risk.processId ?? null;
    } else if (processId) {
      if (!this.processes || !(await this.processes.getById(actor.tenantId, processId))) throw new NotFoundError("Process", processId);
    }
    const found = await resolveApplicableVersion(
      { frameworks: this.frameworks, ratingScales: this.ratingScales, processes: this.processes },
      actor.tenantId,
      processId,
    );
    return found ? { frameworkId: found.frameworkId, version: withMasteryIndependence(found.version), ratingScaleId: found.scale.id } : null;
  }

  // -- reads ------------------------------------------------------------

  async list(actor: AuthenticatedUser): Promise<FrameworkSummary[]> {
    requirePermission(actor, "riskframework.read");
    const all = await this.frameworks.listFrameworks(actor.tenantId);
    return Promise.all(
      all.map(async (f) => {
        const a = await this.frameworks.getActiveVersion(actor.tenantId, f.id);
        return {
          ...f,
          activeVersion: a
            ? {
                id: a.id,
                versionNumber: a.versionNumber,
                activatedAt: a.activatedAt,
                ratingScaleId: a.ratingScaleId,
                reducedMasteryIndependence: a.masteryAuthoritativeSource === "FIRST_LINE",
              }
            : null,
        };
      }),
    );
  }

  async get(actor: AuthenticatedUser, id: string): Promise<RiskFramework & { versions: WithMasteryIndependence<RiskFrameworkVersion>[] }> {
    requirePermission(actor, "riskframework.read");
    const framework = await this.getFrameworkOrThrow(actor.tenantId, id);
    return { ...framework, versions: (await this.frameworks.listVersions(actor.tenantId, id)).map(withMasteryIndependence) };
  }

  async getVersion(actor: AuthenticatedUser, frameworkId: string, versionId: string): Promise<WithMasteryIndependence<RiskFrameworkVersion>> {
    requirePermission(actor, "riskframework.read");
    return withMasteryIndependence(await this.getVersionOrThrow(actor.tenantId, frameworkId, versionId));
  }

  /** `regime: "BOOTSTRAP"` is the consultation of the bootstrap decisions (q103), with their frozen free parameters. */
  async listRequests(actor: AuthenticatedUser, status?: ChangeRequestStatus, regime?: DecisionRegime): Promise<RiskFrameworkChangeRequest[]> {
    requirePermission(actor, "riskframework.read");
    return this.frameworks.listRequests(actor.tenantId, status || regime ? { ...(status ? { status } : {}), ...(regime ? { regime } : {}) } : undefined);
  }

  // -- identity and drafts ---------------------------------------------

  async create(actor: AuthenticatedUser, input: CreateRiskFrameworkInput, requestId: string) {
    requirePermission(actor, "riskframework.create");
    await this.assertRiskManager(actor);
    const name = cleanText(input.name, "name", MAX_NAME, true)!;
    const description = cleanText(input.description, "description", MAX_DESCRIPTION, false);
    const scale = await this.ratingScales.getById(actor.tenantId, input.ratingScaleId);
    if (!scale) throw new ValidationError(`Rating scale ${input.ratingScaleId} does not exist in this tenant`);

    const given = checkParams(await this.withResolvedAppetite(actor.tenantId, input.params ?? {}));
    const params: FrameworkParams = {
      ratingScaleId: scale.id,
      defaultEvaluationMode: given.defaultEvaluationMode ?? "CLASSIQUE",
      committeeEvaluationMinScore: given.committeeEvaluationMinScore ?? defaultCommitteeThreshold(maxScoreForScale(scale)),
      committeeEvaluationEnforced: given.committeeEvaluationEnforced ?? true,
      committeeTreatmentMinScore: given.committeeTreatmentMinScore ?? null,
      appetiteThresholds: given.appetiteThresholds ?? [],
      changeApprover: given.changeApprover ?? "RISK_MANAGER",
      selfProposalAllowed: given.selfProposalAllowed ?? false,
      lowCriticalityThreshold: given.lowCriticalityThreshold ?? DEFAULT_CONTRACT_PARAMS.lowCriticalityThreshold,
      riskOwnerExecutorCumulAllowed: given.riskOwnerExecutorCumulAllowed ?? DEFAULT_CONTRACT_PARAMS.riskOwnerExecutorCumulAllowed,
      delegateExecutorCumulAllowed: given.delegateExecutorCumulAllowed ?? DEFAULT_CONTRACT_PARAMS.delegateExecutorCumulAllowed,
      delegationMaxDays: given.delegationMaxDays ?? DEFAULT_CONTRACT_PARAMS.delegationMaxDays,
      hybridPolicyEnabled: given.hybridPolicyEnabled ?? DEFAULT_CONTRACT_PARAMS.hybridPolicyEnabled,
      masteryAuthoritativeSource: given.masteryAuthoritativeSource ?? DEFAULT_CONTRACT_PARAMS.masteryAuthoritativeSource,
      committeeVoteRule: given.committeeVoteRule ?? DEFAULT_CONTRACT_PARAMS.committeeVoteRule,
      committeeVoteCustom: null,
    };

    return this.audited<{ framework: RiskFramework; version: RiskFrameworkVersion }>(
      (created) => [
        this.event(actor, "RiskFramework", created.framework.id, "CREATE", null, created.framework, null, requestId),
        this.event(actor, "RiskFrameworkVersion", created.version.id, "CREATE", null, created.version, null, requestId),
      ],
      (audit) => this.frameworks.createWithDraft({ tenantId: actor.tenantId, name, description, createdBy: actor.userId, params, audit }),
    );
  }

  async updateIdentity(
    actor: AuthenticatedUser,
    id: string,
    input: { name?: string; description?: string | null; reason: string },
    requestId: string,
  ): Promise<RiskFramework> {
    requirePermission(actor, "riskframework.update");
    await this.assertRiskManager(actor);
    const reason = cleanText(input.reason, "reason", MAX_REASON, true)!;
    const before = await this.getFrameworkOrThrow(actor.tenantId, id);
    if (before.archivedAt) throw new ValidationError("Cannot modify an archived Dispositif");
    const fields: { name?: string; description?: string | null } = {};
    if (input.name !== undefined) fields.name = cleanText(input.name, "name", MAX_NAME, true)!;
    if (input.description !== undefined) fields.description = cleanText(input.description, "description", MAX_DESCRIPTION, false);
    return this.audited(
      (after) => [this.event(actor, "RiskFramework", id, "UPDATE", before, after, reason, requestId)],
      (audit) => this.frameworks.updateIdentity(actor.tenantId, id, fields, audit),
    );
  }

  /** New DRAFT copied from `fromVersionId`, or from the ACTIVE version. */
  async createDraft(actor: AuthenticatedUser, frameworkId: string, fromVersionId: string | undefined, requestId: string) {
    requirePermission(actor, "riskframework.update");
    await this.assertRiskManager(actor);
    const framework = await this.getFrameworkOrThrow(actor.tenantId, frameworkId);
    if (framework.archivedAt) throw new ValidationError("Cannot add a version to an archived Dispositif");
    const versions = await this.frameworks.listVersions(actor.tenantId, frameworkId);
    if (versions.some((v) => v.status === "DRAFT" || v.status === "PENDING_APPROVAL")) {
      throw new ConflictError("Ce Dispositif a déjà une version en brouillon ou en attente d'approbation");
    }
    const source = fromVersionId ? versions.find((v) => v.id === fromVersionId) : versions.find((v) => v.status === "ACTIVE");
    if (!source) {
      throw new ValidationError(fromVersionId ? `Version ${fromVersionId} not found in this Dispositif` : "No active version to copy: fromVersionId is required");
    }
    // q87: the repository copies every parameter except the approver, which is always RISK_MANAGER in a new
    // draft (a Committee/Audit approver of a legacy source is never carried over; the circuit of a request
    // still follows the ACTIVE version, fail-closed).
    return withMasteryIndependence(await this.audited<RiskFrameworkVersion>(
      (draft) => [this.event(actor, "RiskFrameworkVersion", draft.id, "CREATE", null, draft, null, requestId)],
      (audit) => this.frameworks.createDraftFrom(actor.tenantId, frameworkId, source.id, actor.userId, audit),
    ));
  }

  /** Partial update of a DRAFT. There is no `status` in the input: an edit is never a transition. */
  async updateDraft(
    actor: AuthenticatedUser,
    frameworkId: string,
    versionId: string,
    patch: UpdateDraftParams,
    requestId: string,
  ): Promise<RiskFrameworkVersion> {
    requirePermission(actor, "riskframework.update");
    await this.assertRiskManager(actor);
    const before = await this.getVersionOrThrow(actor.tenantId, frameworkId, versionId);
    this.assertDraft(before);
    const clean = checkParams(await this.withResolvedAppetite(actor.tenantId, patch));
    if (Object.values(clean).every((v) => v === undefined)) throw new ValidationError("Nothing to update");
    if (clean.ratingScaleId !== undefined) {
      const scale = await this.ratingScales.getById(actor.tenantId, clean.ratingScaleId);
      if (!scale) throw new ValidationError(`Rating scale ${clean.ratingScaleId} does not exist in this tenant`);
    }

    // q90: with a transactional repository the edit and its audit line are one operation. Otherwise (B6a-QA-01)
    // the audit line, which feeds the author exclusion, is written BEFORE the edit is stored: worst case an
    // UPDATE entry for an edit that failed to store (over-excludes that person, never under-excludes).
    if (this.inTx) {
      return withMasteryIndependence(await this.frameworks.updateDraft(actor.tenantId, frameworkId, versionId, clean, actor.userId,
        (after) => [this.event(actor, "RiskFrameworkVersion", versionId, "UPDATE", before, after, null, requestId)]));
    }
    await this.record(actor, "RiskFrameworkVersion", versionId, "UPDATE", before, { ...before, ...clean, lastEditedBy: actor.userId }, null, requestId);
    return withMasteryIndependence(await this.frameworks.updateDraft(actor.tenantId, frameworkId, versionId, clean, actor.userId));
  }

  /** DRAFT -> ARCHIVED. A terminal transition: `riskframework.archive`, never `update`. */
  async discardDraft(
    actor: AuthenticatedUser,
    frameworkId: string,
    versionId: string,
    reason: string,
    requestId: string,
  ): Promise<RiskFrameworkVersion> {
    requirePermission(actor, "riskframework.archive");
    await this.assertRiskManager(actor);
    const clean = cleanText(reason, "reason", MAX_REASON, true)!;
    const before = await this.getVersionOrThrow(actor.tenantId, frameworkId, versionId);
    this.assertDraft(before);
    return withMasteryIndependence(await this.audited<RiskFrameworkVersion>(
      (after) => [this.event(actor, "RiskFrameworkVersion", versionId, "STATUS_CHANGE", before, after, clean, requestId)],
      (audit) => this.frameworks.discardDraft(actor.tenantId, frameworkId, versionId, actor.userId, clean, audit),
    ));
  }

  // -- change requests --------------------------------------------------

  async requestActivation(
    actor: AuthenticatedUser,
    frameworkId: string,
    versionId: string,
    reason: string,
    requestId: string,
  ): Promise<RiskFrameworkChangeRequest> {
    requirePermission(actor, "riskframework.update");
    await this.assertRiskManager(actor);
    const clean = cleanText(reason, "reason", MAX_REASON, true)!;
    const framework = await this.getFrameworkOrThrow(actor.tenantId, frameworkId);
    if (framework.archivedAt) throw new ValidationError("Cannot activate a version of an archived Dispositif");
    const version = await this.getVersionOrThrow(actor.tenantId, frameworkId, versionId);
    this.assertDraft(version);
    const checked = await this.validateRequestable(actor.tenantId, version, actor.userId);
    const { active } = checked;

    const request = await this.frameworks.createActivationRequest({
      tenantId: actor.tenantId,
      frameworkId,
      versionId,
      reason: clean,
      requestedBy: actor.userId,
      previousValue: active ? { versionId: active.id, versionNumber: active.versionNumber } : null,
      // F-B6a-02: replayed on the locked row, so a PATCH racing with this request cannot slip past.
      validateLocked: async (locked) => { checked.final = await this.validateRequestable(actor.tenantId, locked, actor.userId); },
      audit: this.inTx ? (r) => [this.event(actor, "RiskFrameworkChangeRequest", r.id, "SUBMIT", null, r, clean, requestId)] : undefined,
    });
    const { decider, all, eligible } = checked.final ?? checked;
    // Non-transactional repository only: notifications leave even when the audit write fails (C-B6a-01.1).
    let auditError: unknown = null;
    if (!this.inTx) {
      try {
        await this.record(actor, "RiskFrameworkChangeRequest", request.id, "SUBMIT", null, request, clean, requestId);
      } catch (err) {
        auditError = err;
        console.error(`risk framework request ${request.id}: request stored but audit failed (requestId ${requestId})`, err instanceof Error ? err.message : err);
      }
    }

    if (decider.kind === "RISK_MANAGER" && eligible.RISK_MANAGER.length === 0) {
      // q75: nobody can decide — never a tacit validation, never by the administrator.
      const canBootstrap = await this.bootstrapPossible(actor, version);
      await this.notify(actor, all.RISK_MANAGER, request.id, "RISK_FRAMEWORK_NO_DECIDER",
        "Une demande d'activation de Dispositif ne peut être décidée par personne : aucun Risk Manager éligible."
        + (canBootstrap ? " Vous pouvez décider en amorçage (premier Dispositif, valeurs par défaut du contrat)." : ""), requestId);
    } else {
      await this.notify(actor, await this.holders(actor, "riskframework.activate"), frameworkId, "RISK_FRAMEWORK_CHANGE_PENDING",
        "Une demande d'activation de Dispositif attend votre décision.", requestId, true);
    }
    if (auditError) throw auditError;
    return request;
  }

  async approve(actor: AuthenticatedUser, id: string, comment: string | undefined, requestId: string) {
    return this.decide(actor, id, "APPROVED", comment, requestId);
  }

  async reject(actor: AuthenticatedUser, id: string, comment: string, requestId: string) {
    return this.decide(actor, id, "REJECTED", comment, requestId);
  }

  /** Requester only; the version goes back to DRAFT. */
  async withdraw(actor: AuthenticatedUser, id: string, reason: string | undefined, requestId: string) {
    requirePermission(actor, "riskframework.update");
    await this.assertRiskManager(actor);
    const request = await this.getRequestOrThrow(actor.tenantId, id);
    if (request.requestedBy !== actor.userId) throw new ForbiddenError("Seul le demandeur peut retirer sa demande");
    if (request.status !== "PENDING") throw new ConflictError(`Cette demande est déjà traitée (${request.status})`);
    const comment = cleanText(reason, "reason", MAX_REASON, true);
    return this.audited<DecisionResult>(
      (result) => [this.event(actor, "RiskFrameworkChangeRequest", id, "STATUS_CHANGE", request, result.request, comment, requestId)],
      (audit) => this.frameworks.withdraw(actor.tenantId, id, comment, audit),
    );
  }

  /**
   * Approve or reject. The decider is never the requester nor an author of the version, must be an
   * active Risk Manager (administrator alone never decides), and a vote-only request is refused (409).
   */
  private async decide(
    actor: AuthenticatedUser,
    id: string,
    outcome: "APPROVED" | "REJECTED",
    comment: string | undefined,
    requestId: string,
  ) {
    requirePermission(actor, "riskframework.activate");
    await this.assertRiskManager(actor);
    const request = await this.getRequestOrThrow(actor.tenantId, id);
    if (request.status !== "PENDING") throw new ConflictError(`Cette demande est déjà traitée (${request.status})`);
    if (request.requestedBy === actor.userId) {
      throw new ForbiddenError("Le demandeur ne peut pas décider sa propre demande (maker-checker)");
    }
    if (request.kind !== "ACTIVATE_VERSION" || !request.versionId) {
      throw new ValidationError(`Request kind ${request.kind} is not supported yet`);
    }
    const version = await this.getVersionOrThrow(actor.tenantId, request.frameworkId, request.versionId);
    if ((await this.authorsOf(actor.tenantId, version)).has(actor.userId)) {
      throw new ForbiddenError("Vous avez contribué à cette version : un tiers doit décider");
    }

    // F-B6a-02: approving replays the rules of the request (a rejection of an invalid version stays possible).
    const { decider, fallbackCause, bypassedGroups } = outcome === "APPROVED"
      ? await this.validateRequestable(actor.tenantId, version, request.requestedBy)
      : await this.resolveFor(actor.tenantId, version,
          request.requestedBy, (await this.frameworks.getActiveVersion(actor.tenantId, request.frameworkId))?.changeApprover ?? "RISK_MANAGER");
    const fallback = decider.regime === "FALLBACK";
    const cleanComment = cleanText(comment, "comment", MAX_COMMENT, outcome === "REJECTED" || fallback);

    const events = (result: DecisionResult): AuditInput[] =>
      outcome === "APPROVED"
        ? [
            this.event(actor, "RiskFrameworkVersion", result.version.id, "STATUS_CHANGE",
              result.previousActive, {
                ...result.version, decisionRegime: decider.regime, requestId: id,
                ...(fallbackCause ? { fallbackCause, bypassedGroups } : {}),
              }, cleanComment, requestId),
            this.event(actor, "RiskFrameworkChangeRequest", id, "APPROVE", request, result.request, cleanComment, requestId),
          ]
        : [this.event(actor, "RiskFrameworkChangeRequest", id, "REJECT", request, result.request, cleanComment, requestId)];

    // q90: with a transactional repository the audit rows are part of the decision (a failing audit = ROLLBACK).
    const result = await this.frameworks.recordDecision(actor.tenantId, id, {
      outcome,
      decidedBy: actor.userId,
      comment: cleanComment,
      decisionRegime: decider.regime,
      deciderGroup: "RISK_MANAGER",
      ratificationStatus: fallback ? "PENDING" : null,
      fallbackCause,
    }, this.inTx ? events : undefined);

    let auditError: unknown = null;
    if (!this.inTx) {
      try {
        for (const e of events(result)) await this.audit.record(e);
      } catch (err) {
        // Non-transactional repository only: the decision is applied and not replayed (F-B8t-04): logged, then reported.
        console.error(`risk framework request ${id}: decision applied but audit failed (requestId ${requestId})`, err instanceof Error ? err.message : err);
        auditError = err;
      }
    }

    await this.notify(actor, [request.requestedBy], id, "RISK_FRAMEWORK_CHANGE_DECIDED",
      outcome === "APPROVED" ? "Votre demande d'activation de Dispositif a été approuvée." : "Votre demande d'activation de Dispositif a été refusée.",
      requestId);
    // q34 / q56: Audit is told when a Risk Manager (or the fallback) decides.
    // q100: a legacy-approver fallback also tells the members of the groups whose vote was bypassed.
    const noticeTo = [...(await this.holders(actor, "audit.read")), ...(await this.membersOf(actor.tenantId, bypassedGroups))];
    await this.notify(actor, noticeTo, id, "RISK_FRAMEWORK_CHANGE_AUDIT_NOTICE",
      fallbackCause
        ? "Une demande de Dispositif a été décidée en repli par un Risk Manager : l'approbation par le Comité/Audit n'est pas encore disponible (ratification à venir)."
        : fallback ? "Une demande de Dispositif a été décidée en repli par un Risk Manager (ratification à venir)." : "Une demande de Dispositif a été décidée par un Risk Manager.",
      requestId);
    if (auditError) throw auditError; // reported after the (best effort) notifications left
    return result;
  }

  /**
   * Everything that must hold for a version to be submitted and, again, approved (spec §2.3 + q65).
   * Returns the circuit resolved for it. `final` is set by the locked replay in createActivationRequest.
   */
  private async validateRequestable(tenantId: string, version: RiskFrameworkVersion, requesterId: string) {
    await this.assertActivatable(tenantId, version);
    const active = await this.frameworks.getActiveVersion(tenantId, version.frameworkId);
    const resolved = await this.resolveFor(tenantId, version, requesterId, active?.changeApprover ?? "RISK_MANAGER");
    // q65: switching self-proposal on is only receivable when the Committee votes on it.
    const switchesSelfProposalOn = version.selfProposalAllowed && !(active?.selfProposalAllowed ?? false);
    // Before B-12 the circuit is never a Committee vote (q100 folds it into a fallback), so this always refuses (q92).
    if (switchesSelfProposalOn) {
      throw new ValidationError("L'activation de l'auto-proposition exige un vote du Comité");
    }
    return { ...resolved, active, final: undefined as undefined | Awaited<ReturnType<typeof this.resolveFor>> };
  }

  // -- bootstrap (B-6d, spec §5.6) -------------------------------------

  /**
   * The sole Risk Manager decides their own first-activation request (q77, q83). Only the "decider is not the
   * requester / not an author" rule is lifted; membership, permission, §2.3 validations and q65 still apply, and
   * the conditions are replayed under the tenant lock by the repository. No ratification (q83).
   */
  async bootstrapApprove(
    actor: AuthenticatedUser,
    id: string,
    input: { comment: string; justification: BootstrapDeclaration },
    requestId: string,
  ) {
    requirePermission(actor, "riskframework.activate");
    await this.assertRiskManager(actor);
    const record = this.frameworks.recordBootstrapDecision?.bind(this.frameworks);
    if (!record) throw new ValidationError("Bootstrap approval is not available");
    const request = await this.getRequestOrThrow(actor.tenantId, id);
    if (request.status !== "PENDING") throw new ConflictError(`Cette demande est déjà traitée (${request.status})`);
    if (request.requestedBy !== actor.userId) {
      throw new ForbiddenError("L'amorçage ne peut être décidé que par le demandeur lui-même");
    }
    if (request.kind !== "ACTIVATE_VERSION" || !request.versionId) {
      throw new ValidationError(this.bootstrapMessage("OUT_OF_SCOPE"));
    }
    const comment = cleanText(input.comment, "comment", MAX_COMMENT, true)!;
    const declaration = await this.checkDeclaration(actor, input.justification);
    const version = await this.getVersionOrThrow(actor.tenantId, request.frameworkId, request.versionId);
    await this.assertActivatable(actor.tenantId, version);
    const scale = (await this.ratingScales.getById(actor.tenantId, version.ratingScaleId))!;
    const lowestBand = Math.min(...(scale.criticalityThresholds ?? []).map((b) => b.max));
    // I-D8 (A13): the values q98 leaves free are frozen with the decision. R2 is a value to examine, never a refusal.
    const myGrants = (await this.roles.listActiveGrants?.(actor.tenantId, actor.userId)) ?? [];
    const justification: BootstrapJustification = {
      ...declaration,
      deciderAlsoAdministrator: myGrants.some((g) => g.role.permissions.some((p) => ADMIN_PERMISSIONS.includes(p))),
      freeParameters: {
        scaleSize: scale.impactLevels,
        appetiteThresholds: version.appetiteThresholds,
        lowCriticalityThreshold: version.lowCriticalityThreshold,
        delegationMaxDays: version.delegationMaxDays,
        committeeTreatmentMinScore: version.committeeTreatmentMinScore,
        lowThresholdToExamine: version.lowCriticalityThreshold !== null && Number.isFinite(lowestBand) && version.lowCriticalityThreshold > lowestBand,
      },
    };

    const events = (result: DecisionResult): AuditInput[] => [
      this.event(actor, "RiskFrameworkVersion", result.version.id, "STATUS_CHANGE", result.previousActive,
        { ...result.version, decisionRegime: "BOOTSTRAP", requestId: id, bootstrapJustification: justification }, comment, requestId),
      this.event(actor, "RiskFrameworkChangeRequest", id, "APPROVE", request, result.request, comment, requestId),
    ];
    const result = await record(actor.tenantId, id, { decidedBy: actor.userId, comment, justification }, async (facts) => {
      const ctx = this.bootstrapContext(version, scale.impactLevels, facts);
      const refusal = bootstrapRefusal(ctx);
      if (refusal) throw this.bootstrapError(refusal, contractDefaultViolations(version, scale.impactLevels));
    }, this.inTx ? events : undefined);

    let auditError: unknown = null;
    if (!this.inTx) {
      try {
        for (const e of events(result)) await this.audit.record(e);
      } catch (err) {
        console.error(`risk framework request ${id}: bootstrap decision applied but audit failed (requestId ${requestId})`, err instanceof Error ? err.message : err);
        auditError = err;
      }
    }
    // q99 / q101 / q103: active Audit and Committee members, and nobody else (empty groups = no notification).
    await this.notify(actor, await this.membersOf(actor.tenantId, ["AUDIT", "COMMITTEE"]), id, "RISK_FRAMEWORK_BOOTSTRAP_NOTICE",
      bootstrapNoticeMessage(justification), requestId);
    if (auditError) throw auditError;
    return result;
  }

  private bootstrapContext(version: RiskFrameworkVersion, scaleSize: number, facts: BootstrapFacts): BootstrapContext {
    return {
      kind: "ACTIVATE_VERSION",
      endedAt: facts.endedAt,
      activeMembers: facts.activeMembers,
      requesterIsActiveRiskManager: facts.requesterIsActiveRiskManager,
      firstActivationOfTenant: facts.firstActivationOfTenant,
      contractDefaultsOnly: contractDefaultViolations(version, scaleSize).length === 0,
      switchesSelfProposalOn: version.selfProposalAllowed,
    };
  }

  /** Unlocked read, only to word the NO_DECIDER notification; the decision never relies on it. */
  private async bootstrapPossible(actor: AuthenticatedUser, version: RiskFrameworkVersion): Promise<boolean> {
    try {
      if (!this.frameworks.getBootstrapFacts) return false;
      const facts = await this.frameworks.getBootstrapFacts(actor.tenantId, actor.userId);
      const scale = await this.ratingScales.getById(actor.tenantId, version.ratingScaleId);
      return !!scale && bootstrapRefusal(this.bootstrapContext(version, scale.impactLevels, facts)) === null;
    } catch {
      return false;
    }
  }

  private bootstrapMessage(r: BootstrapRefusal, fields: string[] = []): string {
    switch (r) {
      case "ENDED": return "L'amorçage est terminé définitivement pour ce tenant : un circuit d'approbation fonctionne.";
      case "CIRCUIT_FUNCTIONAL": return "Un circuit d'approbation fonctionne déjà (au moins 2 membres actifs dans le groupe Risk Manager, le Comité ou Audit) : un tiers doit décider.";
      case "NOT_SOLE_RISK_MANAGER": return "L'amorçage n'est ouvert qu'à l'unique membre actif du groupe Risk Manager.";
      case "OUT_OF_SCOPE": return "L'amorçage ne couvre que l'activation du premier Dispositif du tenant.";
      case "NOT_FIRST_ACTIVATION": return "L'amorçage ne couvre que le premier Dispositif du tenant : une version a déjà été activée.";
      case "NOT_CONTRACT_DEFAULTS": return `L'amorçage exige les valeurs par défaut du contrat ; à corriger dans le brouillon : ${fields.join(", ")}.`;
      case "SELF_PROPOSAL": return "L'activation de l'auto-proposition exige un vote du Comité.";
    }
  }

  private bootstrapError(r: BootstrapRefusal, fields: string[]): Error {
    const message = this.bootstrapMessage(r, fields);
    return r === "NOT_SOLE_RISK_MANAGER" ? new ForbiddenError(message) : new ValidationError(message);
  }

  /** q83 / I-D2 / I-D9: structured, mandatory motive. The asked administrator must be another active administrator. */
  private async checkDeclaration(actor: AuthenticatedUser, d: BootstrapDeclaration): Promise<BootstrapDeclaration> {
    const outcome = cleanText(d?.outcome, "justification.outcome", MAX_REASON, true)!;
    const askedOn = (d?.askedOn ?? "").trim();
    const parsed = /^\d{4}-\d{2}-\d{2}$/.test(askedOn) ? new Date(`${askedOn}T00:00:00Z`) : null;
    if (!parsed || Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== askedOn) {
      throw new ValidationError("justification.askedOn must be a date (YYYY-MM-DD)");
    }
    if (askedOn > new Date().toISOString().slice(0, 10)) throw new ValidationError("justification.askedOn cannot be in the future");
    const rawAskedId = d?.askedUserId;
    if (!rawAskedId) throw new ValidationError("justification.askedUserId is required");
    const asked = await this.users.getById(actor.tenantId, rawAskedId);
    if (!asked || asked.deletedAt) throw new ValidationError("L'administrateur sollicité doit être un utilisateur actif du tenant");
    // QA-B6d-01: compare the id returned by the database (canonical lower-case uuid), never the client's text.
    // I-D9 (A13, pending PO): the requester cannot be the administrator they claim to have asked.
    if (asked.id === actor.userId && !BOOTSTRAP_ASKED_ADMIN_MAY_BE_SELF) {
      throw new ValidationError("Vous ne pouvez pas vous désigner vous-même comme administrateur sollicité : sollicitez un autre administrateur du tenant, ou créez vous-même un second membre du groupe Risk Manager.");
    }
    const listGrants = this.roles.listActiveGrants?.bind(this.roles);
    if (!listGrants) throw new ValidationError("Bootstrap approval is not available");
    const adminGrants = (await listGrants(actor.tenantId, asked.id)).filter((g) => g.role.permissions.some((p) => ADMIN_PERMISSIONS.includes(p)));
    if (adminGrants.length === 0) {
      throw new ValidationError("L'utilisateur sollicité n'est pas administrateur : indiquez un administrateur du tenant");
    }
    // F-B6d-01: the administrator right must predate the request and not come from the requester themselves.
    // Also the lower bound of askedOn: it cannot precede the grant, hence not the creation of the tenant.
    // F-B6d-01 retest 2 (A10): nor may the requester have created the role or changed its permissions (an admin
    // permission added to an old ordinary role would pass the grant checks; a date check is beaten by askedOn = today).
    // RoleService.update logs every edit (rename included) as PERMISSION_CHANGE: count only an admin permission brought in.
    const perms = (v: unknown): string[] => (v as { permissions?: string[] } | null)?.permissions ?? [];
    const authoredByMe = async (roleId: string) => (await this.audit.listForEntity(actor.tenantId, "Role", roleId))
      .some((e) => e.userId === actor.userId && (e.action === "CREATE" || e.action === "PERMISSION_CHANGE")
        && perms(e.newValue).some((p) => (ADMIN_PERMISSIONS as readonly string[]).includes(p) && !perms(e.oldValue).includes(p)));
    let preExisting = false;
    for (const g of adminGrants) {
      if (g.grantedBy === actor.userId || g.grantedAt.toISOString().slice(0, 10) > askedOn) continue;
      if (!(await authoredByMe(g.role.id))) { preExisting = true; break; }
    }
    if (!preExisting) {
      throw new ValidationError("Le droit d'administrateur de l'utilisateur sollicité a été accordé par vous, ou après la date de sollicitation déclarée, ou son rôle a été créé ou modifié par vous : indiquez un administrateur préexistant");
    }
    const askedUserId = asked.id;
    return { askedUserId, askedOn, outcome };
  }

  /** Active members of the groups, deduplicated; best effort (a lookup failure yields nobody, never an error). */
  private async membersOf(tenantId: string, groups: ApproverGroup[]): Promise<string[]> {
    try {
      const out = new Set<string>();
      for (const g of groups) for (const id of await this.activeMembers(tenantId, g)) out.add(id);
      return [...out];
    } catch (err) {
      console.error("group members could not be resolved", err instanceof Error ? err.message : err);
      return [];
    }
  }

  // -- rules ------------------------------------------------------------

  /** Spec §2.3, replayed when activation is requested: the version is frozen from then on. */
  private async assertActivatable(tenantId: string, v: RiskFrameworkVersion): Promise<void> {
    const scale = await this.ratingScales.getById(tenantId, v.ratingScaleId);
    if (!scale) throw new ValidationError("The rating scale of this version no longer exists");
    if (scale.status === "ARCHIVED") throw new ValidationError("The rating scale of this version is archived; pick an active or draft scale");
    if (scale.probabilityLevels !== scale.impactLevels) {
      throw new ValidationError("The rating scale must be square (probabilityLevels = impactLevels)");
    }
    assertReadyToActivate(scale);
    if (!scale.impactAxes?.axes?.length) throw new ValidationError("The rating scale needs at least one impact axis");

    const ceiling = maxScoreForScale(scale);
    const over: string[] = [];
    if (v.committeeEvaluationMinScore > ceiling) over.push(`seuil Comité évaluation (${v.committeeEvaluationMinScore})`);
    if (v.committeeTreatmentMinScore !== null && v.committeeTreatmentMinScore > ceiling) {
      over.push(`seuil Comité traitement (${v.committeeTreatmentMinScore})`);
    }
    for (const a of normalizeAppetite(v.appetiteThresholds)) {
      if (a.threshold > ceiling) over.push(`appétence "${a.subCategory}" (${a.threshold})`);
    }
    // R2 (A13): the "low" threshold has no default and is never pre-filled; the author enters it explicitly.
    if (v.lowCriticalityThreshold === null) {
      throw new ValidationError("Le seuil de criticité « faible » est obligatoire pour demander l'activation : renseignez-le dans le brouillon");
    }
    if (v.lowCriticalityThreshold > ceiling) over.push(`seuil de criticité « faible » (${v.lowCriticalityThreshold})`);
    for (const b of scale.criticalityThresholds ?? []) {
      if (b.max > ceiling) over.push(`bande "${b.label}" (${b.max})`);
    }
    if (over.length > 0) {
      throw new ValidationError(`These thresholds exceed the maximum score of the scale (${ceiling}): ${over.join(", ")}. Correct them in the draft.`);
    }
    await this.assertSubCategories(tenantId, v.appetiteThresholds);
  }

  private assertDraft(v: RiskFrameworkVersion): void {
    if (v.status !== "DRAFT") throw new ValidationError(`Only a draft version can be changed (this one is ${v.status})`);
  }

  /**
   * q133 / F-FW-01: on every write, each appetite entry must name an existing, active SUB-category (parentId set) of THIS tenant
   * (subCategoryId mandatory); the stored `subCategory` label is the category's name, never the client's text.
   */
  private async withResolvedAppetite<T extends UpdateDraftParams>(tenantId: string, p: T): Promise<T> {
    if (p.appetiteThresholds === undefined) return p;
    if (p.appetiteThresholds.length > 0 && !this.riskCategories) {
      throw new ValidationError("Risk category validation is not available: RiskCategoryRepository is not configured");
    }
    const names = new Map<string, string>();
    for (const e of p.appetiteThresholds) {
      if (!e.subCategoryId) throw new ValidationError("Chaque seuil d'appétence doit désigner une catégorie de risque (subCategoryId)");
      if (names.has(e.subCategoryId)) continue;
      const cat = await this.riskCategories!.getById(tenantId, e.subCategoryId);
      if (!cat || !cat.active) throw new ValidationError(`Risk category ${e.subCategoryId} does not exist in this tenant`);
      if (!cat.parentId) throw new ValidationError(`Risk category ${e.subCategoryId} is a top-level category: pick a sub-category`);
      names.set(e.subCategoryId, cat.name);
    }
    return { ...p, appetiteThresholds: p.appetiteThresholds.map((e) => ({ ...e, subCategory: names.get(e.subCategoryId!)! })) };
  }

  /** Activation request: legacy drafts may still carry a free-text entry (no id); only the ids that exist are checked. */
  private async assertSubCategories(tenantId: string, entries: AppetiteThresholdEntry[]): Promise<void> {
    for (const e of entries) {
      if (!e.subCategoryId) continue;
      if (!this.riskCategories) {
        throw new ValidationError("Risk category validation is not available: RiskCategoryRepository is not configured");
      }
      if (!(await this.riskCategories.getById(tenantId, e.subCategoryId))) {
        throw new ValidationError(`Risk category ${e.subCategoryId} does not exist in this tenant`);
      }
    }
  }

  // -- membership and circuit ------------------------------------------

  /** q51: configuring the Dispositif belongs to the risk function; an administrator alone is not enough. */
  private async assertRiskManager(actor: AuthenticatedUser): Promise<void> {
    const held = await this.roles.listForUser(actor.tenantId, actor.userId);
    if (!held.some((r) => r.systemGroup === "RISK_MANAGER")) {
      throw new ForbiddenError("Réservé aux membres du groupe Risk Manager");
    }
  }

  /** Active members: assignment not revoked and user not suspended (same definition as B-8). */
  private async activeMembers(tenantId: string, group: ApproverGroup): Promise<string[]> {
    const role = (await this.roles.list(tenantId)).find((r) => r.systemGroup === SYSTEM_GROUP_OF[group]);
    if (!role) return [];
    const ids = [...new Set((await this.roles.listAssignments(tenantId, role.id)).filter((a) => !a.revokedAt).map((a) => a.userId))];
    const out: string[] = [];
    for (const id of ids) {
      const u = await this.users.getById(tenantId, id);
      if (u && !u.deletedAt) out.push(id);
    }
    return out;
  }

  /** Requester + every author of the version (created_by, last editor, CREATE/UPDATE audit entries). */
  private async authorsOf(tenantId: string, v: RiskFrameworkVersion): Promise<Set<string>> {
    const authors = new Set<string>();
    if (v.createdBy) authors.add(v.createdBy);
    if (v.lastEditedBy) authors.add(v.lastEditedBy);
    for (const e of await this.audit.listForEntity(tenantId, "RiskFrameworkVersion", v.id)) {
      if (e.action === "CREATE" || e.action === "UPDATE") authors.add(e.userId);
    }
    // F-B6a-04: a DRAFT scale is still editable until the version is frozen, so its authors count too.
    const scale = await this.ratingScales.getById(tenantId, v.ratingScaleId);
    if (scale?.status === "DRAFT") {
      for (const e of await this.audit.listForEntity(tenantId, "RatingScale", scale.id)) {
        if (e.action === "CREATE" || e.action === "UPDATE") authors.add(e.userId);
      }
    }
    return authors;
  }

  private async resolveFor(
    tenantId: string,
    version: RiskFrameworkVersion,
    requesterId: string,
    approver: ChangeApprover,
  ): Promise<{
    decider: { kind: "RISK_MANAGER"; regime: "NORMAL" | "FALLBACK" };
    fallbackCause: FallbackCause | null;
    bypassedGroups: ApproverGroup[];
    all: EligibleMembers;
    eligible: EligibleMembers;
  }> {
    const excluded = new Set([requesterId, ...(await this.authorsOf(tenantId, version))]);
    const all: EligibleMembers = { RISK_MANAGER: [], AUDIT: [], COMMITTEE: [] };
    for (const g of Object.keys(all) as ApproverGroup[]) all[g] = await this.activeMembers(tenantId, g);
    const eligible: EligibleMembers = {
      RISK_MANAGER: all.RISK_MANAGER.filter((id) => !excluded.has(id)),
      AUDIT: all.AUDIT.filter((id) => !excluded.has(id)),
      COMMITTEE: all.COMMITTEE.filter((id) => !excluded.has(id)),
    };
    // q100: until B-12 a vote cannot be exercised; it is folded into the existing Risk Manager fallback.
    return { ...foldVoteBeforeB12(resolveDecider(approver, eligible)), all, eligible };
  }

  // -- plumbing ---------------------------------------------------------

  private async getFrameworkOrThrow(tenantId: string, id: string): Promise<RiskFramework> {
    const f = await this.frameworks.getFramework(tenantId, id);
    if (!f) throw new NotFoundError("RiskFramework", id);
    return f;
  }

  private async getVersionOrThrow(tenantId: string, frameworkId: string, versionId: string): Promise<RiskFrameworkVersion> {
    const v = await this.frameworks.getVersion(tenantId, frameworkId, versionId);
    if (!v) throw new NotFoundError("RiskFrameworkVersion", versionId);
    return v;
  }

  private async getRequestOrThrow(tenantId: string, id: string): Promise<RiskFrameworkChangeRequest> {
    const r = await this.frameworks.getRequest(tenantId, id);
    if (!r) throw new NotFoundError("RiskFrameworkChangeRequest", id);
    return r;
  }

  /** q90: true when the repository writes the audit rows in the transaction of the action itself. */
  private get inTx(): boolean {
    return this.frameworks.auditsInTransaction === true;
  }

  private event(
    actor: AuthenticatedUser,
    entityType: string,
    entityId: string,
    action: "CREATE" | "UPDATE" | "STATUS_CHANGE" | "SUBMIT" | "APPROVE" | "REJECT",
    oldValue: unknown,
    newValue: unknown,
    reason: string | null,
    requestId: string,
  ): AuditInput {
    return { tenantId: actor.tenantId, userId: actor.userId, entityType, entityId, action, oldValue, newValue, reason, requestId };
  }

  private async record(
    actor: AuthenticatedUser,
    entityType: string,
    entityId: string,
    action: "CREATE" | "UPDATE" | "STATUS_CHANGE" | "SUBMIT" | "APPROVE" | "REJECT",
    oldValue: unknown,
    newValue: unknown,
    reason: string | null,
    requestId: string,
  ): Promise<void> {
    await this.audit.record(this.event(actor, entityType, entityId, action, oldValue, newValue, reason, requestId));
  }

  /** Runs the action with its audit events in the same transaction, or records them right after (fakes). */
  private async audited<R>(build: TransactionalAudit<R>, run: (audit?: TransactionalAudit<R>) => Promise<R>): Promise<R> {
    if (this.inTx) return run(build);
    const result = await run();
    for (const e of build(result)) await this.audit.record(e);
    return result;
  }

  private async holders(actor: AuthenticatedUser, permission: string): Promise<string[]> {
    try {
      const list = (await this.users.listWithPermission?.(actor.tenantId, permission, actor.userId)) ?? [];
      return list.map((u) => u.id);
    } catch (err) {
      // Best effort (C-B6a-01.1): a failing lookup must not skip the other notifications nor undo the action.
      console.error(`recipients of ${permission} could not be resolved`, err instanceof Error ? err.message : err);
      return [];
    }
  }

  /** Best effort: the action is already stored and audited; a notification failure must not undo it. */
  private async notify(
    actor: AuthenticatedUser,
    userIds: string[],
    resourceId: string,
    eventType: string,
    message: string,
    requestId: string,
    /** F-B6a-07: skip when an identical unread notification exists (only if `emit` is available). */
    dedupe = false,
  ): Promise<void> {
    if (!this.notifications) return;
    // One try per recipient (B6abis-QA-02): a failure for one member must not skip the others.
    for (const recipientUserId of new Set(userIds)) {
      try {
        const n = {
          tenantId: actor.tenantId,
          recipientUserId,
          resourceType: "MANAGEMENT" as const,
          resourceId,
          eventType,
          message,
          triggeredBy: actor.userId,
          requestId,
        };
        if (dedupe && this.notifications.emit) await this.notifications.emit({ ...n, skipIfUnread: true });
        else await this.notifications.record(n);
      } catch (err) {
        console.error(`${eventType} ${resourceId}: members could not be notified (requestId ${requestId})`, err instanceof Error ? err.message : err);
      }
    }
  }
}
