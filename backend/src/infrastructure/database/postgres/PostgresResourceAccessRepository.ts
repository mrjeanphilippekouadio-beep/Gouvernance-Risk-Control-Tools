import type { Pool } from "pg";
import type {
  ResourceAccessRepository,
  ResourceVisibilityChange,
  ResourceVisibilityState,
  RestrictableResource,
  VisibilityChangeResult,
} from "../../../domain/repositories/ResourceAccessRepository.js";
import type { TransactionalAudit } from "../../../domain/entities/RiskFramework.js";
import type { ReadScope, Visibility } from "../../../domain/visibility.js";
import { NotFoundError, ValidationError } from "../../../domain/errors/DomainErrors.js";
import { runAudited } from "./PostgresAuditRepository.js";
import { resourceVisibleExpr, visibleToFunction } from "./visibilityFilter.js";

/** Fixed identifiers only (never user input): the root table of each type and whether it has a soft-delete column. */
const ROOT: Record<RestrictableResource, { table: string; softDeleted: boolean; entity: string }> = {
  CONTROL: { table: "controls", softDeleted: true, entity: "Control" },
  ANOMALY: { table: "anomalies", softDeleted: false, entity: "Anomaly" },
  ACTION_PLAN: { table: "action_plans", softDeleted: false, entity: "ActionPlan" },
  KPI: { table: "kpis", softDeleted: true, entity: "Kpi" },
};

type Db = Pick<Pool, "query">;

async function activeList(db: Db, tenantId: string, type: string, id: string): Promise<string[]> {
  const { rows } = await db.query<{ user_id: string }>(
    `SELECT user_id FROM resource_access_grants
     WHERE tenant_id = $1 AND resource_type = $2 AND resource_id = $3 AND revoked_at IS NULL ORDER BY granted_at`,
    [tenantId, type, id],
  );
  return rows.map((r) => r.user_id);
}

async function effectiveReaders(db: Db, tenantId: string, type: RestrictableResource | "RISK", id: string): Promise<string[]> {
  const { rows } = await db.query<{ id: string }>(
    `SELECT id FROM users WHERE tenant_id = $1 AND deleted_at IS NULL AND ${visibleToFunction(type)}($1, $2, id)`,
    [tenantId, id],
  );
  return rows.map((r) => r.id);
}

export class PostgresResourceAccessRepository implements ResourceAccessRepository {
  readonly auditsInTransaction = true;

  constructor(private readonly pool: Pool) {}

  listAccess(tenantId: string, type: RestrictableResource, id: string): Promise<string[]> {
    return activeList(this.pool, tenantId, type, id);
  }

  readers(tenantId: string, type: RestrictableResource | "RISK", id: string): Promise<string[]> {
    return effectiveReaders(this.pool, tenantId, type, id);
  }

  async hiddenIds(tenantId: string, type: RestrictableResource, ids: string[], scope: ReadScope): Promise<string[]> {
    if (scope.all || ids.length === 0) return [];
    const { rows } = await this.pool.query<{ id: string }>(
      `SELECT id FROM ${ROOT[type].table} t
       WHERE t.tenant_id = $1 AND t.id = ANY($2::uuid[]) AND NOT ${resourceVisibleExpr(type, scope, "t.tenant_id", "t.id")}`,
      [tenantId, ids],
    );
    return rows.map((r) => r.id);
  }

  async inPerimeter(tenantId: string, userId: string, departmentId: string | null, processId: string | null): Promise<boolean> {
    const { rows } = await this.pool.query<{ ok: boolean }>(
      `SELECT (visibility_in_department_group($1, $2, $3::uuid)
               OR EXISTS (SELECT 1 FROM processes p WHERE p.tenant_id = $1 AND p.id = $4 AND p.owner_user_id = $2)) AS ok`,
      [tenantId, userId, departmentId, processId],
    );
    return rows[0]?.ok === true;
  }

  async changeVisibility(
    tenantId: string,
    type: RestrictableResource,
    id: string,
    change: ResourceVisibilityChange,
    audit?: TransactionalAudit<VisibilityChangeResult>,
  ): Promise<VisibilityChangeResult> {
    const root = ROOT[type];
    return runAudited(this.pool, async (db) => {
      const locked = await db.query<{ visibility: Visibility }>(
        `SELECT visibility FROM ${root.table} WHERE tenant_id = $1 AND id = $2 ${root.softDeleted ? "AND deleted_at IS NULL" : ""} FOR UPDATE`,
        [tenantId, id],
      );
      if (!locked.rows[0]) throw new NotFoundError(root.entity, id);
      const before: ResourceVisibilityState = { visibility: locked.rows[0].visibility, accessUserIds: await activeList(db, tenantId, type, id) };
      const readersBefore = await effectiveReaders(db, tenantId, type, id);
      // Back to CLIENT revokes the list as read under the lock (a concurrent grant cannot survive).
      const revoke = change.visibility === "CLIENT" ? before.accessUserIds : change.revokeUserIds;
      for (const userId of new Set(revoke)) {
        const { rowCount } = await db.query(
          `UPDATE resource_access_grants SET revoked_at = now(), revoked_by = $5, revoke_reason = $6
           WHERE tenant_id = $1 AND resource_type = $2 AND resource_id = $3 AND user_id = $4 AND revoked_at IS NULL`,
          [tenantId, type, id, userId, change.changedBy, change.reason],
        );
        if (!rowCount) throw new ValidationError(`No active access to revoke for user ${userId}`);
      }
      for (const userId of new Set(change.addUserIds)) {
        if (before.accessUserIds.includes(userId)) continue;
        await db.query(
          `INSERT INTO resource_access_grants (tenant_id, resource_type, resource_id, user_id, granted_by, grant_reason)
           VALUES ($1, $2, $3, $4, $5, $6)`,
          [tenantId, type, id, userId, change.changedBy, change.reason],
        );
      }
      await db.query(
        `UPDATE ${root.table} SET visibility = $3, updated_at = now() WHERE tenant_id = $1 AND id = $2`,
        [tenantId, id, change.visibility],
      );
      const readersAfter = await effectiveReaders(db, tenantId, type, id);
      const widening = readersAfter.some((u) => !readersBefore.includes(u));
      return { before, after: { visibility: change.visibility, accessUserIds: await activeList(db, tenantId, type, id) }, widening };
    }, audit);
  }
}
