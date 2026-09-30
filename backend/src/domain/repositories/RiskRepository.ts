import type { CreateRiskInput, Risk, UpdateRiskInput } from "../entities/Risk.js";

/**
 * The domain talks only to this interface — never to `pg`, Neon, or any
 * SQL directly. Swapping the storage engine means writing a new
 * implementation of this interface, not touching services/api. See
 * ADR-001.
 */
export interface RiskRepository {
  getById(tenantId: string, id: string): Promise<Risk | null>;
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
    options?: {
      includeArchived?: boolean;
      ownerId?: string;
      ownerDepartmentIds?: string[];
      processIds?: string[];
      ids?: string[];
    },
  ): Promise<Risk[]>;
  create(input: CreateRiskInput): Promise<Risk>;
  update(tenantId: string, id: string, input: UpdateRiskInput): Promise<Risk>;
  /** ACT-120/121: the only way `ownerId` is ever written — never via the generic `update()`. `null` clears it. */
  assignOwner(tenantId: string, id: string, ownerId: string | null): Promise<Risk>;
  /** ACT-122: the only way `superiorOwnerId` is ever written. `null` clears it. */
  assignSuperiorOwner(tenantId: string, id: string, superiorOwnerId: string | null): Promise<Risk>;
  softDelete(tenantId: string, id: string, deletedBy: string, reason: string): Promise<void>;
}
