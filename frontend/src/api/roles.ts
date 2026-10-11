import { apiRequest } from "./client";

export interface Role {
  id: string;
  name: string;
  description: string | null;
  permissions: string[];
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
}

export interface CreateRoleInput {
  name: string;
  description?: string;
  permissions: string[];
}

export interface Grantors {
  permission: string;
  grantors: { displayName: string }[];
}

export const rolesApi = {
  grantors: (token: string, permission: string) =>
    apiRequest<Grantors>(`/api/v1/roles/grantors?permission=${encodeURIComponent(permission)}`, { token }),

  list: (token: string, includeDisabled = false) =>
    apiRequest<Role[]>(`/api/v1/roles${includeDisabled ? "?includeDisabled=true" : ""}`, { token }),

  create: (token: string, input: CreateRoleInput) =>
    apiRequest<Role>("/api/v1/roles", { method: "POST", body: input, token }),

  disable: (token: string, id: string) =>
    apiRequest<void>(`/api/v1/roles/${id}/disable`, { method: "POST", token }),

  assign: (token: string, id: string, userId: string) =>
    apiRequest<void>(`/api/v1/roles/${id}/assign`, { method: "POST", body: { userId }, token }),

  revoke: (token: string, id: string, userId: string) =>
    apiRequest<void>(`/api/v1/roles/${id}/revoke`, { method: "POST", body: { userId }, token }),
};
