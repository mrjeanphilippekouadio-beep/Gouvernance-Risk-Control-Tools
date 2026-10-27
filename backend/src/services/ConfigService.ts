import type { ConfigRepository } from "../domain/repositories/ConfigRepository.js";
import type { AuditRepository } from "../domain/repositories/AuditRepository.js";
import type { Config, ConfigPatch, EvaluationMode } from "../domain/entities/Config.js";
import type { TransactionalAudit } from "../domain/entities/RiskFramework.js";
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from "../domain/errors/DomainErrors.js";
import { requirePermission } from "../domain/permissions.js";
import type { AuthenticatedUser } from "../infrastructure/identity/IdentityProvider.js";
import type { RatingScaleRepository } from "../domain/repositories/RatingScaleRepository.js";
import { isAcceptableReason, SELF_VALIDATION_POLICIES, type EligibleValidatorQuery, type SelfValidationPolicy } from "../domain/governance/selfValidation.js";
import { MIN_APPETITE_THRESHOLD } from "./RiskEvaluationService.js";
import { defaultCommitteeThreshold } from "../domain/scoring.js";
import { resolveMaxScore } from "./scoreCeiling.js";
import type { PolicyChange, PolicyChangeResult, SelfValidationPolicyRequest, SelfValidationPolicyRequestRepository } from "../domain/repositories/SelfValidationPolicyRequestRepository.js";
import type { RiskFrameworkRepository } from "../domain/repositories/RiskFrameworkRepository.js";
import { FRAMEWORK_OWNS_SETTING_MESSAGE } from "./riskFrameworkResolution.js";
import { writeAudited } from "./auditedWrite.js";

/** Upper bound of a governance delay (same CHECK as migration 075). */
export const MAX_GOVERNANCE_DELAY_DAYS = 3650;

const EVALUATION_MODES = ["CLASSIQUE", "PARTICIPATIF"] as const;

/**
 * Default shown to a tenant that has never explicitly saved a config row
 * — deliberately mirrors what's hardcoded today in RatingScaleService/
 * RiskEvaluationService (P x I, impact-retenu MAX,
 * AUTO_AVEC_SURCHARGE_MANUELLE — see RiskEvaluationService.suggestAppetite,
 * which always computes a suggestion but never blocks an override).
 * `version: 0` and `id: null` mark it as not-yet-persisted.
 */
function defaultConfig(tenantId: string, committeeMinScore: number): Config {
  return {
    id: "",
    tenantId,
    scoreFormula: "P_X_I",
    levelThresholds: [],
    impactRetenuRule: "MAX",
    appetiteMode: "AUTO_AVEC_SURCHARGE_MANUELLE",
    evaluationMode: "CLASSIQUE",
    // Lot A (RISK_MANAGEMENT_V1 §8): reproduces the pre-Lot-A hardcoded behavior exactly
    // (COMMITTEE_VALIDATION_MIN_SCORE = 15, always enforced) — see 045_committee_thresholds.sql.
    committeeEvaluationMinScore: committeeMinScore,
    committeeTreatmentMinScore: null,
    committeeEvaluationEnforced: true,
    committeeAuditCumulAllowed: true,
    selfValidationPolicy: "REFUSE",
    exceptionReviewDelayDays: null,
    acceptanceMaxDays: null,
    policyRequestExpiryDays: null,
    version: 0,
    updatedBy: null,
    createdAt: new Date(0),
    updatedAt: new Date(0),
  };
}

/**
 * ACT-220/ACT-226 — Config domain module. Storage + audit trail for
 * tenant-wide methodology settings ONLY. This batch does NOT wire any of
 * this into the services that currently hardcode the equivalent
 * behavior:
 *   - RatingScaleService's impact-retenu MAX rule is set per RatingScale
 *     version (see RatingScale.ts), independent of Config.impactRetenuRule.
 *   - RiskEvaluationService's `probability * impactRetained` formula
 *     never reads Config.scoreFormula.
 *   - RiskEvaluationService's appetite suggestion/override flow already
 *     behaves like AUTO_AVEC_SURCHARGE_MANUELLE unconditionally; it never
 *     branches on Config.appetiteMode.
 * That rewiring is an explicit follow-up requiring Architect/Risk
 * Manager review (see .claude/agent-context/ACTION_ITEMS.md's open item
 * on the scoring methodology) — nothing here should be read as having
 * done it.
 */
export class ConfigService {
  constructor(
    private readonly configs: ConfigRepository,
    private readonly audit: AuditRepository,
    /** B-9 bis: optional; without it the committee ceiling stays at the historical 25. Wired in server.ts. */
    private readonly ratingScales?: Pick<RatingScaleRepository, "list">,
    /**
     * B-6b (spec §3): when wired (always in server.ts) the Dispositif owns the Committee thresholds, the
     * enforcement flag and the default evaluation mode, so their writers here answer a ValidationError.
     * Absent: the pre-B-6b behaviour (tests). GET /config stays available as obsolete history.
     */
    private readonly frameworks?: Pick<RiskFrameworkRepository, "listFrameworks">,
    /** q158: tells whether another person holds config.selfvalidation.approve. Optional; softening fails closed without it. */
    private readonly eligible?: EligibleValidatorQuery,
    /** q158: pending relaxations awaiting a second person. Optional; softening fails closed without it. */
    private readonly policyRequests?: SelfValidationPolicyRequestRepository,
  ) {}

  private assertNotOwnedByFramework(): void {
    if (this.frameworks) throw new ValidationError(FRAMEWORK_OWNS_SETTING_MESSAGE);
  }

  /**
   * The first write creates the tenant's row, whose column DEFAULT for the Committee threshold is
   * 15 (migration 045). Write the scale-based default instead, so that saving an unrelated setting
   * never silently changes the threshold `get()` was reporting (5 on a 3×3 scale, 21 on 6×6).
   */
  private async upsertConfig(tenantId: string, patch: Parameters<ConfigRepository["upsert"]>[1], updatedBy: string, audit?: TransactionalAudit<Config>): Promise<Config> {
    return this.configs.upsert(tenantId, await this.withFirstWriteDefault(tenantId, patch), updatedBy, audit);
  }

  private async withFirstWriteDefault(tenantId: string, patch: ConfigPatch): Promise<ConfigPatch> {
    if (patch.committeeEvaluationMinScore === undefined && !(await this.configs.getByTenant(tenantId))) {
      return { ...patch, committeeEvaluationMinScore: defaultCommitteeThreshold(await resolveMaxScore(this.ratingScales, tenantId)) };
    }
    return patch;
  }

  private configAuditEvent(actor: AuthenticatedUser, before: Config, after: Config, reason: string, requestId: string) {
    return {
      tenantId: actor.tenantId,
      userId: actor.userId,
      entityType: "Config",
      entityId: after.id,
      action: "UPDATE" as const,
      oldValue: before,
      newValue: after,
      reason,
      requestId,
    };
  }

  async get(actor: AuthenticatedUser): Promise<Config> {
    requirePermission(actor, "config.read");
    return this.readConfig(actor.tenantId);
  }

  /** Tenant-scoped read without a permission check: only for a caller that already checked its own permission. */
  private async readConfig(tenantId: string): Promise<Config> {
    return (await this.configs.getByTenant(tenantId)) ?? defaultConfig(tenantId, defaultCommitteeThreshold(await resolveMaxScore(this.ratingScales, tenantId)));
  }

  /** PUT /config/evaluation-mode — DIV-06. Same permission/reason bar as the retired updateAppetiteMode; shares the same underlying row. */
  async updateEvaluationMode(
    actor: AuthenticatedUser,
    mode: EvaluationMode,
    reason: string,
    requestId: string,
  ): Promise<Config> {
    requirePermission(actor, "config.update");
    this.assertNotOwnedByFramework();
    if (!reason.trim()) {
      throw new ValidationError("A reason is required to change the evaluation mode — this affects the default risk evaluation methodology tenant-wide");
    }
    if (!EVALUATION_MODES.includes(mode)) throw new ValidationError(`Unknown evaluation mode: ${mode}`);

    const before = await this.get(actor);
    const after = await this.upsertConfig(actor.tenantId, { evaluationMode: mode }, actor.userId);

    await this.audit.record({
      tenantId: actor.tenantId,
      userId: actor.userId,
      entityType: "Config",
      entityId: after.id,
      action: "UPDATE",
      oldValue: before,
      newValue: after,
      reason,
      requestId,
    });

    return after;
  }

  /**
   * PUT /config/committee-thresholds — Lot A (RISK_MANAGEMENT_V1 §8).
   * Recalibrates the Committee score thresholds, gated by its own
   * permission (`config.committeethreshold.set`, distinct from
   * `config.committeeenforcement.set` below). `treatmentMinScore` accepts
   * `null` explicitly (field present, value null) to clear the threshold
   * back to "not configured" — distinct from omitting the field entirely,
   * which leaves the stored value untouched (buildUpdateSet semantics).
   */
  async updateCommitteeThresholds(
    actor: AuthenticatedUser,
    patch: { evaluationMinScore?: number; treatmentMinScore?: number | null },
    reason: string,
    requestId: string,
  ): Promise<Config> {
    requirePermission(actor, "config.committeethreshold.set");
    this.assertNotOwnedByFramework();
    const MAX_APPETITE_THRESHOLD = await resolveMaxScore(this.ratingScales, actor.tenantId);
    if (!reason.trim()) {
      throw new ValidationError("A reason is required to change the committee thresholds — this affects which risk evaluations can reach committee validation");
    }
    if (
      patch.evaluationMinScore !== undefined &&
      !Number.isInteger(patch.evaluationMinScore)
    ) {
      throw new ValidationError("evaluationMinScore must be an integer");
    }
    if (
      patch.evaluationMinScore !== undefined &&
      (patch.evaluationMinScore < MIN_APPETITE_THRESHOLD || patch.evaluationMinScore > MAX_APPETITE_THRESHOLD)
    ) {
      throw new ValidationError(`evaluationMinScore must be between ${MIN_APPETITE_THRESHOLD} and ${MAX_APPETITE_THRESHOLD}`);
    }
    if (
      patch.treatmentMinScore !== undefined &&
      patch.treatmentMinScore !== null &&
      (!Number.isInteger(patch.treatmentMinScore) ||
        patch.treatmentMinScore < MIN_APPETITE_THRESHOLD ||
        patch.treatmentMinScore > MAX_APPETITE_THRESHOLD)
    ) {
      throw new ValidationError(`treatmentMinScore must be null or an integer between ${MIN_APPETITE_THRESHOLD} and ${MAX_APPETITE_THRESHOLD}`);
    }

    // Built with only the keys the caller actually provided (never an explicit `undefined`
    // value under a present key) — some ConfigRepository test doubles merge patches with a
    // plain object spread rather than buildUpdateSet's "skip if undefined" semantics, and a
    // present-but-undefined key would incorrectly clobber the stored value there.
    const configPatch: Parameters<ConfigRepository["upsert"]>[1] = {};
    if (patch.evaluationMinScore !== undefined) configPatch.committeeEvaluationMinScore = patch.evaluationMinScore;
    if (patch.treatmentMinScore !== undefined) configPatch.committeeTreatmentMinScore = patch.treatmentMinScore;

    const before = await this.get(actor);
    const after = await this.upsertConfig(actor.tenantId, configPatch, actor.userId);

    await this.audit.record({
      tenantId: actor.tenantId,
      userId: actor.userId,
      entityType: "Config",
      entityId: after.id,
      action: "UPDATE",
      oldValue: before,
      newValue: after,
      reason,
      requestId,
    });

    return after;
  }

  /**
   * PUT /config/committee-enforcement — Lot A (RISK_MANAGEMENT_V1 §8).
   * Toggles whether `RiskEvaluationService.validate()` refuses evaluations
   * at or above the committee threshold. Gated by its own permission
   * (`config.committeeenforcement.set`), never `config.update` — turning
   * off this obligation is a governance act in the SEC-013/SEC-014 family
   * (a terminal/high-stakes side effect, even though it reads like a
   * routine toggle), not a cosmetic settings change.
   */
  async setCommitteeEnforcement(actor: AuthenticatedUser, enforced: boolean, reason: string, requestId: string): Promise<Config> {
    requirePermission(actor, "config.committeeenforcement.set");
    this.assertNotOwnedByFramework();
    if (!reason.trim() || !isAcceptableReason(reason)) {
      throw new ValidationError("A reason is required to change the committee validation enforcement — disabling it removes a governance control tenant-wide");
    }

    const before = await this.get(actor);
    // F-PNL2-06: the setting and its audit row are one transaction (a failing audit insert rolls the change back).
    return writeAudited(
      this.configs.auditsInTransaction,
      this.audit,
      (audit) => this.upsertConfig(actor.tenantId, { committeeEvaluationEnforced: enforced }, actor.userId, audit),
      (after) => [this.configAuditEvent(actor, before, after, reason, requestId)],
    );
  }

  /**
   * PUT /config/committee-audit-cumul — DECISION-042 §1 (q58). Allows or forbids one user
   * being in both the Committee and Audit groups (allowed by default). Takes effect on later
   * assignments only; existing double members are not removed. Sensitive setting (Compliance):
   * dedicated permission, mandatory reason, audited. Risk Manager + Audit is not affected by it.
   */
  async setCommitteeAuditCumul(actor: AuthenticatedUser, allowed: boolean, reason: string, requestId: string): Promise<Config> {
    requirePermission(actor, "config.cumul.set");
    if (!reason.trim() || !isAcceptableReason(reason)) {
      throw new ValidationError("A reason is required to change the Committee + Audit cumul setting");
    }
    const before = await this.get(actor);
    return writeAudited(
      this.configs.auditsInTransaction,
      this.audit,
      (audit) => this.upsertConfig(actor.tenantId, { committeeAuditCumulAllowed: allowed }, actor.userId, audit),
      (after) => [this.configAuditEvent(actor, before, after, reason, requestId)],
    );
  }

  /**
   * PUT /config/governance-delays — DECISION-083 (q168, q169, q174): the three governance delays, in days, chosen by
   * the tenant. Omitted key = untouched, null = back to "not configured". Administrator act with its own permission,
   * mandatory reason, audited with the setting in the same transaction (DECISION-079).
   */
  async setGovernanceDelays(
    actor: AuthenticatedUser,
    delays: Pick<ConfigPatch, "exceptionReviewDelayDays" | "acceptanceMaxDays" | "policyRequestExpiryDays">,
    reason: string,
    requestId: string,
  ): Promise<Config> {
    requirePermission(actor, "config.governancedelays.set");
    if (!reason.trim() || !isAcceptableReason(reason)) throw new ValidationError("A reason is required to change the governance delays");
    const patch: ConfigPatch = {};
    for (const key of ["exceptionReviewDelayDays", "acceptanceMaxDays", "policyRequestExpiryDays"] as const) {
      const v = delays[key];
      if (v === undefined) continue;
      if (v !== null && (!Number.isInteger(v) || v < 1 || v > MAX_GOVERNANCE_DELAY_DAYS)) {
        throw new ValidationError(`${key} must be a whole number of days between 1 and ${MAX_GOVERNANCE_DELAY_DAYS}, or null`);
      }
      patch[key] = v;
    }
    if (Object.keys(patch).length === 0) throw new ValidationError("No governance delay to change");
    // The audit's "before" must not need config.read on top of config.governancedelays.set (revue Codex PR #195).
    const before = await this.readConfig(actor.tenantId);
    return writeAudited(
      this.configs.auditsInTransaction,
      this.audit,
      (audit) => this.upsertConfig(actor.tenantId, patch, actor.userId, audit),
      (after) => [this.configAuditEvent(actor, before, after, reason, requestId)],
    );
  }

  /**
   * PUT /config/self-validation-policy — DECISION-074 q141, DECISION-078 q158. Chooses what happens when someone
   * validates their own input: REFUSE (default) or DOUBLE_CONFIRMATION. Dedicated administrator permission, mandatory
   * reason, audited. Relaxing (REFUSE -> DOUBLE_CONFIRMATION) needs a second person holding
   * config.selfvalidation.approve when one exists: a PENDING request, applied by `approveSelfValidationPolicy`
   * (never by its author). With nobody else able to approve, the administrator applies it alone, marked
   * `config.selfvalidation.adminAlone`. Tightening or a no-op change stays direct, unmarked.
   * A new call replaces (WITHDRAWN) a request still pending.
   */
  async setSelfValidationPolicy(actor: AuthenticatedUser, policy: SelfValidationPolicy, reason: string, requestId: string): Promise<SelfValidationPolicyOutcome> {
    requirePermission(actor, "config.selfvalidation.set");
    if (!SELF_VALIDATION_POLICIES.includes(policy)) throw new ValidationError(`Unknown self-validation policy: ${policy}`);
    // SEC-PNL-01: the effect is written before the (non-transactional) audit row, so a reason the audit cannot store must stop here.
    if (!reason || !isAcceptableReason(reason)) throw new ValidationError("A valid reason is required to change the self-validation policy");
    const why = reason.trim();

    const before = await this.get(actor);
    const relaxing = before.selfValidationPolicy === "REFUSE" && policy === "DOUBLE_CONFIRMATION";
    let approverExists = false;
    if (relaxing) {
      // Fail closed: without the means to tell whether a second person exists, never relax.
      if (!this.eligible || !this.policyRequests) throw new ValidationError("Relaxing the self-validation policy is not available");
      approverExists = await this.eligible.existsOther(actor.tenantId, actor.userId, "config.selfvalidation.approve");
    }

    // DECISION-079: every step below (withdrawing the pending request, submitting, or writing the policy) is applied
    // together with its audit rows in ONE transaction.
    const pending = this.policyRequests ? await this.policyRequests.getPending(actor.tenantId) : null;
    const expiryDays = before.policyRequestExpiryDays;
    const submit = relaxing && approverExists && this.policyRequests
      ? { policy, reason: why, by: actor.userId, expiresAt: expiryDays ? new Date(Date.now() + expiryDays * 86_400_000) : null }
      : undefined;
    const result = await this.applyPolicyChange(
      actor.tenantId,
      {
        ...(pending ? { decide: { id: pending.id, status: "WITHDRAWN" as const, by: actor.userId, reason: "Replaced by a newer change" } } : {}),
        ...(submit ? { submit } : { setPolicy: { patch: { selfValidationPolicy: policy }, updatedBy: actor.userId } }),
      },
      (r) => [
        ...(pending && r.decided
          ? [{
              tenantId: actor.tenantId, userId: actor.userId, entityType: "SelfValidationPolicyRequest", entityId: pending.id,
              action: "CLOSE" as const, oldValue: pending, newValue: null, reason: "Replaced by a newer change", requestId,
            }]
          : []),
        ...(r.submitted
          ? [{
              tenantId: actor.tenantId, userId: actor.userId, entityType: "SelfValidationPolicyRequest", entityId: r.submitted.id,
              action: "SUBMIT" as const, oldValue: null, newValue: r.submitted, reason: why, requestId,
            }]
          : []),
        ...(r.config
          ? [{
              tenantId: actor.tenantId,
              userId: actor.userId,
              entityType: "Config",
              entityId: r.config.id,
              action: "UPDATE" as const,
              oldValue: before,
              newValue: r.config,
              reason: why,
              requestId,
              ...(relaxing ? { governanceException: "config.selfvalidation.adminAlone" } : {}),
            }]
          : []),
      ],
    );
    if (result.submitted) return { config: before, pendingRequest: result.submitted };
    return { config: result.config!, pendingRequest: null };
  }

  /**
   * DECISION-079 (CMP-PNL-01): claim a request / open one / write the policy, with the audit rows, in one transaction
   * when the request repository supports it (always in server.ts). Without it (test fakes) the same steps are chained
   * and the audit is recorded after, as before; a claimed request whose effect fails is reopened.
   */
  private async applyPolicyChange(
    tenantId: string,
    change: PolicyChange,
    events: TransactionalAudit<PolicyChangeResult>,
  ): Promise<PolicyChangeResult> {
    const repo = this.policyRequests;
    const setPolicy = change.setPolicy
      ? { ...change.setPolicy, patch: await this.withFirstWriteDefault(tenantId, change.setPolicy.patch) }
      : undefined;
    const resolved: PolicyChange = { ...change, ...(setPolicy ? { setPolicy } : {}) };
    if (repo?.auditsInTransaction === true && repo.change) return repo.change(tenantId, resolved, events);

    let decided: SelfValidationPolicyRequest | null = null;
    if (resolved.decide) {
      decided = await repo!.decide(tenantId, resolved.decide.id, resolved.decide.status, resolved.decide.by, resolved.decide.reason);
      if (!decided) throw new ConflictError("This request has already been decided");
    }
    let submitted: SelfValidationPolicyRequest | null = null;
    let config: Config | null = null;
    try {
      if (resolved.submit) {
        submitted = await repo!.create(tenantId, resolved.submit.policy, resolved.submit.reason, resolved.submit.by, resolved.submit.expiresAt ?? null);
      }
      if (resolved.setPolicy) config = await this.configs.upsert(tenantId, resolved.setPolicy.patch, resolved.setPolicy.updatedBy);
    } catch (err) {
      if (resolved.decide) await repo!.reopen?.(tenantId, resolved.decide.id)?.catch(() => undefined);
      throw err;
    }
    const result = { decided, submitted, config };
    for (const event of events(result)) await this.audit.record(event);
    return result;
  }

  /** The pending relaxation, if any; visible to the administrator who asks and to the people who can approve. */
  async getPendingSelfValidationPolicyRequest(
    actor: AuthenticatedUser,
  ): Promise<(SelfValidationPolicyRequest & { expiresAt: Date | null }) | null> {
    if (!actor.roles.includes("config.selfvalidation.set")) requirePermission(actor, "config.selfvalidation.approve");
    const pending = this.policyRequests ? await this.policyRequests.getPending(actor.tenantId) : null;
    return pending ? { ...pending, expiresAt: pending.expiresAt ?? null } : null;
  }

  /** Second confirmation: never the author (maker-checker). Applies the requested policy. */
  async approveSelfValidationPolicy(actor: AuthenticatedUser, id: string, requestId: string, reason?: string): Promise<Config> {
    requirePermission(actor, "config.selfvalidation.approve");
    // The approver's own reason (CMP-PNL2): stored as decision_reason and used as the audit reason, never the requester's.
    if (reason !== undefined && !isAcceptableReason(reason)) throw new ValidationError("A valid reason is required to approve a request");
    const why = reason?.trim() ?? null;
    const request = await this.getPendingRequestOrThrow(actor, id);
    const before = await this.get(actor);
    // q174 (DECISION-083): an expired request can no longer be approved (it can still be rejected or replaced).
    // Fixed at submission (F-SAD-02): changing the delay later never revives or shortens a pending request.
    const expiresAt = request.expiresAt ?? null;
    if (expiresAt && expiresAt.getTime() <= Date.now()) {
      throw new ConflictError(`This request expired on ${expiresAt.toISOString().slice(0, 10)} and can no longer be approved`, id);
    }
    // DECISION-079: claim + policy write + audit row in one transaction (nothing applied if the audit cannot be written).
    const { config } = await this.applyPolicyChange(
      actor.tenantId,
      {
        decide: { id, status: "APPLIED", by: actor.userId, reason: why },
        setPolicy: { patch: { selfValidationPolicy: request.requestedPolicy }, updatedBy: request.requestedBy },
      },
      (r) => [
        {
          tenantId: actor.tenantId,
          userId: actor.userId,
          entityType: "Config",
          entityId: r.config!.id,
          action: "APPROVE",
          oldValue: before,
          newValue: { ...r.config!, approvedRequestId: id, requestedBy: request.requestedBy, requestReason: request.reason },
          reason: why ?? request.reason,
          requestId,
        },
      ],
    );
    return config!;
  }

  async rejectSelfValidationPolicy(actor: AuthenticatedUser, id: string, reason: string, requestId: string): Promise<SelfValidationPolicyRequest> {
    requirePermission(actor, "config.selfvalidation.approve");
    if (!reason || !isAcceptableReason(reason)) throw new ValidationError("A valid reason is required to reject a request");
    const request = await this.getPendingRequestOrThrow(actor, id);
    // DECISION-079: the rejection and its audit row in one transaction.
    const { decided } = await this.applyPolicyChange(
      actor.tenantId,
      { decide: { id, status: "REJECTED", by: actor.userId, reason: reason.trim() } },
      (r) => [
        {
          tenantId: actor.tenantId, userId: actor.userId, entityType: "SelfValidationPolicyRequest", entityId: id,
          action: "REJECT", oldValue: request, newValue: r.decided, reason: reason.trim(), requestId,
        },
      ],
    );
    return decided!;
  }

  /** Tenant-scoped lookup, still PENDING, and never the author's own request. */
  private async getPendingRequestOrThrow(actor: AuthenticatedUser, id: string): Promise<SelfValidationPolicyRequest> {
    if (!this.policyRequests) throw new NotFoundError("SelfValidationPolicyRequest", id);
    const request = await this.policyRequests.getById(actor.tenantId, id);
    if (!request) throw new NotFoundError("SelfValidationPolicyRequest", id);
    if (request.status !== "PENDING") throw new ValidationError(`This request has already been decided (${request.status})`);
    if (request.requestedBy === actor.userId) {
      throw new ForbiddenError("The author of a request cannot confirm or reject it (maker-checker)");
    }
    return request;
  }
}

export interface SelfValidationPolicyOutcome {
  config: Config;
  /** Set when the relaxation waits for a second person; `config` is then unchanged. */
  pendingRequest: SelfValidationPolicyRequest | null;
}
