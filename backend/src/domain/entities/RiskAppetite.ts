/**
 * ACT-165/ACT-168 — risk appetite threshold per risk sub-category,
 * optionally scoped to an entity. Updated in place (like Department/
 * Process): a single row per (tenant, subCategory, entity) that a Risk
 * Manager / Admin defines or redefines via PUT, never historized.
 *
 * ACT-166 (compare a residual risk score to the applicable threshold)
 * and ACT-167 (raise a breach notification) are explicitly out of scope
 * here — they depend on a RiskEvaluation domain (residual risk scoring)
 * that doesn't exist yet in this codebase. Don't infer one from this
 * entity; that's a separate design decision for Architecture (A05).
 */
export interface RiskAppetite {
  id: string;
  tenantId: string;
  /** "sous_categorie" in the backlog — the risk sub-category this threshold applies to. */
  subCategory: string;
  /**
   * DIV-08 (.claude/agent-context/ACTION_ITEMS.md, @architect audit
   * 2026-09-29): real FK to `risk_categories`, added alongside the
   * free-text `subCategory` field above — not replacing it. Nullable,
   * never backfilled: `subCategory` free text doesn't reliably match an
   * existing `risk_categories.name`, so a migration would have to
   * guess. Left null until a caller explicitly links a threshold to a
   * real RiskCategory row. Do not confuse with RiskEvaluation.subCategory
   * (a different entity's field, deliberately kept free text — see that
   * entity's file header) — this FK touches RiskAppetite only.
   */
  subCategoryId: string | null;
  /** Optional scope: null means the threshold applies across all entities. */
  entity: string | null;
  /** "seuil" — score ceiling, 1-25 per the backlog's regle_critique. */
  threshold: number;
  /** "version méthodologique" — free-text version tag of the risk scoring methodology this threshold was set under. */
  methodologyVersion: string;
  description: string | null;
  active: boolean;
  createdAt: Date;
  updatedAt: Date;
  deletedAt: Date | null;
  deletedBy: string | null;
  deletionReason: string | null;
}

export interface SetRiskAppetiteInput {
  tenantId: string;
  subCategory: string;
  subCategoryId?: string | null;
  entity?: string | null;
  threshold: number;
  methodologyVersion: string;
  description?: string | null;
  active?: boolean;
}

export interface ListRiskAppetiteOptions {
  /** Defaults to true (ACT-168: "actif=Oui en filtre par défaut"). */
  activeOnly?: boolean;
  entity?: string;
}
