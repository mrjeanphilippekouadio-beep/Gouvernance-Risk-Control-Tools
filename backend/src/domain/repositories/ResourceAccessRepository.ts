import type { TransactionalAudit } from "../entities/RiskFramework.js";
import type { ReadScope, Visibility } from "../visibility.js";

/** Lot V2 (DECISION-100/102): the roots restrictable besides risks (risks keep their own repository methods, lot V1). */
export type RestrictableResource = "CONTROL" | "ANOMALY" | "ACTION_PLAN" | "KPI";

export interface ResourceVisibilityState {
  visibility: Visibility;
  accessUserIds: string[];
  /** Names of the named people, for the resource's readers only (q205). Filled by the service. */
  accessUsers?: Array<{ id: string; displayName: string | null }>;
}

export interface ResourceVisibilityChange {
  visibility: Visibility;
  addUserIds: string[];
  revokeUserIds: string[];
  reason: string;
  /** Forced to `actor.userId` by the service, never a client field. */
  changedBy: string;
}

export type VisibilityChangeResult = { before: ResourceVisibilityState; after: ResourceVisibilityState; widening: boolean };

/**
 * Lot V2: level and named-people list (`resource_access_grants`) of a control, anomaly, action plan or KPI, and the
 * effective readers computed by the SQL `<root>_visible_to` functions (migration 083). Grants are revoked with
 * `revoked_at`, never deleted.
 */
export interface ResourceAccessRepository {
  /** DECISION-079: `changeVisibility` writes its audit rows in its own transaction. */
  readonly auditsInTransaction?: boolean;
  listAccess(tenantId: string, type: RestrictableResource, id: string): Promise<string[]>;
  /** Level and list changed under a row lock; `widening` = someone reads it after who did not before (effective sets). */
  changeVisibility(
    tenantId: string,
    type: RestrictableResource,
    id: string,
    change: ResourceVisibilityChange,
    audit?: TransactionalAudit<VisibilityChangeResult>,
  ): Promise<VisibilityChangeResult>;
  /** Active accounts of the tenant that read the resource now (SQL `<root>_visible_to`). */
  readers(tenantId: string, type: RestrictableResource | "RISK", id: string): Promise<string[]>;
  /** Among `ids`, those the scope may NOT read (any status). */
  hiddenIds(tenantId: string, type: RestrictableResource, ids: string[], scope: ReadScope): Promise<string[]>;
  /** Whether `userId` belongs to the department's group or owns the process (the perimeter known at creation). */
  inPerimeter(tenantId: string, userId: string, departmentId: string | null, processId: string | null): Promise<boolean>;
}
