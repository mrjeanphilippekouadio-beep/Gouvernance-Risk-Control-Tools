import type { CreateRoleInput, Role, RoleAssignment, UpdateRoleInput } from "../entities/Role.js";

export interface RoleRepository {
  getById(tenantId: string, id: string): Promise<Role | null>;
  getByName(tenantId: string, name: string): Promise<Role | null>;
  list(tenantId: string, options?: { includeDisabled?: boolean }): Promise<Role[]>;
  create(input: CreateRoleInput): Promise<Role>;
  update(tenantId: string, id: string, input: UpdateRoleInput): Promise<Role>;
  disable(tenantId: string, id: string): Promise<void>;
  /** Used by ACT-112: a role can't be disabled while a user is still actively assigned to it. */
  countActiveAssignments(tenantId: string, roleId: string): Promise<number>;
  assignToUser(tenantId: string, roleId: string, userId: string, grantedBy: string): Promise<RoleAssignment>;
  revokeFromUser(tenantId: string, roleId: string, userId: string): Promise<void>;
  listForUser(tenantId: string, userId: string): Promise<Role[]>;
  listAssignments(tenantId: string, roleId: string): Promise<RoleAssignment[]>;
}
