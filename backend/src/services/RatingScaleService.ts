import type { RatingScaleRepository } from "../domain/repositories/RatingScaleRepository.js";
import type { AuditRepository } from "../domain/repositories/AuditRepository.js";
import type { RiskEvaluationRepository } from "../domain/repositories/RiskEvaluationRepository.js";
import type {
  CreateRatingScaleInput,
  RatingScale,
  ScaleLevel,
  ScoreThreshold,
  UpdateImpactAxesInput,
  UpdateMasteryInput,
  UpdatePersistenceInput,
  UpdateThresholdsInput,
  UpdateVelocityInput,
} from "../domain/entities/RatingScale.js";
import { NotFoundError, ValidationError } from "../domain/errors/DomainErrors.js";
import { requirePermission } from "../domain/permissions.js";
import type { RiskAppetiteRepository } from "../domain/repositories/RiskAppetiteRepository.js";
import type { ConfigRepository } from "../domain/repositories/ConfigRepository.js";
import { maxScoreForScale } from "../domain/scoring.js";
import { assertDescriptors, assertLevels, assertReadyToActivate } from "../domain/ratingScaleRules.js";
import type { RiskFrameworkRepository } from "../domain/repositories/RiskFrameworkRepository.js";
import { FRAMEWORK_OWNS_SETTING_MESSAGE } from "./riskFrameworkResolution.js";
import type { TransactionalAudit } from "../domain/entities/RiskFramework.js";
import type { AuditEvent } from "../domain/entities/AuditEvent.js";
import type { AuthenticatedUser } from "../infrastructure/identity/IdentityProvider.js";

const LEVEL_BOUNDS = { min: 1, max: 5 } as const;
/** B-9 (F-13): size of the probability scale and of every impact axis — one value for both, 3 to 6. */
const SCALE_SIZE_BOUNDS = { min: 3, max: 6 } as const;
/** B-9: ceiling, never a count to assume (the axes in use come from the scale itself). */
const MAX_IMPACT_AXES = 7;
const MASTERY_LEVEL_BOUNDS = { min: 1, max: 3 } as const;

function assertDimension(value: number, fieldName: string): void {
  if (!Number.isInteger(value) || value < SCALE_SIZE_BOUNDS.min || value > SCALE_SIZE_BOUNDS.max) {
    throw new ValidationError(
      `${fieldName} must be an integer between ${SCALE_SIZE_BOUNDS.min} and ${SCALE_SIZE_BOUNDS.max}`,
    );
  }
}

/** Thresholds must be non-empty, each range valid, and ranges must not overlap. */
function assertThresholds(thresholds: ScoreThreshold[], fieldName: string): void {
  if (!Array.isArray(thresholds) || thresholds.length === 0) {
    throw new ValidationError(`${fieldName} must be a non-empty array`);
  }
  for (const t of thresholds) {
    if (!t.label?.trim()) throw new ValidationError(`${fieldName} entries require a non-empty label`);
    if (!Number.isInteger(t.min) || !Number.isInteger(t.max) || t.min < 1 || t.max < t.min) {
      throw new ValidationError(`${fieldName} entry "${t.label}" has an invalid range`);
    }
  }
  const sorted = [...thresholds].sort((a, b) => a.min - b.min);
  for (let i = 1; i < sorted.length; i++) {
    const previous = sorted[i - 1]!;
    const current = sorted[i]!;
    if (current.min <= previous.max) {
      throw new ValidationError(
        `${fieldName} ranges must not overlap ("${previous.label}" and "${current.label}" overlap)`,
      );
    }
  }
}

/**
 * R-01: a rating scale is only mutable in DRAFT. Once ACTIVE, every
 * evaluation created under it snapshots `ratingScaleId`/`ratingScaleVersion`
 * expecting that version's content to stay fixed — allowing in-place edits
 * on an ACTIVE scale (the previous behavior here only blocked ARCHIVED)
 * would silently rewrite the methodology behind already-scored
 * evaluations and historical Cartography bands. Changing a methodology
 * now always means: create a new DRAFT version, then activateVersion.
 */
function assertMutable(scale: RatingScale): void {
  if (scale.status === "ACTIVE") {
    throw new ValidationError("Cannot modify an active rating scale — create a new version instead");
  }
  if (scale.status === "ARCHIVED") {
    throw new ValidationError("Cannot modify an archived rating scale — create a new version instead");
  }
}

/**
 * Mirrors the methodology described in the legacy CONFIG sheet
 * (n_proba x n_impact grid, 7 impact axes, velocity/persistence assessed
 * separately from the P x I score, mastery scored per line of defense).
 * One row per version (in-place update, like Department/Process); the
 * sub-configurations are narrow dedicated methods (like
 * `designateRiskOwner`), never a generic partial `update()` — each has
 * its own shape and validation rules.
 */
export class RatingScaleService {
  constructor(
    private readonly ratingScales: RatingScaleRepository,
    private readonly audit: AuditRepository,
    /**
     * R-01: mandatory, not optional — `disable()`'s guard against
     * soft-deleting a scale that evaluations still reference (so an
     * ARCHIVED version's historical interpretability, readable via
     * getById regardless of status, can never be revoked) must not
     * depend on whether a caller happened to wire it. A fresh
     * RatingScaleService can no longer be constructed without this
     * protection in place.
     */
    private readonly riskEvaluations: Pick<RiskEvaluationRepository, "existsForRatingScale">,
    /**
     * F-B9b-01: optional (guarded) so existing construction sites keep working. When wired,
     * activateVersion refuses a scale whose ceiling is below an active appetite / Comité threshold.
     */
    private readonly riskAppetites?: Pick<RiskAppetiteRepository, "list">,
    private readonly configs?: Pick<ConfigRepository, "getByTenant">,
    /** B-6b-01 (spec §3): when wired (server.ts) the Dispositif owns "the active scale"; activateVersion is closed. */
    private readonly frameworks?: Pick<RiskFrameworkRepository, "listFrameworks">,
  ) {}

  async create(
    actor: AuthenticatedUser,
    input: Omit<CreateRatingScaleInput, "tenantId">,
    requestId: string,
  ): Promise<RatingScale> {
    requirePermission(actor, "ratingscale.create");
    if (!input.name.trim()) throw new ValidationError("name is required");
    if (!input.version.trim()) throw new ValidationError("version is required");
    assertDimension(input.probabilityLevels, "probabilityLevels");
    assertDimension(input.impactLevels, "impactLevels");
    // B-9 / contract §6: probability and every impact axis share one scale size.
    if (input.probabilityLevels !== input.impactLevels) {
      throw new ValidationError("probabilityLevels and impactLevels must be equal");
    }
    if (input.probabilityLabels) {
      assertDescriptors(input.probabilityLabels, "probabilityLabels", input.probabilityLevels);
    }
    if (input.impactLabels) {
      assertDescriptors(input.impactLabels, "impactLabels", input.impactLevels);
    }

    return this.audited(
      (scale) => [this.event(actor, scale.id, "CREATE", null, scale, null, requestId)],
      (audit) => this.ratingScales.create({ ...input, tenantId: actor.tenantId }, audit),
    );
  }

  async get(actor: AuthenticatedUser, id: string): Promise<RatingScale> {
    requirePermission(actor, "ratingscale.read");
    const scale = await this.ratingScales.getById(actor.tenantId, id);
    if (!scale) throw new NotFoundError("RatingScale", id);
    return scale;
  }

  async list(actor: AuthenticatedUser, includeArchived = false): Promise<RatingScale[]> {
    requirePermission(actor, "ratingscale.read");
    return this.ratingScales.list(actor.tenantId, { includeArchived });
  }

  async updateThresholds(
    actor: AuthenticatedUser,
    id: string,
    input: UpdateThresholdsInput,
    requestId: string,
  ): Promise<RatingScale> {
    requirePermission(actor, "ratingscale.update");
    const before = await this.get(actor, id);
    assertMutable(before);
    assertThresholds(input.thresholds, "thresholds");
    // B-9 bis (q49): no band may reach above the matrix's score ceiling n².
    const ceiling = maxScoreForScale(before);
    if (input.thresholds.some((t) => t.max > ceiling)) {
      throw new ValidationError(`thresholds cannot exceed the maximum score of this scale (${ceiling})`);
    }

    return this.audited(
      (after) => [this.event(actor, id, "UPDATE", before, after, null, requestId)],
      (audit) => this.ratingScales.updateThresholds(actor.tenantId, id, input.thresholds, audit),
    );
  }

  async updateImpactAxes(
    actor: AuthenticatedUser,
    id: string,
    input: UpdateImpactAxesInput,
    requestId: string,
  ): Promise<RatingScale> {
    requirePermission(actor, "ratingscale.update");
    const before = await this.get(actor, id);
    assertMutable(before);

    if (!Array.isArray(input.axes) || input.axes.length === 0) {
      throw new ValidationError("axes must be a non-empty array");
    }
    if (input.axes.length > MAX_IMPACT_AXES) {
      throw new ValidationError(`axes cannot have more than ${MAX_IMPACT_AXES} impact axes`);
    }
    const codes = new Set<string>();
    const orders = new Set<number>();
    for (const axis of input.axes) {
      if (!axis.code?.trim()) throw new ValidationError("each impact axis requires a non-empty code");
      if (!axis.label?.trim()) throw new ValidationError("each impact axis requires a non-empty label");
      if (codes.has(axis.code)) throw new ValidationError(`duplicate impact axis code: ${axis.code}`);
      if (orders.has(axis.order)) throw new ValidationError(`duplicate impact axis order: ${axis.order}`);
      // B-9: when supplied, an axis carries one descriptor per level of the scale's impact size.
      if (axis.levelLabels) assertDescriptors(axis.levelLabels, `axis ${axis.code} levelLabels`, before.impactLevels);
      codes.add(axis.code);
      orders.add(axis.order);
    }

    return this.audited(
      (after) => [this.event(actor, id, "UPDATE", before, after, null, requestId)],
      (audit) => this.ratingScales.updateImpactAxes(actor.tenantId, id, {
        axes: input.axes,
        retainedImpactRule: input.retainedImpactRule ?? "MAX",
      }, audit),
    );
  }

  async updateVelocity(
    actor: AuthenticatedUser,
    id: string,
    input: UpdateVelocityInput,
    requestId: string,
  ): Promise<RatingScale> {
    requirePermission(actor, "ratingscale.update");
    const before = await this.get(actor, id);
    assertMutable(before);
    assertLevels(input.levels, "velocity levels", LEVEL_BOUNDS);

    return this.audited(
      (after) => [this.event(actor, id, "UPDATE", before, after, null, requestId)],
      (audit) => this.ratingScales.updateVelocity(actor.tenantId, id, input.levels, audit),
    );
  }

  async updatePersistence(
    actor: AuthenticatedUser,
    id: string,
    input: UpdatePersistenceInput,
    requestId: string,
  ): Promise<RatingScale> {
    requirePermission(actor, "ratingscale.update");
    const before = await this.get(actor, id);
    assertMutable(before);
    assertLevels(input.levels, "persistence levels", LEVEL_BOUNDS);

    return this.audited(
      (after) => [this.event(actor, id, "UPDATE", before, after, null, requestId)],
      (audit) => this.ratingScales.updatePersistence(actor.tenantId, id, input.levels, audit),
    );
  }

  async updateMastery(
    actor: AuthenticatedUser,
    id: string,
    input: UpdateMasteryInput,
    requestId: string,
  ): Promise<RatingScale> {
    requirePermission(actor, "ratingscale.update");
    const before = await this.get(actor, id);
    assertMutable(before);
    assertLevels(input.levels, "mastery levels", MASTERY_LEVEL_BOUNDS);
    if (!Array.isArray(input.defenseLines) || input.defenseLines.length === 0) {
      throw new ValidationError("defenseLines must be a non-empty array");
    }
    if (new Set(input.defenseLines).size !== input.defenseLines.length) {
      throw new ValidationError("defenseLines must not contain duplicates");
    }
    if (input.thresholds) assertThresholds(input.thresholds, "mastery thresholds");

    return this.audited(
      (after) => [this.event(actor, id, "UPDATE", before, after, null, requestId)],
      (audit) => this.ratingScales.updateMastery(actor.tenantId, id, {
        levels: input.levels,
        defenseLines: input.defenseLines,
        // CHALLENGE-001 (PO decision, 2026-09-29, corrected after Risk Manager
        // review): lines of defense are not compensatory — not caller-configurable today.
        aggregation: "MIN",
        thresholds: input.thresholds ?? null,
      }, audit),
    );
  }

  /**
   * F-B9b-01 (fail-closed): an active threshold above the new scale's ceiling could never be
   * reached, silently disabling the appetite / Comité control. Refuse the activation instead.
   */
  private async assertThresholdsFitCeiling(tenantId: string, scale: RatingScale): Promise<void> {
    const ceiling = maxScoreForScale(scale);
    const over: string[] = [];
    for (const b of scale.criticalityThresholds ?? []) {
      if (b.max > ceiling) over.push(`bande "${b.label}" (${b.max})`);
    }
    if (this.riskAppetites) {
      for (const a of await this.riskAppetites.list(tenantId, { activeOnly: true })) {
        if (a.threshold > ceiling) over.push(`appétence "${a.subCategory}" (${a.threshold})`);
      }
    }
    const config = this.configs ? await this.configs.getByTenant(tenantId) : null;
    if (config && config.committeeEvaluationMinScore > ceiling) over.push(`seuil Comité évaluation (${config.committeeEvaluationMinScore})`);
    if (config && config.committeeTreatmentMinScore !== null && config.committeeTreatmentMinScore > ceiling) {
      over.push(`seuil Comité traitement (${config.committeeTreatmentMinScore})`);
    }
    if (over.length > 0) {
      throw new ValidationError(
        `Cannot activate: these thresholds exceed the maximum score of the new scale (${ceiling}): ${over.join(", ")}. Lower them first, then activate.`,
      );
    }
  }

  /**
   * ACT-176: activates `id` and archives whatever scale was previously
   * ACTIVE for this tenant, atomically. Never a generic `update()` path —
   * this is the only way status can move to ACTIVE or (as a side effect)
   * to ARCHIVED.
   */
  async activateVersion(actor: AuthenticatedUser, id: string, requestId: string): Promise<RatingScale> {
    requirePermission(actor, "ratingscale.delete");
    // B-6b-01: the scale in force is the one referenced by the ACTIVE version of a Dispositif (it is mirrored
    // from there by PostgresRiskFrameworkRepository); activating one here would be a second writer.
    if (this.frameworks) {
      throw new ValidationError(`${FRAMEWORK_OWNS_SETTING_MESSAGE} (référencez cette échelle dans une nouvelle version du Dispositif)`);
    }
    const before = await this.get(actor, id);
    if (before.status === "ARCHIVED") {
      throw new ValidationError("Cannot re-activate an archived rating scale — create a new version instead");
    }
    assertReadyToActivate(before);
    await this.assertThresholdsFitCeiling(actor.tenantId, before);

    return this.audited(
      (after) => [this.event(actor, id, "STATUS_CHANGE", before, after, null, requestId)],
      (audit) => this.ratingScales.activateAndArchivePrevious(actor.tenantId, id, audit),
    );
  }

  /**
   * ACT-177: soft-delete. The currently ACTIVE methodology must be
   * replaced (activateVersion on a new one) before it can be disabled.
   *
   * R-01: a version — ACTIVE or already ARCHIVED — that at least one
   * evaluation still references by `ratingScaleId` can never be
   * soft-deleted. `getById` ignores `status` and only filters
   * `deleted_at`, which is precisely what keeps an ARCHIVED version
   * historically readable (Cartography, evaluation detail) — a
   * soft-delete would make `getById` return null and silently fall back
   * to default criticality bands / "no longer exists" for evaluations
   * that were already scored under it.
   */
  async disable(actor: AuthenticatedUser, id: string, reason: string, requestId: string): Promise<void> {
    requirePermission(actor, "ratingscale.delete");
    if (!reason.trim()) throw new ValidationError("A reason is required to disable a rating scale");
    const before = await this.get(actor, id);
    if (before.status === "ACTIVE") {
      throw new ValidationError("Cannot disable the active rating scale — activate a replacement first");
    }
    if (await this.riskEvaluations.existsForRatingScale(actor.tenantId, id)) {
      throw new ValidationError(
        "Cannot disable a rating scale that is still referenced by one or more evaluations — its history must remain interpretable",
      );
    }

    if (await this.ratingScales.isReferencedByFrameworkVersion?.(actor.tenantId, id)) {
      throw new ValidationError(
        "Cannot disable a rating scale that a Dispositif version references (draft or not) — change the version's scale first",
      );
    }

    await this.audited(
      () => [this.event(actor, id, "DELETE", before, null, reason, requestId)],
      (audit) => this.ratingScales.softDelete(actor.tenantId, id, actor.userId, reason, audit),
    );
  }

  private event(
    actor: AuthenticatedUser,
    entityId: string,
    action: "CREATE" | "UPDATE" | "STATUS_CHANGE" | "DELETE",
    oldValue: unknown,
    newValue: unknown,
    reason: string | null,
    requestId: string,
  ): Omit<AuditEvent, "id" | "timestamp"> {
    return { tenantId: actor.tenantId, userId: actor.userId, entityType: "RatingScale", entityId, action, oldValue, newValue, reason, requestId };
  }

  /**
   * F-D044-03: the audit rows go in the transaction of the write when the repository supports it
   * (so a lost audit row rolls the write back); otherwise (test fakes) they are recorded right after.
   */
  private async audited<R>(build: TransactionalAudit<R>, run: (audit?: TransactionalAudit<R>) => Promise<R>): Promise<R> {
    if (this.ratingScales.auditsInTransaction === true) return run(build);
    const result = await run();
    for (const e of build(result)) await this.audit.record(e);
    return result;
  }
}
