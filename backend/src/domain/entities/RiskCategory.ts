/**
 * ACT-224 — risk category / sub-category taxonomy. `parentId: null` is a
 * top-level category; a non-null `parentId` is a sub-category of that
 * category (one level deep in practice, though the self-reference
 * doesn't hard-enforce that — matches how apps-script-legacy treats
 * category/sub-category as a flat pair of text fields, just normalized
 * into a table here).
 *
 * Deliberately NOT linked as a foreign key from RiskAppetite.subCategory
 * (still free text there) or from RiskEvaluation.subCategory — changing
 * either of those already-shipped modules to reference this table is a
 * breaking change out of scope for this batch, flagged as a follow-up.
 */
export interface RiskCategory {
  id: string;
  tenantId: string;
  name: string;
  parentId: string | null;
  active: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface CreateRiskCategoryInput {
  tenantId: string;
  name: string;
  parentId?: string | null;
  active?: boolean;
}

export interface UpdateRiskCategoryInput {
  name?: string;
  parentId?: string | null;
  active?: boolean;
}
