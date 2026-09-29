/**
 * ACT-220/ACT-226 — tenant-wide methodology settings, currently
 * hardcoded across RatingScaleService/RiskEvaluationService, made
 * admin-editable *storage*. IMPORTANT: this batch builds the config
 * record and its audit trail only — nothing here is read yet by
 * RatingScaleService or RiskEvaluationService. See ConfigService's file
 * header for the full list of what's deliberately NOT wired.
 *
 * One row per tenant, updated in place (like Department/Process/
 * RiskAppetite) rather than a generic key-value store — the backlog
 * names exactly three methodology keys (SCORE_FORMULA, SEUILS_NIVEAU,
 * IMPACT_RETENU_RULE) plus the separate APPETENCE_MODE key (ACT-226),
 * and nothing suggests more will be added ad hoc. `version` increments
 * on every write so a caller can tell whether a row is still the
 * as-shipped default (version 0, never persisted) or has been
 * explicitly configured — full point-in-time history of every change
 * lives in the audit log (old value -> new value), not in this table,
 * matching RoleService.update's PERMISSION_CHANGE pattern.
 *
 * Design note flagged for Architect (A05) / Risk Manager (A13), not
 * resolved here: `impactRetenuRule` already exists today as a
 * per-RatingScale-version field (RatingScale.impactAxes.retainedImpactRule,
 * see RatingScale.ts) that RiskEvaluationService actually reads. This
 * Config.impactRetenuRule is a separate, currently-inert value with the
 * same name — storing it here does not make it the source of truth, and
 * the backlog doesn't say which one should win if they ever disagree.
 * Don't assume this field silently supersedes the RatingScale one.
 */

export type ScoreFormula = "P_X_I" | "WEIGHTED_SUM";

/** Mirrors RatingScale.ts's RetainedImpactRule literal-for-literal on purpose — see file header design note. */
export type RetainedImpactRule = "MAX" | "AVERAGE" | "WEIGHTED_SUM";

export type AppetiteMode = "AUTO" | "MANUEL" | "AUTO_AVEC_SURCHARGE_MANUELLE";

/**
 * DIV-06 (.claude/agent-context/ACTION_ITEMS.md, @architect audit
 * 2026-09-29): tenant-wide default for the risk evaluation methodology
 * (Classique = single evaluator, Participatif = multi-contributor).
 * `Process.evaluationMode` (nullable) can override this per process —
 * see `resolveInheritedEvaluationMode` in Process.ts for the resolution
 * order. Not read yet by RiskEvaluationService — storage + resolution
 * function only, wiring is a follow-up batch (the Évaluation screen).
 */
export type EvaluationMode = "CLASSIQUE" | "PARTICIPATIF";

/** One band of the SEUILS_NIVEAU (score -> level label) mapping, e.g. { label: "Critique", min: 16, max: 25 }. */
export interface LevelThreshold {
  label: string;
  min: number;
  max: number;
}

export interface Config {
  id: string;
  tenantId: string;
  scoreFormula: ScoreFormula;
  levelThresholds: LevelThreshold[];
  impactRetenuRule: RetainedImpactRule;
  appetiteMode: AppetiteMode;
  evaluationMode: EvaluationMode;
  /** 0 means "default, never explicitly saved" — see DEFAULT_CONFIG in ConfigService. */
  version: number;
  updatedBy: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface UpdateMethodologyInput {
  scoreFormula?: ScoreFormula;
  levelThresholds?: LevelThreshold[];
  impactRetenuRule?: RetainedImpactRule;
}

/** Partial patch applied to the single per-tenant row — shared by updateMethodology and updateAppetiteMode since they touch the same record. */
export interface ConfigPatch {
  scoreFormula?: ScoreFormula;
  levelThresholds?: LevelThreshold[];
  impactRetenuRule?: RetainedImpactRule;
  appetiteMode?: AppetiteMode;
  evaluationMode?: EvaluationMode;
}
