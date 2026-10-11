import type { UserRepository } from "../domain/repositories/UserRepository.js";
import type { AuditRepository } from "../domain/repositories/AuditRepository.js";
import type { DepartmentRepository } from "../domain/repositories/DepartmentRepository.js";
import type { UpdateUserInput, User } from "../domain/entities/User.js";
import { ForbiddenError, NotFoundError, ValidationError } from "../domain/errors/DomainErrors.js";
import { requirePermission } from "../domain/permissions.js";
import type { AuthenticatedUser } from "../infrastructure/identity/IdentityProvider.js";
import type { RoleService } from "./RoleService.js";
import type { NotificationService } from "./NotificationService.js";
import type { SystemGroup } from "../domain/entities/Role.js";
import type { Permission } from "../domain/permissions.js";

/** B-8 bis (q43): user sheet with the fixed groups and the allowed Risk Manager + Committee cumul flagged. */
export interface UserDetail extends User {
  fixedGroups: SystemGroup[];
  riskManagerAndCommittee: boolean;
}

/** B-8 bis (F-B8-06): a role disabled during suspension whose assignment remains. */
export interface LostRole {
  id: string;
  name: string;
  permissions: Permission[];
}

export interface CreateUserWithRoleInput {
  email: string;
  displayName: string;
  /** ACT-100: "rôle initial obligatoire" — an RBAC Role id (RoleService/roles table), not a legacy `users.roles` string. */
  roleId: string;
  /** Architect audit (2026-09-30): optional department attachment, validated against the actor's tenant — see assertDepartmentExists. */
  departmentId?: string | null;
  /** B-8 bis (q44): mandatory when the initial role is one of the fixed groups. */
  reason?: string;
}

export interface ListUsersOptions {
  includeSuspended?: boolean;
  limit?: number;
  offset?: number;
}

export interface ListUsersResult {
  users: User[];
  total: number;
}

/**
 * ACT-100 to ACT-105, ACT-107. There is no session/JWT store anywhere in
 * this codebase — authentication is a per-request Google ID token
 * verification (`GoogleIdentityProvider`), and the identity lookup in
 * server.ts already does `WHERE deleted_at IS NULL` when resolving a
 * user by email. That makes `suspend()`'s soft-delete alone sufficient
 * to block every future request from that user on the very next call —
 * ACT-107 ("automatic session revocation on suspension") is satisfied by
 * that existing check and needs no new infrastructure (no sessions
 * table, no JWT blocklist: neither would fit the existing auth model).
 */
export class UserService {
  constructor(
    private readonly users: UserRepository,
    private readonly audit: AuditRepository,
    private readonly roleService?: RoleService,
    /**
     * Architect audit (2026-09-30): optional so existing tests keep
     * compiling — but if a caller actually supplies `departmentId`,
     * `assertDepartmentExists` throws rather than silently skipping
     * validation, same pattern as RiskService.assertProcessExists (the
     * SEC-012 lesson — never `if (!this.x) return;` on a dependency the
     * current call is actually trying to use). server.ts must wire the
     * real repository for `departmentId` to ever be accepted.
     */
    private readonly departments?: DepartmentRepository,
    /** B-8 bis (F-B8-06): notifies the reactivated user of lost rights; skipped when absent. */
    private readonly notifications?: NotificationService,
  ) {}

  /**
   * ACT-100. The initial role is mandatory by design — this constructor
   * takes `RoleService` as an optional parameter only so a caller that
   * never exercises `create()` (e.g. tests focused on suspend/reactivate)
   * doesn't need to wire RBAC too; `create()` itself still fails loudly
   * (not silently) if a roleId is supplied without a `RoleService` to
   * assign it. Uniqueness of (tenant, email) is enforced by the DB
   * constraint via `UserRepository.create` — no racy pre-check here.
   */
  async create(actor: AuthenticatedUser, input: CreateUserWithRoleInput, requestId: string): Promise<User> {
    requirePermission(actor, "user.create");
    // SEC-010: role.assign is re-checked below by RoleService.assignToUser
    // (the source of truth for that permission) — but it must also be
    // checked *here*, before any row is inserted, otherwise an actor with
    // user.create but not role.assign gets a 403 after the users row
    // already exists: a login-capable, role-less account survives the
    // refusal. No cross-repository transaction exists in this codebase to
    // roll that insert back (see comment below), so the only fix is to
    // fail before writing.
    requirePermission(actor, "role.assign");
    if (!input.email.trim()) throw new ValidationError("email is required");
    if (!input.displayName.trim()) throw new ValidationError("displayName is required");
    if (!input.roleId?.trim()) throw new ValidationError("An initial role is required");
    if (!this.roleService) {
      throw new ValidationError("Role assignment is not configured — cannot create a user without an initial role");
    }
    await this.assertDepartmentExists(actor.tenantId, input.departmentId);

    const user = await this.users.create({
      tenantId: actor.tenantId,
      email: input.email.trim().toLowerCase(),
      displayName: input.displayName.trim(),
      departmentId: input.departmentId ?? null,
    });

    // Not wrapped in a DB transaction with the insert above — no
    // repository in this codebase exposes cross-repository transactions
    // (DepartmentService.create/audit.record has the same gap). If this
    // throws (unknown roleId, or the actor lacks role.assign/role.read),
    // the user row already exists without a role; the caller sees the
    // error and can retry the assignment via RoleService directly.
    await this.roleService.assignToUser(actor, input.roleId, user.id, requestId, input.reason);

    await this.audit.record({
      tenantId: actor.tenantId,
      userId: actor.userId,
      entityType: "User",
      entityId: user.id,
      action: "CREATE",
      oldValue: null,
      newValue: user,
      reason: null,
      requestId,
    });

    return user;
  }

  /** ACT-104: no id parameter — this can only ever return the caller's own row. */
  async getSelf(actor: AuthenticatedUser): Promise<User> {
    const user = await this.users.getById(actor.tenantId, actor.userId);
    if (!user) throw new NotFoundError("User", actor.userId);
    return user;
  }

  async get(actor: AuthenticatedUser, id: string): Promise<User> {
    requirePermission(actor, "user.read");
    const user = await this.users.getById(actor.tenantId, id);
    if (!user) throw new NotFoundError("User", id);
    return user;
  }

  /** B-8 bis (q43): the user sheet, with fixed-group membership and the Risk Manager + Committee cumul. */
  async getDetail(actor: AuthenticatedUser, id: string): Promise<UserDetail> {
    const user = await this.get(actor, id);
    const fixedGroups = this.roleService ? await this.roleService.fixedGroupsOf(actor.tenantId, id) : [];
    return {
      ...user,
      fixedGroups,
      riskManagerAndCommittee: fixedGroups.includes("RISK_MANAGER") && fixedGroups.includes("RISK_COMMITTEE"),
    };
  }

  /** ACT-105: admin-only, tenant-scoped, paginated. */
  async list(actor: AuthenticatedUser, options: ListUsersOptions = {}): Promise<ListUsersResult> {
    requirePermission(actor, "user.read");
    const [users, total] = await Promise.all([
      this.users.list(actor.tenantId, options),
      this.users.count(actor.tenantId, { includeSuspended: options.includeSuspended }),
    ]);
    return { users, total };
  }

  /** ACT-101: profile edit — display name only, see UpdateUserInput. */
  async update(actor: AuthenticatedUser, id: string, input: UpdateUserInput, requestId: string): Promise<User> {
    requirePermission(actor, "user.update");
    const before = await this.get(actor, id);

    if (input.displayName !== undefined && !input.displayName.trim()) {
      throw new ValidationError("displayName cannot be empty");
    }
    await this.assertDepartmentExists(actor.tenantId, input.departmentId);

    const after = await this.users.update(actor.tenantId, id, input);

    await this.audit.record({
      tenantId: actor.tenantId,
      userId: actor.userId,
      entityType: "User",
      entityId: id,
      action: "UPDATE",
      oldValue: before,
      newValue: after,
      reason: null,
      requestId,
    });

    return after;
  }

  /**
   * ACT-102: soft-delete, a terminal-state action with its own
   * permission (`user.delete`) — never folded into the general
   * `update()`, same convention as Risk/Control/KPI's dedicated
   * archive/delete methods. Maker-checker: an actor can never suspend
   * themselves (mirrors RoleService.assignToUser/revokeFromUser).
   */
  async suspend(actor: AuthenticatedUser, id: string, requestId: string): Promise<void> {
    requirePermission(actor, "user.delete");
    if (actor.userId === id) {
      throw new ForbiddenError("You cannot suspend your own account — ask another admin");
    }
    const before = await this.users.getById(actor.tenantId, id);
    if (!before) throw new NotFoundError("User", id);
    if (before.deletedAt) throw new ValidationError("User is already suspended");
    // F-B8-01: security rule, fail closed if RBAC is not wired.
    if (!this.roleService) throw new Error("UserService.suspend requires a RoleService (Risk Manager group guard)");
    await this.roleService.assertNotLastRiskManager(actor.tenantId, id);

    await this.users.suspend(actor.tenantId, id);

    await this.audit.record({
      tenantId: actor.tenantId,
      userId: actor.userId,
      entityType: "User",
      entityId: id,
      action: "DELETE",
      oldValue: before,
      newValue: null,
      reason: null,
      requestId,
    });
  }

  /**
   * ACT-103: the maker-checker counterpart to suspend — its own
   * permission (`user.reactivate`), not gated behind `user.delete` or
   * `user.update`, mirroring how `execution.validate`/
   * `effectiveness.validate` get their own permission as the
   * counter-action to a terminal transition.
   */
  async reactivate(
    actor: AuthenticatedUser,
    id: string,
    requestId: string,
  ): Promise<User & { lostRoles: LostRole[] }> {
    requirePermission(actor, "user.reactivate");
    const before = await this.users.getById(actor.tenantId, id);
    if (!before) throw new NotFoundError("User", id);
    if (!before.deletedAt) throw new ValidationError("User is not suspended");

    await this.users.reactivate(actor.tenantId, id);
    const after = await this.users.getById(actor.tenantId, id);
    if (!after) throw new NotFoundError("User", id);

    // F-B8-06: rights lost because a role was disabled while the user was suspended.
    const lost = this.roleService ? await this.roleService.listLostRoles(actor.tenantId, id) : [];
    const lostRoles: LostRole[] = lost.map((r) => ({ id: r.id, name: r.name, permissions: r.permissions }));

    await this.audit.record({
      tenantId: actor.tenantId,
      userId: actor.userId,
      entityType: "User",
      entityId: id,
      action: "UPDATE",
      oldValue: before,
      newValue: lostRoles.length > 0 ? { ...after, lostRoles: lostRoles.map((r) => r.name) } : after,
      reason: null,
      requestId,
    });

    if (lostRoles.length > 0) {
      await this.notifications?.record({
        tenantId: actor.tenantId,
        recipientUserId: id,
        resourceType: "MANAGEMENT",
        eventType: "RIGHTS_LOST_ON_REACTIVATION",
        message: `Des droits ont été perdus pendant la suspension (rôles désactivés : ${lostRoles.map((r) => r.name).join(", ")}).`.slice(0, 1500),
        triggeredBy: actor.userId,
        requestId,
      });
    }

    return { ...after, lostRoles };
  }

  /**
   * Architect audit (2026-09-30): a departmentId, if given, must belong
   * to the caller's tenant. Unlike a repository that's simply unused for
   * a call, a missing DepartmentRepository here does NOT silently skip
   * validation when a departmentId was actually supplied — same
   * reasoning as RiskService.assertProcessExists (DIV-05): it's only
   * safe to no-op when the caller didn't ask to set departmentId at all.
   */
  private async assertDepartmentExists(tenantId: string, departmentId: string | null | undefined): Promise<void> {
    if (departmentId === undefined || departmentId === null) return;
    if (!this.departments) {
      throw new ValidationError("User department validation is not available: DepartmentRepository is not configured");
    }
    const department = await this.departments.getById(tenantId, departmentId);
    if (!department) throw new ValidationError(`Department ${departmentId} does not exist in this tenant`);
  }
}
