import type { RiskEvaluationRepository } from "../domain/repositories/RiskEvaluationRepository.js";
import type { AuditRepository } from "../domain/repositories/AuditRepository.js";
import type { RiskRepository } from "../domain/repositories/RiskRepository.js";
import type { RatingScaleRepository } from "../domain/repositories/RatingScaleRepository.js";
import type { RiskAppetiteRepository } from "../domain/repositories/RiskAppetiteRepository.js";
import type { ProcessRepository } from "../domain/repositories/ProcessRepository.js";
import type { ConfigRepository } from "../domain/repositories/ConfigRepository.js";
import type { ImpactAxis, RatingScale, RetainedImpactRule } from "../domain/entities/RatingScale.js";
import { PROCESS_LEVEL_BY_RANK, resolveInheritedEvaluationMode, type Process } from "../domain/entities/Process.js";
import type { EvaluationMode } from "../domain/entities/Config.js";
import type {
  CreateRiskEvaluationInput,
  ImpactAxisScore,
  ListRiskEvaluationsOptions,
  MasteryLineScore,
  RiskEvaluation,
  RiskEvaluationType,
} from "../domain/entities/RiskEvaluation.js";
import { ForbiddenError, NotFoundError, ValidationError } from "../domain/errors/DomainErrors.js";
import { requirePermission } from "../domain/permissions.js";
import { defaultCommitteeThreshold, maxScoreForScale } from "../domain/scoring.js";
import { resolveMaxScore } from "./scoreCeiling.js";
import type { RiskCategoryRepository } from "../domain/repositories/RiskCategoryRepository.js";
import type { RiskFrameworkRepository } from "../domain/repositories/RiskFrameworkRepository.js";
import { findAppetite } from "../domain/frameworkAppetite.js";
import { NO_APPLICABLE_FRAMEWORK_MESSAGE, resolveApplicableVersion } from "./riskFrameworkResolution.js";

/** B-6b: the read side of the Dispositif this service needs. */
export type FrameworkReads = Pick<RiskFrameworkRepository, "getDefaultFramework" | "getProcessFrameworkId" | "getActiveVersion" | "getVersionById">;
import type { AuthenticatedUser } from "../infrastructure/identity/IdentityProvider.js";

/** Mirrors ConfigService's own defaultConfig()/030_evaluation_mode.sql's DB default — the tenant-wide fallback when no Config row exists yet and/or no ConfigRepository is wired. */
const FALLBACK_EVALUATION_MODE: EvaluationMode = "CLASSIQUE";

const EVALUATION_TYPES: RiskEvaluationType[] = ["AD_HOC", "ANNUELLE", "ANTICIPEE"];
/** Exported for ConfigService's committee-threshold bounds validation. The upper bound is n² of the active scale (B-9 bis), see domain/scoring.ts. */
export const MIN_APPETITE_THRESHOLD = 1;
/**
 * Lot A (RISK_MANAGEMENT_V1 §8) — these are the fail-closed defaults used
 * when no ConfigRepository is wired or no Config row exists yet for the
 * tenant. They mirror the pre-Lot-A hardcoded constant (15, always
 * enforced) so a test/caller that never configures Config never silently
 * reopens the authorization gap this lot closes. Never make these more
 * permissive.
 */
const COMMITTEE_EVALUATION_ENFORCED_DEFAULT = true;

export interface InherentScoringRequest {
  probability: number;
  impacts: ImpactAxisScore[];
}

export interface MasteryAssessmentRequest {
  lines: MasteryLineScore[];
}

export interface ResidualScoringRequest {
  probability: number;
  impacts: ImpactAxisScore[];
  justification: string;
  /** Evaluator override of the auto-suggested appetite threshold — stored, never blocked (ACT-155). */
  appetiteOverride?: number | null;
}

export interface AppetiteSuggestion {
  subCategory: string;
  entity: string | null;
  suggested: number | null;
  methodologyVersion: string | null;
}

export interface AppetiteComparison {
  residualScore: number;
  /** q145: false = evaluation with a legacy free label (threshold matched by label, may be missing or wrong). */
  linkedToCategory: boolean;
  threshold: number | null;
  source: "OVERRIDE" | "AUTO" | "NONE";
  exceeded: boolean | null;
}

function assertMutable(evaluation: RiskEvaluation): void {
  if (evaluation.status !== "BROUILLON") {
    throw new ValidationError(
      `This evaluation has already been finalized (${evaluation.status}) and cannot be modified further`,
    );
  }
}

/**
 * SEC-011: the scoring setters must be gated to the designated evaluator, not
 * just to `riskevaluation.update` — otherwise the maker-checker guard in
 * validate()/reject() (comparing actor.userId to evaluatorId) fires too late,
 * after a third party has already written the scoring content.
 */
function assertIsEvaluator(actor: AuthenticatedUser, evaluation: RiskEvaluation): void {
  if (evaluation.evaluatorId !== actor.userId) {
    throw new ForbiddenError("Only the designated evaluator can record scoring on this evaluation");
  }
}

function assertIntegerInRange(value: number, min: number, max: number, fieldName: string): void {
  if (!Number.isInteger(value) || value < min || value > max) {
    throw new ValidationError(`${fieldName} must be an integer between ${min} and ${max}`);
  }
}

function assertImpacts(impacts: ImpactAxisScore[], axes: ImpactAxis[], maxLevel: number): void {
  if (!Array.isArray(impacts) || impacts.length !== axes.length) {
    throw new ValidationError(`impacts must supply exactly one score for each of the ${axes.length} configured impact axes`);
  }
  const expectedCodes = new Set(axes.map((a) => a.code));
  const seenCodes = new Set<string>();
  for (const impact of impacts) {
    if (!expectedCodes.has(impact.code)) {
      throw new ValidationError(`Unknown impact axis code: ${impact.code}`);
    }
    if (seenCodes.has(impact.code)) {
      throw new ValidationError(`Duplicate impact axis code: ${impact.code}`);
    }
    seenCodes.add(impact.code);
    assertIntegerInRange(impact.value, 1, maxLevel, `impact axis ${impact.code}`);
  }
}

/** Impact retenu = MAX (or AVERAGE) of the configured axes' scores — config rule, never client-supplied (ACT-151/ACT-154). */
function computeImpactRetained(impacts: ImpactAxisScore[], rule: RetainedImpactRule): number {
  const values = impacts.map((i) => i.value);
  if (rule === "MAX") return Math.max(...values);
  if (rule === "AVERAGE") return values.reduce((sum, v) => sum + v, 0) / values.length;
  throw new ValidationError(
    `retainedImpactRule "${rule}" requires per-axis weights that are not part of the current impact axes configuration`,
  );
}

function levelBounds(levels: { level: number }[]): { min: number; max: number } {
  const nums = levels.map((l) => l.level);
  return { min: Math.min(...nums), max: Math.max(...nums) };
}

/**
 * Rules ported from apps-script-legacy/10_Evaluation.gs (RISQUES sheet):
 * append-only, one row per evaluation occurrence, progressively filled in
 * by narrow setters (inherent scoring, mastery assessment, residual
 * scoring) while status stays BROUILLON, then finalized exactly once via
 * validate/reject through the same maker-checker circuit as
 * ControlEffectivenessService. Scores are always server-computed from the
 * active RatingScale's configuration — never trusted from the client
 * (ACT-154).
 */
export class RiskEvaluationService {
  constructor(
    private readonly evaluations: RiskEvaluationRepository,
    private readonly audit: AuditRepository,
    /** Optional so a test that never exercises the existence check can construct this service without one — server.ts must wire the real repository. */
    private readonly risks?: RiskRepository,
    /** Required in practice for every scoring setter; optional only to keep the constructor pattern consistent with the rest of this module. A missing repository fails loudly (ValidationError) the first time scoring is attempted, never silently. */
    private readonly ratingScales?: RatingScaleRepository,
    /** Optional — if absent, appetite suggestion/comparison degrade to "no threshold available" rather than throwing. */
    private readonly riskAppetites?: RiskAppetiteRepository,
    /**
     * DIV-06 wiring — optional so existing test construction sites (and
     * any caller that never needs the resolution) keep working unchanged.
     * If absent, evaluationMode resolution skips the process-inheritance
     * walk and falls straight to the Config/fallback default — the same
     * "degrade, never throw" posture as riskAppetites above.
     */
    private readonly processes?: ProcessRepository,
    /** Optional — if absent, evaluationMode resolution falls back to FALLBACK_EVALUATION_MODE instead of the tenant's saved Config row. */
    private readonly configs?: ConfigRepository,
    /**
     * B-6b: when wired (always in server.ts), the Dispositif is the single source of the methodology: create()
     * resolves the applicable version and freezes it on the evaluation (F-8), with no fallback to `configs` nor to
     * the "ACTIVE scale". When absent the pre-B-6b behaviour is kept (tests that never exercise it).
     */
    private readonly frameworks?: FrameworkReads,
    /**
     * q145: when wired (always in server.ts), the sub-category of an evaluation is chosen by `subCategoryId` in the
     * referential (tenant, active, with a parent) and its label is derived here. Without it (tests only) the legacy
     * free-text `subCategory` is kept; a `subCategoryId` without this dependency is refused (fail closed).
     */
    private readonly riskCategories?: Pick<RiskCategoryRepository, "getById">,
  ) {}

  async create(
    actor: AuthenticatedUser,
    input: Omit<CreateRiskEvaluationInput, "tenantId" | "evaluatorId" | "evaluationMode" | "subCategory"> & { subCategory?: string },
    requestId: string,
  ): Promise<RiskEvaluation> {
    requirePermission(actor, "riskevaluation.create");

    if (!EVALUATION_TYPES.includes(input.evaluationType)) {
      throw new ValidationError(`evaluationType must be one of: ${EVALUATION_TYPES.join(", ")}`);
    }
    const { subCategory, subCategoryId } = await this.resolveSubCategory(actor.tenantId, input);
    if (!input.riskId?.trim()) throw new ValidationError("riskId is required");

    let risk = null;
    if (this.risks) {
      risk = await this.risks.getById(actor.tenantId, input.riskId);
      if (!risk) throw new ValidationError(`Risk ${input.riskId} does not exist in this tenant`);
    }

    // B-6b (spec §8.1): the applicable Dispositif version is resolved once, here, and frozen on the evaluation.
    let snapshot: CreateRiskEvaluationInput["snapshot"];
    let frameworkMode: EvaluationMode | undefined;
    if (this.frameworks) {
      if (!this.ratingScales) throw new Error("RatingScaleRepository is not configured for RiskEvaluationService");
      const applicable = await resolveApplicableVersion(
        { frameworks: this.frameworks, ratingScales: this.ratingScales, processes: this.processes },
        actor.tenantId,
        risk?.processId ?? null,
      );
      if (!applicable) throw new ValidationError(NO_APPLICABLE_FRAMEWORK_MESSAGE);
      const v = applicable.version;
      snapshot = {
        riskFrameworkVersionId: v.id,
        ratingScaleId: applicable.scale.id,
        ratingScaleVersion: applicable.scale.version,
        committeeEvaluationMinScore: v.committeeEvaluationMinScore,
        committeeEvaluationEnforced: v.committeeEvaluationEnforced,
        committeeTreatmentMinScore: v.committeeTreatmentMinScore,
      };
      frameworkMode = v.defaultEvaluationMode;
    }

    // DIV-06 wiring: resolved exactly once, here, and never again — see
    // RiskEvaluation.evaluationMode's doc comment. Never client-supplied,
    // same gesture as evaluatorId above (excluded from the input type).
    // B-6b: with a Dispositif, its default mode replaces `Config.evaluationMode` as the tenant default.
    const evaluationMode = await this.resolveEvaluationModeForRisk(actor.tenantId, risk?.processId ?? null, frameworkMode);

    const evaluation = await this.evaluations.create({
      tenantId: actor.tenantId,
      riskId: input.riskId,
      evaluationType: input.evaluationType,
      // Never client-supplied — the caller's Omit<...> above already
      // excludes it from the input type, this is belt-and-braces.
      evaluatorId: actor.userId,
      subCategory,
      subCategoryId,
      entity: input.entity?.trim() || null,
      evaluationMode,
      ...(snapshot ? { snapshot } : {}),
    });

    await this.audit.record({
      tenantId: actor.tenantId,
      userId: actor.userId,
      entityType: "RiskEvaluation",
      entityId: evaluation.id,
      action: "CREATE",
      oldValue: null,
      newValue: evaluation,
      reason: null,
      requestId,
    });

    return evaluation;
  }

  /**
   * q145 (same rule as q133): `subCategoryId` must be an active sub-category (parent set) of the actor's tenant; the label is the
   * category name, never the client's text. Same message for unknown, foreign-tenant and inactive ids (no oracle).
   */
  private async resolveSubCategory(
    tenantId: string,
    input: { subCategory?: string; subCategoryId?: string | null },
  ): Promise<{ subCategory: string; subCategoryId: string | null }> {
    if (!this.riskCategories) {
      if (input.subCategoryId) throw new ValidationError("Risk category validation is not available: RiskCategoryRepository is not configured");
      if (!input.subCategory?.trim()) throw new ValidationError("subCategory is required");
      return { subCategory: input.subCategory.trim(), subCategoryId: null };
    }
    if (!input.subCategoryId) throw new ValidationError("subCategoryId is required: pick a sub-category of the risk categories");
    const cat = await this.riskCategories.getById(tenantId, input.subCategoryId);
    if (!cat || !cat.active) throw new ValidationError(`Risk category ${input.subCategoryId} does not exist in this tenant`);
    if (!cat.parentId) throw new ValidationError(`Risk category ${input.subCategoryId} is a top-level category: pick a sub-category`);
    return { subCategory: cat.name, subCategoryId: cat.id };
  }

  async get(actor: AuthenticatedUser, id: string): Promise<RiskEvaluation> {
    requirePermission(actor, "riskevaluation.read");
    const evaluation = await this.evaluations.getById(actor.tenantId, id);
    if (!evaluation) throw new NotFoundError("RiskEvaluation", id);
    return evaluation;
  }

  /** ACT-159: full history for a risk, most recent first, paginated, optional status filter. */
  async listForRisk(
    actor: AuthenticatedUser,
    riskId: string,
    options?: ListRiskEvaluationsOptions,
  ): Promise<RiskEvaluation[]> {
    requirePermission(actor, "riskevaluation.read");
    if (this.risks) {
      const risk = await this.risks.getById(actor.tenantId, riskId);
      if (!risk) throw new ValidationError(`Risk ${riskId} does not exist in this tenant`);
    }
    return this.evaluations.listForRisk(actor.tenantId, riskId, options);
  }

  /** ACT-151/ACT-154: probability x 7 impact axes; impact retenu and score are always server-computed. */
  async recordInherentScoring(
    actor: AuthenticatedUser,
    id: string,
    input: InherentScoringRequest,
    requestId: string,
  ): Promise<RiskEvaluation> {
    requirePermission(actor, "riskevaluation.update");
    const before = await this.get(actor, id);
    assertMutable(before);
    assertIsEvaluator(actor, before);

    const ratingScale = await this.resolveScaleForInherent(actor.tenantId, before);
    const axesConfig = ratingScale.impactAxes;
    if (!axesConfig) throw new ValidationError("The active rating scale has no impact axes configured");

    assertIntegerInRange(input.probability, 1, ratingScale.probabilityLevels, "probability");
    assertImpacts(input.impacts, axesConfig.axes, ratingScale.impactLevels);

    const impactRetained = computeImpactRetained(input.impacts, axesConfig.retainedImpactRule);
    const score = input.probability * impactRetained;

    const after = await this.evaluations.recordInherentScoring(actor.tenantId, id, {
      ratingScaleId: ratingScale.id,
      ratingScaleVersion: ratingScale.version,
      probability: input.probability,
      impacts: input.impacts,
      impactRetained,
      score,
    });

    await this.recordUpdate(actor, id, before, after, requestId);
    return after;
  }

  /** ACT-152: adequacy/execution/effectiveness x L1/L2/L3, each 1-3; maîtrise globale = minimum des notes saisies (le maillon le plus faible). */
  async recordMasteryAssessment(
    actor: AuthenticatedUser,
    id: string,
    input: MasteryAssessmentRequest,
    requestId: string,
  ): Promise<RiskEvaluation> {
    requirePermission(actor, "riskevaluation.update");
    const before = await this.get(actor, id);
    assertMutable(before);
    assertIsEvaluator(actor, before);

    if (before.inherentScore === null || !before.ratingScaleId) {
      throw new ValidationError("Inherent scoring must be recorded before mastery assessment");
    }

    const ratingScale = await this.getRatingScaleOrThrow(actor.tenantId, before.ratingScaleId);
    const masteryConfig = ratingScale.masteryScale;
    if (!masteryConfig) {
      throw new ValidationError("The rating scale used for this evaluation has no mastery scale configured");
    }

    const expectedLines = new Set(masteryConfig.defenseLines);
    if (!Array.isArray(input.lines) || input.lines.length !== masteryConfig.defenseLines.length) {
      throw new ValidationError(`lines must supply exactly one entry per configured line of defense: ${masteryConfig.defenseLines.join(", ")}`);
    }
    const seenLines = new Set<string>();
    const bounds = levelBounds(masteryConfig.levels);
    for (const line of input.lines) {
      if (!expectedLines.has(line.line)) throw new ValidationError(`Unknown line of defense: ${line.line}`);
      if (seenLines.has(line.line)) throw new ValidationError(`Duplicate line of defense: ${line.line}`);
      seenLines.add(line.line);
      assertIntegerInRange(line.adequacy, bounds.min, bounds.max, `${line.line} adequacy`);
      assertIntegerInRange(line.execution, bounds.min, bounds.max, `${line.line} execution`);
      assertIntegerInRange(line.effectiveness, bounds.min, bounds.max, `${line.line} effectiveness`);
    }

    // CHALLENGE-001 (PO decision, 2026-09-29, corrected after Risk Manager
    // review): global mastery is the MIN across all lines of defense
    // (adequacy/execution/effectiveness), not their average and not their
    // max. Levels run 1..3, Inadéquat -> Adéquat, so a higher score is more
    // favorable, but per the Three Lines of Defense Model the 3 lines are
    // not compensatory — a single weak line/axis must dominate the global
    // score. MIN on the 9 raw values is mathematically equivalent to MIN
    // per line then MIN across lines, so a single flat MIN suffices.
    const allValues = input.lines.flatMap((l) => [l.adequacy, l.execution, l.effectiveness]);
    const masteryGlobal = Math.min(...allValues);

    const after = await this.evaluations.recordMasteryAssessment(actor.tenantId, id, {
      lines: input.lines,
      masteryGlobal,
    });

    await this.recordUpdate(actor, id, before, after, requestId);
    return after;
  }

  /** ACT-153/ACT-154/ACT-155: residual is re-assessed by a human, never derived by formula; score is server-computed. */
  async recordResidualScoring(
    actor: AuthenticatedUser,
    id: string,
    input: ResidualScoringRequest,
    requestId: string,
  ): Promise<RiskEvaluation> {
    requirePermission(actor, "riskevaluation.update");
    const before = await this.get(actor, id);
    assertMutable(before);
    assertIsEvaluator(actor, before);

    if (before.masteryGlobal === null || !before.ratingScaleId) {
      throw new ValidationError("Mastery assessment must be recorded before residual scoring");
    }
    if (!input.justification?.trim()) {
      throw new ValidationError("A justification is required for residual scoring");
    }

    const ratingScale = await this.getRatingScaleOrThrow(actor.tenantId, before.ratingScaleId);
    const axesConfig = ratingScale.impactAxes;
    if (!axesConfig) throw new ValidationError("The rating scale used for this evaluation has no impact axes configured");

    assertIntegerInRange(input.probability, 1, ratingScale.probabilityLevels, "probability");
    assertImpacts(input.impacts, axesConfig.axes, ratingScale.impactLevels);

    const impactRetained = computeImpactRetained(input.impacts, axesConfig.retainedImpactRule);
    const score = input.probability * impactRetained;

    const suggested = (await this.suggestedAppetite(actor.tenantId, before)).threshold;

    let override: number | null = input.appetiteOverride ?? null;
    if (override !== null) {
      assertIntegerInRange(override, MIN_APPETITE_THRESHOLD, maxScoreForScale(ratingScale), "appetiteOverride");
    }

    const applied = override ?? suggested;
    const exceeded = applied === null ? null : score > applied;

    const after = await this.evaluations.recordResidualScoring(actor.tenantId, id, {
      probability: input.probability,
      impacts: input.impacts,
      impactRetained,
      score,
      justification: input.justification.trim(),
      appetiteThresholdSuggested: suggested,
      appetiteThresholdOverride: override,
      appetiteThresholdApplied: applied,
      appetiteExceeded: exceeded,
    });

    await this.recordUpdate(actor, id, before, after, requestId);
    return after;
  }

  /** ACT-155: read-only appetite suggestion for (subCategory, entity), overridable but never invented here. */
  async suggestAppetite(actor: AuthenticatedUser, id: string): Promise<AppetiteSuggestion> {
    const evaluation = await this.get(actor, id);
    const s = await this.suggestedAppetite(actor.tenantId, evaluation);
    return { subCategory: evaluation.subCategory, entity: evaluation.entity, suggested: s.threshold, methodologyVersion: s.methodologyVersion };
  }

  /**
   * B-6b (spec §8.1): an evaluation frozen on a Dispositif version reads that version's appetite list
   * (`findAppetite`); a row from before the Dispositif keeps the historical read of `risk_appetites`
   * (read-only legacy path). Fail closed when the evaluation names a version but the Dispositif is not wired.
   */
  private async suggestedAppetite(
    tenantId: string,
    evaluation: RiskEvaluation,
  ): Promise<{ threshold: number | null; methodologyVersion: string | null }> {
    if (evaluation.riskFrameworkVersionId) {
      if (!this.frameworks) throw new Error("RiskFrameworkRepository is not configured for RiskEvaluationService");
      const version = await this.frameworks.getVersionById(tenantId, evaluation.riskFrameworkVersionId);
      if (!version) throw new ValidationError("The Dispositif version of this evaluation no longer exists");
      const entry = findAppetite(version.appetiteThresholds, evaluation.subCategory, evaluation.entity, evaluation.subCategoryId);
      return { threshold: entry?.threshold ?? null, methodologyVersion: entry ? `v${version.versionNumber}` : null };
    }
    if (!this.riskAppetites) return { threshold: null, methodologyVersion: null };
    const appetite = await this.riskAppetites.getBySubCategory(tenantId, evaluation.subCategory, evaluation.entity);
    // SEC-015: a retired threshold (active: false) must be treated as absent, not applied.
    const active = appetite?.active !== false ? appetite : null;
    return { threshold: active?.threshold ?? null, methodologyVersion: active?.methodologyVersion ?? null };
  }

  /** ACT-160: residual score vs the applicable appetite threshold, flagged if exceeded. */
  async compareToAppetite(actor: AuthenticatedUser, id: string): Promise<AppetiteComparison> {
    const evaluation = await this.get(actor, id);
    if (evaluation.residualScore === null) {
      throw new ValidationError("Residual scoring has not been completed for this evaluation yet");
    }
    const source: AppetiteComparison["source"] =
      evaluation.appetiteThresholdOverride !== null ? "OVERRIDE" : evaluation.appetiteThresholdSuggested !== null ? "AUTO" : "NONE";

    return {
      residualScore: evaluation.residualScore,
      linkedToCategory: Boolean(evaluation.subCategoryId),
      threshold: evaluation.appetiteThresholdApplied,
      source,
      exceeded: evaluation.appetiteExceeded,
    };
  }

  /** ACT-156: maker-checker — validator must never be the evaluator. Terminal, immutable afterwards. */
  async validate(actor: AuthenticatedUser, id: string, comment: string | null, requestId: string): Promise<RiskEvaluation> {
    requirePermission(actor, "riskevaluation.validate");
    const before = await this.get(actor, id);

    if (before.status !== "BROUILLON") {
      throw new ValidationError(`This evaluation has already been finalized (${before.status})`);
    }
    if (before.residualScore === null) {
      throw new ValidationError("Cannot validate an evaluation before residual scoring is completed");
    }
    if (before.evaluatorId === actor.userId) {
      throw new ForbiddenError("An evaluator cannot validate their own risk evaluation");
    }

    const { minScore, enforced } = await this.committeeSettingsOf(actor.tenantId, before);
    if (enforced && before.residualScore >= minScore) {
      throw new ValidationError(
        `This evaluation scored ${before.residualScore}, at or above the committee threshold (${minScore}) — ` +
          `it must be validated through POST /risk-evaluations/:id/validate-committee, not this endpoint`,
      );
    }

    const after = await this.evaluations.recordValidation(actor.tenantId, id, actor.userId, comment);

    await this.audit.record({
      tenantId: actor.tenantId,
      userId: actor.userId,
      entityType: "RiskEvaluation",
      entityId: id,
      action: "VALIDATE",
      oldValue: before,
      newValue: after,
      reason: comment,
      requestId,
    });

    return after;
  }

  /** ACT-157: same maker-checker circuit as validate, mandatory comment. Terminal, immutable afterwards. */
  async reject(actor: AuthenticatedUser, id: string, comment: string, requestId: string): Promise<RiskEvaluation> {
    requirePermission(actor, "riskevaluation.validate");
    const before = await this.get(actor, id);

    if (before.status !== "BROUILLON") {
      throw new ValidationError(`This evaluation has already been finalized (${before.status})`);
    }
    if (!comment?.trim()) {
      throw new ValidationError("A comment is required to reject a risk evaluation");
    }
    if (before.evaluatorId === actor.userId) {
      throw new ForbiddenError("An evaluator cannot reject their own risk evaluation");
    }

    const after = await this.evaluations.recordRejection(actor.tenantId, id, actor.userId, comment);

    await this.audit.record({
      tenantId: actor.tenantId,
      userId: actor.userId,
      entityType: "RiskEvaluation",
      entityId: id,
      action: "REJECT",
      oldValue: before,
      newValue: after,
      reason: comment,
      requestId,
    });

    return after;
  }

  /**
   * ACT-253: distinct terminal status from validate()/VALIDATED — a
   * separate "Comité des Risques / Direction" maker-checker for
   * significant risks only (residual score at or above the configurable
   * committee threshold, default 15 — see
   * resolveCommitteeEvaluationSettings), gated by its own permission
   * (riskevaluation.validate.committee, never riskevaluation.validate).
   * The permission split is unchanged since ACT-253; as of Lot A
   * (RISK_MANAGEMENT_V1 §8), validate() now also refuses evaluations at or
   * above the same threshold when committeeEvaluationEnforced is true,
   * so this is no longer "purely additive" with no effect on validate().
   */
  async validateByCommittee(actor: AuthenticatedUser, id: string, comment: string | null, requestId: string): Promise<RiskEvaluation> {
    requirePermission(actor, "riskevaluation.validate.committee");
    const before = await this.get(actor, id);

    if (before.status !== "BROUILLON") {
      throw new ValidationError(`This evaluation has already been finalized (${before.status})`);
    }
    if (before.residualScore === null) {
      throw new ValidationError("Cannot validate an evaluation before residual scoring is completed");
    }
    // Lot A (§8): the Committee floor is checked unconditionally here, independent of
    // committeeEvaluationEnforced — disabling the *obligation* in validate() must never
    // loosen access to Committee validation itself.
    const { minScore } = await this.committeeSettingsOf(actor.tenantId, before);
    if (before.residualScore < minScore) {
      throw new ValidationError(
        `Committee validation only applies to residual scores at or above the committee threshold (${minScore}) (this evaluation scored ${before.residualScore})`,
      );
    }
    if (before.evaluatorId === actor.userId) {
      throw new ForbiddenError("An evaluator cannot validate their own risk evaluation, including committee validation");
    }

    const after = await this.evaluations.recordCommitteeValidation(actor.tenantId, id, actor.userId, comment);

    await this.audit.record({
      tenantId: actor.tenantId,
      userId: actor.userId,
      entityType: "RiskEvaluation",
      entityId: id,
      action: "VALIDATE",
      oldValue: before,
      newValue: after,
      reason: comment,
      requestId,
    });

    return after;
  }

  /**
   * DIV-06 wiring: resolved once by `create()`, never again. Duplicates
   * (deliberately, not via composition) the ancestor-chain walk that
   * `ProcessService.resolveEvaluationMode` already performs — that
   * method requires `process.read` and takes an `AuthenticatedUser`,
   * which is right for a user explicitly inspecting a Process but wrong
   * here: an evaluator recording a risk evaluation should never be
   * blocked from creating it just because they lack `process.read`. The
   * actual inheritance rule (`resolveInheritedEvaluationMode`) is reused
   * as-is — only the I/O/permission wrapper differs.
   */
  private async resolveEvaluationModeForRisk(
    tenantId: string,
    processId: string | null,
    frameworkDefault?: EvaluationMode,
  ): Promise<EvaluationMode> {
    const tenantDefault = frameworkDefault ?? (await this.resolveTenantDefaultEvaluationMode(tenantId));
    if (!processId || !this.processes) return tenantDefault;

    const chain: Pick<Process, "evaluationMode">[] = [];
    let current: Process | null = await this.processes.getById(tenantId, processId);
    while (current && chain.length < PROCESS_LEVEL_BY_RANK.length) {
      chain.push(current);
      if (!current.parentId) break;
      current = await this.processes.getById(tenantId, current.parentId);
    }

    return resolveInheritedEvaluationMode(chain, tenantDefault);
  }

  private async resolveTenantDefaultEvaluationMode(tenantId: string): Promise<EvaluationMode> {
    if (!this.configs) return FALLBACK_EVALUATION_MODE;
    const config = await this.configs.getByTenant(tenantId);
    return config?.evaluationMode ?? FALLBACK_EVALUATION_MODE;
  }

  /**
   * Lot A (RISK_MANAGEMENT_V1 §8) — replaces the old hardcoded
   * COMMITTEE_VALIDATION_MIN_SCORE constant. Fail-closed: no
   * ConfigRepository wired, or no Config row saved yet for the tenant,
   * always resolves to the blocking defaults (15, enforced) — never the
   * permissive ones. Same "degrade, never throw" posture as
   * resolveTenantDefaultEvaluationMode, but the degrade direction here is
   * deliberately the opposite (stricter, not laxer).
   */
  private async resolveCommitteeEvaluationSettings(tenantId: string): Promise<{ minScore: number; enforced: boolean }> {
    // Default follows the ACTIVE matrix size (15 for 5x5); a configured value is never replaced.
    const defaultMinScore = defaultCommitteeThreshold(await resolveMaxScore(this.ratingScales, tenantId));
    if (!this.configs) {
      return { minScore: defaultMinScore, enforced: COMMITTEE_EVALUATION_ENFORCED_DEFAULT };
    }
    const config = await this.configs.getByTenant(tenantId);
    return {
      minScore: config?.committeeEvaluationMinScore ?? defaultMinScore,
      enforced: config?.committeeEvaluationEnforced ?? COMMITTEE_EVALUATION_ENFORCED_DEFAULT,
    };
  }

  /**
   * B-6b (F-8): the Committee settings are read from the evaluation itself (copied from its Dispositif version at
   * creation, or by migration 059 for older rows). Only an evaluation without a copy (never the case in
   * production once 059 ran) falls back to the pre-B-6b resolution.
   */
  private async committeeSettingsOf(tenantId: string, e: RiskEvaluation): Promise<{ minScore: number; enforced: boolean }> {
    if (e.committeeEvaluationMinScore != null) {
      return { minScore: e.committeeEvaluationMinScore, enforced: e.committeeEvaluationEnforced ?? COMMITTEE_EVALUATION_ENFORCED_DEFAULT };
    }
    // QA-B6b-01 (spec §8.1): an evaluation attached to a version never reads `configs`; a missing copy fails closed.
    if (e.riskFrameworkVersionId) {
      throw new ValidationError(
        "The Dispositif version of this evaluation carries no committee threshold copy — it cannot be validated; contact a Risk Manager",
      );
    }
    return this.resolveCommitteeEvaluationSettings(tenantId);
  }

  /**
   * Inherent scoring: the scale frozen at creation (F-8). A row without one (created before B-6b) takes the scale
   * of the applicable version (spec §8.1), never the old "ACTIVE scale". Without the Dispositif wired: legacy.
   */
  private async resolveScaleForInherent(tenantId: string, e: RiskEvaluation): Promise<RatingScale> {
    if (!this.frameworks) return this.resolveActiveRatingScale(tenantId);
    if (e.ratingScaleId) return this.getRatingScaleOrThrow(tenantId, e.ratingScaleId);
    if (!this.ratingScales) throw new Error("RatingScaleRepository is not configured for RiskEvaluationService");
    const risk = this.risks ? await this.risks.getById(tenantId, e.riskId) : null;
    const applicable = await resolveApplicableVersion(
      { frameworks: this.frameworks, ratingScales: this.ratingScales, processes: this.processes },
      tenantId,
      risk?.processId ?? null,
    );
    if (!applicable) throw new ValidationError(NO_APPLICABLE_FRAMEWORK_MESSAGE);
    return applicable.scale;
  }

  private async resolveActiveRatingScale(tenantId: string): Promise<RatingScale> {
    if (!this.ratingScales) {
      throw new Error("RatingScaleRepository is not configured for RiskEvaluationService");
    }
    const scales = await this.ratingScales.list(tenantId, { includeArchived: false });
    const active = scales.find((s) => s.status === "ACTIVE");
    if (!active) throw new ValidationError("No active rating scale is configured for this tenant");
    return active;
  }

  private async getRatingScaleOrThrow(tenantId: string, ratingScaleId: string): Promise<RatingScale> {
    if (!this.ratingScales) {
      throw new Error("RatingScaleRepository is not configured for RiskEvaluationService");
    }
    const scale = await this.ratingScales.getById(tenantId, ratingScaleId);
    if (!scale) throw new ValidationError("The rating scale used for this evaluation no longer exists");
    return scale;
  }

  private async recordUpdate(
    actor: AuthenticatedUser,
    id: string,
    before: RiskEvaluation,
    after: RiskEvaluation,
    requestId: string,
  ): Promise<void> {
    await this.audit.record({
      tenantId: actor.tenantId,
      userId: actor.userId,
      entityType: "RiskEvaluation",
      entityId: id,
      action: "UPDATE",
      oldValue: before,
      newValue: after,
      reason: null,
      requestId,
    });
  }
}
