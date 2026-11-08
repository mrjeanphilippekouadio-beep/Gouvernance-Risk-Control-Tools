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

import type { SelfValidationPolicy } from "../governance/selfValidation.js";

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

/** q178 (DECISION-095): the PO's default for `riskManagerVacancyMaxDays`, same as the column DEFAULT of migration 076. */
export const DEFAULT_RISK_MANAGER_VACANCY_MAX_DAYS = 60;
/** q221 (DECISION-111): the PO's default for `resourceReadallMaxDays`, same as the column DEFAULT of migration 084. */
export const DEFAULT_RESOURCE_READALL_MAX_DAYS = 90;
/** R3 (DECISION-099, q227 / DECISION-114): « dernière activité » kept 5 years after the end of the account, adjustable per client (migration 085). */
export const DEFAULT_LAST_SEEN_RETENTION_DAYS = 1826;
/** q232 A (DECISION-115, SEC D6-01): never less than a year. */
export const MIN_LAST_SEEN_RETENTION_DAYS = 365;

/**
 * q233 A (DECISION-116): thresholds of the governance panel, adjustable per client within the A13 ranges
 * (docs/risk/A13-seuils-panel-D6-2026-11-04.md). Same defaults as the column DEFAULTs of migration 086. Never null.
 * Raising one (fewer alerts) needs the second person (q182 circuit); lowering one is direct.
 */
export const GOVERNANCE_THRESHOLDS = {
  /** RISK-01: max share (%) of the live risks one Risk Manager owns directly. */
  govRmRiskShareMaxPct: { default: 20, min: 10, max: 40 },
  /** ACC-01 (a): max number of active administrators. */
  govMaxAdmins: { default: 3, min: 2, max: 5 },
  /** ACC-01 (b): a custom role is too wide above this many permissions… */
  govRoleMaxPermissions: { default: 25, min: 15, max: 40 },
  /** …or from this many permission families (first segment before the dot). */
  govRoleMaxFamilies: { default: 4, min: 3, max: 6 },
  /** ACC-01 (c): days without activity before a privileged account is « dormant » (flagged, never suspended). */
  govDormantDays: { default: 90, min: 45, max: 180 },
  /** OWN-01 (d): max share (%) of the live risks whose creator is also the owner. */
  govOwnerCreatorShareMaxPct: { default: 50, min: 25, max: 80 },
} as const;
export type GovernanceThresholdKey = keyof typeof GOVERNANCE_THRESHOLDS;
export type GovernanceThresholds = Record<GovernanceThresholdKey, number>;
export const isGovernanceThresholdKey = (k: string): k is GovernanceThresholdKey => k in GOVERNANCE_THRESHOLDS;

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
  /**
   * RISK_MANAGEMENT_V1 §8 (Lot A) — the two Committee thresholds are
   * independent decision references, never a single hardcoded constant.
   * `committeeTreatmentMinScore: null` is intentional and significant: it
   * means "no threshold configured yet", fail-closed (no Treatment
   * Decision can reach Committee until a tenant explicitly sets one) —
   * never give this a numeric default.
   */
  committeeEvaluationMinScore: number;
  committeeTreatmentMinScore: number | null;
  /** Default true — the Committee pass-through obligation on riskevaluation.validate() is on by default. */
  committeeEvaluationEnforced: boolean;
  /** DECISION-042 §1 (q58): may a user be in both the Committee and Audit groups? Default false (DECISION-061, migration 086: new rows only, an existing setting is never changed). Risk Manager + Audit is always refused, whatever this says. */
  committeeAuditCumulAllowed: boolean;
  /** DECISION-074 q141: what happens when someone validates their own input. Default REFUSE. */
  selfValidationPolicy: SelfValidationPolicy;
  /**
   * DECISION-083 (q168, q169, q174): governance delays in days, set by the tenant (config.governancedelays.set).
   * null = not configured: no delay applies. Never given a default value.
   */
  exceptionReviewDelayDays: number | null;
  acceptanceMaxDays: number | null;
  policyRequestExpiryDays: number | null;
  /** q178 (DECISION-095): longest Risk Manager vacancy (last member gone, no interim). Default 60 days, decided by the PO (migration 076). */
  riskManagerVacancyMaxDays: number | null;
  /** q221 (DECISION-111): life of a confirmed resource.readall grant (days); null = default 90. Optional for older fakes. */
  resourceReadallMaxDays?: number | null;
  /** R3 (q227): days after the end of an account (suspension) before its « dernière activité » date is erased; null = never. Optional for older fakes. */
  lastSeenRetentionDays?: number | null;
  /** R5 (q231 B, DECISION-115): DPO contact shown in « Vos données »; entered at go-live (no write route). Optional for older fakes. */
  dpoContact?: string | null;
  govRmRiskShareMaxPct?: number;
  govMaxAdmins?: number;
  govRoleMaxPermissions?: number;
  govRoleMaxFamilies?: number;
  govDormantDays?: number;
  govOwnerCreatorShareMaxPct?: number;
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
  /** `undefined` = omitted (leave as-is); `null` = explicitly clear the Treatment threshold back to "not configured" — buildUpdateSet, never COALESCE, must distinguish the two. */
  committeeEvaluationMinScore?: number;
  committeeTreatmentMinScore?: number | null;
  committeeEvaluationEnforced?: boolean;
  committeeAuditCumulAllowed?: boolean;
  selfValidationPolicy?: SelfValidationPolicy;
  exceptionReviewDelayDays?: number | null;
  acceptanceMaxDays?: number | null;
  policyRequestExpiryDays?: number | null;
  riskManagerVacancyMaxDays?: number | null;
  resourceReadallMaxDays?: number | null;
  lastSeenRetentionDays?: number | null;
  govRmRiskShareMaxPct?: number | null;
  govMaxAdmins?: number | null;
  govRoleMaxPermissions?: number | null;
  govRoleMaxFamilies?: number | null;
  govDormantDays?: number | null;
  govOwnerCreatorShareMaxPct?: number | null;
}
