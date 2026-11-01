import type { CreateUserInput, UpdateUserInput, User } from "../entities/User.js";

export interface ListUsersOptions {
  includeSuspended?: boolean;
  limit?: number;
  offset?: number;
}

export interface UserRepository {
  /**
   * Deliberately NOT filtered by `deleted_at` — unlike most other
   * repositories' `getById`. ACT-103 (reactivate) needs to load a
   * currently-suspended user by id (its `deletedAt` will be non-null);
   * callers that only want active users check `user.deletedAt` on the
   * result, same as `getByEmail`/`list` do via `includeSuspended`.
   */
  getById(tenantId: string, id: string): Promise<User | null>;
  getByEmail(tenantId: string, email: string, options?: { includeSuspended?: boolean }): Promise<User | null>;
  list(tenantId: string, options?: ListUsersOptions): Promise<User[]>;
  count(tenantId: string, options?: { includeSuspended?: boolean }): Promise<number>;
  create(input: CreateUserInput): Promise<User>;
  update(tenantId: string, id: string, input: UpdateUserInput): Promise<User>;
  /** ACT-102: soft-delete only — sets `deleted_at`, never a physical DELETE. */
  suspend(tenantId: string, id: string): Promise<void>;
  /** ACT-103: clears `deleted_at`. */
  reactivate(tenantId: string, id: string): Promise<void>;
  /**
   * B-8 bis (q48): active users of the tenant holding `permission` (legacy
   * `users.roles` or an active RBAC role), minus `excludeUserId`. Only id +
   * display name — used by RoleService.listGrantors, nothing else.
   */
  listWithPermission?(tenantId: string, permission: string, excludeUserId: string): Promise<Array<{ id: string; displayName: string }>>;
  /**
   * q205 (DECISION-105): active accounts of the tenant whose display name contains `text` (case-insensitive), filtered
   * in SQL before the limit, ordered by name. Id + display name only.
   */
  searchActive?(tenantId: string, text: string, limit: number): Promise<Array<{ id: string; displayName: string }>>;
}
