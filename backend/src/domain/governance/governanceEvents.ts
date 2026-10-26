/**
 * Lot D5: what the governance notifier reads AFTER a request has committed. Read-only, every method tenant-scoped.
 * Rows come from the audit trail of that very request (same request id, same actor): the audit row is the committed
 * fact, so a notification can never describe something that was rolled back.
 */
export interface GovernanceAuditRow {
  id: string;
  userId: string;
  entityType: string;
  entityId: string;
  action: string;
  governanceException: string | null;
  oldValue: unknown;
  newValue: unknown;
  /** For entityType "Role": the fixed group of that role (RISK_MANAGER, RISK_COMMITTEE, AUDIT), else null. */
  systemGroup: string | null;
}

export interface GovernanceEventSource {
  rowsForRequest(tenantId: string, requestId: string, actorId: string): Promise<GovernanceAuditRow[]>;
  /** Active accounts holding a permission, through a role or a direct grant. */
  holdersOf(tenantId: string, permission: string): Promise<string[]>;
  /** Active members of fixed groups (RISK_MANAGER, RISK_COMMITTEE, AUDIT). */
  groupMembers(tenantId: string, groups: string[]): Promise<string[]>;
  /** The designated manager (kind MANAGER), if any and still an active account. */
  managerId(tenantId: string): Promise<string | null>;
  /** Marked exceptions (the Risk Manager vacancy excluded: trace only, q160) with no REVIEWED review yet. */
  unreviewedExceptionCount(tenantId: string): Promise<number>;
}
