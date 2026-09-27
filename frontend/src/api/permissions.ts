import { apiRequest } from "./client";

export const permissionsApi = {
  list: (token: string) => apiRequest<string[]>("/api/v1/permissions", { token }),
};
