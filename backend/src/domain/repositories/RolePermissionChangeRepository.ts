import type { RolePermissionChange, RolePermissionChangeStatus } from "../entities/Role.js";
import type { Permission } from "../permissions.js";

export interface RolePermissionChangeRepository {
  create(input: { tenantId: string; roleId: string; permissions: Permission[]; requestedBy: string; reason?: string | null }): Promise<RolePermissionChange>;
  getById(tenantId: string, id: string): Promise<RolePermissionChange | null>;
  /** Atomic claim: moves PENDING to the given status; false if it was no longer PENDING. */
  decide(tenantId: string, id: string, status: "APPROVED" | "REJECTED", decidedBy: string): Promise<boolean>;
  /**
   * B-8 ter (F-B8b-04): undoes an APPROVED claim whose application failed, so the change can be retried.
   * Optional so older test doubles keep compiling; the Postgres repository implements it.
   */
  reopen?(tenantId: string, id: string): Promise<void>;
  /** B-8 ter: changes of a tenant, newest first (optional for the same reason as reopen). */
  list?(tenantId: string, filter: { status?: RolePermissionChangeStatus; roleId?: string }): Promise<RolePermissionChange[]>;
}
