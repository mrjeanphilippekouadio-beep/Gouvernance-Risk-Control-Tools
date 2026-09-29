/**
 * Djamo's risk rating methodology (ACT-170 to ACT-177): a single
 * versioned "rating scale" (probability x impact grid) plus the
 * sub-configurations that go with it — criticality thresholds, the 7
 * impact axes, velocity, persistence and the mastery (control adequacy)
 * scale.
 *
 * Design decision: one row per methodology version (`rating_scales`,
 * in-place update pattern like Department/Process), with the
 * sub-configurations stored as JSONB columns rather than their own
 * tables. They are structured *lists of values* the admin configures
 * together as one methodology, not entities with an independent
 * lifecycle, ownership, or cross-module references — nothing else in
 * the domain points at "impact axis #3" by id the way ControlExecution
 * points at a Control. JSONB keeps the whole methodology atomic (one
 * row, one `updated_at`, one audit trail) and keeps this module's
 * blast radius to a single table, matching the instruction to stay
 * within one module's scope. If a sub-configuration ever needs its own
 * identity (e.g. an impact axis referenced by id from Risk assessments),
 * split it out into its own table + repository at that point.
 */

export type RatingScaleStatus = "DRAFT" | "ACTIVE" | "ARCHIVED";

/** Shared shape for both criticality thresholds (Faible..Critique) and mastery thresholds (SEUILS_MAITRISE). */
export interface ScoreThreshold {
  label: string;
  min: number;
  max: number;
}

/** One level of an ordinal 1..N scale (probability, impact, velocity, persistence, mastery). */
export interface ScaleLevel {
  level: number;
  label: string;
}

export interface ImpactAxis {
  code: string;
  label: string;
  order: number;
}

export type RetainedImpactRule = "MAX" | "AVERAGE" | "WEIGHTED_SUM";

export interface ImpactAxesConfig {
  axes: ImpactAxis[];
  /** Legacy CONFIG.IMPACT_RETENU_RULE — how the retained impact score is derived across axes. */
  retainedImpactRule: RetainedImpactRule;
}

export interface MasteryScaleConfig {
  /** 1..3, Inadéquat -> Adéquat. */
  levels: ScaleLevel[];
  /** The 3 lines of defense the mastery score is assessed per (L1/L2/L3). */
  defenseLines: string[];
  /** CHALLENGE-001 (PO decision, 2026-09-29): "on prend le max de tous les axes" — always "MAX" today. Supersedes ACT-175's original "maîtrise globale = moyenne". */
  aggregation: "MAX";
  /** CONFIG.SEUILS_MAITRISE — optional until configured. */
  thresholds: ScoreThreshold[] | null;
}

export interface RatingScale {
  id: string;
  tenantId: string;
  name: string;
  version: string;
  status: RatingScaleStatus;
  /** n_proba, 1-5. */
  probabilityLevels: number;
  probabilityLabels: ScaleLevel[] | null;
  /** n_impact, 1-5. */
  impactLevels: number;
  impactLabels: ScaleLevel[] | null;
  criticalityThresholds: ScoreThreshold[] | null;
  impactAxes: ImpactAxesConfig | null;
  velocityLevels: ScaleLevel[] | null;
  persistenceLevels: ScaleLevel[] | null;
  masteryScale: MasteryScaleConfig | null;
  activatedAt: Date | null;
  archivedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
  deletedAt: Date | null;
  deletedBy: string | null;
  deletionReason: string | null;
}

export interface CreateRatingScaleInput {
  tenantId: string;
  name: string;
  version: string;
  probabilityLevels: number;
  impactLevels: number;
  probabilityLabels?: ScaleLevel[] | null;
  impactLabels?: ScaleLevel[] | null;
}

export interface UpdateThresholdsInput {
  thresholds: ScoreThreshold[];
}

export interface UpdateImpactAxesInput {
  axes: ImpactAxis[];
  retainedImpactRule?: RetainedImpactRule;
}

export interface UpdateVelocityInput {
  levels: ScaleLevel[];
}

export interface UpdatePersistenceInput {
  levels: ScaleLevel[];
}

export interface UpdateMasteryInput {
  levels: ScaleLevel[];
  defenseLines: string[];
  thresholds?: ScoreThreshold[] | null;
}
