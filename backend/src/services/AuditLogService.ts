import type { AuditRepository, AuditSearchFilters } from "../domain/repositories/AuditRepository.js";
import type { AuditEvent } from "../domain/entities/AuditEvent.js";
import { requirePermission } from "../domain/permissions.js";
import type { AuthenticatedUser } from "../infrastructure/identity/IdentityProvider.js";

const MAX_LIMIT = 500;
const DEFAULT_LIMIT = 100;

/**
 * The global journal apps-script-legacy/09_JournalGlobal.gs asked for
 * but deliberately left unwired ("le raccordement transverse est un
 * chantier séparé"). No separate wiring needed here: every service
 * already writes through AuditRepository.record on every action, so
 * this is automatic by construction rather than a manual log.
 */
export class AuditLogService {
  constructor(private readonly audit: AuditRepository) {}

  async listRecent(actor: AuthenticatedUser, limit = DEFAULT_LIMIT): Promise<AuditEvent[]> {
    requirePermission(actor, "audit.read");
    return this.audit.listRecent(actor.tenantId, Math.min(limit, MAX_LIMIT));
  }

  async listForEntity(actor: AuthenticatedUser, entityType: string, entityId: string): Promise<AuditEvent[]> {
    requirePermission(actor, "audit.read");
    return this.audit.listForEntity(actor.tenantId, entityType, entityId);
  }

  /** ACT-071 / ACT-230-231: the filtered journal (user, action, resource, date range). */
  async search(actor: AuthenticatedUser, filters: AuditSearchFilters, limit = DEFAULT_LIMIT): Promise<AuditEvent[]> {
    requirePermission(actor, "audit.read");
    if (!this.audit.search) {
      throw new Error("This AuditRepository implementation does not support filtered search");
    }
    return this.audit.search(actor.tenantId, filters, Math.min(limit, MAX_LIMIT));
  }
}
