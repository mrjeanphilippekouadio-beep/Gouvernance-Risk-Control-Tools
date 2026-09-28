import type { RiskEvaluationRepository } from "../domain/repositories/RiskEvaluationRepository.js";
import type { AuditRepository } from "../domain/repositories/AuditRepository.js";
import type { RiskRepository } from "../domain/repositories/RiskRepository.js";
import type { RatingScaleRepository } from "../domain/repositories/RatingScaleRepository.js";
import type { RiskAppetiteRepository } from "../domain/repositories/RiskAppetiteRepository.js";
import type { ImpactAxis, RatingScale, RetainedImpactRule } from "../domain/entities/RatingScale.js";
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
import type { AuthenticatedUser } from "../infrastructure/identity/IdentityProvider.js";

const EVALUATION_TYPES: RiskEvaluationType[] = ["AD_HOC", "ANNUELLE", "ANTICIPEE"];
const MIN_APPETITE_THRESHOLD = 1;
const MAX_APPETITE_THRESHOLD = 25;
/** ACT-253: Majeur (15-19) and Critique (20-25) are contiguous — a single floor covers both bands. */
const COMMITTEE_VALIDATION_MIN_SCORE = 15;

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
  ) {}

  async create(
    actor: AuthenticatedUser,
    input: Omit<CreateRiskEvaluationInput, "tenantId" | "evaluatorId">,
    requestId: string,
  ): Promise<RiskEvaluation> {
    requirePermission(actor, "riskevaluation.create");

    if (!EVALUATION_TYPES.includes(input.evaluationType)) {
      throw new ValidationError(`evaluationType must be one of: ${EVALUATION_TYPES.join(", ")}`);
    }
    if (!input.subCategory?.trim()) throw new ValidationError("subCategory is required");
    if (!input.riskId?.trim()) throw new ValidationError("riskId is required");

    if (this.risks) {
      const risk = await this.risks.getById(actor.tenantId, input.riskId);
      if (!risk) throw new ValidationError(`Risk ${input.riskId} does not exist in this tenant`);
    }

    const evaluation = await this.evaluations.create({
      tenantId: actor.tenantId,
      riskId: input.riskId,
      evaluationType: input.evaluationType,
      // Never client-supplied — the caller's Omit<...> above already
      // excludes it from the input type, this is belt-and-braces.
      evaluatorId: actor.userId,
      subCategory: input.subCategory.trim(),
      entity: input.entity?.trim() || null,
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

    const ratingScale = await this.resolveActiveRatingScale(actor.tenantId);
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

  /** ACT-152: adequacy/execution/effectiveness x L1/L2/L3, each 1-3; maîtrise globale = moyenne (config-fixed). */
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

    const allValues = input.lines.flatMap((l) => [l.adequacy, l.execution, l.effectiveness]);
    const masteryGlobal = allValues.reduce((sum, v) => sum + v, 0) / allValues.length;

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

    let suggested: number | null = null;
    if (this.riskAppetites) {
      const appetite = await this.riskAppetites.getBySubCategory(actor.tenantId, before.subCategory, before.entity);
      // SEC-015: a retired threshold (active: false) must be treated as absent, not applied.
      suggested = appetite?.active !== false ? appetite?.threshold ?? null : null;
    }

    let override: number | null = input.appetiteOverride ?? null;
    if (override !== null) {
      assertIntegerInRange(override, MIN_APPETITE_THRESHOLD, MAX_APPETITE_THRESHOLD, "appetiteOverride");
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
    if (!this.riskAppetites) {
      return { subCategory: evaluation.subCategory, entity: evaluation.entity, suggested: null, methodologyVersion: null };
    }
    const appetite = await this.riskAppetites.getBySubCategory(actor.tenantId, evaluation.subCategory, evaluation.entity);
    // SEC-015: a retired threshold (active: false) must be treated as absent, not applied.
    const active = appetite?.active !== false ? appetite : null;
    return {
      subCategory: evaluation.subCategory,
      entity: evaluation.entity,
      suggested: active?.threshold ?? null,
      methodologyVersion: active?.methodologyVersion ?? null,
    };
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
   * significant risks only (residual score in Majeur 15-19 or Critique
   * 20-25), gated by its own permission (riskevaluation.validate.committee,
   * never riskevaluation.validate). Purely additive: validate()/reject()
   * and their permission are unchanged.
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
    if (before.residualScore < COMMITTEE_VALIDATION_MIN_SCORE) {
      throw new ValidationError(
        `Committee validation only applies to Majeur (15-19) or Critique (20-25) residual scores (this evaluation scored ${before.residualScore})`,
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
