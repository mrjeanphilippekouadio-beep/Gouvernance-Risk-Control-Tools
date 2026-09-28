import type { Pool } from "pg";
import type { BrandingRepository } from "../../../domain/repositories/BrandingRepository.js";
import type { TenantBranding } from "../../../domain/entities/TenantBranding.js";
import { NotFoundError } from "../../../domain/errors/DomainErrors.js";

interface BrandingRow {
  logo_drive_file_id: string | null;
  logo_url: string | null;
  logo_updated_at: Date | null;
  logo_updated_by: string | null;
}

function toDomain(tenantId: string, row: BrandingRow): TenantBranding {
  return {
    tenantId,
    logoDriveFileId: row.logo_drive_file_id,
    logoUrl: row.logo_url,
    logoUpdatedAt: row.logo_updated_at,
    logoUpdatedBy: row.logo_updated_by,
  };
}

export class PostgresBrandingRepository implements BrandingRepository {
  constructor(private readonly pool: Pool) {}

  async getBranding(tenantId: string): Promise<TenantBranding> {
    const { rows } = await this.pool.query<BrandingRow>(
      `SELECT logo_drive_file_id, logo_url, logo_updated_at, logo_updated_by FROM tenants WHERE id = $1`,
      [tenantId],
    );
    const row = rows[0];
    if (!row) throw new NotFoundError("Tenant", tenantId);
    return toDomain(tenantId, row);
  }

  async setLogo(tenantId: string, logoDriveFileId: string, logoUrl: string, updatedBy: string): Promise<TenantBranding> {
    const { rows } = await this.pool.query<BrandingRow>(
      `UPDATE tenants
       SET logo_drive_file_id = $2, logo_url = $3, logo_updated_at = now(), logo_updated_by = $4
       WHERE id = $1
       RETURNING logo_drive_file_id, logo_url, logo_updated_at, logo_updated_by`,
      [tenantId, logoDriveFileId, logoUrl, updatedBy],
    );
    const row = rows[0];
    if (!row) throw new NotFoundError("Tenant", tenantId);
    return toDomain(tenantId, row);
  }
}
