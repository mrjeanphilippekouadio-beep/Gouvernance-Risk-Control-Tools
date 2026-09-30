import type { RiskRepository } from "../domain/repositories/RiskRepository.js";
import type { RiskEvaluationRepository } from "../domain/repositories/RiskEvaluationRepository.js";
import type { RatingScaleRepository } from "../domain/repositories/RatingScaleRepository.js";
import type { Risk } from "../domain/entities/Risk.js";
import {
  AUTHORITATIVE_EVALUATION_STATUSES,
  type AuthoritativeEvaluationStatus,
  type RiskEvaluation,
} from "../domain/entities/RiskEvaluation.js";
import type { ScoreThreshold } from "../domain/entities/RatingScale.js";
import { ValidationError } from "../domain/errors/DomainErrors.js";
import { requirePermission } from "../domain/permissions.js";
import type { AuthenticatedUser } from "../infrastructure/identity/IdentityProvider.js";

export type CartographyVersion = "inherent" | "residual";

export interface CartographyFilters {
  entity?: string;
  subCategory?: string;
  minScore?: number;
  maxScore?: number;
  departmentId?: string;
  /**
   * ACT-183 forward-compat placeholder. `Risk` (backend/src/domain/entities/Risk.ts)
   * does not carry an individual owner field yet — a parallel RiskOwnership
   * module is adding `Risk.ownerId` in its own branch/worktree, not merged
   * at the time this module was built. Accepted here in the DTO shape so
   * the query contract doesn't need to change once that lands, but any
   * non-undefined value is currently rejected explicitly (see
   * `assertOwnerFilterSupported`) rather than silently ignored or guessed
   * at with an invented shape.
   */
  ownerId?: string;
}

/** One risk plotted on the heatmap: position (probability x impact), color (criticality), size (velocity). */
export interface CartographyDataPoint {
  riskId: string;
  process: string;
  probability: number;
  impactRetained: number;
  score: number;
  /**
   * Which terminal status the plotted evaluation actually carries —
   * VALIDATED (maker-checker) or VALIDE_COMITE (Comité des Risques
   * escalation outcome, ACT-253). Both are authoritative and plottable;
   * this is purely informational (e.g. to badge committee-validated
   * points differently), never used to exclude — exclusion already
   * happened upstream in getMostRecentAuthoritativeEvaluation.
   */
  evaluationStatus: AuthoritativeEvaluationStatus;
  criticality: string;
  /**
   * Always null today. The backlog (ACT-180) describes bubble size as
   * "vélocité", and `RatingScale.velocityLevels` (domain/entities/RatingScale.ts)
   * defines the ordinal label scale for it (ACT-172), but `RiskEvaluation`
   * (the just-shipped module this service reads from) never actually
   * captures a per-evaluation velocity score — there is no
   * `inherentVelocity`/`residualVelocity` field on it, only the abstract
   * scale configuration. This is a genuine data-model gap, not something
   * to guess a shape for here: flagged for the orchestrator so the
   * RiskEvaluation module owner can decide whether to add a velocity
   * score field (mirroring how inherent/residual probability+impact are
   * captured) in a follow-up.
   */
  velocity: null;
  entityLabel: string | null;
  departmentId: string | null;
}

export interface CartographyCompareResult {
  inherent: CartographyDataPoint[];
  residual: CartographyDataPoint[];
}

/**
 * Fixed fallback bands over the 1-25 score range used elsewhere in this
 * codebase (see RiskEvaluationService's MIN/MAX_APPETITE_THRESHOLD) —
 * applied only when no RatingScaleRepository is injected, or the
 * evaluation's captured rating scale has no `criticalityThresholds`
 * configured for its methodology.
 */
const DEFAULT_CRITICALITY_BANDS: ScoreThreshold[] = [
  { label: "Faible", min: 1, max: 4 },
  { label: "Modéré", min: 5, max: 9 },
  { label: "Élevé", min: 10, max: 15 },
  { label: "Critique", min: 16, max: 25 },
];

function deriveCriticality(score: number, bands: ScoreThreshold[]): string {
  const match = bands.find((b) => score >= b.min && score <= b.max);
  if (match) return match.label;
  // Score falls outside every configured band (e.g. a methodology change
  // narrowed the bands after this evaluation was scored) — clamp to the
  // nearest edge band rather than returning an empty/undefined label.
  const sorted = [...bands].sort((a, b) => a.min - b.min);
  const first = sorted[0];
  const last = sorted[sorted.length - 1];
  if (!first || !last) return "N/A";
  if (score < first.min) return first.label;
  if (score > last.max) return last.label;
  return "N/A";
}

interface VersionFields {
  probability: number;
  impactRetained: number;
  score: number;
}

function extractVersionFields(evaluation: RiskEvaluation, version: CartographyVersion): VersionFields | null {
  if (version === "inherent") {
    const { inherentProbability, inherentImpactRetained, inherentScore } = evaluation;
    if (inherentProbability === null || inherentImpactRetained === null || inherentScore === null) return null;
    return { probability: inherentProbability, impactRetained: inherentImpactRetained, score: inherentScore };
  }
  const { residualProbability, residualImpactRetained, residualScore } = evaluation;
  if (residualProbability === null || residualImpactRetained === null || residualScore === null) return null;
  return { probability: residualProbability, impactRetained: residualImpactRetained, score: residualScore };
}

/**
 * ACT-180/181/183/184 — the risk cartography (heatmap). Pure read-only
 * aggregation: no entity of its own, no migration, no writes, nothing to
 * audit. Composes `Risk` (process, ownerDepartmentId) with each risk's
 * most recent authoritative `RiskEvaluation` (score, criticality inputs)
 * — VALIDATED or VALIDE_COMITE, see AUTHORITATIVE_EVALUATION_STATUSES. A
 * risk with no authoritative evaluation yet has no score to plot and is
 * excluded, never defaulted.
 */
export class CartographyService {
  constructor(
    private readonly risks: RiskRepository,
    private readonly evaluations: RiskEvaluationRepository,
    /**
     * Optional — degrades to DEFAULT_CRITICALITY_BANDS when absent. Used
     * to resolve `RatingScale.criticalityThresholds` (labeled score bands
     * such as Faible/Modéré/Élevé/Critique), captured via the evaluation's
     * own `ratingScaleId` so a later methodology change never retroactively
     * relabels an already-scored evaluation.
     *
     * Design decision: `RiskAppetite` (domain/entities/RiskAppetite.ts) was
     * also a candidate source for this label, but it only stores a single
     * numeric ceiling per (subCategory, entity) — enough to say "exceeds
     * appetite" or not (a boolean), not enough to produce a labeled
     * multi-band criticality scale for a heatmap legend. RatingScale is the
     * field actually designed for this ("Shared shape for both criticality
     * thresholds (Faible..Critique)" per its own doc comment), so it was
     * used instead of RiskAppetiteRepository.
     */
    private readonly ratingScales?: RatingScaleRepository,
  ) {}

  /** ACT-180/181/183: heatmap data points for one version, with optional combinable filters. */
  async getCartography(
    actor: AuthenticatedUser,
    version: CartographyVersion = "residual",
    filters?: CartographyFilters,
  ): Promise<CartographyDataPoint[]> {
    requirePermission(actor, "cartography.read");
    this.assertOwnerFilterSupported(filters);
    return this.computeDataPoints(actor, version, filters);
  }

  /** ACT-184: inherent + residual data points for the same filtered risk set, one response. */
  async compare(actor: AuthenticatedUser, filters?: CartographyFilters): Promise<CartographyCompareResult> {
    requirePermission(actor, "cartography.read");
    this.assertOwnerFilterSupported(filters);
    const [inherent, residual] = await Promise.all([
      this.computeDataPoints(actor, "inherent", filters),
      this.computeDataPoints(actor, "residual", filters),
    ]);
    return { inherent, residual };
  }

  private assertOwnerFilterSupported(filters?: CartographyFilters): void {
    if (filters?.ownerId !== undefined) {
      throw new ValidationError(
        "Owner filtering is not yet available: Risk has no individual owner field yet (ACT-183 is blocked pending the RiskOwnership module).",
      );
    }
  }

  private async computeDataPoints(
    actor: AuthenticatedUser,
    version: CartographyVersion,
    filters?: CartographyFilters,
  ): Promise<CartographyDataPoint[]> {
    // RiskRepository.list() with no options already excludes ARCHIVED and
    // soft-deleted risks — see PostgresRiskRepository.list.
    const risks = await this.risks.list(actor.tenantId);
    const candidates = risks.filter((risk) => this.matchesStaticFilters(risk, filters));

    const bandsCache = new Map<string, ScoreThreshold[]>();
    const points: CartographyDataPoint[] = [];

    for (const risk of candidates) {
      // N+1 by design for now: RiskEvaluationRepository only exposes
      // listForRisk(riskId), not a bulk "most recent authoritative per
      // risk" query. Acceptable for the current risk-count scale of this
      // module; flagged here rather than silently adding a bulk
      // repository method (and its Postgres DISTINCT ON implementation)
      // to a neighboring, already-shipped module's interface.
      const evaluation = await this.getMostRecentAuthoritativeEvaluation(actor.tenantId, risk.id);
      if (!evaluation) continue; // no authoritative (VALIDATED/VALIDE_COMITE) evaluation yet -> excluded, never defaulted

      if (filters?.subCategory && evaluation.subCategory !== filters.subCategory) continue;
      if (filters?.entity && (evaluation.entity ?? undefined) !== filters.entity) continue;

      const fields = extractVersionFields(evaluation, version);
      if (!fields) continue; // defensive: an authoritative evaluation should always have both scores set

      if (filters?.minScore !== undefined && fields.score < filters.minScore) continue;
      if (filters?.maxScore !== undefined && fields.score > filters.maxScore) continue;

      const bands = await this.resolveCriticalityBands(actor.tenantId, evaluation.ratingScaleId, bandsCache);

      points.push({
        riskId: risk.id,
        process: risk.process,
        probability: fields.probability,
        impactRetained: fields.impactRetained,
        score: fields.score,
        // Safe: getMostRecentAuthoritativeEvaluation only ever returns an
        // evaluation whose status is in AUTHORITATIVE_EVALUATION_STATUSES.
        evaluationStatus: evaluation.status as AuthoritativeEvaluationStatus,
        criticality: deriveCriticality(fields.score, bands),
        velocity: null,
        entityLabel: evaluation.entity,
        departmentId: risk.ownerDepartmentId,
      });
    }

    return points;
  }

  private matchesStaticFilters(risk: Risk, filters?: CartographyFilters): boolean {
    if (filters?.departmentId && risk.ownerDepartmentId !== filters.departmentId) return false;
    return true;
  }

  /**
   * Most recent evaluation among the authoritative terminal statuses
   * (VALIDATED, VALIDE_COMITE), by `created_at DESC` — whichever of the
   * two is more recent wins, since neither status outranks the other
   * (2026-09-30 audit finding, ACT-253).
   */
  private async getMostRecentAuthoritativeEvaluation(tenantId: string, riskId: string): Promise<RiskEvaluation | null> {
    const results = await this.evaluations.listForRisk(tenantId, riskId, {
      status: [...AUTHORITATIVE_EVALUATION_STATUSES],
      limit: 1,
    });
    return results[0] ?? null;
  }

  private async resolveCriticalityBands(
    tenantId: string,
    ratingScaleId: string | null,
    cache: Map<string, ScoreThreshold[]>,
  ): Promise<ScoreThreshold[]> {
    if (!ratingScaleId || !this.ratingScales) return DEFAULT_CRITICALITY_BANDS;
    const cached = cache.get(ratingScaleId);
    if (cached) return cached;

    const scale = await this.ratingScales.getById(tenantId, ratingScaleId);
    const bands =
      scale?.criticalityThresholds && scale.criticalityThresholds.length > 0
        ? scale.criticalityThresholds
        : DEFAULT_CRITICALITY_BANDS;
    cache.set(ratingScaleId, bands);
    return bands;
  }
}
