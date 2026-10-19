import type { Pool } from "pg";
import pino from "pino";

const log = pino({ name: "identity.lastSeen" });
const ONE_HOUR_MS = 3_600_000;

/**
 * Lot D2a / q155 : enregistre `users.last_seen_at` (dernière connexion). Télémétrie technique : pas d'audit_log, aucune
 * donnée au-delà de la date (et de l'`iat` du jeton). Ne lève jamais et n'est jamais attendue par l'appelant : un échec
 * est journalisé et la requête continue.
 *  - Sans `tokenIat` (fournisseur local, connexion réelle) : au plus une fois par heure et par utilisateur.
 *  - Avec `tokenIat` (Google, I01 / migration 074) : une connexion n'est comptée que si l'`iat` du jeton est STRICTEMENT plus récent que
 *    `users.last_token_iat` (monotone, SEC-PNL3-01 : deux jetons en alternance ou un jeton plus ancien ne comptent pas). La comparaison est faite en SQL (atomique, indépendante de l'instance) ; la Map mémoire
 *    n'évite que l'UPDATE à chaque requête d'un même jeton.
 */
export function createLastSeenRecorder(pool: Pick<Pool, "query">) {
  // Filtres mémoire par processus (évitent un UPDATE par requête) ; la condition SQL reste l'autorité.
  const lastWrite = new Map<string, number>();
  const lastIat = new Map<string, number>();
  return (tenantId: string, userId: string, tokenIat?: number): void => {
    const now = Date.now();
    const key = `${tenantId}:${userId}`;
    if (tokenIat !== undefined) {
      const seen = lastIat.get(key);
      if (seen !== undefined && tokenIat <= seen) return; // monotone: an older or equal token is never a new connection
      lastIat.set(key, tokenIat);
    } else {
      const previous = lastWrite.get(key);
      if (previous !== undefined && now - previous < ONE_HOUR_MS) return;
      lastWrite.set(key, now);
    }
    void Promise.resolve()
      .then(() =>
        tokenIat !== undefined
          ? pool.query(
              `UPDATE users SET last_seen_at = now(), last_token_iat = $3
               WHERE tenant_id = $1 AND id = $2 AND deleted_at IS NULL AND (last_token_iat IS NULL OR last_token_iat < $3)`,
              [tenantId, userId, tokenIat],
            )
          : pool.query(
              `UPDATE users SET last_seen_at = now()
               WHERE tenant_id = $1 AND id = $2 AND deleted_at IS NULL
                 AND (last_seen_at IS NULL OR last_seen_at < now() - interval '1 hour')`,
              [tenantId, userId],
            ),
      )
      .catch((err: unknown) => {
        lastWrite.delete(key);
        lastIat.delete(key);
        log.warn({ tenantId, errorType: err instanceof Error ? err.name : "unknown" }, "last_seen_at update failed");
      });
  };
}
