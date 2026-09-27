import type { RatingScaleRepository } from "../domain/repositories/RatingScaleRepository.js";
import type { AuditRepository } from "../domain/repositories/AuditRepository.js";
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
import type { AuthenticatedUser } from "../infrastructure/identity/IdentityProvider.js";

const LEVEL_BOUNDS = { min: 1, max: 5 } as const;
const MASTERY_LEVEL_BOUNDS = { min: 1, max: 3 } as const;

function assertDimension(value: number, fieldName: string): void {
  if (!Number.isInteger(value) || value < LEVEL_BOUNDS.min || value > LEVEL_BOUNDS.max) {
    throw new ValidationError(`${fieldName} must be an integer between ${LEVEL_BOUNDS.min} and ${LEVEL_BOUNDS.max}`);
  }
}

/** Levels must be 1..N, contiguous, unique, with a non-empty label each. */
function assertLevels(levels: ScaleLevel[], fieldName: string, bounds: { min: number; max: number }): void {
  if (!Array.isArray(levels) || levels.length === 0) {
    throw new ValidationError(`${fieldName} must be a non-empty array`);
  }
  if (levels.length > bounds.max) {
    throw new ValidationError(`${fieldName} cannot have more than ${bounds.max} levels`);
  }
  const sorted = [...levels].sort((a, b) => a.level - b.level);
  for (let i = 0; i < sorted.length; i++) {
    const entry = sorted[i]!;
    if (!Number.isInteger(entry.level) || entry.level !== i + bounds.min) {
      throw new ValidationError(`${fieldName} must have contiguous levels starting at ${bounds.min}`);
    }
    if (!entry.label?.trim()) {
      throw new ValidationError(`${fieldName}[${entry.level}] requires a non-empty label`);
    }
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

function assertActive(scale: RatingScale): void {
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
    if (input.probabilityLabels) {
      assertLevels(input.probabilityLabels, "probabilityLabels", { min: 1, max: input.probabilityLevels });
    }
    if (input.impactLabels) {
      assertLevels(input.impactLabels, "impactLabels", { min: 1, max: input.impactLevels });
    }

    const scale = await this.ratingScales.create({ ...input, tenantId: actor.tenantId });

    await this.audit.record({
      tenantId: actor.tenantId,
      userId: actor.userId,
      entityType: "RatingScale",
      entityId: scale.id,
      action: "CREATE",
      oldValue: null,
      newValue: scale,
      reason: null,
      requestId,
    });

    return scale;
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
    assertActive(before);
    assertThresholds(input.thresholds, "thresholds");

    const after = await this.ratingScales.updateThresholds(actor.tenantId, id, input.thresholds);
    await this.recordUpdate(actor, id, before, after, requestId);
    return after;
  }

  async updateImpactAxes(
    actor: AuthenticatedUser,
    id: string,
    input: UpdateImpactAxesInput,
    requestId: string,
  ): Promise<RatingScale> {
    requirePermission(actor, "ratingscale.update");
    const before = await this.get(actor, id);
    assertActive(before);

    if (!Array.isArray(input.axes) || input.axes.length === 0) {
      throw new ValidationError("axes must be a non-empty array");
    }
    const codes = new Set<string>();
    const orders = new Set<number>();
    for (const axis of input.axes) {
      if (!axis.code?.trim()) throw new ValidationError("each impact axis requires a non-empty code");
      if (!axis.label?.trim()) throw new ValidationError("each impact axis requires a non-empty label");
      if (codes.has(axis.code)) throw new ValidationError(`duplicate impact axis code: ${axis.code}`);
      if (orders.has(axis.order)) throw new ValidationError(`duplicate impact axis order: ${axis.order}`);
      codes.add(axis.code);
      orders.add(axis.order);
    }

    const after = await this.ratingScales.updateImpactAxes(actor.tenantId, id, {
      axes: input.axes,
      retainedImpactRule: input.retainedImpactRule ?? "MAX",
    });
    await this.recordUpdate(actor, id, before, after, requestId);
    return after;
  }

  async updateVelocity(
    actor: AuthenticatedUser,
    id: string,
    input: UpdateVelocityInput,
    requestId: string,
  ): Promise<RatingScale> {
    requirePermission(actor, "ratingscale.update");
    const before = await this.get(actor, id);
    assertActive(before);
    assertLevels(input.levels, "velocity levels", LEVEL_BOUNDS);

    const after = await this.ratingScales.updateVelocity(actor.tenantId, id, input.levels);
    await this.recordUpdate(actor, id, before, after, requestId);
    return after;
  }

  async updatePersistence(
    actor: AuthenticatedUser,
    id: string,
    input: UpdatePersistenceInput,
    requestId: string,
  ): Promise<RatingScale> {
    requirePermission(actor, "ratingscale.update");
    const before = await this.get(actor, id);
    assertActive(before);
    assertLevels(input.levels, "persistence levels", LEVEL_BOUNDS);

    const after = await this.ratingScales.updatePersistence(actor.tenantId, id, input.levels);
    await this.recordUpdate(actor, id, before, after, requestId);
    return after;
  }

  async updateMastery(
    actor: AuthenticatedUser,
    id: string,
    input: UpdateMasteryInput,
    requestId: string,
  ): Promise<RatingScale> {
    requirePermission(actor, "ratingscale.update");
    const before = await this.get(actor, id);
    assertActive(before);
    assertLevels(input.levels, "mastery levels", MASTERY_LEVEL_BOUNDS);
    if (!Array.isArray(input.defenseLines) || input.defenseLines.length === 0) {
      throw new ValidationError("defenseLines must be a non-empty array");
    }
    if (new Set(input.defenseLines).size !== input.defenseLines.length) {
      throw new ValidationError("defenseLines must not contain duplicates");
    }
    if (input.thresholds) assertThresholds(input.thresholds, "mastery thresholds");

    const after = await this.ratingScales.updateMastery(actor.tenantId, id, {
      levels: input.levels,
      defenseLines: input.defenseLines,
      // Fixed by methodology (ACT-175: "maîtrise globale = moyenne") —
      // not caller-configurable today.
      aggregation: "AVERAGE",
      thresholds: input.thresholds ?? null,
    });
    await this.recordUpdate(actor, id, before, after, requestId);
    return after;
  }

  /**
   * ACT-176: activates `id` and archives whatever scale was previously
   * ACTIVE for this tenant, atomically. Never a generic `update()` path —
   * this is the only way status can move to ACTIVE or (as a side effect)
   * to ARCHIVED.
   */
  async activateVersion(actor: AuthenticatedUser, id: string, requestId: string): Promise<RatingScale> {
    requirePermission(actor, "ratingscale.update");
    const before = await this.get(actor, id);
    if (before.status === "ARCHIVED") {
      throw new ValidationError("Cannot re-activate an archived rating scale — create a new version instead");
    }

    const after = await this.ratingScales.activateAndArchivePrevious(actor.tenantId, id);

    await this.audit.record({
      tenantId: actor.tenantId,
      userId: actor.userId,
      entityType: "RatingScale",
      entityId: id,
      action: "STATUS_CHANGE",
      oldValue: before,
      newValue: after,
      reason: null,
      requestId,
    });

    return after;
  }

  /** ACT-177: soft-delete. The currently ACTIVE methodology must be replaced (activateVersion on a new one) before it can be disabled. */
  async disable(actor: AuthenticatedUser, id: string, reason: string, requestId: string): Promise<void> {
    requirePermission(actor, "ratingscale.delete");
    if (!reason.trim()) throw new ValidationError("A reason is required to disable a rating scale");
    const before = await this.get(actor, id);
    if (before.status === "ACTIVE") {
      throw new ValidationError("Cannot disable the active rating scale — activate a replacement first");
    }

    await this.ratingScales.softDelete(actor.tenantId, id, actor.userId, reason);

    await this.audit.record({
      tenantId: actor.tenantId,
      userId: actor.userId,
      entityType: "RatingScale",
      entityId: id,
      action: "DELETE",
      oldValue: before,
      newValue: null,
      reason,
      requestId,
    });
  }

  private async recordUpdate(
    actor: AuthenticatedUser,
    id: string,
    before: RatingScale,
    after: RatingScale,
    requestId: string,
  ): Promise<void> {
    await this.audit.record({
      tenantId: actor.tenantId,
      userId: actor.userId,
      entityType: "RatingScale",
      entityId: id,
      action: "UPDATE",
      oldValue: before,
      newValue: after,
      reason: null,
      requestId,
    });
  }
}
