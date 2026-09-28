import type { Pool } from "pg";
import type { RegulatoryFrameworkRepository } from "../../../domain/repositories/RegulatoryFrameworkRepository.js";
import type {
  CreateRegulatoryFrameworkInput,
  RegulatoryFramework,
  UpdateRegulatoryFrameworkInput,
} from "../../../domain/entities/RegulatoryFramework.js";
import { NotFoundError } from "../../../domain/errors/DomainErrors.js";
import { buildUpdateSet } from "./dynamicUpdate.js";

interface RegulatoryFrameworkRow {
  id: string;
  tenant_id: string;
  name: string;
  description: string | null;
  active: boolean;
  created_at: Date;
  updated_at: Date;
}

function toDomain(row: RegulatoryFrameworkRow): RegulatoryFramework {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    name: row.name,
    description: row.description,
    active: row.active,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export class PostgresRegulatoryFrameworkRepository implements RegulatoryFrameworkRepository {
  constructor(private readonly pool: Pool) {}

  async getById(tenantId: string, id: string): Promise<RegulatoryFramework | null> {
    const { rows } = await this.pool.query<RegulatoryFrameworkRow>(
      `SELECT * FROM regulatory_frameworks WHERE tenant_id = $1 AND id = $2`,
      [tenantId, id],
    );
    return rows[0] ? toDomain(rows[0]) : null;
  }

  async getByName(tenantId: string, name: string): Promise<RegulatoryFramework | null> {
    const { rows } = await this.pool.query<RegulatoryFrameworkRow>(
      `SELECT * FROM regulatory_frameworks WHERE tenant_id = $1 AND name = $2`,
      [tenantId, name],
    );
    return rows[0] ? toDomain(rows[0]) : null;
  }

  async list(tenantId: string, options?: { activeOnly?: boolean }): Promise<RegulatoryFramework[]> {
    const filter = options?.activeOnly ? "AND active = true" : "";
    const { rows } = await this.pool.query<RegulatoryFrameworkRow>(
      `SELECT * FROM regulatory_frameworks WHERE tenant_id = $1 ${filter} ORDER BY name`,
      [tenantId],
    );
    return rows.map(toDomain);
  }

  async create(input: CreateRegulatoryFrameworkInput): Promise<RegulatoryFramework> {
    const { rows } = await this.pool.query<RegulatoryFrameworkRow>(
      `INSERT INTO regulatory_frameworks (tenant_id, name, description, active)
       VALUES ($1, $2, $3, $4)
       RETURNING *`,
      [input.tenantId, input.name, input.description ?? null, input.active ?? true],
    );
    const row = rows[0];
    if (!row) throw new Error("Insert into regulatory_frameworks returned no row");
    return toDomain(row);
  }

  async update(tenantId: string, id: string, input: UpdateRegulatoryFrameworkInput): Promise<RegulatoryFramework> {
    const { setClauses, values } = buildUpdateSet(
      { name: input.name, description: input.description, active: input.active },
      3,
    );
    if (setClauses.length === 0) {
      const current = await this.getById(tenantId, id);
      if (!current) throw new NotFoundError("RegulatoryFramework", id);
      return current;
    }

    const { rows } = await this.pool.query<RegulatoryFrameworkRow>(
      `UPDATE regulatory_frameworks SET ${setClauses.join(", ")}, updated_at = now()
       WHERE tenant_id = $1 AND id = $2
       RETURNING *`,
      [tenantId, id, ...values],
    );
    const row = rows[0];
    if (!row) throw new NotFoundError("RegulatoryFramework", id);
    return toDomain(row);
  }
}
