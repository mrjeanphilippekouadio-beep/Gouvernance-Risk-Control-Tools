export type AuditAction =
  | "CREATE"
  | "UPDATE"
  | "DELETE"
  | "SUBMIT"
  | "VALIDATE"
  | "REJECT"
  | "APPROVE"
  | "CLOSE"
  | "REOPEN"
  | "ASSIGN"
  | "UNASSIGN"
  | "ESCALATE"
  | "STATUS_CHANGE"
  | "ROLE_CHANGE"
  | "PERMISSION_CHANGE";

export interface AuditEvent {
  id: string;
  tenantId: string;
  timestamp: Date;
  userId: string;
  entityType: string;
  entityId: string;
  action: AuditAction;
  oldValue: unknown;
  newValue: unknown;
  reason: string | null;
  requestId: string;
}
