/**
 * ACT-084 — "Importer le logo client". One row per tenant (1:1,
 * in-place update like Department/Process — see CLAUDE.md's write
 * pattern taxonomy), stored as extra columns on `tenants` rather than a
 * new table: there is exactly one logo per tenant, no independent
 * lifecycle, and no other table will ever need to reference "this
 * branding row" by id the way ControlExecution references a Control.
 * Mirrors the `tenants.drive_folder_id` column added by migration 006
 * for the same kind of tenant-level, single-value setting.
 */
export interface TenantBranding {
  tenantId: string;
  logoDriveFileId: string | null;
  logoUrl: string | null;
  logoUpdatedAt: Date | null;
  logoUpdatedBy: string | null;
}
