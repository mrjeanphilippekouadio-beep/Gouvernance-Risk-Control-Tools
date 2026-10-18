import type { Pool } from "pg";
import pino from "pino";

const log = pino({ name: "identity.lastSeen" });
const ONE_HOUR_MS = 3_600_000;

/**
 * Lot D2a / q155 : enregistre `users.last_seen_at` au plus une fois par heure et par utilisateur.
 * Télémétrie technique : pas d'audit_log, aucune donnée au-delà de la date. Ne lève jamais et n'est
 * jamais attendue par l'appelant : un échec est journalisé et la requête continue.
 */
export function createLastSeenRecorder(pool: Pick<Pool, "query">) {
  // Filtre mémoire par processus (évite un UPDATE par requête) ; la condition SQL reste l'autorité.
  const lastWrite = new Map<string, number>();
  return (tenantId: string, userId: string): void => {
    const now = Date.now();
    const key = `${tenantId}:${userId}`;
    const previous = lastWrite.get(key);
    if (previous !== undefined && now - previous < ONE_HOUR_MS) return;
    lastWrite.set(key, now);
    void Promise.resolve()
      .then(() =>
        pool.query(
          `UPDATE users SET last_seen_at = now()
           WHERE tenant_id = $1 AND id = $2 AND deleted_at IS NULL
             AND (last_seen_at IS NULL OR last_seen_at < now() - interval '1 hour')`,
          [tenantId, userId],
        ),
      )
      .catch((err: unknown) => {
        lastWrite.delete(key);
        log.warn({ tenantId, errorType: err instanceof Error ? err.name : "unknown" }, "last_seen_at update failed");
      });
  };
}
