import { requirePermission } from "../domain/permissions.js";
import { DEFAULT_LAST_SEEN_RETENTION_DAYS } from "../domain/entities/Config.js";
import type { ConfigRepository } from "../domain/repositories/ConfigRepository.js";
import type { LastSeenRetentionRepository } from "../domain/repositories/LastSeenRetentionRepository.js";
import type { AuthenticatedUser } from "../infrastructure/identity/IdentityProvider.js";
import type { AuditRepository } from "../domain/repositories/AuditRepository.js";

export interface PrivacyNoticeFacts {
  /** R5: the duration written in the information text; null = the client keeps the date with no limit. */
  lastSeenRetentionDays: number | null;
  /** R5 `{contactDpo}` (q231 B): `configs.dpo_contact`, entered at go-live; null = not filled in yet. */
  dpoContact: string | null;
}

export type PurgeOutcome =
  | { dryRun: false; retentionDays: number | null; erased: number }
  | { dryRun: true; retentionDays: number | null; wouldErase: number; userIds: string[] };

/**
 * R3 / R5 (DECISION-099, q227 / DECISION-114, q231 / DECISION-115): the « dernière activité » date of accounts.
 *  - notice: what the information text needs, for any signed-in person (it is about their own data).
 *  - purgeLastSeen: erases (sets to NULL, never deletes) the date of accounts ended more than N days ago, N =
 *    `configs.last_seen_retention_days` (1826 by default, at least 365, shortening it needs a second person). Manual
 *    (q231 B): an administrator runs it. Every real run leaves one execution trace (`LastSeenPurge`, count and duration,
 *    even at zero) plus one line per account erased, in the same transaction; the erased date is never copied. `dryRun`
 *    lists the accounts concerned (count and ids) without writing anything.
 */
export class PrivacyService {
  constructor(
    private readonly retention: LastSeenRetentionRepository,
    private readonly configs: Pick<ConfigRepository, "getByTenant">,
    /** Traces a run with no retention set (nothing to erase). Optional for older wiring; the purge itself audits in its transaction. */
    private readonly audit?: Pick<AuditRepository, "record">,
  ) {}

  private async settings(tenantId: string): Promise<PrivacyNoticeFacts> {
    const config = await this.configs.getByTenant(tenantId);
    const days = config?.lastSeenRetentionDays;
    return { lastSeenRetentionDays: days === undefined ? DEFAULT_LAST_SEEN_RETENTION_DAYS : days, dpoContact: config?.dpoContact?.trim() || null };
  }

  async notice(actor: AuthenticatedUser): Promise<PrivacyNoticeFacts> {
    return this.settings(actor.tenantId);
  }

  async purgeLastSeen(actor: AuthenticatedUser, requestId: string, options: { dryRun?: boolean } = {}): Promise<PurgeOutcome> {
    requirePermission(actor, "user.update");
    const days = (await this.settings(actor.tenantId)).lastSeenRetentionDays;
    if (options.dryRun) {
      const userIds = days === null ? [] : await this.retention.candidates(actor.tenantId, days);
      return { dryRun: true, retentionDays: days, wouldErase: userIds.length, userIds };
    }
    const reason = days === null
      ? "Conservation R3 : aucune durée fixée, rien à effacer"
      : `Conservation R3 : date de dernière activité effacée ${days} jours après la fin du compte`;
    const run = (ids: string[]) => ({
      tenantId: actor.tenantId,
      userId: actor.userId,
      entityType: "LastSeenPurge",
      entityId: actor.tenantId,
      action: "UPDATE" as const,
      oldValue: null,
      newValue: { erased: ids.length, retentionDays: days },
      reason,
      requestId,
    });
    if (days === null) {
      await this.audit?.record(run([]));
      return { dryRun: false, retentionDays: null, erased: 0 };
    }
    const erased = await this.retention.purge(actor.tenantId, days, (ids) => [
      run(ids),
      ...ids.map((id) => ({
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
    ]);
    return { dryRun: false, retentionDays: days, erased: erased.length };
  }
}
