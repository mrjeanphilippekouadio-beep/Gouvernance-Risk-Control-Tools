import type { Pool } from "pg";
import type { TransactionalAudit } from "../../../domain/entities/RiskFramework.js";
import type { ErasedVisibilityReason, VisibilityReasonRetentionRepository } from "../../../domain/repositories/VisibilityReasonRetentionRepository.js";
import { runAudited } from "./PostgresAuditRepository.js";

/** Same condition as the guard of migration 097: effect ended, and the retention elapsed since. */
const ELIGIBLE = `WHERE tenant_id = $1 AND text IS NOT NULL AND effect_ended_at IS NOT NULL
  AND effect_ended_at + make_interval(days => $2) <= clock_timestamp()`;

export class PostgresVisibilityReasonRetentionRepository implements VisibilityReasonRetentionRepository {
  constructor(private readonly pool: Pool) {}

  async purge(tenantId: string, days: number, audit: TransactionalAudit<ErasedVisibilityReason[]>): Promise<ErasedVisibilityReason[]> {
    return runAudited(
      this.pool,
      async (db) => {
        const { rows } = await db.query<ErasedVisibilityReason>(
          `UPDATE public.visibility_reasons SET text = NULL, erased_at = clock_timestamp() ${ELIGIBLE} RETURNING id, source, effect_ended_at AS "effectEndedAt"`,
          [tenantId, days],
        );
        return rows;
      },
      audit,
    );
  }

  async candidates(tenantId: string, days: number): Promise<ErasedVisibilityReason[]> {
    const { rows } = await this.pool.query<ErasedVisibilityReason>(`SELECT id, source FROM public.visibility_reasons ${ELIGIBLE} ORDER BY id`, [tenantId, days]);
    return rows;
  }
}
