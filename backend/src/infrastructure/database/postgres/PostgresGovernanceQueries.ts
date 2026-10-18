import type { Pool } from "pg";
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
export class PostgresGovernanceQueries implements EligibleValidatorQuery, GovernanceThirdPartyQuery, GovernanceExceptionLookup {
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

  /** One query on the partial index (tenant_id, entity_type, entity_id) WHERE governance_exception IS NOT NULL. */
  async forEntities(tenantId: string, entityType: string, ids: string[]): Promise<Map<string, ValidationIndependence>> {
    const result = new Map<string, ValidationIndependence>();
    if (ids.length === 0) return result;
    const { rows } = await this.pool.query<{ entity_id: string }>(
      `SELECT DISTINCT entity_id::text AS entity_id FROM audit_log
       WHERE tenant_id = $1 AND entity_type = $2 AND entity_id = ANY($3::uuid[]) AND governance_exception IS NOT NULL`,
      [tenantId, entityType, ids],
    );
    const marked = new Set(rows.map((r) => r.entity_id));
    for (const id of ids) result.set(id, marked.has(id) ? "WITHOUT_INDEPENDENT_REVIEW" : "INDEPENDENT");
    return result;
  }
}
