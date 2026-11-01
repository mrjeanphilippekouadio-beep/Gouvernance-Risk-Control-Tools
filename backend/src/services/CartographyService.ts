import { readerScope } from "../domain/visibility.js";
import type { RiskRepository } from "../domain/repositories/RiskRepository.js";
import type { RiskEvaluationRepository } from "../domain/repositories/RiskEvaluationRepository.js";
import type { RatingScaleRepository } from "../domain/repositories/RatingScaleRepository.js";
import type { ProcessRepository } from "../domain/repositories/ProcessRepository.js";
import type { RiskFrameworkRepository } from "../domain/repositories/RiskFrameworkRepository.js";
import type { RatingScale } from "../domain/entities/RatingScale.js";
import type { Risk } from "../domain/entities/Risk.js";
import {
  AUTHORITATIVE_EVALUATION_STATUSES,
  type AuthoritativeEvaluationStatus,
  type RiskEvaluation,
} from "../domain/entities/RiskEvaluation.js";
import type { ScoreThreshold } from "../domain/entities/RatingScale.js";
import type { Process } from "../domain/entities/Process.js";
import { ValidationError } from "../domain/errors/DomainErrors.js";
import { requirePermission } from "../domain/permissions.js";
import { DEFAULT_MATRIX_SIZE, defaultBandsForMaxScore, defaultCriticalityBands, maxScoreForScale } from "../domain/scoring.js";
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
  /** B-6b: one Dispositif at a time; defaults to the tenant's default Dispositif. Ignored when the Dispositif is not wired. */
  frameworkId?: string;
}

/** B-6b: the read side of the Dispositif the cartography needs. */
export type CartographyFrameworkReads = Pick<RiskFrameworkRepository, "getDefaultFramework" | "getFramework" | "getActiveVersion" | "getVersionById">;

/** One risk plotted on the heatmap: position (probability x impact), color (criticality), size (velocity). */
export interface CartographyDataPoint {
  riskId: string;
  /** DIV-05 wiring: `Process.name` when `Risk.processId` resolves to a real process, `Risk.process` free text otherwise — see `resolvedVia`. */
  process: string;
  /** `Risk.processId` verbatim — null when the risk was never linked to a real Process row. */
  processId: string | null;
  /**
   * Explicit marker for how `process` above was produced — never a
   * silent degradation. "processId" means the FK resolved to a real,
   * non-deleted Process row; "processText" covers every other case
   * (processId null, the repository not wired, or a stale FK pointing at
   * a process that no longer resolves).
   */
  resolvedVia: "processId" | "processText";
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
  /** B-6b (only when the Dispositif is wired): the version the evaluation is frozen on; null = "antérieure au Dispositif". */
  frameworkVersionId?: string | null;
}

export interface CartographyCompareResult {
  inherent: CartographyDataPoint[];
  residual: CartographyDataPoint[];
}

/** DECISION-041: the active scale as the Cartography page needs it (grid size + EFFECTIVE color bands). */
export interface CartographyActiveScale {
  scaleId: string;
  name: string;
  version: string;
  /** n of the n x n grid; null only for a legacy scale with probabilityLevels != impactLevels (use the two fields below). */
  size: number | null;
  probabilityLevels: number;
  impactLevels: number;
  maxScore: number;
  /** Configured criticalityThresholds, else defaultBandsForMaxScore(maxScore). */
  bands: ScoreThreshold[];
  bandsSource: "CONFIGURED" | "DEFAULT";
  /** B-6b (only when the Dispositif is wired). */
  frameworkId?: string;
  frameworkName?: string;
  frameworkVersionId?: string;
  frameworkVersionNumber?: number;
}

/** The grid view of a scale (size, ceiling, effective bands). */
function scaleView(scale: RatingScale): CartographyActiveScale {
  const maxScore = maxScoreForScale(scale);
  const configured = scale.criticalityThresholds && scale.criticalityThresholds.length > 0 ? scale.criticalityThresholds : null;
  return {
    scaleId: scale.id,
    name: scale.name,
    version: scale.version,
    size: scale.probabilityLevels === scale.impactLevels ? scale.probabilityLevels : null,
    probabilityLevels: scale.probabilityLevels,
    impactLevels: scale.impactLevels,
    maxScore,
    bands: configured ?? defaultBandsForMaxScore(maxScore),
    bandsSource: configured ? "CONFIGURED" : "DEFAULT",
  };
}

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
     * Optional — degrades to defaultCriticalityBands(n) when absent. Used
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
    /**
     * DIV-05 wiring (ACTION_ITEMS.md, 2026-09-30): optional so existing
     * construction sites keep working unchanged. When absent, every data
     * point falls back to `Risk.process` free text — same degrade-never-
     * throw posture as `ratingScales` above, but always flagged via
     * `resolvedVia`, never silently.
     */
    private readonly processes?: ProcessRepository,
    /** B-6b: when wired, the scale shown is that of the Dispositif's ACTIVE version; absent: pre-B-6b behaviour. */
    private readonly frameworks?: CartographyFrameworkReads,
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

  /** DECISION-041: active scale of the tenant with its effective bands, or null when none is active (the page then shows no grid). */
  async getActiveScale(actor: AuthenticatedUser, frameworkId?: string): Promise<CartographyActiveScale | null> {
    requirePermission(actor, "cartography.read");
    if (!this.ratingScales) return null;
    if (this.frameworks) {
      // B-6b (spec §9): the scale of the shown Dispositif's ACTIVE version; no Dispositif / no active version -> no grid.
      const framework = frameworkId
        ? await this.frameworks.getFramework(actor.tenantId, frameworkId)
        : await this.frameworks.getDefaultFramework(actor.tenantId);
      if (!framework) return null;
      const version = await this.frameworks.getActiveVersion(actor.tenantId, framework.id);
      if (!version) return null;
      const scale = await this.ratingScales.getById(actor.tenantId, version.ratingScaleId);
      if (!scale) return null;
      return {
        ...scaleView(scale),
        frameworkId: framework.id,
        frameworkName: framework.name,
        frameworkVersionId: version.id,
        frameworkVersionNumber: version.versionNumber,
      };
    }
    const active = (await this.ratingScales.list(actor.tenantId)).find((s) => s.status === "ACTIVE");
    return active ? scaleView(active) : null;
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
    const risks = await this.risks.list(actor.tenantId, undefined, readerScope(actor));
    const candidates = risks.filter((risk) => this.matchesStaticFilters(risk, filters));

    // B-6b (spec §9): one Dispositif at a time. An evaluation belongs to one through its version; rows from
    // before the Dispositif (no version) are shown with the default Dispositif WITHOUT being attached to it
    // (frameworkVersionId: null) — nothing is rewritten, no methodology is claimed that cannot be proven.
    let targetFrameworkId: string | null = null;
    let targetIsDefault = true;
    const versionFramework = new Map<string, string | null>();
    if (this.frameworks) {
      const def = await this.frameworks.getDefaultFramework(actor.tenantId);
      targetFrameworkId = filters?.frameworkId ?? def?.id ?? null;
      targetIsDefault = !filters?.frameworkId || filters.frameworkId === def?.id;
    }

    const bandsCache = new Map<string, ScoreThreshold[]>();
    const processCache = new Map<string, Process | null>();
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

      if (this.frameworks) {
        const versionId = evaluation.riskFrameworkVersionId ?? null;
        if (versionId === null) {
          if (!targetIsDefault) continue;
        } else {
          let owner = versionFramework.get(versionId);
          if (owner === undefined) {
            owner = (await this.frameworks.getVersionById(actor.tenantId, versionId))?.frameworkId ?? null;
            versionFramework.set(versionId, owner);
          }
          if (owner === null || owner !== targetFrameworkId) continue;
        }
      }

      if (filters?.subCategory && evaluation.subCategory !== filters.subCategory) continue;
      if (filters?.entity && (evaluation.entity ?? undefined) !== filters.entity) continue;

      const fields = extractVersionFields(evaluation, version);
      if (!fields) continue; // defensive: an authoritative evaluation should always have both scores set

      if (filters?.minScore !== undefined && fields.score < filters.minScore) continue;
      if (filters?.maxScore !== undefined && fields.score > filters.maxScore) continue;

      const bands = await this.resolveCriticalityBands(actor.tenantId, evaluation.ratingScaleId, bandsCache);
      const { process, resolvedVia } = await this.resolveProcessLabel(actor.tenantId, risk, processCache);

      points.push({
        riskId: risk.id,
        process,
        processId: risk.processId,
        resolvedVia,
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
        ...(this.frameworks ? { frameworkVersionId: evaluation.riskFrameworkVersionId ?? null } : {}),
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

  /**
   * DIV-05 wiring: prefer the real FK (`Risk.processId` -> `Process.name`)
   * over the free-text `Risk.process` when it resolves — falls back
   * explicitly (never silently) to the free text when `processId` is
   * null, no `ProcessRepository` is wired, or the FK is stale (points at
   * a process that no longer exists/is soft-deleted).
   */
  private async resolveProcessLabel(
    tenantId: string,
    risk: Risk,
    cache: Map<string, Process | null>,
  ): Promise<{ process: string; resolvedVia: "processId" | "processText" }> {
    if (risk.processId && this.processes) {
      let process = cache.get(risk.processId);
      if (process === undefined) {
        process = await this.processes.getById(tenantId, risk.processId);
        cache.set(risk.processId, process);
      }
      if (process) return { process: process.name, resolvedVia: "processId" };
    }
    return { process: risk.process, resolvedVia: "processText" };
  }

  private async resolveCriticalityBands(
    tenantId: string,
    ratingScaleId: string | null,
    cache: Map<string, ScoreThreshold[]>,
  ): Promise<ScoreThreshold[]> {
    if (!ratingScaleId || !this.ratingScales) return defaultCriticalityBands(DEFAULT_MATRIX_SIZE);
    const cached = cache.get(ratingScaleId);
    if (cached) return cached;

    const scale = await this.ratingScales.getById(tenantId, ratingScaleId);
    const bands =
      scale?.criticalityThresholds && scale.criticalityThresholds.length > 0
        ? scale.criticalityThresholds
        : scale ? defaultBandsForMaxScore(maxScoreForScale(scale)) : defaultCriticalityBands(DEFAULT_MATRIX_SIZE);
    cache.set(ratingScaleId, bands);
    return bands;
  }
}
