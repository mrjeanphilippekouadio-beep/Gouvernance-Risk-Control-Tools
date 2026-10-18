import type { Pool, PoolClient } from "pg";
import { insertAuditEvent } from "./PostgresAuditRepository.js";
import type { OrganizationProfile, OrganizationProfileRegime, OrganizationProfileStatus } from "../../../domain/entities/OrganizationProfile.js";
import type { TransactionalAudit } from "../../../domain/entities/RiskFramework.js";
import type { ObservedOrganization } from "../../../domain/governance/classifyOrganization.js";
import type { OrganizationAnswers } from "../../../domain/governance/organizationQuestionnaire.js";
import type {
  InsertOrganizationProfileInput,
  OrganizationProfileChange,
  OrganizationProfileRepository,
} from "../../../domain/repositories/OrganizationProfileRepository.js";
import { ConflictError, NotFoundError } from "../../../domain/errors/DomainErrors.js";

interface Row {
  id: string;
  tenant_id: string;
  version: number;
  questionnaire_version: string;
  answers: OrganizationAnswers;
  reason: string;
  status: OrganizationProfileStatus;
  regime: OrganizationProfileRegime | null;
  submitted_by: string;
  submitted_at: Date;
  decided_by: string | null;
  decided_at: Date | null;
  decision_reason: string | null;
}

function toDomain(r: Row): OrganizationProfile {
  return {
    id: r.id,
    tenantId: r.tenant_id,
    version: r.version,
    questionnaireVersion: r.questionnaire_version,
    answers: r.answers,
    reason: r.reason,
    status: r.status,
    regime: r.regime,
    submittedBy: r.submitted_by,
    submittedAt: r.submitted_at,
    decidedBy: r.decided_by,
    decidedAt: r.decided_at,
    decisionReason: r.decision_reason,
  };
}

const isUniqueViolation = (err: unknown): boolean =>
  typeof err === "object" && err !== null && (err as { code?: unknown }).code === "23505";

/** Active members of the three fixed groups; a person counted once per group. */
const GROUP_MEMBERS_SQL = `
  SELECT ur.user_id, r.system_group
  FROM user_roles ur
  JOIN roles r ON r.id = ur.role_id AND r.tenant_id = ur.tenant_id AND r.deleted_at IS NULL AND r.system_group IS NOT NULL
  JOIN users u ON u.id = ur.user_id AND u.tenant_id = ur.tenant_id AND u.deleted_at IS NULL
  WHERE ur.tenant_id = $1 AND ur.revoked_at IS NULL`;

export class PostgresOrganizationProfileRepository implements OrganizationProfileRepository {
  constructor(private readonly pool: Pool) {}

  async list(tenantId: string, limit: number): Promise<OrganizationProfile[]> {
    const { rows } = await this.pool.query<Row>(
      `SELECT * FROM organization_profiles WHERE tenant_id = $1 ORDER BY version DESC LIMIT $2`,
      [tenantId, limit],
    );
    return rows.map(toDomain);
  }

  private async getByStatus(tenantId: string, status: OrganizationProfileStatus): Promise<OrganizationProfile | null> {
    const { rows } = await this.pool.query<Row>(
      `SELECT * FROM organization_profiles WHERE tenant_id = $1 AND status = $2`,
      [tenantId, status],
    );
    return rows[0] ? toDomain(rows[0]) : null;
  }

  getActive(tenantId: string): Promise<OrganizationProfile | null> {
    return this.getByStatus(tenantId, "ACTIVE");
  }

  getPending(tenantId: string): Promise<OrganizationProfile | null> {
    return this.getByStatus(tenantId, "PENDING");
  }

  async getById(tenantId: string, id: string): Promise<OrganizationProfile | null> {
    const { rows } = await this.pool.query<Row>(`SELECT * FROM organization_profiles WHERE tenant_id = $1 AND id = $2`, [tenantId, id]);
    return rows[0] ? toDomain(rows[0]) : null;
  }

  async observe(tenantId: string): Promise<ObservedOrganization> {
    const accounts = await this.pool.query<{ n: string }>(
      `SELECT count(*) AS n FROM users WHERE tenant_id = $1 AND deleted_at IS NULL`,
      [tenantId],
    );
    const groups = await this.pool.query<{ system_group: string; n: string }>(
      `SELECT system_group, count(DISTINCT user_id) AS n FROM (${GROUP_MEMBERS_SQL}) m GROUP BY system_group`,
      [tenantId],
    );
    const count = (g: string): number => Number(groups.rows.find((r) => r.system_group === g)?.n ?? 0);
    return {
      activeAccounts: Number(accounts.rows[0]?.n ?? 0),
      riskManagers: count("RISK_MANAGER"),
      committeeMembers: count("RISK_COMMITTEE"),
      auditMembers: count("AUDIT"),
    };
  }

  async countOtherGovernanceMembers(tenantId: string, excludeUserId: string): Promise<number> {
    const { rows } = await this.pool.query<{ n: string }>(
      `SELECT count(DISTINCT user_id) AS n FROM (${GROUP_MEMBERS_SQL}) m WHERE user_id <> $2`,
      [tenantId, excludeUserId],
    );
    return Number(rows[0]?.n ?? 0);
  }

  /** Serialises the writers of one tenant's profile (version number, single ACTIVE / PENDING row). */
  private async lockTenant(client: PoolClient, tenantId: string): Promise<void> {
    await client.query(`SELECT pg_advisory_xact_lock(hashtextextended('organization_profiles:' || $1::text, 0))`, [tenantId]);
  }

  private async supersedeActive(client: PoolClient, tenantId: string): Promise<OrganizationProfile | null> {
    const { rows } = await client.query<Row>(
      `UPDATE organization_profiles SET status = 'SUPERSEDED' WHERE tenant_id = $1 AND status = 'ACTIVE' RETURNING *`,
      [tenantId],
    );
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

  async insertVersion(
    input: InsertOrganizationProfileInput,
    audit: TransactionalAudit<OrganizationProfileChange>,
  ): Promise<OrganizationProfileChange> {
    try {
      return await this.inTransaction(async (client) => {
        await this.lockTenant(client, input.tenantId);
        const superseded = input.status === "ACTIVE" ? await this.supersedeActive(client, input.tenantId) : null;
        if (input.status === "ACTIVE" && input.expectedActiveId !== undefined && (superseded?.id ?? null) !== input.expectedActiveId) {
          throw new ConflictError("The active profile changed while this version was prepared — reload and retry");
        }
        const { rows } = await client.query<Row>(
          `INSERT INTO organization_profiles
             (tenant_id, version, questionnaire_version, answers, reason, status, regime, submitted_by)
           VALUES ($1, (SELECT COALESCE(MAX(version), 0) + 1 FROM organization_profiles WHERE tenant_id = $1), $2, $3, $4, $5, $6, $7)
           RETURNING *`,
          [input.tenantId, input.questionnaireVersion, JSON.stringify(input.answers), input.reason, input.status, input.regime, input.submittedBy],
        );
        const row = rows[0];
        if (!row) throw new Error("Insert into organization_profiles returned no row");
        const out = { profile: toDomain(row), superseded };
        for (const event of audit(out)) await insertAuditEvent(client, event);
        return out;
      });
    } catch (err) {
      if (isUniqueViolation(err)) throw new ConflictError("A profile version is already pending or was just submitted — reload and retry");
      throw err;
    }
  }

  async approve(
    tenantId: string,
    id: string,
    decidedBy: string,
    audit: TransactionalAudit<OrganizationProfileChange>,
  ): Promise<OrganizationProfileChange> {
    return this.inTransaction(async (client) => {
      await this.lockTenant(client, tenantId);
      const superseded = await this.supersedeActive(client, tenantId);
      const { rows } = await client.query<Row>(
        `UPDATE organization_profiles
         SET status = 'ACTIVE', regime = 'CONFIRMED', decided_by = $3, decided_at = now()
         WHERE tenant_id = $1 AND id = $2 AND status = 'PENDING'
         RETURNING *`,
        [tenantId, id, decidedBy],
      );
      const row = rows[0];
      if (!row) throw new NotFoundError("OrganizationProfile", id);
      const out = { profile: toDomain(row), superseded };
      for (const event of audit(out)) await insertAuditEvent(client, event);
      return out;
    });
  }

  async reject(
    tenantId: string,
    id: string,
    decidedBy: string,
    reason: string,
    audit: TransactionalAudit<OrganizationProfile>,
  ): Promise<OrganizationProfile> {
    return this.inTransaction(async (client) => {
      const { rows } = await client.query<Row>(
        `UPDATE organization_profiles
         SET status = 'REJECTED', decided_by = $3, decided_at = now(), decision_reason = $4
         WHERE tenant_id = $1 AND id = $2 AND status = 'PENDING'
         RETURNING *`,
        [tenantId, id, decidedBy, reason],
      );
      const row = rows[0];
      if (!row) throw new NotFoundError("OrganizationProfile", id);
      const profile = toDomain(row);
      for (const event of audit(profile)) await insertAuditEvent(client, event);
      return profile;
    });
  }
}
