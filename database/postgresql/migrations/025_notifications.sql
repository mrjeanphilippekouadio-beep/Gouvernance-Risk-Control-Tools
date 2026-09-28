-- Notification domain (ACT-200/ACT-201/ACT-202). No apps-script-legacy
-- precedent. Two independent tables:
--
--  - notification_subscriptions: updated in place (Department/Process
--    pattern) — one row per (tenant, user, resource_type, event_type),
--    upserted on re-subscribe/unsubscribe.
--  - notifications: append-only (ControlExecution pattern) — a new row per
--    occurrence, the only mutation ever allowed after creation is stamping
--    read_at (see NotificationRepository.markAsRead).
--
-- Numbering note: at the time this file was authored, the latest migration
-- in this repo was 022_action_plans.sql; 025/026 were assigned per the
-- task brief (023/024 reserved for the parallel Dashboard+Reporting/Config
-- batches) to avoid a numbering collision at merge time. If the merged
-- history ends up different, renumber before applying.
--
-- event_type is free text, not a CHECK-constrained enum: the exact
-- taxonomy of event keys (e.g. "KRI_THRESHOLD_BREACH", "ACTION_OVERDUE")
-- is a follow-up integration decision for whoever wires
-- NotificationService.record(...) into KriMeasureService/RiskService/
-- ActionPlanService's existing Notifier call sites — see the design-decision
-- comment in backend/src/domain/entities/Notification.ts.

CREATE TABLE notification_subscriptions (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id      uuid NOT NULL REFERENCES tenants (id),
  user_id        uuid NOT NULL REFERENCES users (id),
  resource_type  text NOT NULL
                   CHECK (resource_type IN ('RISK', 'KRI', 'ACTION_PLAN', 'CONTROL', 'ANOMALY', 'RISK_EVALUATION', 'REVIEW_CYCLE')),
  event_type     text NOT NULL,
  enabled        boolean NOT NULL DEFAULT true,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, user_id, resource_type, event_type)
);

CREATE INDEX notification_subscriptions_tenant_user_idx ON notification_subscriptions (tenant_id, user_id);

CREATE TABLE notifications (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id          uuid NOT NULL REFERENCES tenants (id),
  recipient_user_id  uuid NOT NULL REFERENCES users (id),
  resource_type      text NOT NULL
                       CHECK (resource_type IN ('RISK', 'KRI', 'ACTION_PLAN', 'CONTROL', 'ANOMALY', 'RISK_EVALUATION', 'REVIEW_CYCLE')),
  resource_id        uuid,
  event_type         text NOT NULL,
  message            text NOT NULL,
  sent_at            timestamptz NOT NULL DEFAULT now(),
  -- Null until the recipient marks it read — the only column ever updated
  -- after creation (NotificationRepository.markAsRead).
  read_at            timestamptz
);

CREATE INDEX notifications_tenant_recipient_idx ON notifications (tenant_id, recipient_user_id, sent_at DESC);
CREATE INDEX notifications_tenant_recipient_unread_idx ON notifications (tenant_id, recipient_user_id) WHERE read_at IS NULL;
