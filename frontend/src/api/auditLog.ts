import { apiRequest } from "./client";

export type AuditAction =
  | "CREATE" | "UPDATE" | "DELETE" | "SUBMIT" | "VALIDATE" | "REJECT" | "APPROVE" | "CLOSE"
  | "REOPEN" | "ASSIGN" | "UNASSIGN" | "ESCALATE" | "STATUS_CHANGE" | "ROLE_CHANGE" | "PERMISSION_CHANGE" | "DOWNLOAD" | "READ";

export interface AuditEvent {
  id: string;
  tenantId: string;
  timestamp: string;
  userId: string;
  entityType: string;
  entityId: string;
  action: AuditAction;
  oldValue: unknown;
  newValue: unknown;
  reason: string | null;
  requestId: string;
}

export interface AuditLogFilters {
  userId?: string;
  action?: AuditAction;
  entityType?: string;
  entityId?: string;
  /** ISO date-time strings. */
  from?: string;
  to?: string;
  limit?: number;
}

/** Read-only: the journal is append-only, the API exposes no write route. */
export const auditLogApi = {
  list: (token: string, filters: AuditLogFilters = {}) => {
    const query = new URLSearchParams();
    for (const [key, value] of Object.entries(filters)) {
      if (value !== undefined && value !== "") query.set(key, String(value));
    }
    const suffix = query.size ? `?${query.toString()}` : "";
    return apiRequest<AuditEvent[]>(`/api/v1/audit-log${suffix}`, { token });
  },
};
