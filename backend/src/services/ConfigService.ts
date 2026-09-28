import type { ConfigRepository } from "../domain/repositories/ConfigRepository.js";
import type { AuditRepository } from "../domain/repositories/AuditRepository.js";
import type { Config, AppetiteMode, UpdateMethodologyInput } from "../domain/entities/Config.js";
import { ValidationError } from "../domain/errors/DomainErrors.js";
import { requirePermission } from "../domain/permissions.js";
import type { AuthenticatedUser } from "../infrastructure/identity/IdentityProvider.js";

const SCORE_FORMULAS = ["P_X_I", "WEIGHTED_SUM"] as const;
const IMPACT_RETENU_RULES = ["MAX", "AVERAGE", "WEIGHTED_SUM"] as const;
const APPETITE_MODES = ["AUTO", "MANUEL", "AUTO_AVEC_SURCHARGE_MANUELLE"] as const;

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
}
