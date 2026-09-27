import type { UserRepository } from "../domain/repositories/UserRepository.js";
import type { AuditRepository } from "../domain/repositories/AuditRepository.js";
import type { UpdateUserInput, User } from "../domain/entities/User.js";
import { ForbiddenError, NotFoundError, ValidationError } from "../domain/errors/DomainErrors.js";
import { requirePermission } from "../domain/permissions.js";
import type { AuthenticatedUser } from "../infrastructure/identity/IdentityProvider.js";
import type { RoleService } from "./RoleService.js";

export interface CreateUserWithRoleInput {
  email: string;
  displayName: string;
  /** ACT-100: "rôle initial obligatoire" — an RBAC Role id (RoleService/roles table), not a legacy `users.roles` string. */
  roleId: string;
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
    if (!input.email.trim()) throw new ValidationError("email is required");
    if (!input.displayName.trim()) throw new ValidationError("displayName is required");
    if (!input.roleId?.trim()) throw new ValidationError("An initial role is required");
    if (!this.roleService) {
      throw new ValidationError("Role assignment is not configured — cannot create a user without an initial role");
    }

    const user = await this.users.create({
      tenantId: actor.tenantId,
      email: input.email.trim().toLowerCase(),
      displayName: input.displayName.trim(),
    });

    // Not wrapped in a DB transaction with the insert above — no
    // repository in this codebase exposes cross-repository transactions
    // (DepartmentService.create/audit.record has the same gap). If this
    // throws (unknown roleId, or the actor lacks role.assign/role.read),
    // the user row already exists without a role; the caller sees the
    // error and can retry the assignment via RoleService directly.
    await this.roleService.assignToUser(actor, input.roleId, user.id, requestId);

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
  async reactivate(actor: AuthenticatedUser, id: string, requestId: string): Promise<User> {
    requirePermission(actor, "user.reactivate");
    const before = await this.users.getById(actor.tenantId, id);
    if (!before) throw new NotFoundError("User", id);
    if (!before.deletedAt) throw new ValidationError("User is not suspended");

    await this.users.reactivate(actor.tenantId, id);
    const after = await this.users.getById(actor.tenantId, id);
    if (!after) throw new NotFoundError("User", id);

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
}
