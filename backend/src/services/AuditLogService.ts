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
export type AuditEventView = AuditEvent & { userDisplayName?: string; entityDisplayName?: string };

export class AuditLogService {
  constructor(
    private readonly audit: AuditRepository,
    private readonly users?: UserRepository,
  ) {}

  private async withNames(tenantId: string, events: AuditEvent[]): Promise<AuditEventView[]> {
    const users = this.users;
    if (!users) return events;
    const cache = new Map<string, Promise<string | undefined>>();
    const nameOf = (id: string) => {
      let hit = cache.get(id);
      if (!hit) {
        hit = users.getById(tenantId, id).then((u) => u?.displayName, () => undefined);
        cache.set(id, hit);
      }
      return hit;
    };
    return Promise.all(
      events.map(async (e) => {
        const userDisplayName = await nameOf(e.userId);
        const entityDisplayName = e.entityType === "User" ? await nameOf(e.entityId) : undefined;
        return {
          ...e,
          ...(userDisplayName !== undefined ? { userDisplayName } : {}),
          ...(entityDisplayName !== undefined ? { entityDisplayName } : {}),
        };
      }),
    );
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
