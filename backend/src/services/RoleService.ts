import type { RoleRepository } from "../domain/repositories/RoleRepository.js";
import type { AuditRepository } from "../domain/repositories/AuditRepository.js";
import type { UserRepository } from "../domain/repositories/UserRepository.js";
import type { DepartmentRepository } from "../domain/repositories/DepartmentRepository.js";
import type { RolePermissionChangeRepository } from "../domain/repositories/RolePermissionChangeRepository.js";
import type { CreateRoleInput, Role, SystemGroup, UpdateRoleInput } from "../domain/entities/Role.js";
import {
  ALL_PERMISSIONS,
  BASE_PERMISSIONS,
  filterKnownPermissions,
  requirePermission,
  type Permission,
} from "../domain/permissions.js";
import { ForbiddenError, NotFoundError, ValidationError } from "../domain/errors/DomainErrors.js";
import type { AuthenticatedUser } from "../infrastructure/identity/IdentityProvider.js";
import type { DashboardScopeMode } from "../domain/entities/DashboardScope.js";

const MAX_GROUP_REASON_LENGTH = 500;

/** B-8 bis (q43): hard-coded for now (configurable part waits for PO q58). Risk Manager and Audit never cumulate. */
const FORBIDDEN_CUMUL: Partial<Record<SystemGroup, SystemGroup>> = { RISK_MANAGER: "AUDIT", AUDIT: "RISK_MANAGER" };

function assertKnownPermissions(permissions: Permission[]): void {
  if (permissions.length === 0) throw new ValidationError("A role needs at least one permission");
  const unknown = permissions.filter((p) => !ALL_PERMISSIONS.includes(p));
  if (unknown.length > 0) {
    throw new ValidationError(`Unknown permission(s): ${unknown.join(", ")}`);
  }
}

/**
 * @architect design 2026-09-30: PROCESS is a valid stored
 * dashboard_scope_mode value (kept in the DB CHECK / TS enum so the
 * column and the application-level type never drift) but rejected here,
 * at the write boundary — `risks.process_id` (029_risks_process_id.sql)
 * has never been backfilled in real data (0 unique matches in the PO's
 * cited dry-run), so a role holding PROCESS today would see an empty
 * dashboard.executive regardless of its actual RACI/ownership.
 */
function assertDashboardScopeModeWritable(mode: DashboardScopeMode | undefined): void {
  if (mode === "PROCESS") {
    throw new ValidationError(
      "dashboardScopeMode: PROCESS is not yet usable — risks.process_id has not been backfilled " +
        "(0 unique matches found in the dry-run), so a PROCESS-scoped role would see an empty dashboard.executive. " +
        "Use GLOBAL or DEPARTMENT until that backfill is done.",
    );
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
    private readonly users?: UserRepository,
    /** B-8: needed only to link a role to a department; fails closed (throws) if a departmentId is given without it. */
    private readonly departments?: DepartmentRepository,
    /** B-8 bis (q45): pending Audit-group permission changes; fails closed if a change must be queued without it. */
    private readonly permissionChanges?: RolePermissionChangeRepository,
  ) {}

  /** B-8 bis (q44): entering/leaving a fixed group needs a bounded, non-empty reason. */
  private groupReason(role: Role, reason: string | undefined): string | null {
    const r = reason?.trim() || null;
    if (role.systemGroup && !r) throw new ValidationError("A reason is required to add or remove a member of a fixed group");
    if (r && r.length > MAX_GROUP_REASON_LENGTH) {
      throw new ValidationError(`reason must be at most ${MAX_GROUP_REASON_LENGTH} characters`);
    }
    return r;
  }

  /**
   * B-8: a department's group must point at a live department of this
   * tenant and be the only group of that department.
   */
  private async assertDepartmentLinkable(tenantId: string, departmentId: string, selfRoleId: string | null): Promise<void> {
    if (!this.departments) throw new Error("RoleService requires a DepartmentRepository to link a role to a department");
    const department = await this.departments.getById(tenantId, departmentId);
    if (!department) throw new ValidationError(`Department ${departmentId} does not exist in this tenant`);
    const roles = await this.roles.list(tenantId);
    if (roles.some((r) => r.departmentId === departmentId && r.id !== selfRoleId)) {
      throw new ValidationError("This department already has a group");
    }
  }

  async create(
    actor: AuthenticatedUser,
    input: Omit<CreateRoleInput, "tenantId">,
    requestId: string,
  ): Promise<Role> {
    requirePermission(actor, "role.create");
    if (!input.name.trim()) throw new ValidationError("name is required");
    assertKnownPermissions(input.permissions);
    assertDashboardScopeModeWritable(input.dashboardScopeMode);
    if (input.departmentId) await this.assertDepartmentLinkable(actor.tenantId, input.departmentId, null);

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
    if (before.systemGroup && input.name !== undefined && input.name !== before.name) {
      throw new ValidationError(`"${before.name}" is a fixed group: it cannot be renamed`);
    }
    if (before.systemGroup && input.departmentId) {
      throw new ValidationError(`"${before.name}" is a fixed group: it cannot be linked to a department`);
    }
    if (input.departmentId) await this.assertDepartmentLinkable(actor.tenantId, input.departmentId, id);
    if (input.permissions !== undefined) assertKnownPermissions(input.permissions);
    if (before.systemGroup === "AUDIT" && input.permissions !== undefined) {
      throw new ValidationError("The permissions of the Audit group are changed through its dedicated endpoint");
    }
    assertDashboardScopeModeWritable(input.dashboardScopeMode);

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
    if (before.systemGroup) {
      throw new ValidationError(`"${before.name}" is a fixed group: it cannot be disabled`);
    }

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
  async assignToUser(
    actor: AuthenticatedUser,
    roleId: string,
    userId: string,
    requestId: string,
    reason?: string,
  ): Promise<void> {
    requirePermission(actor, "role.assign");
    if (actor.userId === userId) {
      throw new ForbiddenError("You cannot assign a role to yourself — ask another admin");
    }
    const role = await this.get(actor, roleId);
    const cleanReason = this.groupReason(role, reason);
    const forbidden = role.systemGroup ? FORBIDDEN_CUMUL[role.systemGroup] : undefined;
    if (forbidden) {
      const held = await this.roles.listForUser(actor.tenantId, userId);
      if (held.some((r) => r.systemGroup === forbidden)) {
        throw new ValidationError("A user cannot be both in the Risk Manager group and in the Audit group");
      }
    }

    const assignment = await this.roles.assignToUser(actor.tenantId, roleId, userId, actor.userId);

    await this.audit.record({
      tenantId: actor.tenantId,
      userId: actor.userId,
      entityType: "Role",
      entityId: roleId,
      action: "ROLE_CHANGE",
      oldValue: null,
      newValue: { ...assignment, roleName: role.name },
      reason: cleanReason,
      requestId,
    });
  }

  /** ACT-114: also refuses to leave a user with zero active roles. */
  async revokeFromUser(
    actor: AuthenticatedUser,
    roleId: string,
    userId: string,
    requestId: string,
    reason?: string,
  ): Promise<void> {
    requirePermission(actor, "role.assign");
    if (actor.userId === userId) {
      throw new ForbiddenError("You cannot revoke your own role — ask another admin");
    }
    const role = await this.get(actor, roleId);
    const cleanReason = this.groupReason(role, reason);

    // B-8: the Risk Manager group is never left empty (Committee and Audit may be).
    // Checked here for a clear error, and again atomically in the repository.
    const isRiskManagerGroup = role.systemGroup === "RISK_MANAGER";
    if (isRiskManagerGroup) {
      // F-B8-05: the count excludes suspended users, so a suspended target is not in it.
      // Refuse only if no OTHER active member would remain (fail closed without a UserRepository).
      const active = await this.roles.countActiveAssignments(actor.tenantId, roleId);
      const target = this.users ? await this.users.getById(actor.tenantId, userId) : null;
      const targetCounted = !target || !target.deletedAt;
      if ((targetCounted ? active - 1 : active) < 1) {
        throw new ValidationError("Cannot remove the last member of the Risk Manager group");
      }
    }

    const remaining = await this.roles.listForUser(actor.tenantId, userId);
    if (remaining.length <= 1 && remaining.some((r) => r.id === roleId)) {
      throw new ValidationError("Cannot revoke the user's last active role");
    }

    await this.roles.revokeFromUser(actor.tenantId, roleId, userId, isRiskManagerGroup ? { minRemaining: 1 } : undefined);

    await this.audit.record({
      tenantId: actor.tenantId,
      userId: actor.userId,
      entityType: "Role",
      entityId: roleId,
      action: "ROLE_CHANGE",
      oldValue: { roleId, userId, roleName: role.name },
      newValue: null,
      reason: cleanReason,
      requestId,
    });
  }

  /**
   * F-B8-01: suspending a user removes them from every group in practice, so
   * the Risk Manager "never empty" rule applies as for a revoke. Clear error
   * here; the atomic guard is in UserRepository.suspend.
   */
  async assertNotLastRiskManager(tenantId: string, userId: string): Promise<void> {
    const held = await this.roles.listForUser(tenantId, userId);
    const rm = held.find((r) => r.systemGroup === "RISK_MANAGER");
    if (rm && (await this.roles.countActiveAssignments(tenantId, rm.id)) <= 1) {
      throw new ValidationError("Cannot remove the last member of the Risk Manager group");
    }
  }

  async listForUser(actor: AuthenticatedUser, userId: string): Promise<Role[]> {
    requirePermission(actor, "role.read");
    return this.roles.listForUser(actor.tenantId, userId);
  }

  /**
   * SEC-005 (second half): the RBAC role list alone (`listForUser`) isn't
   * what actually gates a request — server.ts's identity resolver unions
   * it with `users.roles` (legacy/bootstrap grants) and BASE_PERMISSIONS
   * to get the permission set `requirePermission` checks against. This
   * mirrors that same computation so an admin can see what a user can
   * *actually* do, not just which named roles they hold.
   */
  async getEffectivePermissions(actor: AuthenticatedUser, userId: string): Promise<Permission[]> {
    requirePermission(actor, "role.read");
    if (!this.users) {
      throw new Error("RoleService.getEffectivePermissions requires a UserRepository");
    }

    const user = await this.users.getById(actor.tenantId, userId);
    if (!user) throw new NotFoundError("User", userId);

    const roles = await this.roles.listForUser(actor.tenantId, userId);
    const legacyPermissions = filterKnownPermissions(user.roles);
    const rolePermissions = roles.flatMap((r) => r.permissions);

    return Array.from(new Set([...BASE_PERMISSIONS, ...legacyPermissions, ...rolePermissions]));
  }

  // -- B-8 bis ----------------------------------------------------------

  /** Fixed groups a user belongs to (no permission check: callers already authorized the read). */
  async fixedGroupsOf(tenantId: string, userId: string): Promise<SystemGroup[]> {
    const held = await this.roles.listForUser(tenantId, userId);
    return held.flatMap((r) => (r.systemGroup ? [r.systemGroup] : []));
  }

  /** F-B8-06: roles disabled while the user was suspended whose assignment remains (rights silently lost). */
  async listLostRoles(tenantId: string, userId: string): Promise<Role[]> {
    return (await this.roles.listDisabledForUser?.(tenantId, userId)) ?? [];
  }

  /**
   * q45: only the application administrator (rolegroup.audit.update) changes the
   * Audit group's permissions. If the actor is also a Risk Manager the change is
   * queued until a member of Audit or the Committee validates it.
   */
  async changeAuditGroupPermissions(
    actor: AuthenticatedUser,
    permissions: Permission[],
    requestId: string,
  ): Promise<{ status: "APPLIED"; role: Role } | { status: "PENDING"; changeId: string }> {
    requirePermission(actor, "rolegroup.audit.update");
    assertKnownPermissions(permissions);
    const group = (await this.roles.list(actor.tenantId)).find((r) => r.systemGroup === "AUDIT");
    if (!group) throw new NotFoundError("Role", "AUDIT");
    const held = await this.roles.listForUser(actor.tenantId, actor.userId);
    if (held.some((r) => r.id === group.id)) {
      throw new ForbiddenError("You cannot change the permissions of a group you belong to");
    }

    if (held.some((r) => r.systemGroup === "RISK_MANAGER")) {
      if (!this.permissionChanges) throw new Error("RoleService requires a RolePermissionChangeRepository");
      const change = await this.permissionChanges.create({
        tenantId: actor.tenantId,
        roleId: group.id,
        permissions,
        requestedBy: actor.userId,
      });
      await this.audit.record({
        tenantId: actor.tenantId,
        userId: actor.userId,
        entityType: "RolePermissionChange",
        entityId: change.id,
        action: "PERMISSION_CHANGE",
        oldValue: { permissions: group.permissions },
        newValue: { status: "PENDING", permissions },
        reason: null,
        requestId,
      });
      return { status: "PENDING", changeId: change.id };
    }

    const role = await this.roles.update(actor.tenantId, group.id, { permissions });
    await this.audit.record({
      tenantId: actor.tenantId,
      userId: actor.userId,
      entityType: "Role",
      entityId: group.id,
      action: "PERMISSION_CHANGE",
      oldValue: group,
      newValue: role,
      reason: null,
      requestId,
    });
    return { status: "APPLIED", role };
  }

  /** q45 maker-checker: a member of Audit or the Committee (never the author) approves or rejects. */
  async decideAuditPermissionChange(
    actor: AuthenticatedUser,
    changeId: string,
    approve: boolean,
    requestId: string,
  ): Promise<void> {
    requirePermission(actor, "rolegroup.audit.validate");
    if (!this.permissionChanges) throw new Error("RoleService requires a RolePermissionChangeRepository");
    const change = await this.permissionChanges.getById(actor.tenantId, changeId);
    if (!change) throw new NotFoundError("RolePermissionChange", changeId);
    if (change.status !== "PENDING") throw new ValidationError("This change has already been decided");
    if (change.requestedBy === actor.userId) {
      throw new ForbiddenError("The author of a permission change cannot validate it");
    }
    const held = await this.roles.listForUser(actor.tenantId, actor.userId);
    if (!held.some((r) => r.systemGroup === "AUDIT" || r.systemGroup === "RISK_COMMITTEE")) {
      throw new ForbiddenError("Only a member of the Audit group or of the Committee can validate this change");
    }

    const claimed = await this.permissionChanges.decide(
      actor.tenantId,
      changeId,
      approve ? "APPROVED" : "REJECTED",
      actor.userId,
    );
    if (!claimed) throw new ValidationError("This change has already been decided");

    if (approve) {
      const before = await this.roles.getById(actor.tenantId, change.roleId);
      const after = await this.roles.update(actor.tenantId, change.roleId, { permissions: change.permissions });
      await this.audit.record({
        tenantId: actor.tenantId,
        userId: actor.userId,
        entityType: "Role",
        entityId: change.roleId,
        action: "PERMISSION_CHANGE",
        oldValue: before,
        newValue: after,
        reason: `Validation of change ${changeId} requested by ${change.requestedBy}`,
        requestId,
      });
    }
    await this.audit.record({
      tenantId: actor.tenantId,
      userId: actor.userId,
      entityType: "RolePermissionChange",
      entityId: changeId,
      action: approve ? "APPROVE" : "REJECT",
      oldValue: { status: "PENDING" },
      newValue: { status: approve ? "APPROVED" : "REJECTED" },
      reason: null,
      requestId,
    });
  }

  /**
   * q48 (F-B8-06), explicit exception to DECISION-011/q02, limited to this case:
   * for a denied permission, the active users of the tenant who can give it back
   * (holders of role.assign, if an active role carries the permission). Any
   * authenticated user may ask; only display names are returned, and every call is audited.
   */
  async listGrantors(
    actor: AuthenticatedUser,
    permission: Permission,
    requestId: string,
  ): Promise<{ permission: Permission; grantors: Array<{ displayName: string }> }> {
    if (!ALL_PERMISSIONS.includes(permission)) throw new ValidationError(`Unknown permission: ${permission}`);
    if (!this.users?.listWithPermission) throw new Error("RoleService.listGrantors requires a UserRepository");
    const carried = (await this.roles.list(actor.tenantId)).some((r) => r.permissions.includes(permission));
    const found = carried ? await this.users.listWithPermission(actor.tenantId, "role.assign", actor.userId) : [];
    await this.audit.record({
      tenantId: actor.tenantId,
      userId: actor.userId,
      entityType: "PermissionGrantorsLookup",
      entityId: actor.userId,
      action: "READ",
      oldValue: null,
      newValue: { permission, returned: found.length },
      reason: null,
      requestId,
    });
    return { permission, grantors: found.map((u) => ({ displayName: u.displayName })) };
  }
}
