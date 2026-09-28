/**
 * Notification (ACT-201/ACT-202): persistent, append-only record of every
 * message sent through the existing `Notifier` interface
 * (infrastructure/notifications/Notifier.ts). `KriMeasureService` (ACT-135
 * threshold breach), `RiskService` (owner reassignment/escalation) and
 * `ActionPlanService` (ACT-193 overdue) already call `notifier.notify(...)`
 * best-effort today, but nothing persists that a notification happened —
 * flagged as a known gap in `.claude/agent-context/ACTION_ITEMS.md`.
 *
 * This entity is the missing persistent layer: one row per notification
 * occurrence, never mutated except to stamp `readAt` when the recipient
 * reads it (mirrors the append-only + single narrow mutation shape used by
 * ControlExecution/ControlEffectivenessAssessment).
 *
 * Design decision (documented for the orchestrator, not guessed silently):
 * `resourceType` is a fixed, known enum (the domains that already exist in
 * this codebase) but `eventType` is a validated free-text string rather
 * than a fixed enum. The exact taxonomy of event keys the three existing
 * Notifier call sites will eventually pass (e.g. "KRI_THRESHOLD_BREACH",
 * "ACTION_OVERDUE") is a follow-up integration decision for whoever wires
 * `NotificationService.record(...)` into those services — this module
 * intentionally does not lock that in with a CHECK constraint enum, to
 * avoid a migration churn cycle once the real taxonomy is settled.
 */

export type NotificationResourceType =
  | "RISK"
  | "KRI"
  | "ACTION_PLAN"
  | "CONTROL"
  | "ANOMALY"
  | "RISK_EVALUATION"
  | "REVIEW_CYCLE";

export interface Notification {
  id: string;
  tenantId: string;
  recipientUserId: string;
  resourceType: NotificationResourceType;
  /** Null for tenant-wide/broadcast-style notifications not tied to one specific row. */
  resourceId: string | null;
  eventType: string;
  message: string;
  sentAt: Date;
  /** Null until the recipient marks it read — the only mutation ever allowed after creation. */
  readAt: Date | null;
}

export interface CreateNotificationInput {
  tenantId: string;
  recipientUserId: string;
  resourceType: NotificationResourceType;
  resourceId: string | null;
  eventType: string;
  message: string;
}

export interface ListNotificationsOptions {
  resourceType?: NotificationResourceType;
  eventType?: string;
  /** true = only read, false = only unread, undefined = both. */
  read?: boolean;
  limit?: number;
  offset?: number;
}

export interface ListNotificationsResult {
  data: Notification[];
  total: number;
}
