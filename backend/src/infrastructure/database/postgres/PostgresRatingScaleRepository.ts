import type { Pool } from "pg";
import type { RatingScaleRepository } from "../../../domain/repositories/RatingScaleRepository.js";
import type {
  CreateRatingScaleInput,
  ImpactAxesConfig,
  MasteryScaleConfig,
  RatingScale,
  ScaleLevel,
  ScoreThreshold,
} from "../../../domain/entities/RatingScale.js";
import { NotFoundError } from "../../../domain/errors/DomainErrors.js";

interface RatingScaleRow {
  id: string;
  tenant_id: string;
  name: string;
  version: string;
  status: "DRAFT" | "ACTIVE" | "ARCHIVED";
  probability_levels: number;
  probability_labels: ScaleLevel[] | null;
  impact_levels: number;
  impact_labels: ScaleLevel[] | null;
  criticality_thresholds: ScoreThreshold[] | null;
  impact_axes: ImpactAxesConfig | null;
  velocity_levels: ScaleLevel[] | null;
  persistence_levels: ScaleLevel[] | null;
  mastery_scale: MasteryScaleConfig | null;
  activated_at: Date | null;
  archived_at: Date | null;
  created_at: Date;
  updated_at: Date;
  deleted_at: Date | null;
  deleted_by: string | null;
  deletion_reason: string | null;
}

function toDomain(row: RatingScaleRow): RatingScale {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    name: row.name,
    version: row.version,
    status: row.status,
    probabilityLevels: row.probability_levels,
    probabilityLabels: row.probability_labels,
    impactLevels: row.impact_levels,
    impactLabels: row.impact_labels,
    criticalityThresholds: row.criticality_thresholds,
    impactAxes: row.impact_axes,
    velocityLevels: row.velocity_levels,
    persistenceLevels: row.persistence_levels,
    masteryScale: row.mastery_scale,
    activatedAt: row.activated_at,
    archivedAt: row.archived_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    deletedAt: row.deleted_at,
    deletedBy: row.deleted_by,
    deletionReason: row.deletion_reason,
  };
}

export class PostgresRatingScaleRepository implements RatingScaleRepository {
  constructor(private readonly pool: Pool) {}

  async getById(tenantId: string, id: string): Promise<RatingScale | null> {
    const { rows } = await this.pool.query<RatingScaleRow>(
      `SELECT * FROM rating_scales WHERE tenant_id = $1 AND id = $2 AND deleted_at IS NULL`,
      [tenantId, id],
    );
    return rows[0] ? toDomain(rows[0]) : null;
  }

  async list(tenantId: string, options?: { includeArchived?: boolean }): Promise<RatingScale[]> {
    const statusFilter = options?.includeArchived ? "" : "AND status != 'ARCHIVED'";
    const { rows } = await this.pool.query<RatingScaleRow>(
      `SELECT * FROM rating_scales
       WHERE tenant_id = $1 AND deleted_at IS NULL ${statusFilter}
       ORDER BY created_at DESC`,
      [tenantId],
    );
    return rows.map(toDomain);
  }

  async create(input: CreateRatingScaleInput): Promise<RatingScale> {
    const { rows } = await this.pool.query<RatingScaleRow>(
      `INSERT INTO rating_scales
         (tenant_id, name, version, status, probability_levels, probability_labels,
          impact_levels, impact_labels)
       VALUES ($1, $2, $3, 'DRAFT', $4, $5, $6, $7)
       RETURNING *`,
      [
        input.tenantId,
        input.name,
        input.version,
        input.probabilityLevels,
        input.probabilityLabels ? JSON.stringify(input.probabilityLabels) : null,
        input.impactLevels,
        input.impactLabels ? JSON.stringify(input.impactLabels) : null,
      ],
    );
    const row = rows[0];
    if (!row) throw new Error("Insert into rating_scales returned no row");
    return toDomain(row);
  }

  private async setJsonColumn(
    tenantId: string,
    id: string,
    column: string,
    value: unknown,
  ): Promise<RatingScale> {
    const { rows } = await this.pool.query<RatingScaleRow>(
      `UPDATE rating_scales SET ${column} = $3, updated_at = now()
       WHERE tenant_id = $1 AND id = $2 AND deleted_at IS NULL
       RETURNING *`,
      [tenantId, id, JSON.stringify(value)],
    );
    const row = rows[0];
    if (!row) throw new NotFoundError("RatingScale", id);
    return toDomain(row);
  }

  async updateThresholds(tenantId: string, id: string, thresholds: ScoreThreshold[]): Promise<RatingScale> {
    return this.setJsonColumn(tenantId, id, "criticality_thresholds", thresholds);
  }

  async updateImpactAxes(tenantId: string, id: string, config: ImpactAxesConfig): Promise<RatingScale> {
    return this.setJsonColumn(tenantId, id, "impact_axes", config);
  }

  async updateVelocity(tenantId: string, id: string, levels: ScaleLevel[]): Promise<RatingScale> {
    return this.setJsonColumn(tenantId, id, "velocity_levels", levels);
  }

  async updatePersistence(tenantId: string, id: string, levels: ScaleLevel[]): Promise<RatingScale> {
    return this.setJsonColumn(tenantId, id, "persistence_levels", levels);
  }

  async updateMastery(tenantId: string, id: string, config: MasteryScaleConfig): Promise<RatingScale> {
    return this.setJsonColumn(tenantId, id, "mastery_scale", config);
  }

  async activateAndArchivePrevious(tenantId: string, id: string): Promise<RatingScale> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");

      await client.query(
        `UPDATE rating_scales
         SET status = 'ARCHIVED', archived_at = now(), updated_at = now()
         WHERE tenant_id = $1 AND status = 'ACTIVE' AND id != $2 AND deleted_at IS NULL`,
        [tenantId, id],
      );

      const { rows } = await client.query<RatingScaleRow>(
        `UPDATE rating_scales
         SET status = 'ACTIVE', activated_at = now(), archived_at = NULL, updated_at = now()
         WHERE tenant_id = $1 AND id = $2 AND deleted_at IS NULL
         RETURNING *`,
        [tenantId, id],
      );
      const row = rows[0];
      if (!row) throw new NotFoundError("RatingScale", id);

      await client.query("COMMIT");
      return toDomain(row);
    } catch (err) {
      await client.query("ROLLBACK");
      throw err;
    } finally {
      client.release();
    }
  }

  async softDelete(tenantId: string, id: string, deletedBy: string, reason: string): Promise<void> {
    const { rowCount } = await this.pool.query(
      `UPDATE rating_scales
       SET deleted_at = now(), deleted_by = $3, deletion_reason = $4
       WHERE tenant_id = $1 AND id = $2 AND deleted_at IS NULL`,
      [tenantId, id, deletedBy, reason],
    );
    if (!rowCount) throw new NotFoundError("RatingScale", id);
  }
}
