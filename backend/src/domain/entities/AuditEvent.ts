import type { VisibilityReason } from "./VisibilityReason.js";

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
  /**
   * Conservation L2a (096): reference of the reason stored in `visibility_reasons` (null = none). Read side: `reason` then holds
   * the joined text, or the « motif effacé » wording; write side: `reason` stays null for a visibility reason.
   */
  reasonRef?: string | null;
  /** Write side only: a visibility reason to store with this event (text in `visibility_reasons`, reference in the journal). */
  visibilityReason?: VisibilityReason;
}
