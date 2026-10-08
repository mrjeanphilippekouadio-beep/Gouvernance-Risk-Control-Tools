import type { ConfigRepository } from "../domain/repositories/ConfigRepository.js";
import type { AuditRepository } from "../domain/repositories/AuditRepository.js";
import type { Config, AppetiteMode, EvaluationMode, UpdateMethodologyInput } from "../domain/entities/Config.js";
import { ValidationError } from "../domain/errors/DomainErrors.js";
import { requirePermission } from "../domain/permissions.js";
import type { AuthenticatedUser } from "../infrastructure/identity/IdentityProvider.js";
import { MIN_APPETITE_THRESHOLD, MAX_APPETITE_THRESHOLD } from "./RiskEvaluationService.js";

const SCORE_FORMULAS = ["P_X_I", "WEIGHTED_SUM"] as const;
const IMPACT_RETENU_RULES = ["MAX", "AVERAGE", "WEIGHTED_SUM"] as const;
const APPETITE_MODES = ["AUTO", "MANUEL", "AUTO_AVEC_SURCHARGE_MANUELLE"] as const;
const EVALUATION_MODES = ["CLASSIQUE", "PARTICIPATIF"] as const;

/**
 * Default shown to a tenant that has never explicitly saved a config row
 * — deliberately mirrors what's hardcoded today in RatingScaleService/
 * RiskEvaluationService (P x I, impact-retenu MAX,
 * AUTO_AVEC_SURCHARGE_MANUELLE — see RiskEvaluationService.suggestAppetite,
 * which always computes a suggestion but never blocks an override).
 * `version: 0` and `id: null` mark it as not-yet-persisted.
 */
function defaultConfig(tenantId: string): Config {
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
    committeeEvaluationMinScore: 15,
    committeeTreatmentMinScore: null,
    committeeEvaluationEnforced: true,
    version: 0,
    updatedBy: null,
    createdAt: new Date(0),
    updatedAt: new Date(0),
  };
}

function assertValidThresholds(thresholds: { label: string; min: number; max: number }[]): void {
  for (const t of thresholds) {
    if (!t.label.trim()) throw new ValidationError("Each level threshold needs a non-empty label");
    if (!Number.isInteger(t.min) || !Number.isInteger(t.max) || t.min > t.max) {
      throw new ValidationError(`Invalid threshold range for "${t.label}": min (${t.min}) must be <= max (${t.max})`);
    }
  }
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
  ) {}

  async get(actor: AuthenticatedUser): Promise<Config> {
    requirePermission(actor, "config.read");
    return (await this.configs.getByTenant(actor.tenantId)) ?? defaultConfig(actor.tenantId);
  }

  /**
   * PUT /config — ACT-220. Gated on `config.update`, a permission
   * distinct from `config.read`, and requires a mandatory reason since
   * this affects every score calculated tenant-wide ("impact immédiat
   * sur tous les calculs") — the same caution RoleService.update applies
   * to permission changes, at the "distinct permission + full audit
   * trail" bar the dispatch brief set as the minimum for this batch. A
   * full two-person propose/approve workflow was NOT built — flagged in
   * the handoff summary as an open question for Risk Manager/Architect.
   */
  async updateMethodology(
    actor: AuthenticatedUser,
    input: UpdateMethodologyInput,
    reason: string,
    requestId: string,
  ): Promise<Config> {
    requirePermission(actor, "config.update");
    if (!reason.trim()) {
      throw new ValidationError("A reason is required to change methodology settings — this affects every score calculated tenant-wide");
    }
    if (input.scoreFormula !== undefined && !SCORE_FORMULAS.includes(input.scoreFormula)) {
      throw new ValidationError(`Unknown scoreFormula: ${input.scoreFormula}`);
    }
    if (input.impactRetenuRule !== undefined && !IMPACT_RETENU_RULES.includes(input.impactRetenuRule)) {
      throw new ValidationError(`Unknown impactRetenuRule: ${input.impactRetenuRule}`);
    }
    if (input.levelThresholds !== undefined) assertValidThresholds(input.levelThresholds);

    const before = await this.get(actor);
    const after = await this.configs.upsert(actor.tenantId, input, actor.userId);

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

  /** PUT /config/appetite-mode — ACT-226. Same permission/reason bar as updateMethodology; shares the same underlying row. */
  async updateAppetiteMode(
    actor: AuthenticatedUser,
    mode: AppetiteMode,
    reason: string,
    requestId: string,
  ): Promise<Config> {
    requirePermission(actor, "config.update");
    if (!reason.trim()) {
      throw new ValidationError("A reason is required to change the appetite mode — this affects automatic appetite suggestions tenant-wide");
    }
    if (!APPETITE_MODES.includes(mode)) throw new ValidationError(`Unknown appetite mode: ${mode}`);

    const before = await this.get(actor);
    const after = await this.configs.upsert(actor.tenantId, { appetiteMode: mode }, actor.userId);

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

  /** PUT /config/evaluation-mode — DIV-06. Same permission/reason bar as updateAppetiteMode; shares the same underlying row. */
  async updateEvaluationMode(
    actor: AuthenticatedUser,
    mode: EvaluationMode,
    reason: string,
    requestId: string,
  ): Promise<Config> {
    requirePermission(actor, "config.update");
    if (!reason.trim()) {
      throw new ValidationError("A reason is required to change the evaluation mode — this affects the default risk evaluation methodology tenant-wide");
    }
    if (!EVALUATION_MODES.includes(mode)) throw new ValidationError(`Unknown evaluation mode: ${mode}`);

    const before = await this.get(actor);
    const after = await this.configs.upsert(actor.tenantId, { evaluationMode: mode }, actor.userId);

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
    const after = await this.configs.upsert(actor.tenantId, configPatch, actor.userId);

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
    if (!reason.trim()) {
      throw new ValidationError("A reason is required to change the committee validation enforcement — disabling it removes a governance control tenant-wide");
    }

    const before = await this.get(actor);
    const after = await this.configs.upsert(actor.tenantId, { committeeEvaluationEnforced: enforced }, actor.userId);

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
}
