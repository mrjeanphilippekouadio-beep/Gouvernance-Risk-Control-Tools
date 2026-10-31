import type { CreateRiskInput, Risk, RiskVisibilityChange, RiskVisibilityState, UpdateRiskInput } from "../entities/Risk.js";
import type { TransactionalAudit } from "../entities/RiskFramework.js";
import type { ReadScope } from "../visibility.js";

/**
 * The domain talks only to this interface — never to `pg`, Neon, or any
 * SQL directly. Swapping the storage engine means writing a new
 * implementation of this interface, not touching services/api. See
 * ADR-001.
 */
export interface RiskRepository {
  /** DECISION-079: true when `changeVisibility` writes its audit rows in its own transaction (writeAudited). */
  readonly auditsInTransaction?: boolean;
  /** `scope` (DECISION-100, fail-closed SEC V0-01): the reader's visibility, mandatory; internal reads pass SYSTEM_SCOPE. */
  getById(tenantId: string, id: string, scope: ReadScope): Promise<Risk | null>;
  /** Batched existence check — used instead of N getById calls (e.g. validating a control's covered risks). */
  listByIds(tenantId: string, ids: string[]): Promise<Risk[]>;
  /**
   * ACT-124: `ownerId` filters to risks individually owned by that user
   * (the "my risks" view). `ownerDepartmentIds`/`processIds`/`ids`
   * (DashboardScopeResolver, 2026-09-30): real `WHERE ... = ANY($n)`
   * filters, OR'd together when more than one is given — used to scope
   * `dashboard.executive` to a configurable RACI-derived perimeter.
   * Never a post-fetch, in-memory filter.
   */
  list(
    tenantId: string,
    options: {
      includeArchived?: boolean;
      ownerId?: string;
      ownerDepartmentIds?: string[];
      processIds?: string[];
      ids?: string[];
    } | undefined,
    scope: ReadScope,
  ): Promise<Risk[]>;
  create(input: CreateRiskInput): Promise<Risk>;
  /** Create once for a tenant-scoped Idempotency-Key; retries return the original resource. */
  createIdempotent(input: CreateRiskInput, idempotencyKey: string): Promise<{ risk: Risk; created: boolean }>;
  update(tenantId: string, id: string, input: UpdateRiskInput): Promise<Risk>;
  /** ACT-120/121: the only way `ownerId` is ever written — never via the generic `update()`. `null` clears it. */
  assignOwner(tenantId: string, id: string, ownerId: string | null): Promise<Risk>;
  /** ACT-122: the only way `superiorOwnerId` is ever written. `null` clears it. */
  assignSuperiorOwner(tenantId: string, id: string, superiorOwnerId: string | null): Promise<Risk>;
  softDelete(tenantId: string, id: string, deletedBy: string, reason: string): Promise<void>;
  /**
   * Lot V1 (q192): the active named-people list of a risk. Optional so the existing fakes keep compiling; the service
   * refuses any restricted level when it is absent (fail-closed).
   */
  listAccess?(tenantId: string, riskId: string): Promise<string[]>;
  /**
   * Lot V1 (q194): changes level and list under a row lock, with the audit rows in the same transaction. Returns the state
   * before and after. Grants are revoked with `revoked_at` (never deleted).
   */
  changeVisibility?(
    tenantId: string,
    riskId: string,
    change: RiskVisibilityChange,
    audit?: TransactionalAudit<{ before: RiskVisibilityState; after: RiskVisibilityState }>,
  ): Promise<{ before: RiskVisibilityState; after: RiskVisibilityState }>;
  /**
   * Lot V1 (q193): among `ids`, the risks the scope may NOT read (restricted and not admitted). Archived and deleted
   * risks are included, unlike `list`: what inherits from a risk follows its visibility whatever its status. Optional:
   * a fake without it holds no restricted risk.
   */
  hiddenIds?(tenantId: string, ids: string[], scope: ReadScope): Promise<string[]>;
  /** Lot V1: at creation, whether the creator would see a risk of this level / department / process (no owner, no list yet). */
  creatorWouldSee?(
    tenantId: string,
    userId: string,
    risk: { visibility: RiskVisibilityState["visibility"]; ownerDepartmentId: string | null; processId: string | null },
  ): Promise<boolean>;
}
