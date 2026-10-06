import type {
  ListRiskAppetiteOptions,
  RiskAppetite,
  SetRiskAppetiteInput,
} from "../entities/RiskAppetite.js";

export interface RiskAppetiteRepository {
  getById(tenantId: string, id: string): Promise<RiskAppetite | null>;
  /**
   * Natural key lookup. Used two ways: (1) by the PUT upsert, to decide
   * CREATE vs UPDATE for the audit trail — must see a row regardless of
   * `active`, since re-activating a previously deactivated threshold is
   * an UPDATE, not a CREATE; (2) by `getApplicable` (P-04), which must
   * pass `{ activeOnly: true }` — a deactivated threshold is not an
   * applicable one, even though it is not soft-deleted.
   */
  getBySubCategory(
    tenantId: string,
    subCategory: string,
    entity: string | null,
    options?: { activeOnly?: boolean },
  ): Promise<RiskAppetite | null>;
  list(tenantId: string, options?: ListRiskAppetiteOptions): Promise<RiskAppetite[]>;
  /**
   * "Définir ou modifier" (ACT-165) in one call: creates the threshold if
   * none exists yet for (tenant, subCategory, entity), otherwise replaces
   * it in place. Not a partial update — the caller always supplies the
   * full definition, so buildUpdateSet's COALESCE-vs-omitted concern
   * doesn't apply here the way it does for Department/Control's PATCH.
   */
  upsert(input: SetRiskAppetiteInput): Promise<RiskAppetite>;
  softDelete(tenantId: string, id: string, deletedBy: string, reason: string): Promise<void>;
}
