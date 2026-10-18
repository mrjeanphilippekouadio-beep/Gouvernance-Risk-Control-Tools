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
  | "PERMISSION_CHANGE"
  | "DOWNLOAD"
  | "READ";

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
  /**
   * DECISION-074: id of the governance rule bypassed ("executed without a second validation"). Absent/null =
   * ordinary action. Written at INSERT only. Optional so existing test doubles keep compiling.
   */
  governanceException?: string | null;
}
