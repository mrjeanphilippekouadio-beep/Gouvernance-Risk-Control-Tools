import type { AuditRepository, AuditSearchFilters } from "../domain/repositories/AuditRepository.js";
import type { AuditEvent } from "../domain/entities/AuditEvent.js";
import type { UserRepository } from "../domain/repositories/UserRepository.js";
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
/**
 * q251 (DECISION-120): new rows carry only ids; the names are joined back at read time, tenant-scoped. Absent when the
 * account no longer resolves (the id alone is returned, nothing is invented).
 */
export type AuditEventView = AuditEvent & { userDisplayName?: string; entityDisplayName?: string; namesAreCurrent?: true };

export class AuditLogService {
  constructor(
    private readonly audit: AuditRepository,
    private readonly users?: UserRepository,
  ) {}

  /**
   * q272 (DECISION-130): the joined names are the accounts' CURRENT names (`namesAreCurrent: true`), not the ones at the time of the
   * action. SEC-q251-03: one grouped, tenant-scoped read for all ids (no per-id fan-out); a failure leaves the ids alone.
   */
  private async withNames(tenantId: string, events: AuditEvent[]): Promise<AuditEventView[]> {
    const users = this.users;
    if (!users) return events;
    const ids = [...new Set(events.flatMap((e) => (e.entityType === "User" ? [e.userId, e.entityId] : [e.userId])))];
    const names = new Map<string, string>();
    try {
      if (users.getByIds) for (const u of await users.getByIds(tenantId, ids)) names.set(u.id, u.displayName);
      else for (const id of ids) { const u = await users.getById(tenantId, id); if (u) names.set(id, u.displayName); }
    } catch {
      return events;
    }
    return events.map((e) => {
      const userDisplayName = names.get(e.userId);
      const entityDisplayName = e.entityType === "User" ? names.get(e.entityId) : undefined;
      return {
        ...e,
        ...(userDisplayName !== undefined ? { userDisplayName } : {}),
        ...(entityDisplayName !== undefined ? { entityDisplayName } : {}),
        ...(userDisplayName !== undefined || entityDisplayName !== undefined ? { namesAreCurrent: true as const } : {}),
      };
    });
  }

  async listRecent(actor: AuthenticatedUser, limit = DEFAULT_LIMIT): Promise<AuditEventView[]> {
    requirePermission(actor, "audit.read");
    return this.withNames(actor.tenantId, await this.audit.listRecent(actor.tenantId, Math.min(limit, MAX_LIMIT)));
  }

  async listForEntity(actor: AuthenticatedUser, entityType: string, entityId: string): Promise<AuditEventView[]> {
    requirePermission(actor, "audit.read");
    return this.withNames(actor.tenantId, await this.audit.listForEntity(actor.tenantId, entityType, entityId));
  }

  /** ACT-071 / ACT-230-231: the filtered journal (user, action, resource, date range). */
  async search(actor: AuthenticatedUser, filters: AuditSearchFilters, limit = DEFAULT_LIMIT): Promise<AuditEventView[]> {
    requirePermission(actor, "audit.read");
    if (!this.audit.search) {
      throw new Error("This AuditRepository implementation does not support filtered search");
    }
    return this.withNames(actor.tenantId, await this.audit.search(actor.tenantId, filters, Math.min(limit, MAX_LIMIT)));
  }
}
