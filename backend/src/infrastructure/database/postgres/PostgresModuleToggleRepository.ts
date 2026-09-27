import type { Pool } from "pg";
import type { ModuleToggleRepository } from "../../../domain/repositories/ModuleToggleRepository.js";
import type { ModuleName, ModuleToggle } from "../../../domain/entities/ModuleToggle.js";

interface ModuleToggleRow {
  id: string;
  tenant_id: string;
  module_name: ModuleName;
  enabled: boolean;
  updated_by: string | null;
  created_at: Date;
  updated_at: Date;
}

function toDomain(row: ModuleToggleRow): ModuleToggle {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    moduleName: row.module_name,
    enabled: row.enabled,
    updatedBy: row.updated_by,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export class PostgresModuleToggleRepository implements ModuleToggleRepository {
  constructor(private readonly pool: Pool) {}

  async list(tenantId: string): Promise<ModuleToggle[]> {
    const { rows } = await this.pool.query<ModuleToggleRow>(
      `SELECT * FROM module_toggles WHERE tenant_id = $1 ORDER BY module_name`,
      [tenantId],
    );
    return rows.map(toDomain);
  }

  async getByName(tenantId: string, moduleName: ModuleName): Promise<ModuleToggle | null> {
    const { rows } = await this.pool.query<ModuleToggleRow>(
      `SELECT * FROM module_toggles WHERE tenant_id = $1 AND module_name = $2`,
      [tenantId, moduleName],
    );
    return rows[0] ? toDomain(rows[0]) : null;
  }

  async upsert(tenantId: string, moduleName: ModuleName, enabled: boolean, updatedBy: string): Promise<ModuleToggle> {
    const { rows } = await this.pool.query<ModuleToggleRow>(
      `INSERT INTO module_toggles (tenant_id, module_name, enabled, updated_by)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (tenant_id, module_name)
       DO UPDATE SET enabled = $3, updated_by = $4, updated_at = now()
       RETURNING *`,
      [tenantId, moduleName, enabled, updatedBy],
    );
    const row = rows[0];
    if (!row) throw new Error("Module toggle upsert returned no row");
    return toDomain(row);
  }
}
