import type { Pool, PoolClient } from "pg";
import { insertAuditEvent } from "./PostgresAuditRepository.js";
import type {
  AcceptanceRegime,
  AcceptanceStatus,
  GovernancePrincipleAcceptance,
} from "../../../domain/entities/GovernanceReviews.js";
import type { TransactionalAudit } from "../../../domain/entities/RiskFramework.js";
import type {
  AcceptanceCreated,
  GovernancePrincipleAcceptanceRepository,
  InsertAcceptanceInput,
} from "../../../domain/repositories/GovernanceReviewRepositories.js";
import { ConflictError } from "../../../domain/errors/DomainErrors.js";

interface Row {
  id: string;
  tenant_id: string;
  principle_id: string;
  catalog_version: string;
  offenders_snapshot: unknown[];
  reason: string;
  expires_at: Date;
  status: AcceptanceStatus;
  regime: AcceptanceRegime | null;
  accepted_by: string;
  accepted_at: Date;
  confirmed_by: string | null;
  confirmed_at: Date | null;
  ended_by: string | null;
  ended_at: Date | null;
  end_reason: string | null;
}

const toDomain = (r: Row): GovernancePrincipleAcceptance => ({
  id: r.id,
  tenantId: r.tenant_id,
  principleId: r.principle_id,
  catalogVersion: r.catalog_version,
  offendersSnapshot: r.offenders_snapshot,
  reason: r.reason,
  expiresAt: r.expires_at,
  status: r.status,
  regime: r.regime,
  acceptedBy: r.accepted_by,
  acceptedAt: r.accepted_at,
  confirmedBy: r.confirmed_by,
  confirmedAt: r.confirmed_at,
  endedBy: r.ended_by,
  endedAt: r.ended_at,
  endReason: r.end_reason,
});

const pgCode = (err: unknown): unknown => (typeof err === "object" && err !== null ? (err as { code?: unknown }).code : undefined);

export class PostgresGovernancePrincipleAcceptanceRepository implements GovernancePrincipleAcceptanceRepository {
  constructor(private readonly pool: Pool) {}

  async list(tenantId: string, limit: number): Promise<GovernancePrincipleAcceptance[]> {
    const { rows } = await this.pool.query<Row>(
      `SELECT * FROM governance_principle_acceptances WHERE tenant_id = $1 ORDER BY accepted_at DESC LIMIT $2`,
      [tenantId, limit],
    );
    return rows.map(toDomain);
  }

  async latestAloneReview(tenantId: string, principleId: string): Promise<{ acceptanceId: string; reviewed: boolean; open: boolean } | null> {
    const { rows } = await this.pool.query<{ id: string; reviewed: boolean; open: boolean }>(
      `SELECT a.id, (a.status IN ('PENDING', 'ACTIVE') AND a.expires_at > now()) AS open,
              EXISTS (SELECT 1 FROM audit_log l
                      JOIN governance_exception_reviews r ON r.tenant_id = l.tenant_id AND r.audit_log_id = l.id AND r.outcome = 'REVIEWED'
                      WHERE l.tenant_id = a.tenant_id AND l.entity_type = 'GovernancePrincipleAcceptance' AND l.entity_id = a.id
                        AND l.governance_exception IS NOT NULL) AS reviewed
       FROM governance_principle_acceptances a
       WHERE a.tenant_id = $1 AND a.principle_id = $2 AND a.regime = 'ALONE'
       ORDER BY a.accepted_at DESC LIMIT 1`,
      [tenantId, principleId],
    );
    return rows[0] ? { acceptanceId: rows[0].id, reviewed: rows[0].reviewed, open: rows[0].open } : null;
  }

  async getById(tenantId: string, id: string): Promise<GovernancePrincipleAcceptance | null> {
    const { rows } = await this.pool.query<Row>(`SELECT * FROM governance_principle_acceptances WHERE tenant_id = $1 AND id = $2`, [tenantId, id]);
    return rows[0] ? toDomain(rows[0]) : null;
  }

  private async inTransaction<T>(work: (client: PoolClient) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const out = await work(client);
      await client.query("COMMIT");
      return out;
    } catch (err) {
      await client.query("ROLLBACK").catch(() => undefined);
      throw err;
    } finally {
      client.release();
    }
  }

  async create(input: InsertAcceptanceInput, audit: TransactionalAudit<AcceptanceCreated>): Promise<AcceptanceCreated> {
    try {
      return await this.inTransaction(async (client) => {
        await client.query(`SELECT pg_advisory_xact_lock(hashtextextended('principle_acceptance:' || $1::text || ':' || $2::text, 0))`, [
          input.tenantId,
          input.principleId,
        ]);
        // An expired open acceptance no longer counts (expiry is not a stored state): close it so the principle can be accepted again.
        const closed = await client.query<Row>(
          `UPDATE governance_principle_acceptances
           SET status = 'REVOKED', ended_by = $3, ended_at = now(), end_reason = 'Expired; replaced by a new acceptance'
           WHERE tenant_id = $1 AND principle_id = $2 AND status IN ('PENDING', 'ACTIVE') AND expires_at <= now()
           RETURNING *`,
          [input.tenantId, input.principleId, input.acceptedBy],
        );
        const { rows } = await client.query<Row>(
          `INSERT INTO governance_principle_acceptances
             (tenant_id, principle_id, catalog_version, offenders_snapshot, reason, expires_at, status, regime, accepted_by)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING *`,
          [
            input.tenantId,
            input.principleId,
            input.catalogVersion,
            JSON.stringify(input.offendersSnapshot),
            input.reason,
            input.expiresAt,
            input.status,
            input.regime,
            input.acceptedBy,
          ],
        );
        const row = rows[0];
        if (!row) throw new Error("Insert into governance_principle_acceptances returned no row");
        const out: AcceptanceCreated = { acceptance: toDomain(row), expiredClosed: closed.rows[0] ? toDomain(closed.rows[0]) : null };
        for (const event of audit(out)) await insertAuditEvent(client, event);
        return out;
      });
    } catch (err) {
      if (pgCode(err) === "23505") throw new ConflictError("This principle already has an acceptance in force or waiting for its confirmation");
      throw err;
    }
  }

  confirm(
    tenantId: string,
    id: string,
    confirmedBy: string,
    audit: TransactionalAudit<GovernancePrincipleAcceptance>,
  ): Promise<GovernancePrincipleAcceptance> {
    return this.transition(
      `UPDATE governance_principle_acceptances
       SET status = 'ACTIVE', regime = 'CONFIRMED', confirmed_by = $3, confirmed_at = now()
       WHERE tenant_id = $1 AND id = $2 AND status = 'PENDING' AND expires_at > now()
       RETURNING *`,
      [tenantId, id, confirmedBy],
      audit,
    );
  }

  end(
    tenantId: string,
    id: string,
    to: "REJECTED" | "REVOKED",
    endedBy: string,
    reason: string,
    audit: TransactionalAudit<GovernancePrincipleAcceptance>,
  ): Promise<GovernancePrincipleAcceptance> {
    const from = to === "REJECTED" ? ["PENDING"] : ["PENDING", "ACTIVE"];
    return this.transition(
      `UPDATE governance_principle_acceptances
       SET status = $3, ended_by = $4, ended_at = now(), end_reason = $5
       WHERE tenant_id = $1 AND id = $2 AND status = ANY($6::text[])
       RETURNING *`,
      [tenantId, id, to, endedBy, reason, from],
      audit,
    );
  }

  private async transition(
    sql: string,
    params: unknown[],
    audit: TransactionalAudit<GovernancePrincipleAcceptance>,
  ): Promise<GovernancePrincipleAcceptance> {
    return this.inTransaction(async (client) => {
      const { rows } = await client.query<Row>(sql, params);
      const row = rows[0];
      if (!row) throw new ConflictError("This acceptance has already been decided or has expired");
      const acceptance = toDomain(row);
      for (const event of audit(acceptance)) await insertAuditEvent(client, event);
      return acceptance;
    });
  }
}
