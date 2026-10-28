import type { Pool } from "pg";
import type { GovernanceAuditRow, GovernanceEventSource } from "../../../domain/governance/governanceEvents.js";
import type {
  EligibleValidatorQuery,
  GovernanceExceptionLookup,
  GovernanceThirdPartyQuery,
  ValidationIndependence,
} from "../../../domain/governance/selfValidation.js";

/**
 * DECISION-074 D4 — read-only queries behind the self-validation rule. Every query filters by tenant_id.
 * "Active" = account not suspended (`users.deleted_at IS NULL`), assignment not revoked, role not deleted
 * (same definition as B-8 and the 062 trigger); a dormant account still counts (I-R4: capacity, not presence).
 */
export class PostgresGovernanceQueries
  implements EligibleValidatorQuery, GovernanceThirdPartyQuery, GovernanceExceptionLookup, GovernanceEventSource {
  constructor(private readonly pool: Pool) {}

  async existsOther(tenantId: string, actorId: string, permission: string, excludeUserIds: string[] = []): Promise<boolean> {
    const { rows } = await this.pool.query(
      `SELECT 1 FROM users u
       WHERE u.tenant_id = $1 AND u.deleted_at IS NULL AND u.id <> $2 AND NOT (u.id = ANY($4::uuid[]))
         AND ($3 = ANY(u.roles)
              OR EXISTS (SELECT 1 FROM user_roles ur
                         JOIN roles r ON r.id = ur.role_id AND r.tenant_id = ur.tenant_id AND r.deleted_at IS NULL
                         WHERE ur.tenant_id = u.tenant_id AND ur.user_id = u.id AND ur.revoked_at IS NULL
                           AND $3 = ANY(r.permissions)))
       LIMIT 1`,
      [tenantId, actorId, permission, excludeUserIds],
    );
    return rows.length > 0;
  }

  async existsGovernanceThirdParty(tenantId: string, actorId: string): Promise<boolean> {
    const { rows } = await this.pool.query(
      `SELECT 1 FROM user_roles ur
       JOIN roles r ON r.id = ur.role_id AND r.tenant_id = ur.tenant_id AND r.deleted_at IS NULL
                   AND r.system_group IN ('RISK_MANAGER', 'RISK_COMMITTEE', 'AUDIT')
       JOIN users u ON u.id = ur.user_id AND u.tenant_id = ur.tenant_id AND u.deleted_at IS NULL
       WHERE ur.tenant_id = $1 AND ur.revoked_at IS NULL AND ur.user_id <> $2
       LIMIT 1`,
      [tenantId, actorId],
    );
    return rows.length > 0;
  }

  /**
   * One query on the partial index (tenant_id, entity_type, entity_id) WHERE governance_exception IS NOT NULL, joined to
   * the third-party reviews (D5): a REVIEWED review on a marked entry makes the object REVIEWED_BY_THIRD_PARTY.
   * A CONTESTED review is an objection, not a review: it changes nothing here.
   */
  async forEntities(tenantId: string, entityType: string, ids: string[]): Promise<Map<string, ValidationIndependence>> {
    const result = new Map<string, ValidationIndependence>();
    if (ids.length === 0) return result;
    const { rows } = await this.pool.query<{ entity_id: string; reviewed: boolean }>(
      `SELECT a.entity_id::text AS entity_id, bool_or(r.id IS NOT NULL) AS reviewed
       FROM audit_log a
       LEFT JOIN governance_exception_reviews r
         ON r.tenant_id = a.tenant_id AND r.audit_log_id = a.id AND r.outcome = 'REVIEWED'
       WHERE a.tenant_id = $1 AND a.entity_type = $2 AND a.entity_id = ANY($3::uuid[]) AND a.governance_exception IS NOT NULL
       GROUP BY a.entity_id`,
      [tenantId, entityType, ids],
    );
    const marked = new Map(rows.map((r) => [r.entity_id, r.reviewed]));
    for (const id of ids) {
      const reviewed = marked.get(id);
      result.set(id, reviewed === undefined ? "INDEPENDENT" : reviewed ? "REVIEWED_BY_THIRD_PARTY" : "WITHOUT_INDEPENDENT_REVIEW");
    }
    return result;
  }

  // -- GovernanceEventSource (lot D5): read after commit by GovernanceNotifier ----------------------------------

  async rowsForRequest(tenantId: string, requestId: string, actorId: string): Promise<GovernanceAuditRow[]> {
    const { rows } = await this.pool.query<{
      id: string; user_id: string; entity_type: string; entity_id: string; action: string;
      governance_exception: string | null; old_value: unknown; new_value: unknown; system_group: string | null;
    }>(
      `SELECT a.id, a.user_id, a.entity_type, a.entity_id, a.action, a.governance_exception, a.old_value, a.new_value, r.system_group
       FROM audit_log a
       LEFT JOIN roles r ON a.entity_type = 'Role' AND r.id = a.entity_id AND r.tenant_id = a.tenant_id
       WHERE a.tenant_id = $1 AND a.request_id = $2 AND a.user_id = $3 AND a."timestamp" > now() - interval '10 minutes'
         AND (a.governance_exception IS NOT NULL
              OR a.entity_type IN ('Role', 'OrganizationProfile', 'SelfValidationPolicyRequest', 'GovernancePrincipleAcceptance', 'GovernanceExceptionReview', 'GovernanceDelayRequest'))
       ORDER BY a."timestamp", a.id`,
      [tenantId, requestId, actorId],
    );
    return rows.map((r) => ({
      id: r.id,
      userId: r.user_id,
      entityType: r.entity_type,
      entityId: r.entity_id,
      action: r.action,
      governanceException: r.governance_exception,
      oldValue: r.old_value,
      newValue: r.new_value,
      systemGroup: r.system_group,
    }));
  }

  async holdersOf(tenantId: string, permission: string): Promise<string[]> {
    const { rows } = await this.pool.query<{ id: string }>(
      `SELECT u.id FROM users u
       WHERE u.tenant_id = $1 AND u.deleted_at IS NULL
         AND ($2 = ANY(u.roles)
              OR EXISTS (SELECT 1 FROM user_roles ur
                         JOIN roles r ON r.id = ur.role_id AND r.tenant_id = ur.tenant_id AND r.deleted_at IS NULL
                         WHERE ur.tenant_id = u.tenant_id AND ur.user_id = u.id AND ur.revoked_at IS NULL
                           AND $2 = ANY(r.permissions)))`,
      [tenantId, permission],
    );
    return rows.map((r) => r.id);
  }

  async groupMembers(tenantId: string, groups: string[]): Promise<string[]> {
    const { rows } = await this.pool.query<{ user_id: string }>(
      `SELECT DISTINCT ur.user_id FROM user_roles ur
       JOIN roles r ON r.id = ur.role_id AND r.tenant_id = ur.tenant_id AND r.deleted_at IS NULL AND r.system_group = ANY($2::text[])
       JOIN users u ON u.id = ur.user_id AND u.tenant_id = ur.tenant_id AND u.deleted_at IS NULL
       WHERE ur.tenant_id = $1 AND ur.revoked_at IS NULL`,
      [tenantId, groups],
    );
    return rows.map((r) => r.user_id);
  }

  async managerId(tenantId: string): Promise<string | null> {
    const { rows } = await this.pool.query<{ user_id: string }>(
      `SELECT d.user_id FROM governance_designations d
       JOIN users u ON u.id = d.user_id AND u.tenant_id = d.tenant_id AND u.deleted_at IS NULL
       WHERE d.tenant_id = $1 AND d.kind = 'MANAGER' AND d.ended_at IS NULL`,
      [tenantId],
    );
    return rows[0]?.user_id ?? null;
  }

  async unreviewedExceptionCount(tenantId: string): Promise<number> {
    const { rows } = await this.pool.query<{ n: string }>(
      `SELECT count(*) AS n FROM audit_log a
       WHERE a.tenant_id = $1 AND a.governance_exception IS NOT NULL AND a.governance_exception <> 'riskManager.vacancy'
         AND NOT EXISTS (SELECT 1 FROM governance_exception_reviews r
                         WHERE r.tenant_id = a.tenant_id AND r.audit_log_id = a.id AND r.outcome = 'REVIEWED')`,
      [tenantId],
    );
    return Number(rows[0]?.n ?? 0);
  }

  /** q178 (DECISION-095): start of the current Risk Manager vacancy (last vacancy trace while the group has no active member). */
  async riskManagerVacancySince(tenantId: string): Promise<Date | null> {
    const { rows } = await this.pool.query<{ since: Date | null }>(
      `SELECT max(a."timestamp") AS since FROM audit_log a
       WHERE a.tenant_id = $1 AND a.governance_exception = 'riskManager.vacancy'
         AND NOT EXISTS (SELECT 1 FROM user_roles ur
                         JOIN roles r ON r.id = ur.role_id AND r.tenant_id = ur.tenant_id AND r.deleted_at IS NULL AND r.system_group = 'RISK_MANAGER'
                         JOIN users u ON u.id = ur.user_id AND u.tenant_id = ur.tenant_id AND u.deleted_at IS NULL
                         WHERE ur.tenant_id = $1 AND ur.revoked_at IS NULL)`,
      [tenantId],
    );
    return rows[0]?.since ?? null;
  }
}
