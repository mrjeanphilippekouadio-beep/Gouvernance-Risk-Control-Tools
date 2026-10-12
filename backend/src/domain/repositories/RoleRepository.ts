import type { CreateRoleInput, Role, RoleAssignment, UpdateRoleInput } from "../entities/Role.js";

/** F-B8s-01: run inside the repository transaction, under the user + role locks; throws to abort. */
export type RoleAssignRecheck = (lockedRole: Role, held: Role[]) => Promise<void>;
export type RoleUpdateRecheck = (lockedRole: Role, holders: { userId: string; roles: Role[] }[]) => Promise<void>;

export interface RoleRepository {
  getById(tenantId: string, id: string): Promise<Role | null>;
  getByName(tenantId: string, name: string): Promise<Role | null>;
  list(tenantId: string, options?: { includeDisabled?: boolean }): Promise<Role[]>;
  create(input: CreateRoleInput): Promise<Role>;
  /** `recheck` (widening permissions): locks holders then the role and replays the cumul rules before the UPDATE. */
  update(tenantId: string, id: string, input: UpdateRoleInput, recheck?: RoleUpdateRecheck): Promise<Role>;
  disable(tenantId: string, id: string): Promise<void>;
  /** Used by ACT-112: a role can't be disabled while a user is still actively assigned to it. */
  countActiveAssignments(tenantId: string, roleId: string): Promise<number>;
  assignToUser(tenantId: string, roleId: string, userId: string, grantedBy: string, recheck?: RoleAssignRecheck): Promise<RoleAssignment>;
  /**
   * `minRemaining`: refuse (ValidationError) when fewer than that many active
   * members would remain after the revoke — checked atomically (B-8: the
   * Risk Manager group is never left empty).
   */
  revokeFromUser(tenantId: string, roleId: string, userId: string, options?: { minRemaining?: number }): Promise<void>;
  listForUser(tenantId: string, userId: string): Promise<Role[]>;
  /** B-8 bis (F-B8-06): roles DISABLED since the user got them but whose non-revoked assignment remains. */
  listDisabledForUser?(tenantId: string, userId: string): Promise<Role[]>;
  listAssignments(tenantId: string, roleId: string): Promise<RoleAssignment[]>;
}
