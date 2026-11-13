import type { TransactionalAudit } from "../entities/RiskFramework.js";
import type { ReadScope, Visibility } from "../visibility.js";

/** Lot V2 (DECISION-100/102): the roots restrictable besides risks (risks keep their own repository methods, lot V1). */
export type RestrictableResource = "CONTROL" | "ANOMALY" | "ACTION_PLAN" | "KPI";

export interface ResourceVisibilityState {
  visibility: Visibility;
  accessUserIds: string[];
  /** Names of the named people, for the resource's readers only (q205). Filled by the service. */
  accessUsers?: Array<{ id: string; displayName: string | null; /** Lot V5 (q225): ISO expiry of a named-people access; null = none. */ expiresAt?: string | null }>;
}

/** Lot V5 (q225): the expiry of one live access (null = no expiry: a PERIMETRE list). */
export interface AccessExpiry { userId: string; expiresAt: Date | null }
export type AccessRenewalResult = { visibility: Visibility; before: AccessExpiry[]; after: AccessExpiry[]; widening: boolean };

export interface ResourceVisibilityChange {
  visibility: Visibility;
  addUserIds: string[];
  revokeUserIds: string[];
  reason: string;
  /** Forced to `actor.userId` by the service, never a client field. */
  changedBy: string;
}

export interface RestrictedResourceRow {
  type: RestrictableResource | "RISK";
  id: string;
  label: string;
  visibility: Visibility;
  accessCount: number;
  updatedAt: Date;
  /** R-1 (CMP V2bis): the last visibility change of the resource (author, date, reason, widening), when there is one. */
  lastChange: { userId?: string; byName?: string | null; at: Date; reason: string | null; widening: boolean | null } | null;
}

/** V3 (q196, q198): per root type, how many PERIMETRE resources the reader cannot see (NOMINATIF never counted). */
export type HiddenCounts = Record<RestrictableResource | "RISK", number>;

export interface PerimeterChange { departmentId?: string | null; processId?: string | null }
export type PerimeterChangeResult = {
  before: { departmentId: string | null; processId: string | null };
  after: { departmentId: string | null; processId: string | null };
  widening: boolean;
};

/** `reasonId`: the stored reason (visibility_reasons) the grant rows and the audit row both reference (096); absent on test fakes. */
export type VisibilityChangeResult = { before: ResourceVisibilityState; after: ResourceVisibilityState; widening: boolean; reasonId?: string };

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
  /**
   * Lot V5 (q225 A): renews the named-people access of `userIds` on a NOMINATIF, not closed dossier — new expiry = now() +
   * 30 days, never more — under a row lock, audit rows in the same transaction. `widening` = someone read nothing before.
   */
  renewAccess(
    tenantId: string,
    type: RestrictableResource,
    id: string,
    userIds: string[],
    audit?: TransactionalAudit<AccessRenewalResult>,
  ): Promise<AccessRenewalResult>;
  /** Lot V5: expiry of each live access of the resource. Optional for the test fakes built before V5. */
  accessExpiries?(tenantId: string, type: RestrictableResource, id: string): Promise<AccessExpiry[]>;
  /**
   * SEC V2-04 / CMP-V2-01: department and/or process of a restricted control or KPI changed under a row lock, with the
   * effective readers measured before and after and the audit rows in the same transaction.
   */
  changePerimeter(
    tenantId: string,
    type: "CONTROL" | "KPI",
    id: string,
    change: PerimeterChange,
    audit?: TransactionalAudit<PerimeterChangeResult>,
  ): Promise<PerimeterChangeResult>;
  /** q207: whether `userId` reads the resource now (SQL `<root>_visible_to`). */
  canRead(tenantId: string, type: RestrictableResource | "RISK", id: string, userId: string): Promise<boolean>;
  /** q207: the PERIMETRE risks, controls and KPIs of a process that `userId` does not read yet (what owning it would open). */
  processOwnerGains(tenantId: string, processId: string, userId: string): Promise<Array<{ type: string; id: string }>>;
  /**
   * q212 (DECISION-109): the PERIMETRE risks, controls, KPIs and own-level action plans of a department that `userId`
   * does not read yet (what joining the department's group would open).
   */
  departmentGroupGains(tenantId: string, departmentId: string, userId: string): Promise<Array<{ type: string; id: string }>>;
  /** V3 (q196, q198): hidden PERIMETRE counts for `userId`; null for a member of a fixed group that sees everything. */
  hiddenCounts(tenantId: string, userId: string): Promise<HiddenCounts | null>;
  /** q209: whether `userId` belongs to a fixed group that sees everything (Risk Manager, Committee, Audit). */
  seesEverything(tenantId: string, userId: string): Promise<boolean>;
  /** Codex P2 (PR #225): active membership of the Risk Manager group (role `system_group = 'RISK_MANAGER'`). */
  isRiskManagerMember(tenantId: string, userId: string): Promise<boolean>;
  /**
   * q220 (DECISION-111), Codex P2 (PR #226): among `ids` (already served to `userId`), those the rules WITHOUT
   * resource.readall (`*_visible_core`) do not open — necessarily owed to the right, whatever its state now — with the
   * most recent confirmed RESOURCE_READALL grant of the account as reference (null when none is found).
   */
  readOnlyThroughReadall?(tenantId: string, userId: string, type: RestrictableResource | "RISK", ids: string[]): Promise<{ grantId: string | null; ids: string[] }>;
  /** q208: every restricted resource of the tenant (any root, not deleted), with its active named-people count. */
  /** V3: paginated (`limit` 1..500, default 200; `offset` >= 0), most recently changed first. */
  listRestricted(tenantId: string, page?: { limit?: number; offset?: number }): Promise<RestrictedResourceRow[]>;
  /** Active accounts of the tenant that read the resource now (SQL `<root>_visible_to`). */
  readers(tenantId: string, type: RestrictableResource | "RISK", id: string): Promise<string[]>;
  /** QA-VIS2-02: among control execution ids, those the scope may NOT read (control hidden and not their executor). */
  hiddenExecutionIds(tenantId: string, ids: string[], scope: ReadScope): Promise<string[]>;
  /** Among `ids`, those the scope may NOT read (any status). */
  hiddenIds(tenantId: string, type: RestrictableResource, ids: string[], scope: ReadScope): Promise<string[]>;
  /** Whether `userId` belongs to the department's group or owns the process (the perimeter known at creation). */
  inPerimeter(tenantId: string, userId: string, departmentId: string | null, processId: string | null): Promise<boolean>;
}
