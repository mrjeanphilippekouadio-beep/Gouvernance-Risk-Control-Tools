import type { Pool } from "pg";
import type { TransactionalAudit } from "../../../domain/entities/RiskFramework.js";
import type { LastSeenRetentionRepository } from "../../../domain/repositories/LastSeenRetentionRepository.js";
import { runAudited } from "./PostgresAuditRepository.js";

/**
 * R3: the end of an account is its suspension (`users.deleted_at`, the only date that records it — there is no separate
 * definitive-suspension date). `last_token_iat` (time of the last Google token) carries the same information and is
 * erased with it. Backups are not touched: they disappear with their normal rotation (q227).
 */
export class PostgresLastSeenRetentionRepository implements LastSeenRetentionRepository {
  constructor(private readonly pool: Pool) {}

  async purge(tenantId: string, days: number, audit: TransactionalAudit<string[]>): Promise<string[]> {
    return runAudited(
      this.pool,
      async (db) => {
        const { rows } = await db.query<{ id: string }>(
          `UPDATE users SET last_seen_at = NULL, last_token_iat = NULL
           WHERE tenant_id = $1 AND deleted_at IS NOT NULL AND deleted_at < now() - make_interval(days => $2)
             AND (last_seen_at IS NOT NULL OR last_token_iat IS NOT NULL)
           RETURNING id`,
          [tenantId, days],
        );
        return rows.map((r) => r.id);
      },
      audit,
    );
  }
}
