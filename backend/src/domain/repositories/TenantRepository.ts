import type { CreateTenantInput, Tenant, UpdateTenantInput } from "../entities/Tenant.js";
import type { TransactionalAudit } from "../entities/RiskFramework.js";

/** q277: who must still be able to reactivate after a deactivation (platform super-administrators, from the server config). */
export interface SuperAdminSurvivalRule {
  /** The actor: cannot reactivate what they deactivated, so they do not count as the survivor. */
  actorUserId: string;
  emails: readonly string[];
  domains: readonly string[];
}

export interface SetActiveInput {
  id: string;
  active: boolean;
  /** Fails (409) if the stored state is no longer this one when the lock is held (concurrent change). */
  expectedActive: boolean;
  /** Deactivation only: refused unless another active super-administrator outside this client remains (q277). */
  survivalRule?: SuperAdminSurvivalRule;
  /** SEC-F8B-02: the audit rows are inserted in the SAME transaction as the state change. */
  audit: TransactionalAudit<{ before: Tenant; after: Tenant }>;
}

export interface TenantRepository {
  getDriveFolderId(tenantId: string): Promise<string>;
  getById(id: string): Promise<Tenant | null>;
  list(): Promise<Tenant[]>;
  create(input: CreateTenantInput): Promise<Tenant>;
  update(id: string, input: UpdateTenantInput): Promise<Tenant>;
  /**
   * Deactivate / reactivate under one transaction: platform-wide advisory lock (serializes these actions), row lock, the
   * q277 survival rule, the state change and its audit rows. Optional so older test doubles keep compiling; only
   * PostgresTenantRepository implements it.
   */
  setActiveAudited?(input: SetActiveInput): Promise<Tenant>;
}
