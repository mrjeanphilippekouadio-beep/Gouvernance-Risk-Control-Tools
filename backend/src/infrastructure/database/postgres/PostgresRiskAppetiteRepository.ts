import type { Pool } from "pg";
import type { RiskAppetiteRepository } from "../../../domain/repositories/RiskAppetiteRepository.js";
import type {
  ListRiskAppetiteOptions,
  RiskAppetite,
  SetRiskAppetiteInput,
} from "../../../domain/entities/RiskAppetite.js";
import { NotFoundError } from "../../../domain/errors/DomainErrors.js";

interface RiskAppetiteRow {
  id: string;
  tenant_id: string;
  sub_category: string;
  sub_category_id: string | null;
  entity: string | null;
  threshold: number;
  methodology_version: string;
  description: string | null;
  active: boolean;
  created_at: Date;
  updated_at: Date;
  deleted_at: Date | null;
  deleted_by: string | null;
  deletion_reason: string | null;
}

function toDomain(row: RiskAppetiteRow): RiskAppetite {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    subCategory: row.sub_category,
    subCategoryId: row.sub_category_id,
    entity: row.entity,
    threshold: row.threshold,
    methodologyVersion: row.methodology_version,
    description: row.description,
    active: row.active,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    deletedAt: row.deleted_at,
    deletedBy: row.deleted_by,
    deletionReason: row.deletion_reason,
  };
}

export class PostgresRiskAppetiteRepository implements RiskAppetiteRepository {
  constructor(private readonly pool: Pool) {}

  async getById(tenantId: string, id: string): Promise<RiskAppetite | null> {
    const { rows } = await this.pool.query<RiskAppetiteRow>(
      `SELECT * FROM risk_appetites WHERE tenant_id = $1 AND id = $2 AND deleted_at IS NULL`,
      [tenantId, id],
    );
    return rows[0] ? toDomain(rows[0]) : null;
  }

  async getBySubCategory(
    tenantId: string,
    subCategory: string,
    entity: string | null,
    options?: { activeOnly?: boolean },
  ): Promise<RiskAppetite | null> {
    const activeFilter = options?.activeOnly ? "AND active = true" : "";
    const { rows } = await this.pool.query<RiskAppetiteRow>(
      `SELECT * FROM risk_appetites
       WHERE tenant_id = $1 AND sub_category = $2 AND COALESCE(entity, '') = COALESCE($3, '')
         AND deleted_at IS NULL ${activeFilter}`,
      [tenantId, subCategory, entity],
    );
    return rows[0] ? toDomain(rows[0]) : null;
  }

  async list(tenantId: string, options?: ListRiskAppetiteOptions): Promise<RiskAppetite[]> {
    const activeOnly = options?.activeOnly ?? true;
    const conditions = ["tenant_id = $1", "deleted_at IS NULL"];
    const values: unknown[] = [tenantId];

    if (activeOnly) {
      conditions.push("active = true");
    }
    if (options?.entity) {
      values.push(options.entity);
      conditions.push(`entity = $${values.length}`);
    }

    const { rows } = await this.pool.query<RiskAppetiteRow>(
      `SELECT * FROM risk_appetites WHERE ${conditions.join(" AND ")} ORDER BY sub_category, entity`,
      values,
    );
    return rows.map(toDomain);
  }

  async upsert(input: SetRiskAppetiteInput): Promise<RiskAppetite> {
    const entity = input.entity ?? null;
    const { rows } = await this.pool.query<RiskAppetiteRow>(
      `INSERT INTO risk_appetites
         (tenant_id, sub_category, sub_category_id, entity, threshold, methodology_version, description, active)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       ON CONFLICT (tenant_id, sub_category, (COALESCE(entity, ''))) WHERE deleted_at IS NULL
       DO UPDATE SET
         sub_category_id = EXCLUDED.sub_category_id,
         threshold = EXCLUDED.threshold,
         methodology_version = EXCLUDED.methodology_version,
         description = EXCLUDED.description,
         active = EXCLUDED.active,
         updated_at = now()
       RETURNING *`,
      [
        input.tenantId,
        input.subCategory,
        input.subCategoryId ?? null,
        entity,
        input.threshold,
        input.methodologyVersion,
        input.description ?? null,
        input.active ?? true,
      ],
    );
    const row = rows[0];
    if (!row) throw new Error("Upsert into risk_appetites returned no row");
    return toDomain(row);
  }

  async softDelete(tenantId: string, id: string, deletedBy: string, reason: string): Promise<void> {
    const { rowCount } = await this.pool.query(
      `UPDATE risk_appetites
       SET deleted_at = now(), deleted_by = $3, deletion_reason = $4
       WHERE tenant_id = $1 AND id = $2 AND deleted_at IS NULL`,
      [tenantId, id, deletedBy, reason],
    );
    if (!rowCount) throw new NotFoundError("RiskAppetite", id);
  }
}
