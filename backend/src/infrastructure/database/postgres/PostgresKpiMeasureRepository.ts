import type { Pool } from "pg";
import type { KpiMeasureRepository } from "../../../domain/repositories/KpiMeasureRepository.js";
import type { CreateKpiMeasureInput, KpiMeasure } from "../../../domain/entities/KpiMeasure.js";

interface KpiMeasureRow {
  id: string;
  tenant_id: string;
  kpi_id: string;
  period: Date;
  value: number;
  comment: string | null;
  recorded_by: string;
  created_at: Date;
}

function toDomain(row: KpiMeasureRow): KpiMeasure {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    kpiId: row.kpi_id,
    period: row.period,
    value: row.value,
    comment: row.comment,
    recordedBy: row.recorded_by,
    createdAt: row.created_at,
  };
}

export class PostgresKpiMeasureRepository implements KpiMeasureRepository {
  constructor(private readonly pool: Pool) {}

  async getById(tenantId: string, id: string): Promise<KpiMeasure | null> {
    const { rows } = await this.pool.query<KpiMeasureRow>(
      `SELECT * FROM kpi_measures WHERE tenant_id = $1 AND id = $2`,
      [tenantId, id],
    );
    return rows[0] ? toDomain(rows[0]) : null;
  }

  async listForKpi(tenantId: string, kpiId: string): Promise<KpiMeasure[]> {
    const { rows } = await this.pool.query<KpiMeasureRow>(
      `SELECT * FROM kpi_measures
       WHERE tenant_id = $1 AND kpi_id = $2
       ORDER BY period DESC, created_at DESC`,
      [tenantId, kpiId],
    );
    return rows.map(toDomain);
  }

  async getLatest(tenantId: string, kpiId: string): Promise<KpiMeasure | null> {
    const { rows } = await this.pool.query<KpiMeasureRow>(
      `SELECT * FROM kpi_measures
       WHERE tenant_id = $1 AND kpi_id = $2
       ORDER BY period DESC, created_at DESC
       LIMIT 1`,
      [tenantId, kpiId],
    );
    return rows[0] ? toDomain(rows[0]) : null;
  }

  async create(input: CreateKpiMeasureInput): Promise<KpiMeasure> {
    const { rows } = await this.pool.query<KpiMeasureRow>(
      `INSERT INTO kpi_measures (tenant_id, kpi_id, period, value, comment, recorded_by)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING *`,
      [input.tenantId, input.kpiId, input.period, input.value, input.comment ?? null, input.recordedBy],
    );
    const row = rows[0];
    if (!row) throw new Error("Insert into kpi_measures returned no row");
    return toDomain(row);
  }
}
