import type { TransactionalAudit } from "../entities/RiskFramework.js";

/** One reason erased: its id and source only, never its text. */
export interface ErasedVisibilityReason {
  id: string;
  source: string;
}

/** Conservation L2b (q248 B): erasing the text of visibility reasons whose effect ended long enough ago. Tenant-scoped. */
export interface VisibilityReasonRetentionRepository {
  /** Sets `text` to NULL and `erased_at` for each reason ended more than `days` days ago (never a DELETE). The audit rows are written in the same transaction. */
  purge(tenantId: string, days: number, audit: TransactionalAudit<ErasedVisibilityReason[]>): Promise<ErasedVisibilityReason[]>;
  /** Dry run: the reasons a purge would erase now, without writing. */
  candidates(tenantId: string, days: number): Promise<ErasedVisibilityReason[]>;
}
