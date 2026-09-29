import { apiRequest } from "./client";

export interface UserSummary {
  id: string;
  email: string;
  displayName: string;
}

/**
 * GET /api/v1/users requires the "user.read" admin permission — most
 * actors assigning RACI roles won't have it. Callers should treat a 403
 * here as "no directory available" and fall back to a raw user id input
 * (see RaciPanel), not as a fatal error.
 */
export const usersApi = {
  list: (token: string) => apiRequest<UserSummary[]>("/api/v1/users", { token }),
};
