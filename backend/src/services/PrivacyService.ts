import { requirePermission } from "../domain/permissions.js";
import { DEFAULT_LAST_SEEN_RETENTION_DAYS } from "../domain/entities/Config.js";
import type { ConfigRepository } from "../domain/repositories/ConfigRepository.js";
import type { LastSeenRetentionRepository } from "../domain/repositories/LastSeenRetentionRepository.js";
import type { AuthenticatedUser } from "../infrastructure/identity/IdentityProvider.js";

export interface PrivacyNoticeFacts {
  /** R5: the duration written in the information text; null = the client keeps the date with no limit. */
  lastSeenRetentionDays: number | null;
  /** R5 `{contactDpo}`: no client setting holds it yet, so always null (the screen asks the administrator to fill it in). */
  dpoContact: string | null;
}

/**
 * R3 / R5 (DECISION-099, q227 / DECISION-114): the « dernière activité » date of accounts.
 *  - notice: what the information text needs, for any signed-in person (it is about their own data).
 *  - purgeLastSeen: erases (sets to NULL, never deletes) the date of accounts ended more than N days ago, N =
 *    `configs.last_seen_retention_days` (1826 by default, adjustable as a governance delay). Idempotent, audited per
 *    account in the same transaction, tenant-scoped. `user.update`: an administrator act on accounts. No scheduler exists
 *    in the application: an external job calls the route (or an administrator), as often as wanted.
 */
export class PrivacyService {
  constructor(
    private readonly retention: LastSeenRetentionRepository,
    private readonly configs: Pick<ConfigRepository, "getByTenant">,
  ) {}

  private async retentionDays(tenantId: string): Promise<number | null> {
    const config = await this.configs.getByTenant(tenantId);
    if (!config) return DEFAULT_LAST_SEEN_RETENTION_DAYS;
    return config.lastSeenRetentionDays === undefined ? DEFAULT_LAST_SEEN_RETENTION_DAYS : config.lastSeenRetentionDays;
  }

  async notice(actor: AuthenticatedUser): Promise<PrivacyNoticeFacts> {
    return { lastSeenRetentionDays: await this.retentionDays(actor.tenantId), dpoContact: null };
  }

  async purgeLastSeen(actor: AuthenticatedUser, requestId: string): Promise<{ retentionDays: number | null; erased: number }> {
    requirePermission(actor, "user.update");
    const days = await this.retentionDays(actor.tenantId);
    if (days === null) return { retentionDays: null, erased: 0 };
    const reason = `Conservation R3 : date de dernière activité effacée ${days} jours après la fin du compte`;
    const erased = await this.retention.purge(actor.tenantId, days, (ids) =>
      ids.map((id) => ({
        tenantId: actor.tenantId,
        userId: actor.userId,
        entityType: "User",
        entityId: id,
        action: "UPDATE" as const,
        // The erased date is never copied into the journal (it would survive the purge).
        oldValue: null,
        newValue: { lastSeenAt: null, lastTokenIat: null, purge: "R3" },
        reason,
        requestId,
      })),
    );
    return { retentionDays: days, erased: erased.length };
  }
}
