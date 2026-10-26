import type { Config, ConfigPatch } from "../entities/Config.js";
import type { TransactionalAudit } from "../entities/RiskFramework.js";

export interface ConfigRepository {
  /** DECISION-079: true when `upsert` writes the optional `audit` rows in the same transaction as the config row. */
  readonly auditsInTransaction?: boolean;
  getByTenant(tenantId: string): Promise<Config | null>;
  /**
   * Creates the tenant's config row with defaults if none exists yet,
   * then applies only the fields present in `patch` (buildUpdateSet
   * semantics — never COALESCE) and bumps `version`. Shared by
   * ConfigService's remaining setters (the former updateMethodology / updateAppetiteMode were removed, SEC-PNL3-02)
   * since they all write the same one-row-per-tenant record.
   */
  upsert(tenantId: string, patch: ConfigPatch, updatedBy: string, audit?: TransactionalAudit<Config>): Promise<Config>;
}
