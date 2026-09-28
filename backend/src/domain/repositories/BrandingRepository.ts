import type { TenantBranding } from "../entities/TenantBranding.js";

export interface BrandingRepository {
  /** Never null even for a tenant that has never uploaded a logo — fields are simply all null in that case. */
  getBranding(tenantId: string): Promise<TenantBranding>;
  /** The only mutation this repository exposes — ACT-084 has no "remove logo" requirement, so no clear() method yet. */
  setLogo(tenantId: string, logoDriveFileId: string, logoUrl: string, updatedBy: string): Promise<TenantBranding>;
}
