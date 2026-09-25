import type { Pool } from "pg";
import type { TenantRepository } from "../../../domain/repositories/TenantRepository.js";
import { ValidationError } from "../../../domain/errors/DomainErrors.js";

export class PostgresTenantRepository implements TenantRepository {
  constructor(private readonly pool: Pool) {}

  async getDriveFolderId(tenantId: string): Promise<string> {
    const { rows } = await this.pool.query<{ drive_folder_id: string | null }>(
      `SELECT drive_folder_id FROM tenants WHERE id = $1`,
      [tenantId],
    );
    const folderId = rows[0]?.drive_folder_id;
    if (!folderId) {
      throw new ValidationError(
        `Tenant ${tenantId} has no drive_folder_id configured — set it before uploading evidence`,
      );
    }
    return folderId;
  }
}
