-- User feedback / recommendations, submitted from anywhere in the app
-- (V0 needed a way to hear from early users). Ticket lifecycle like
-- anomalies: the original submission is immutable, only `status` moves.

CREATE TABLE feedback (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   uuid NOT NULL REFERENCES tenants (id),
  user_id     uuid NOT NULL REFERENCES users (id),
  category    text NOT NULL CHECK (category IN ('BUG', 'IDEA', 'RECOMMENDATION', 'OTHER')),
  message     text NOT NULL,
  page        text,
  status      text NOT NULL DEFAULT 'NEW'
                CHECK (status IN ('NEW', 'ACKNOWLEDGED', 'IN_PROGRESS', 'RESOLVED', 'DECLINED')),
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX feedback_tenant_status_idx ON feedback (tenant_id, status, created_at DESC);
