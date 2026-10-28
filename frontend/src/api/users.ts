import { apiRequest } from "./client";

export interface UserSummary {
  id: string;
  email: string;
  displayName: string;
}

/** One entry of the account picker: id and name only (lot F4, GET /users/directory). */
export interface DirectoryEntry {
  id: string;
  displayName: string;
}

/** A user as the admin directory (user.read) returns it; `deletedAt` set = suspended. */
export interface AdminUser extends UserSummary {
  roles: string[];
  departmentId: string | null;
  createdAt: string;
  deletedAt: string | null;
}

export interface CreateUserInput {
  email: string;
  displayName: string;
  roleId: string;
  departmentId?: string | null;
  reason?: string;
}

/**
 * GET /api/v1/users requires the "user.read" admin permission — most
 * actors assigning RACI roles won't have it. Callers should treat a 403
 * here as "no directory available" and fall back to a raw user id input
 * (see RaciPanel), not as a fatal error.
 */
export const ADMIN_PAGE_SIZE = 100;
/** Server cap of GET /users/directory (UserService MAX_DIRECTORY): a full list may be truncated. */
export const DIRECTORY_LIMIT = 500;

export const usersApi = {
  list: (token: string) => apiRequest<UserSummary[]>("/api/v1/users", { token }),
  /** The caller's own account (no permission needed, tenant-scoped). */
  me: (token: string) => apiRequest<UserSummary>("/api/v1/users/me", { token }),
  /** The caller's own effective permissions (lot F4): used only to hide actions, the server still decides. */
  myPermissions: (token: string) => apiRequest<string[]>("/api/v1/users/me/permissions", { token }),
  /** Active accounts a designation right may name (user.read, process.responsibility.assign, designation.manage or audit.mission.create). */
  directory: (token: string) => apiRequest<DirectoryEntry[]>("/api/v1/users/directory", { token }),
  listAdmin: (token: string, includeSuspended: boolean, offset: number) =>
    apiRequest<AdminUser[]>(`/api/v1/users?limit=${ADMIN_PAGE_SIZE}&offset=${offset}${includeSuspended ? "&includeSuspended=true" : ""}`, { token }),
  create: (token: string, body: CreateUserInput) => apiRequest<AdminUser>("/api/v1/users", { method: "POST", body, token }),
  update: (token: string, id: string, body: { displayName?: string; departmentId?: string | null }) =>
    apiRequest<AdminUser>(`/api/v1/users/${id}`, { method: "PUT", body, token }),
  /** q177: the reason is mandatory, checked again by the server and kept in the audit trail. */
  suspend: (token: string, id: string, reason: string) =>
    apiRequest<{ status: "SUSPENDED" }>(`/api/v1/users/${id}/suspend`, { method: "PATCH", body: { reason }, token }),
  reactivate: (token: string, id: string, reason: string) =>
    apiRequest<AdminUser>(`/api/v1/users/${id}/reactivate`, { method: "PATCH", body: { reason }, token }),
};
