import type { Pool } from "pg";
import type { KpiListFilters, KpiRepository } from "../../../domain/repositories/KpiRepository.js";
import type { CreateKpiInput, Kpi, KpiFrequency, UpdateKpiInput } from "../../../domain/entities/Kpi.js";
import { NotFoundError } from "../../../domain/errors/DomainErrors.js";
import { buildUpdateSet } from "./dynamicUpdate.js";

interface KpiRow {
  id: string;
  tenant_id: string;
  label: string;
  target_value: number;
  unit: string;
  frequency: KpiFrequency;
  owner: string;
  department_id: string | null;
  process_id: string | null;
  active: boolean;
  created_at: Date;
  updated_at: Date;
  deleted_at: Date | null;
  deleted_by: string | null;
  deletion_reason: string | null;
}

function toDomain(row: KpiRow): Kpi {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    label: row.label,
    targetValue: row.target_value,
    unit: row.unit,
    frequency: row.frequency,
    owner: row.owner,
    departmentId: row.department_id,
    processId: row.process_id,
    active: row.active,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    deletedAt: row.deleted_at,
    deletedBy: row.deleted_by,
    deletionReason: row.deletion_reason,
  };
}

export class PostgresKpiRepository implements KpiRepository {
  constructor(private readonly pool: Pool) {}

  async getById(tenantId: string, id: string): Promise<Kpi | null> {
    const { rows } = await this.pool.query<KpiRow>(
      `SELECT * FROM kpis WHERE tenant_id = $1 AND id = $2 AND deleted_at IS NULL`,
      [tenantId, id],
    );
    return rows[0] ? toDomain(rows[0]) : null;
  }

  async list(tenantId: string, filters?: KpiListFilters): Promise<Kpi[]> {
    // Column names below are fixed literals (never user-supplied) —
    // only the values are parameterized, so this stays injection-safe
    // despite the conditions being built dynamically.
    const conditions = ["tenant_id = $1", "deleted_at IS NULL"];
    const values: unknown[] = [tenantId];
    let i = 2;

    if (!filters?.includeInactive) conditions.push("active = true");
    if (filters?.departmentId) {
      conditions.push(`department_id = $${i}`);
      values.push(filters.departmentId);
      i++;
    }
    if (filters?.processId) {
      conditions.push(`process_id = $${i}`);
      values.push(filters.processId);
      i++;
    }

    const { rows } = await this.pool.query<KpiRow>(
      `SELECT * FROM kpis WHERE ${conditions.join(" AND ")} ORDER BY label`,
      values,
    );
    return rows.map(toDomain);
  }

  async create(input: CreateKpiInput): Promise<Kpi> {
    const { rows } = await this.pool.query<KpiRow>(
      `INSERT INTO kpis
         (tenant_id, label, target_value, unit, frequency, owner, department_id, process_id, active)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       RETURNING *`,
      [
        input.tenantId,
        input.label,
        input.targetValue,
        input.unit,
        input.frequency,
        input.owner,
        input.departmentId ?? null,
        input.processId ?? null,
        input.active ?? true,
      ],
    );
    const row = rows[0];
    if (!row) throw new Error("Insert into kpis returned no row");
    return toDomain(row);
  }

  async update(tenantId: string, id: string, input: UpdateKpiInput): Promise<Kpi> {
    const { setClauses, values } = buildUpdateSet(
      {
        label: input.label,
        target_value: input.targetValue,
        unit: input.unit,
        frequency: input.frequency,
        owner: input.owner,
        department_id: input.departmentId,
        process_id: input.processId,
        active: input.active,
      },
      3,
    );
    if (setClauses.length === 0) {
      const current = await this.getById(tenantId, id);
      if (!current) throw new NotFoundError("Kpi", id);
      return current;
    }

    const { rows } = await this.pool.query<KpiRow>(
      `UPDATE kpis SET ${setClauses.join(", ")}, updated_at = now()
       WHERE tenant_id = $1 AND id = $2 AND deleted_at IS NULL
       RETURNING *`,
      [tenantId, id, ...values],
    );
    const row = rows[0];
    if (!row) throw new NotFoundError("Kpi", id);
    return toDomain(row);
  }

  async softDelete(tenantId: string, id: string, deletedBy: string, reason: string): Promise<void> {
    const { rowCount } = await this.pool.query(
      `UPDATE kpis
       SET deleted_at = now(), deleted_by = $3, deletion_reason = $4
       WHERE tenant_id = $1 AND id = $2 AND deleted_at IS NULL`,
      [tenantId, id, deletedBy, reason],
    );
    if (!rowCount) throw new NotFoundError("Kpi", id);
  }
}
