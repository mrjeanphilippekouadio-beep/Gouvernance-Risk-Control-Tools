import { apiRequest } from "./client";

export interface DepartmentSummary {
  id: string;
  name: string;
  entity: string | null;
  active: boolean;
}

/**
 * GET /api/v1/departments requires "department.read" — not every Risk
 * Owner carries it. Callers should treat a 403 here as "no directory
 * available" and fall back to showing the raw department id (same posture
 * as usersApi), never as a fatal error.
 */
export const departmentsApi = {
  list: (token: string) => apiRequest<DepartmentSummary[]>("/api/v1/departments", { token }),
};
