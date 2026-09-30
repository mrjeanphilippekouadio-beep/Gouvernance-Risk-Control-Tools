import type { Pool, PoolClient } from "pg";
import type { KriListFilters, KriRepository } from "../../../domain/repositories/KriRepository.js";
import type { CreateKriInput, Kri, KriFrequency, UpdateKriInput } from "../../../domain/entities/Kri.js";
import { NotFoundError } from "../../../domain/errors/DomainErrors.js";
import { buildUpdateSet } from "./dynamicUpdate.js";

interface KriRow {
  id: string;
  tenant_id: string;
  label: string;
  formula: string;
  threshold_green: number;
  threshold_orange: number;
  threshold_red: number;
  frequency: KriFrequency;
  risk_id: string;
  entity: string | null;
  methodology_version: string | null;
  description: string | null;
  active: boolean;
  created_at: Date;
  updated_at: Date;
  deleted_at: Date | null;
  deleted_by: string | null;
  deletion_reason: string | null;
}

function toDomain(row: KriRow): Kri {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    label: row.label,
    formula: row.formula,
    thresholdGreen: row.threshold_green,
    thresholdOrange: row.threshold_orange,
    thresholdRed: row.threshold_red,
    frequency: row.frequency,
    riskId: row.risk_id,
    entity: row.entity,
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

/**
 * `kri_risks` is a pure link table (see the `control_risks` exemption in
 * CLAUDE.md's Security-sensitive conventions) — rebuilt by delete +
 * insert rather than soft-deleted, but always tenant-scoped so it can
 * never touch another tenant's row even if kriId were reused.
 */
async function replaceCoveredRisksInternal(
  client: PoolClient,
  tenantId: string,
  kriId: string,
  riskIds: string[],
): Promise<void> {
  await client.query(`DELETE FROM kri_risks WHERE tenant_id = $1 AND kri_id = $2`, [tenantId, kriId]);
  for (const riskId of riskIds) {
    await client.query(`INSERT INTO kri_risks (tenant_id, kri_id, risk_id) VALUES ($1, $2, $3)`, [
      tenantId,
      kriId,
      riskId,
    ]);
  }
}

export class PostgresKriRepository implements KriRepository {
  constructor(private readonly pool: Pool) {}

  async getById(tenantId: string, id: string): Promise<Kri | null> {
    const { rows } = await this.pool.query<KriRow>(
      `SELECT * FROM kris WHERE tenant_id = $1 AND id = $2 AND deleted_at IS NULL`,
      [tenantId, id],
    );
    return rows[0] ? toDomain(rows[0]) : null;
  }

  async list(tenantId: string, filters?: KriListFilters): Promise<Kri[]> {
    // Column names below are fixed literals (never user-supplied) —
    // only the values are parameterized, so this stays injection-safe
    // despite the conditions being built dynamically.
    const conditions = ["tenant_id = $1", "deleted_at IS NULL"];
    const values: unknown[] = [tenantId];
    let i = 2;

    if (!filters?.includeInactive) conditions.push("active = true");
    if (filters?.riskId) {
      conditions.push(`risk_id = $${i}`);
      values.push(filters.riskId);
      i++;
    }
    if (filters?.entity) {
      conditions.push(`entity = $${i}`);
      values.push(filters.entity);
      i++;
    }
    if (filters?.riskIds && filters.riskIds.length > 0) {
      conditions.push(`risk_id = ANY($${i})`);
      values.push(filters.riskIds);
      i++;
    }

    const { rows } = await this.pool.query<KriRow>(
      `SELECT * FROM kris WHERE ${conditions.join(" AND ")} ORDER BY label`,
      values,
    );
    return rows.map(toDomain);
  }

  async create(input: CreateKriInput): Promise<Kri> {
    const { rows } = await this.pool.query<KriRow>(
      `INSERT INTO kris
         (tenant_id, label, formula, threshold_green, threshold_orange, threshold_red,
          frequency, risk_id, entity, methodology_version, description, active)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
       RETURNING *`,
      [
        input.tenantId,
        input.label,
        input.formula,
        input.thresholdGreen,
        input.thresholdOrange,
        input.thresholdRed,
        input.frequency,
        input.riskId,
        input.entity ?? null,
        input.methodologyVersion ?? null,
        input.description ?? null,
        input.active ?? true,
      ],
    );
    const row = rows[0];
    if (!row) throw new Error("Insert into kris returned no row");
    return toDomain(row);
  }

  async update(tenantId: string, id: string, input: UpdateKriInput): Promise<Kri> {
    const { setClauses, values } = buildUpdateSet(
      {
        label: input.label,
        formula: input.formula,
        threshold_green: input.thresholdGreen,
        threshold_orange: input.thresholdOrange,
        threshold_red: input.thresholdRed,
        frequency: input.frequency,
        entity: input.entity,
        methodology_version: input.methodologyVersion,
        description: input.description,
        active: input.active,
      },
      3,
    );
    if (setClauses.length === 0) {
      const current = await this.getById(tenantId, id);
      if (!current) throw new NotFoundError("Kri", id);
      return current;
    }

    const { rows } = await this.pool.query<KriRow>(
      `UPDATE kris SET ${setClauses.join(", ")}, updated_at = now()
       WHERE tenant_id = $1 AND id = $2 AND deleted_at IS NULL
       RETURNING *`,
      [tenantId, id, ...values],
    );
    const row = rows[0];
    if (!row) throw new NotFoundError("Kri", id);
    return toDomain(row);
  }

  async softDelete(tenantId: string, id: string, deletedBy: string, reason: string): Promise<void> {
    const { rowCount } = await this.pool.query(
      `UPDATE kris
       SET deleted_at = now(), deleted_by = $3, deletion_reason = $4
       WHERE tenant_id = $1 AND id = $2 AND deleted_at IS NULL`,
      [tenantId, id, deletedBy, reason],
    );
    if (!rowCount) throw new NotFoundError("Kri", id);
  }

  async listCoveredRiskIds(tenantId: string, kriId: string): Promise<string[]> {
    const { rows } = await this.pool.query<{ risk_id: string }>(
      `SELECT risk_id FROM kri_risks WHERE tenant_id = $1 AND kri_id = $2`,
      [tenantId, kriId],
    );
    return rows.map((r) => r.risk_id);
  }

  async replaceCoveredRisks(tenantId: string, kriId: string, riskIds: string[]): Promise<void> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      await replaceCoveredRisksInternal(client, tenantId, kriId, riskIds);
      await client.query("COMMIT");
    } catch (err) {
      await client.query("ROLLBACK");
      throw err;
    } finally {
      client.release();
    }
  }
}
