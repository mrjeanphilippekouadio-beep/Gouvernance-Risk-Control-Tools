import type { Pool } from "pg";
import { ValidationError } from "../../../domain/errors/DomainErrors.js";
import type { AccessExpiry } from "../../../domain/repositories/ResourceAccessRepository.js";

type Db = Pick<Pool, "query">;

/**
 * Lot V5 (q225 A): the access of a named person to a « personnes nommées » (NOMINATIF) dossier lasts 30 days at most
 * (migration 087; the database guard refuses anything longer), or until the dossier is closed. Renewable.
 */

/** Dossier turned NOMINATIF (or created so): every live access still without an expiry gets now() + 30 days. */
export async function stampNamedExpiry(db: Db, tenantId: string, type: string, id: string): Promise<void> {
  await db.query(
    `UPDATE resource_access_grants SET expires_at = now() + interval '30 days'
     WHERE tenant_id = $1 AND resource_type = $2 AND resource_id = $3 AND revoked_at IS NULL AND expires_at IS NULL`,
    [tenantId, type, id],
  );
}

/** Whether the dossier is closed (SQL `visibility_resource_closed`, migration 087). */
export async function isClosed(db: Db, tenantId: string, type: string, id: string): Promise<boolean> {
  const { rows } = await db.query<{ closed: boolean }>(`SELECT visibility_resource_closed($1, $2, $3) AS closed`, [tenantId, type, id]);
  return rows[0]?.closed === true;
}

/** Renewal: new expiry = now() + 30 days, never more. Each person must hold a live (even expired) access. */
export async function renewGrants(db: Db, tenantId: string, type: string, id: string, userIds: string[]): Promise<void> {
  for (const userId of new Set(userIds)) {
    const { rowCount } = await db.query(
      `UPDATE resource_access_grants SET expires_at = now() + interval '30 days'
       WHERE tenant_id = $1 AND resource_type = $2 AND resource_id = $3 AND user_id = $4 AND revoked_at IS NULL AND expires_at IS NOT NULL`,
      [tenantId, type, id, userId],
    );
    if (!rowCount) throw new ValidationError(`No renewable access for user ${userId}`);
  }
}

export async function listExpiries(db: Db, tenantId: string, type: string, id: string): Promise<AccessExpiry[]> {
  const { rows } = await db.query<{ user_id: string; expires_at: Date | null }>(
    `SELECT user_id, expires_at FROM resource_access_grants
     WHERE tenant_id = $1 AND resource_type = $2 AND resource_id = $3 AND revoked_at IS NULL ORDER BY granted_at`,
    [tenantId, type, id],
  );
  return rows.map((r) => ({ userId: r.user_id, expiresAt: r.expires_at }));
}
