import type { RoleRepository } from "../domain/repositories/RoleRepository.js";
import type { AuditRepository } from "../domain/repositories/AuditRepository.js";
import type { CreateRoleInput, Role, UpdateRoleInput } from "../domain/entities/Role.js";
import { ALL_PERMISSIONS, requirePermission, type Permission } from "../domain/permissions.js";
import { ForbiddenError, NotFoundError, ValidationError } from "../domain/errors/DomainErrors.js";
import type { AuthenticatedUser } from "../infrastructure/identity/IdentityProvider.js";

function assertKnownPermissions(permissions: Permission[]): void {
  if (permissions.length === 0) throw new ValidationError("A role needs at least one permission");
  const unknown = permissions.filter((p) => !ALL_PERMISSIONS.includes(p));
  if (unknown.length > 0) {
    throw new ValidationError(`Unknown permission(s): ${unknown.join(", ")}`);
  }
}

/**
 * RBAC per ACT-093/110-118: admin-defined named permission bundles,
 * assignable to users. Maker-checker throughout — an actor can never
 * grant or revoke a role on themselves, matching the "admin ne peut pas
 * s'attribuer ses propres rôles" rule the ACF backlog states for
 * ACT-093/113.
 */
export class RoleService {
  constructor(
    private readonly roles: RoleRepository,
    private readonly audit: AuditRepository,
  ) {}

  async create(
    actor: AuthenticatedUser,
    input: Omit<CreateRoleInput, "tenantId">,
    requestId: string,
  ): Promise<Role> {
    requirePermission(actor, "role.create");
    if (!input.name.trim()) throw new ValidationError("name is required");
    assertKnownPermissions(input.permissions);

    const existing = await this.roles.getByName(actor.tenantId, input.name);
    if (existing) throw new ValidationError(`A role named "${input.name}" already exists`);

    const role = await this.roles.create({ ...input, tenantId: actor.tenantId });

    await this.audit.record({
      tenantId: actor.tenantId,
      userId: actor.userId,
      entityType: "Role",
      entityId: role.id,
      action: "CREATE",
      oldValue: null,
      newValue: role,
      reason: null,
      requestId,
    });

    return role;
  }

  async get(actor: AuthenticatedUser, id: string): Promise<Role> {
    requirePermission(actor, "role.read");
    const role = await this.roles.getById(actor.tenantId, id);
    if (!role) throw new NotFoundError("Role", id);
    return role;
  }

  async list(actor: AuthenticatedUser, includeDisabled = false): Promise<Role[]> {
    requirePermission(actor, "role.read");
    return this.roles.list(actor.tenantId, { includeDisabled });
  }

  /**
   * SEC-002: an actor holding role.update could otherwise widen a role
   * they themselves hold (self-escalation) — assignToUser/revokeFromUser
   * already block self-assignment, this closes the same door on the
   * role definition itself. An actor editing a role they hold must ask
   * another admin, same as assigning/revoking one on themselves.
   */
  async update(actor: AuthenticatedUser, id: string, input: UpdateRoleInput, requestId: string): Promise<Role> {
    requirePermission(actor, "role.update");
    const before = await this.get(actor, id);

    if (input.permissions !== undefined) {
      const held = await this.roles.listForUser(actor.tenantId, actor.userId);
      if (held.some((r) => r.id === id)) {
        throw new ForbiddenError(
          "You cannot change the permissions of a role you hold yourself — ask another admin",
        );
      }
    }

    if (input.name !== undefined && !input.name.trim()) throw new ValidationError("name cannot be empty");
    if (input.permissions !== undefined) assertKnownPermissions(input.permissions);

    const after = await this.roles.update(actor.tenantId, id, input);

    await this.audit.record({
      tenantId: actor.tenantId,
      userId: actor.userId,
      entityType: "Role",
      entityId: id,
      action: "PERMISSION_CHANGE",
      oldValue: before,
      newValue: after,
      reason: null,
      requestId,
    });

    return after;
  }

  /** ACT-112: refuses while a user is still actively assigned — revoke them first. */
  async disable(actor: AuthenticatedUser, id: string, requestId: string): Promise<void> {
    requirePermission(actor, "role.delete");
    const before = await this.get(actor, id);

    const activeCount = await this.roles.countActiveAssignments(actor.tenantId, id);
    if (activeCount > 0) {
      throw new ValidationError(
        `Cannot disable role "${before.name}": ${activeCount} user(s) still hold it — revoke them first`,
      );
    }

    await this.roles.disable(actor.tenantId, id);

    await this.audit.record({
      tenantId: actor.tenantId,
      userId: actor.userId,
      entityType: "Role",
      entityId: id,
      action: "DELETE",
      oldValue: before,
      newValue: null,
      reason: null,
      requestId,
    });
  }

  /** ACT-093/113: the actor can never assign a role to themselves — that's the maker-checker boundary. */
  async assignToUser(actor: AuthenticatedUser, roleId: string, userId: string, requestId: string): Promise<void> {
    requirePermission(actor, "role.assign");
    if (actor.userId === userId) {
      throw new ForbiddenError("You cannot assign a role to yourself — ask another admin");
    }
    const role = await this.get(actor, roleId);

    const assignment = await this.roles.assignToUser(actor.tenantId, roleId, userId, actor.userId);

    await this.audit.record({
      tenantId: actor.tenantId,
      userId: actor.userId,
      entityType: "Role",
      entityId: roleId,
      action: "ROLE_CHANGE",
      oldValue: null,
      newValue: { ...assignment, roleName: role.name },
      reason: null,
      requestId,
    });
  }

  /** ACT-114: also refuses to leave a user with zero active roles. */
  async revokeFromUser(actor: AuthenticatedUser, roleId: string, userId: string, requestId: string): Promise<void> {
    requirePermission(actor, "role.assign");
    if (actor.userId === userId) {
      throw new ForbiddenError("You cannot revoke your own role — ask another admin");
    }
    const role = await this.get(actor, roleId);

    const remaining = await this.roles.listForUser(actor.tenantId, userId);
    if (remaining.length <= 1 && remaining.some((r) => r.id === roleId)) {
      throw new ValidationError("Cannot revoke the user's last active role");
    }

    await this.roles.revokeFromUser(actor.tenantId, roleId, userId);

    await this.audit.record({
      tenantId: actor.tenantId,
      userId: actor.userId,
      entityType: "Role",
      entityId: roleId,
      action: "ROLE_CHANGE",
      oldValue: { roleId, userId, roleName: role.name },
      newValue: null,
      reason: null,
      requestId,
    });
  }

  async listForUser(actor: AuthenticatedUser, userId: string): Promise<Role[]> {
    requirePermission(actor, "role.read");
    return this.roles.listForUser(actor.tenantId, userId);
  }
}
