import type { CreateRiskCategoryInput, RiskCategory, UpdateRiskCategoryInput } from "../entities/RiskCategory.js";

export interface RiskCategoryRepository {
  getById(tenantId: string, id: string): Promise<RiskCategory | null>;
  list(tenantId: string, options?: { activeOnly?: boolean }): Promise<RiskCategory[]>;
  create(input: CreateRiskCategoryInput): Promise<RiskCategory>;
  update(tenantId: string, id: string, input: UpdateRiskCategoryInput): Promise<RiskCategory>;
}
