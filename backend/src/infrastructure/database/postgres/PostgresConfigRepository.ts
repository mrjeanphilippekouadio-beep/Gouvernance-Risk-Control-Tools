import type { Pool } from "pg";
import type { ConfigRepository } from "../../../domain/repositories/ConfigRepository.js";
import type {
  AppetiteMode,
  Config,
  ConfigPatch,
  EvaluationMode,
  LevelThreshold,
  RetainedImpactRule,
  ScoreFormula,
} from "../../../domain/entities/Config.js";
import { buildUpdateSet } from "./dynamicUpdate.js";

interface ConfigRow {
  id: string;
  tenant_id: string;
  score_formula: ScoreFormula;
  level_thresholds: LevelThreshold[];
  impact_retenu_rule: RetainedImpactRule;
  appetite_mode: AppetiteMode;
  evaluation_mode: EvaluationMode;
  version: number;
  updated_by: string | null;
  created_at: Date;
  updated_at: Date;
}

function toDomain(row: ConfigRow): Config {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    scoreFormula: row.score_formula,
    levelThresholds: row.level_thresholds ?? [],
    impactRetenuRule: row.impact_retenu_rule,
    appetiteMode: row.appetite_mode,
    evaluationMode: row.evaluation_mode,
    version: row.version,
    updatedBy: row.updated_by,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export class PostgresConfigRepository implements ConfigRepository {
  constructor(private readonly pool: Pool) {}

  async getByTenant(tenantId: string): Promise<Config | null> {
    const { rows } = await this.pool.query<ConfigRow>(`SELECT * FROM configs WHERE tenant_id = $1`, [tenantId]);
    return rows[0] ? toDomain(rows[0]) : null;
  }

  async upsert(tenantId: string, patch: ConfigPatch, updatedBy: string): Promise<Config> {
    // Creates the row with as-shipped defaults on first write for this
    // tenant (matches ConfigService's defaultConfig()) — ON CONFLICT DO
    // NOTHING so a concurrent first write never errors, then the UPDATE
    // below always applies the actual patch on top of whichever row won.
    await this.pool.query(
      `INSERT INTO configs (tenant_id, score_formula, level_thresholds, impact_retenu_rule, appetite_mode, evaluation_mode, version)
       VALUES ($1, 'P_X_I', '[]'::jsonb, 'MAX', 'AUTO_AVEC_SURCHARGE_MANUELLE', 'CLASSIQUE', 0)
       ON CONFLICT (tenant_id) DO NOTHING`,
      [tenantId],
    );

    const { setClauses, values } = buildUpdateSet(
      {
        score_formula: patch.scoreFormula,
        level_thresholds: patch.levelThresholds ? JSON.stringify(patch.levelThresholds) : undefined,
        impact_retenu_rule: patch.impactRetenuRule,
        appetite_mode: patch.appetiteMode,
        evaluation_mode: patch.evaluationMode,
      },
      3,
    );

    const { rows } = await this.pool.query<ConfigRow>(
      `UPDATE configs SET ${[...setClauses, "version = version + 1", "updated_by = $2", "updated_at = now()"].join(", ")}
       WHERE tenant_id = $1
       RETURNING *`,
      [tenantId, updatedBy, ...values],
    );
    const row = rows[0];
    if (!row) throw new Error(`Config upsert for tenant ${tenantId} returned no row`);
    return toDomain(row);
  }
}
