import type { Pool } from "pg";
import type {
  SensitiveViewGrant,
  SensitiveViewGrantRepository,
  SensitiveViewGrantStatus,
  SensitiveViewGrantKind,
  RevokedGrant,
} from "../../../domain/repositories/SensitiveViewGrantRepository.js";
import type { TransactionalAudit } from "../../../domain/entities/RiskFramework.js";
import { displayReason } from "../../../domain/entities/VisibilityReason.js";
import { ConflictError } from "../../../domain/errors/DomainErrors.js";
import { runAudited } from "./PostgresAuditRepository.js";
import { insertVisibilityReason, reasonColumns } from "./visibilityReasons.js";

type Db = Pick<Pool, "query">;

interface Row {
  id: string;
  tenant_id: string;
  user_id: string;
  kind: SensitiveViewGrantKind;
  reason: string | null;
  reason_ref: string | null;
  status: SensitiveViewGrantStatus;
  requested_by: string;
  requested_at: Date;
  expires_at: Date | null;
  access_expires_at: Date | null;
  decided_by: string | null;
  decided_at: Date | null;
  decision_reason: string | null;
  decision_reason_ref: string | null;
  revoked_by: string | null;
  revoked_at: Date | null;
  revoke_reason: string | null;
  revoke_reason_ref: string | null;
  // The three stored reasons, joined by SELECT_GRANT (migration 096).
  rq_text: string | null;
  rq_erased_at: Date | null;
  dc_text: string | null;
  dc_erased_at: Date | null;
  rv_text: string | null;
  rv_erased_at: Date | null;
}

/** A reason stored in visibility_reasons reads as its text, or as « motif effacé le … » once erased; an older row keeps its own column. */
const readReason = (own: string | null, ref: string | null, text: string | null, erasedAt: Date | null): string | null =>
  ref ? displayReason(text, erasedAt) : own;

const toDomain = (r: Row): SensitiveViewGrant => ({
  id: r.id,
  tenantId: r.tenant_id,
  userId: r.user_id,
  kind: r.kind,
  reason: readReason(r.reason, r.reason_ref, r.rq_text, r.rq_erased_at) ?? "",
  reasonRef: r.reason_ref,
  status: r.status,
  requestedBy: r.requested_by,
  requestedAt: r.requested_at,
  expiresAt: r.expires_at,
  accessExpiresAt: r.access_expires_at,
  decidedBy: r.decided_by,
  decidedAt: r.decided_at,
  decisionReason: readReason(r.decision_reason, r.decision_reason_ref, r.dc_text, r.dc_erased_at),
  decisionReasonRef: r.decision_reason_ref,
  revokedBy: r.revoked_by,
  revokedAt: r.revoked_at,
  revokeReason: readReason(r.revoke_reason, r.revoke_reason_ref, r.rv_text, r.rv_erased_at),
  revokeReasonRef: r.revoke_reason_ref,
});

/** A grant with its three reasons joined (no extra FROM item: the WHERE clauses below stay as they were). */
const SELECT_GRANT = `SELECT g.*,
  ${reasonColumns("g.tenant_id", "g.reason_ref", "rq")},
  ${reasonColumns("g.tenant_id", "g.decision_reason_ref", "dc")},
  ${reasonColumns("g.tenant_id", "g.revoke_reason_ref", "rv")}
  FROM sensitive_view_grants g`;

async function grantOn(db: Db, tenantId: string, id: string): Promise<SensitiveViewGrant> {
  const { rows } = await db.query<Row>(`${SELECT_GRANT} WHERE g.tenant_id = $1 AND g.id = $2`, [tenantId, id]);
  return toDomain(rows[0]!);
}

const MAX_LISTED = 200;
/** q221 (DECISION-111): the PO's default, same as the column DEFAULT of migration 084. */
const DEFAULT_READALL_DAYS = 90;

/** q200 (DECISION-103): individual grants of role.read.sensitive (migration 079). */
export class PostgresSensitiveViewGrantRepository implements SensitiveViewGrantRepository {
  constructor(private readonly pool: Pool) {}

  async list(tenantId: string): Promise<SensitiveViewGrant[]> {
    const { rows } = await this.pool.query<Row>(
      `${SELECT_GRANT} WHERE g.tenant_id = $1 ORDER BY g.requested_at DESC LIMIT ${MAX_LISTED}`, [tenantId]);
    return rows.map(toDomain);
  }

  async getById(tenantId: string, id: string): Promise<SensitiveViewGrant | null> {
    const { rows } = await this.pool.query<Row>(`${SELECT_GRANT} WHERE g.tenant_id = $1 AND g.id = $2`, [tenantId, id]);
    return rows[0] ? toDomain(rows[0]) : null;
  }

  async isApproved(tenantId: string, userId: string, kind: SensitiveViewGrantKind = "ROLE_READ_SENSITIVE"): Promise<boolean> {
    const { rows } = await this.pool.query(
      `SELECT 1 FROM sensitive_view_grants WHERE tenant_id = $1 AND user_id = $2 AND kind = $3 AND status = 'APPROVED'
         AND (kind <> 'RESOURCE_READALL' OR access_expires_at > now())`, [tenantId, userId, kind]); // q221: an expired grant holds nothing
    return rows.length > 0;
  }

  async create(
    input: { tenantId: string; userId: string; reason: string; requestedBy: string; expiresAt: Date | null; kind?: SensitiveViewGrantKind },
    audit: TransactionalAudit<SensitiveViewGrant>,
  ): Promise<SensitiveViewGrant> {
    return runAudited(this.pool, async (db) => {
      try {
        // Conservation L2a: the text goes to visibility_reasons; the grant (and its audit row) reference it.
        const reasonRef = await insertVisibilityReason(db, input.tenantId, "SENSITIVE_VIEW_REQUEST", input.reason);
        const { rows } = await db.query<{ id: string }>(
          `INSERT INTO sensitive_view_grants (tenant_id, user_id, reason_ref, requested_by, expires_at, kind) VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
          [input.tenantId, input.userId, reasonRef, input.requestedBy, input.expiresAt, input.kind ?? "ROLE_READ_SENSITIVE"],
        );
        return await grantOn(db, input.tenantId, rows[0]!.id);
      } catch (err) {
        if ((err as { code?: string }).code === "23505") throw new ConflictError("This account already has a pending or active widened view");
        throw err;
      }
    }, audit);
  }

  async decide(
    tenantId: string,
    id: string,
    change: { status: "APPROVED" | "REJECTED"; by: string; reason: string | null; accessDays?: number },
    audit: TransactionalAudit<SensitiveViewGrant>,
  ): Promise<SensitiveViewGrant> {
    return runAudited(this.pool, async (db) => {
      const reasonRef = change.reason ? await insertVisibilityReason(db, tenantId, "SENSITIVE_VIEW_DECISION", change.reason) : null;
      const { rows } = await db.query<{ id: string }>(
        `UPDATE sensitive_view_grants SET status = $3, decided_by = $4, decided_at = now(), decision_reason_ref = $5,
           -- q221: the end of a RESOURCE_READALL access is fixed here, at the confirmation, and never recalculated.
           access_expires_at = CASE WHEN $3 = 'APPROVED' AND kind = 'RESOURCE_READALL' THEN now() + make_interval(days => $6::int) END
         WHERE tenant_id = $1 AND id = $2 AND status = 'PENDING'
           -- q174: a confirmation never applies an expired request (rechecked inside the transaction).
           AND ($3 <> 'APPROVED' OR expires_at IS NULL OR expires_at > now())
         RETURNING id`,
        [tenantId, id, change.status, change.by, reasonRef, change.accessDays ?? DEFAULT_READALL_DAYS],
      );
      if (!rows[0]) throw new ConflictError("This request has already been decided or has expired");
      return grantOn(db, tenantId, id);
    }, audit);
  }

  async revoke(tenantId: string, id: string, change: { by: string; reason: string }, audit: TransactionalAudit<RevokedGrant>): Promise<SensitiveViewGrant> {
    const out = await runAudited<RevokedGrant>(this.pool, async (db) => {
      const r = await revokeLocked(db, `g.id = $2`, tenantId, id, change);
      if (!r) throw new ConflictError("This widened view is already refused or revoked"); // rolls back, no audit row
      return r;
    }, audit);
    return out.after;
  }

  async closeStaleLive(tenantId: string, userId: string, kind: SensitiveViewGrantKind, change: { by: string; reason: string }, audit: TransactionalAudit<RevokedGrant>): Promise<SensitiveViewGrant | null> {
    const k = kind === "RESOURCE_READALL" ? "RESOURCE_READALL" : "ROLE_READ_SENSITIVE"; // literal of the union, never client text
    const match = `g.user_id = $2 AND g.kind = '${k}' AND ((g.status = 'PENDING' AND g.expires_at <= now())
      OR (g.status = 'APPROVED' AND g.kind = 'RESOURCE_READALL' AND g.access_expires_at <= now()))`;
    const out = await runAudited<RevokedGrant | null>(this.pool, (db) => revokeLocked(db, match, tenantId, userId, change), (r) => (r ? audit(r) : []));
    return out?.after ?? null;
  }

  async revokeLiveOf(tenantId: string, userId: string, change: { by: string; reason: string }, audit: TransactionalAudit<RevokedGrant>,
    kind: SensitiveViewGrantKind = "ROLE_READ_SENSITIVE"): Promise<SensitiveViewGrant | null> {
    // The kind is a literal of the union (never client text), inlined to keep revokeLocked's two parameters.
    const match = `g.user_id = $2 AND g.kind = '${kind === "RESOURCE_READALL" ? "RESOURCE_READALL" : "ROLE_READ_SENSITIVE"}'`;
    const out = await runAudited<RevokedGrant | null>(this.pool, (db) => revokeLocked(db, match, tenantId, userId, change),
      (r) => (r ? audit(r) : []));
    return out?.after ?? null;
  }
}

/** Codex PR #207: the live row is locked, then updated; the audit is built from those two rows, in the same transaction. */
async function revokeLocked(db: Db, match: string, tenantId: string, key: string, change: { by: string; reason: string }): Promise<RevokedGrant | null> {
  const { rows: locked } = await db.query<Row>(
    `${SELECT_GRANT} WHERE g.tenant_id = $1 AND ${match} AND g.status IN ('PENDING', 'APPROVED') FOR UPDATE OF g`, [tenantId, key]);
  if (!locked[0]) return null;
  const reasonRef = await insertVisibilityReason(db, tenantId, "SENSITIVE_VIEW_REVOCATION", change.reason);
  await db.query(
    `UPDATE sensitive_view_grants SET status = 'REVOKED', revoked_by = $3, revoked_at = now(), revoke_reason_ref = $4
     WHERE tenant_id = $1 AND id = $2`,
    [tenantId, locked[0].id, change.by, reasonRef],
  );
  return { before: toDomain(locked[0]), after: await grantOn(db, tenantId, locked[0].id) };
}
