import type { Pool } from "pg";
import { insertAuditEvent } from "./PostgresAuditRepository.js";

export interface UserIdentityColumns {
  id: string;
  tenant_id: string;
  identity_provider: string | null;
  identity_subject: string | null;
}

/**
 * q282 A (DECISION-132): a user account is bound to the provider's STABLE account id (Google `sub`) at first login; afterwards
 * the login requires the same id, so an address reassigned to another person no longer inherits the account.
 * Returns true when the caller may proceed (already bound to this subject, or bound now), false on a mismatch (refused).
 * The first binding and its audit row are written in ONE transaction; the UPDATE only fires while the account is still
 * unbound (concurrent first logins: one wins, the other re-reads). The subject itself is never written to the audit trail.
 * Re-binding after a real account change is a deliberate DevOps action (set both columns to NULL, traced).
 */
export async function ensureIdentityBinding(
  pool: Pool,
  user: UserIdentityColumns,
  subject: { provider: string; id: string },
): Promise<boolean> {
  if (user.identity_subject !== null) {
    return user.identity_provider === subject.provider && user.identity_subject === subject.id;
  }
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const { rowCount } = await client.query(
      `UPDATE users SET identity_provider = $3, identity_subject = $4
       WHERE tenant_id = $1 AND id = $2 AND identity_subject IS NULL AND deleted_at IS NULL`,
      [user.tenant_id, user.id, subject.provider, subject.id],
    );
    if (rowCount === 1) {
      await insertAuditEvent(client, {
        tenantId: user.tenant_id,
        userId: user.id,
        entityType: "User",
        entityId: user.id,
        action: "UPDATE",
        oldValue: null,
        newValue: { identityLinked: true, identityProvider: subject.provider },
        reason: "First login: account linked to the identity provider's stable id",
        requestId: "identity-binding",
      });
    }
    await client.query("COMMIT");
    if (rowCount === 1) return true;
  } catch (err) {
    await client.query("ROLLBACK").catch(() => undefined);
    // 23505: this subject is already bound to ANOTHER active account of the same provider: refused.
    if ((err as { code?: string }).code === "23505") return false;
    throw err;
  } finally {
    client.release();
  }
  // Lost the race (or the row changed): compare with what is stored now.
  const { rows } = await pool.query<UserIdentityColumns>(
    `SELECT id, tenant_id, identity_provider, identity_subject FROM users WHERE tenant_id = $1 AND id = $2 AND deleted_at IS NULL`,
    [user.tenant_id, user.id],
  );
  const now = rows[0];
  return !!now && now.identity_provider === subject.provider && now.identity_subject === subject.id;
}
