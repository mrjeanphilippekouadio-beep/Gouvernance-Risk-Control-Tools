import type { RolePermissionChange } from "../entities/Role.js";
import type { Permission } from "../permissions.js";

export interface RolePermissionChangeRepository {
  create(input: { tenantId: string; roleId: string; permissions: Permission[]; requestedBy: string }): Promise<RolePermissionChange>;
  getById(tenantId: string, id: string): Promise<RolePermissionChange | null>;
  /** Atomic claim: moves PENDING to the given status; false if it was no longer PENDING. */
  decide(tenantId: string, id: string, status: "APPROVED" | "REJECTED", decidedBy: string): Promise<boolean>;
}
