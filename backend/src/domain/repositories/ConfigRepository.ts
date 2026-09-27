import type { Config, ConfigPatch } from "../entities/Config.js";

export interface ConfigRepository {
  getByTenant(tenantId: string): Promise<Config | null>;
  /**
   * Creates the tenant's config row with defaults if none exists yet,
   * then applies only the fields present in `patch` (buildUpdateSet
   * semantics — never COALESCE) and bumps `version`. Shared by
   * ConfigService.updateMethodology (ACT-220) and updateAppetiteMode
   * (ACT-226) since both write the same one-row-per-tenant record.
   */
  upsert(tenantId: string, patch: ConfigPatch, updatedBy: string): Promise<Config>;
}
