import type { AuditAction, AuditEvent } from "../entities/AuditEvent.js";

export interface AuditSearchFilters {
  userId?: string;
  action?: AuditAction;
  entityType?: string;
  entityId?: string;
  from?: Date;
  to?: Date;
}

export interface AuditRepository {
  record(event: Omit<AuditEvent, "id" | "timestamp">): Promise<void>;
  listForEntity(tenantId: string, entityType: string, entityId: string): Promise<AuditEvent[]>;
  /**
   * Every action across every module, most recent first — this is the
   * global journal apps-script-legacy/09_JournalGlobal.gs described but
   * explicitly never wired up automatically ("journaliserGlobal_()
   * n'est PAS appelée depuis les fonctions d'écriture des autres
   * modules"). Here it's automatic by construction: every service call
   * already writes through `record`.
   */
  listRecent(tenantId: string, limit: number): Promise<AuditEvent[]>;
  /**
   * ACT-071/ACT-230/231's filtered journal (user, action, resource,
   * date range). Optional so the existing in-memory test doubles for
   * this interface (built before this filter existed) keep compiling
   * without being touched — only PostgresAuditRepository implements it.
   */
  search?(tenantId: string, filters: AuditSearchFilters, limit: number): Promise<AuditEvent[]>;
}
