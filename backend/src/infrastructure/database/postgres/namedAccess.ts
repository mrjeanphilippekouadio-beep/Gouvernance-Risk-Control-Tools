import type { Pool } from "pg";
import { ValidationError } from "../../../domain/errors/DomainErrors.js";
import type { AccessExpiry } from "../../../domain/repositories/ResourceAccessRepository.js";

type Db = Pick<Pool, "query">;

/**
 * Lot V5 (q225 A): the access of a named person to a « personnes nommées » (NOMINATIF) dossier lasts 30 days at most
 * (migration 087; the database guard refuses anything longer), or until the dossier is closed. Renewable.
 */

/** Dossier turned NOMINATIF or PERIMETRE (or created so; q253 A): every live access still without an expiry gets now() + 30 days. */
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
      `UPDATE resource_access_grants SET expires_at = clock_timestamp() + interval '30 days'
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

/** The people whose access reads now (SQL `visibility_granted`): not expired, not closed. For audit snapshots and counts. */
export async function validList(db: Db, tenantId: string, type: string, id: string): Promise<string[]> {
  const { rows } = await db.query<{ user_id: string }>(
    `SELECT user_id FROM resource_access_grants g
     WHERE g.tenant_id = $1 AND g.resource_type = $2 AND g.resource_id = $3 AND g.revoked_at IS NULL
       AND visibility_granted(g.tenant_id, g.resource_type, g.resource_id, g.user_id) ORDER BY g.granted_at`,
    [tenantId, type, id],
  );
  return rows.map((r) => r.user_id);
}

/**
 * Adding someone whose live access has ended (expired): the addition renews it (30 days from now) — never a silent no-op.
 * A closed dossier refuses with a clear 400.
 */
export async function reviveExpired(db: Db, tenantId: string, type: string, id: string, userId: string): Promise<void> {
  const { rows } = await db.query<{ expires_at: Date | null; valid: boolean }>(
    `SELECT g.expires_at, visibility_granted(g.tenant_id, g.resource_type, g.resource_id, g.user_id) AS valid
     FROM resource_access_grants g
     WHERE g.tenant_id = $1 AND g.resource_type = $2 AND g.resource_id = $3 AND g.user_id = $4 AND g.revoked_at IS NULL`,
    [tenantId, type, id, userId],
  );
  const row = rows[0];
  if (!row || row.valid || row.expires_at === null) return;
  if (await isClosed(db, tenantId, type, id)) throw new ValidationError("This dossier is closed: the named access has ended");
  await renewGrants(db, tenantId, type, id, [userId]);
}
