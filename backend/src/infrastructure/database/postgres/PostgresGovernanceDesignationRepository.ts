import type { Pool } from "pg";
import type { GovernanceDesignationRepository } from "../../../domain/repositories/GovernanceDesignationRepository.js";
import type { CreateDesignationInput, DesignationKind, GovernanceDesignation } from "../../../domain/entities/GovernanceDesignation.js";
import type { TransactionalAudit } from "../../../domain/entities/RiskFramework.js";
import { ConflictError } from "../../../domain/errors/DomainErrors.js";
import { runAudited } from "./PostgresAuditRepository.js";

interface DesignationRow {
  id: string;
  tenant_id: string;
  kind: DesignationKind;
  user_id: string;
  reason: string;
  valid_until: Date | null;
  activated_at: Date | null;
  activated_ref: string | null;
  designated_by: string;
  created_at: Date;
  ended_at: Date | null;
  ended_by: string | null;
  end_reason: string | null;
}

function toDomain(row: DesignationRow): GovernanceDesignation {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    kind: row.kind,
    userId: row.user_id,
    reason: row.reason,
    validUntil: row.valid_until,
    activatedAt: row.activated_at,
    activatedRef: row.activated_ref,
    designatedBy: row.designated_by,
    createdAt: row.created_at,
    endedAt: row.ended_at,
    endedBy: row.ended_by,
    endReason: row.end_reason,
  };
}

export class PostgresGovernanceDesignationRepository implements GovernanceDesignationRepository {
  /** DECISION-079: `create` and `end` insert their audit events with the transaction client. */
  readonly auditsInTransaction = true;

  constructor(private readonly pool: Pool) {}

  async getById(tenantId: string, id: string): Promise<GovernanceDesignation | null> {
    const { rows } = await this.pool.query<DesignationRow>(
      `SELECT * FROM governance_designations WHERE tenant_id = $1 AND id = $2`,
      [tenantId, id],
    );
    return rows[0] ? toDomain(rows[0]) : null;
  }

  async getActive(tenantId: string, kind: DesignationKind): Promise<GovernanceDesignation | null> {
    const { rows } = await this.pool.query<DesignationRow>(
      `SELECT * FROM governance_designations WHERE tenant_id = $1 AND kind = $2 AND ended_at IS NULL`,
      [tenantId, kind],
    );
    return rows[0] ? toDomain(rows[0]) : null;
  }

  async list(tenantId: string, options?: { includeEnded?: boolean }): Promise<GovernanceDesignation[]> {
    const { rows } = await this.pool.query<DesignationRow>(
      `SELECT * FROM governance_designations
       WHERE tenant_id = $1 AND ($2::boolean OR ended_at IS NULL)
       ORDER BY created_at DESC LIMIT 200`,
      [tenantId, options?.includeEnded === true],
    );
    return rows.map(toDomain);
  }

  async create(input: CreateDesignationInput, audit?: TransactionalAudit<GovernanceDesignation>): Promise<GovernanceDesignation> {
    try {
      return await runAudited(
        this.pool,
        async (db) => {
          const { rows } = await db.query<DesignationRow>(
            `INSERT INTO governance_designations (tenant_id, kind, user_id, reason, valid_until, designated_by)
             VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
            [input.tenantId, input.kind, input.userId, input.reason, input.validUntil, input.designatedBy],
          );
          const row = rows[0];
          if (!row) throw new Error("Insert into governance_designations returned no row");
          return toDomain(row);
        },
        audit,
      );
    } catch (err) {
      if (typeof err === "object" && err !== null && (err as { code?: unknown }).code === "23505"
          && (err as { constraint?: unknown }).constraint === "governance_designations_active_kind_idx") {
        throw new ConflictError("A designation of this kind is already active; end it first", input.kind);
      }
      throw err;
    }
  }

  async end(
    tenantId: string,
    id: string,
    endedBy: string,
    endReason: string,
    audit?: TransactionalAudit<GovernanceDesignation>,
  ): Promise<GovernanceDesignation | null> {
    // Nothing ended -> nothing to audit (the null result skips the builder).
    return runAudited<GovernanceDesignation | null>(
      this.pool,
      async (db) => {
        const { rows } = await db.query<DesignationRow>(
          `UPDATE governance_designations SET ended_at = now(), ended_by = $3, end_reason = $4
           WHERE tenant_id = $1 AND id = $2 AND ended_at IS NULL RETURNING *`,
          [tenantId, id, endedBy, endReason],
        );
        return rows[0] ? toDomain(rows[0]) : null;
      },
      audit && ((ended) => (ended ? audit(ended) : [])),
    );
  }
}
