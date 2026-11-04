import type { TransactionalAudit } from "../entities/RiskFramework.js";

/** R3 (DECISION-099, q227 / DECISION-114): erasing the « dernière activité » date of ended accounts. Tenant-scoped. */
export interface LastSeenRetentionRepository {
  /**
   * Sets `last_seen_at` and `last_token_iat` to NULL for the accounts suspended (`deleted_at`) more than `days` days ago
   * that still carry one of them — never a DELETE. Idempotent. The audit rows are written in the same transaction.
   * Returns the ids of the accounts erased.
   */
  purge(tenantId: string, days: number, audit: TransactionalAudit<string[]>): Promise<string[]>;
}
