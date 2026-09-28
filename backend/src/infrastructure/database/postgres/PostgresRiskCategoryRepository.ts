import type { Pool } from "pg";
import type { RiskCategoryRepository } from "../../../domain/repositories/RiskCategoryRepository.js";
import type { CreateRiskCategoryInput, RiskCategory, UpdateRiskCategoryInput } from "../../../domain/entities/RiskCategory.js";
import { NotFoundError } from "../../../domain/errors/DomainErrors.js";
import { buildUpdateSet } from "./dynamicUpdate.js";

interface RiskCategoryRow {
  id: string;
  tenant_id: string;
  name: string;
  parent_id: string | null;
  active: boolean;
  created_at: Date;
  updated_at: Date;
}

function toDomain(row: RiskCategoryRow): RiskCategory {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    name: row.name,
    parentId: row.parent_id,
    active: row.active,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export class PostgresRiskCategoryRepository implements RiskCategoryRepository {
  constructor(private readonly pool: Pool) {}

  async getById(tenantId: string, id: string): Promise<RiskCategory | null> {
    const { rows } = await this.pool.query<RiskCategoryRow>(
      `SELECT * FROM risk_categories WHERE tenant_id = $1 AND id = $2`,
      [tenantId, id],
    );
    return rows[0] ? toDomain(rows[0]) : null;
  }

  async list(tenantId: string, options?: { activeOnly?: boolean }): Promise<RiskCategory[]> {
    const filter = options?.activeOnly ? "AND active = true" : "";
    const { rows } = await this.pool.query<RiskCategoryRow>(
      `SELECT * FROM risk_categories WHERE tenant_id = $1 ${filter} ORDER BY parent_id NULLS FIRST, name`,
      [tenantId],
    );
    return rows.map(toDomain);
  }

  async create(input: CreateRiskCategoryInput): Promise<RiskCategory> {
    const { rows } = await this.pool.query<RiskCategoryRow>(
      `INSERT INTO risk_categories (tenant_id, name, parent_id, active)
       VALUES ($1, $2, $3, $4)
       RETURNING *`,
      [input.tenantId, input.name, input.parentId ?? null, input.active ?? true],
    );
    const row = rows[0];
    if (!row) throw new Error("Insert into risk_categories returned no row");
    return toDomain(row);
  }

  async update(tenantId: string, id: string, input: UpdateRiskCategoryInput): Promise<RiskCategory> {
    const { setClauses, values } = buildUpdateSet(
      { name: input.name, parent_id: input.parentId, active: input.active },
      3,
    );
    if (setClauses.length === 0) {
      const current = await this.getById(tenantId, id);
      if (!current) throw new NotFoundError("RiskCategory", id);
      return current;
    }

    const { rows } = await this.pool.query<RiskCategoryRow>(
      `UPDATE risk_categories SET ${setClauses.join(", ")}, updated_at = now()
       WHERE tenant_id = $1 AND id = $2
       RETURNING *`,
      [tenantId, id, ...values],
    );
    const row = rows[0];
    if (!row) throw new NotFoundError("RiskCategory", id);
    return toDomain(row);
  }
}
