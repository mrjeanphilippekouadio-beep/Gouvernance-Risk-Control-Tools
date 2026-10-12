import type { RatingScale, ScaleLevel } from "./entities/RatingScale.js";
import { ValidationError } from "./errors/DomainErrors.js";

/**
 * B-6a: pure activation rules of a rating scale, moved out of RatingScaleService so the
 * Dispositif (RiskFrameworkService) applies exactly the same ones. Moved, not copied.
 */

/** Levels must be 1..N, contiguous, unique, with a non-empty label each. */
export function assertLevels(levels: ScaleLevel[], fieldName: string, bounds: { min: number; max: number }): void {
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

/** B-9: one descriptor per level, so exactly `size` entries (assertLevels alone accepts fewer). */
export function assertDescriptors(levels: ScaleLevel[], fieldName: string, size: number): void {
  assertLevels(levels, fieldName, { min: 1, max: size });
  if (levels.length !== size) {
    throw new ValidationError(`${fieldName} must have exactly one descriptor per level (${size})`);
  }
}

/**
 * B-9 bis (q50): descriptors are optional in DRAFT but mandatory to activate — probability,
 * impact, and every impact axis (when axes are configured) need one non-empty descriptor per level.
 */
export function assertReadyToActivate(scale: RatingScale): void {
  if (!scale.probabilityLabels) throw new ValidationError("probabilityLabels are required to activate a rating scale");
  assertDescriptors(scale.probabilityLabels, "probabilityLabels", scale.probabilityLevels);
  if (!scale.impactLabels) throw new ValidationError("impactLabels are required to activate a rating scale");
  assertDescriptors(scale.impactLabels, "impactLabels", scale.impactLevels);
  for (const axis of scale.impactAxes?.axes ?? []) {
    if (!axis.levelLabels) throw new ValidationError(`axis ${axis.code} levelLabels are required to activate a rating scale`);
    assertDescriptors(axis.levelLabels, `axis ${axis.code} levelLabels`, scale.impactLevels);
  }
}
