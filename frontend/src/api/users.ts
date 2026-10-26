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
export const usersApi = {
  list: (token: string) => apiRequest<UserSummary[]>("/api/v1/users", { token }),
  /** The caller's own effective permissions (lot F4): used only to hide actions, the server still decides. */
  myPermissions: (token: string) => apiRequest<string[]>("/api/v1/users/me/permissions", { token }),
  /** Active accounts a designation right may name (user.read, process.responsibility.assign or designation.manage). */
  directory: (token: string) => apiRequest<DirectoryEntry[]>("/api/v1/users/directory", { token }),
  listAdmin: (token: string, includeSuspended: boolean) =>
    apiRequest<AdminUser[]>(`/api/v1/users?limit=100${includeSuspended ? "&includeSuspended=true" : ""}`, { token }),
  create: (token: string, body: CreateUserInput) => apiRequest<AdminUser>("/api/v1/users", { method: "POST", body, token }),
  update: (token: string, id: string, body: { displayName?: string; departmentId?: string | null }) =>
    apiRequest<AdminUser>(`/api/v1/users/${id}`, { method: "PUT", body, token }),
  suspend: (token: string, id: string) => apiRequest<{ status: "SUSPENDED" }>(`/api/v1/users/${id}/suspend`, { method: "PATCH", token }),
  reactivate: (token: string, id: string) => apiRequest<AdminUser>(`/api/v1/users/${id}/reactivate`, { method: "PATCH", token }),
};
