import type { Pool } from "pg";
import type {
  KriMeasureListFilters,
  KriMeasureListResult,
  KriMeasureRepository,
} from "../../../domain/repositories/KriMeasureRepository.js";
import type { CreateKriMeasureInput, KriMeasure } from "../../../domain/entities/KriMeasure.js";

interface KriMeasureRow {
  id: string;
  tenant_id: string;
  kri_id: string;
  measure_date: Date;
  value: number;
  source: string;
  comment: string | null;
  recorded_by: string;
  created_at: Date;
}

function toDomain(row: KriMeasureRow): KriMeasure {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    kriId: row.kri_id,
    measureDate: row.measure_date,
    value: row.value,
    source: row.source,
    comment: row.comment,
    recordedBy: row.recorded_by,
    createdAt: row.created_at,
  };
}

const DEFAULT_PAGE_SIZE = 20;
const MAX_PAGE_SIZE = 100;

export class PostgresKriMeasureRepository implements KriMeasureRepository {
  constructor(private readonly pool: Pool) {}

  async getById(tenantId: string, id: string): Promise<KriMeasure | null> {
    const { rows } = await this.pool.query<KriMeasureRow>(
      `SELECT * FROM kri_measures WHERE tenant_id = $1 AND id = $2`,
      [tenantId, id],
    );
    return rows[0] ? toDomain(rows[0]) : null;
  }

  async listForKri(tenantId: string, kriId: string, filters?: KriMeasureListFilters): Promise<KriMeasureListResult> {
    const conditions = ["tenant_id = $1", "kri_id = $2"];
    const values: unknown[] = [tenantId, kriId];
    let i = 3;

    if (filters?.from) {
      conditions.push(`measure_date >= $${i}`);
      values.push(filters.from);
      i++;
    }
    if (filters?.to) {
      conditions.push(`measure_date <= $${i}`);
      values.push(filters.to);
      i++;
    }

    const page = filters?.page && filters.page > 0 ? Math.floor(filters.page) : 1;
    const pageSize =
      filters?.pageSize && filters.pageSize > 0 ? Math.min(Math.floor(filters.pageSize), MAX_PAGE_SIZE) : DEFAULT_PAGE_SIZE;
    const offset = (page - 1) * pageSize;

    const whereClause = conditions.join(" AND ");

    const { rows: countRows } = await this.pool.query<{ count: string }>(
      `SELECT COUNT(*)::text AS count FROM kri_measures WHERE ${whereClause}`,
      values,
    );
    const total = Number(countRows[0]?.count ?? "0");

    const { rows } = await this.pool.query<KriMeasureRow>(
      `SELECT * FROM kri_measures
       WHERE ${whereClause}
       ORDER BY measure_date DESC, created_at DESC
       LIMIT $${i} OFFSET $${i + 1}`,
      [...values, pageSize, offset],
    );

    return { items: rows.map(toDomain), total, page, pageSize };
  }

  async getLatest(tenantId: string, kriId: string): Promise<KriMeasure | null> {
    const { rows } = await this.pool.query<KriMeasureRow>(
      `SELECT * FROM kri_measures
       WHERE tenant_id = $1 AND kri_id = $2
       ORDER BY measure_date DESC, created_at DESC
       LIMIT 1`,
      [tenantId, kriId],
    );
    return rows[0] ? toDomain(rows[0]) : null;
  }

  async create(input: CreateKriMeasureInput): Promise<KriMeasure> {
    const { rows } = await this.pool.query<KriMeasureRow>(
      `INSERT INTO kri_measures (tenant_id, kri_id, measure_date, value, source, comment, recorded_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING *`,
      [
        input.tenantId,
        input.kriId,
        input.measureDate,
        input.value,
        input.source,
        input.comment ?? null,
        input.recordedBy,
      ],
    );
    const row = rows[0];
    if (!row) throw new Error("Insert into kri_measures returned no row");
    return toDomain(row);
  }
}
