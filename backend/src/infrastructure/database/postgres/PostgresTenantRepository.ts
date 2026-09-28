import type { Pool } from "pg";
import type { TenantRepository } from "../../../domain/repositories/TenantRepository.js";
import type { CreateTenantInput, DeploymentMode, Tenant, UpdateTenantInput } from "../../../domain/entities/Tenant.js";
import { NotFoundError, ValidationError } from "../../../domain/errors/DomainErrors.js";
import { buildUpdateSet } from "./dynamicUpdate.js";

interface TenantRow {
  id: string;
  name: string;
  deployment_mode: DeploymentMode;
  active: boolean;
  created_at: Date;
  updated_at: Date;
}

function toDomain(row: TenantRow): Tenant {
  return {
    id: row.id,
    name: row.name,
    deploymentMode: row.deployment_mode,
    active: row.active,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

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

  async getById(id: string): Promise<Tenant | null> {
    const { rows } = await this.pool.query<TenantRow>(
      `SELECT id, name, deployment_mode, active, created_at, updated_at FROM tenants WHERE id = $1`,
      [id],
    );
    return rows[0] ? toDomain(rows[0]) : null;
  }

  async list(): Promise<Tenant[]> {
    const { rows } = await this.pool.query<TenantRow>(
      `SELECT id, name, deployment_mode, active, created_at, updated_at FROM tenants ORDER BY name`,
    );
    return rows.map(toDomain);
  }

  async create(input: CreateTenantInput): Promise<Tenant> {
    const { rows } = await this.pool.query<TenantRow>(
      `INSERT INTO tenants (name, deployment_mode)
       VALUES ($1, $2)
       RETURNING id, name, deployment_mode, active, created_at, updated_at`,
      [input.name, input.deploymentMode ?? "managed_saas"],
    );
    const row = rows[0];
    if (!row) throw new Error("Insert into tenants returned no row");
    return toDomain(row);
  }

  async update(id: string, input: UpdateTenantInput): Promise<Tenant> {
    const { setClauses, values } = buildUpdateSet(
      { name: input.name, deployment_mode: input.deploymentMode, active: input.active },
      2,
    );
    if (setClauses.length === 0) {
      const current = await this.getById(id);
      if (!current) throw new NotFoundError("Tenant", id);
      return current;
    }

    const { rows } = await this.pool.query<TenantRow>(
      `UPDATE tenants SET ${setClauses.join(", ")}, updated_at = now()
       WHERE id = $1
       RETURNING id, name, deployment_mode, active, created_at, updated_at`,
      [id, ...values],
    );
    const row = rows[0];
    if (!row) throw new NotFoundError("Tenant", id);
    return toDomain(row);
  }
}
