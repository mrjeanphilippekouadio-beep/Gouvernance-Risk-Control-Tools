-- Mirrors apps-script-legacy R_ANOMALIES (14_Anomalies.gs). Unlike
-- control_executions/control_effectiveness_assessments, an anomaly is
-- NOT append-only: it's a ticket with a lifecycle carried on the same
-- row (NEW -> UNDER_ANALYSIS -> ACTION_IN_PROGRESS -> CLOSED), and the
-- transition rules live in AnomalyService, not here.

CREATE TABLE anomalies (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id             uuid NOT NULL REFERENCES tenants (id),
  control_id            uuid REFERENCES controls (id),
  control_execution_id  uuid REFERENCES control_executions (id),
  risk_id               uuid REFERENCES risks (id),
  observed_at           timestamptz NOT NULL DEFAULT now(),
  description           text NOT NULL,
  severity              text NOT NULL
                          CHECK (severity IN ('LOW', 'MODERATE', 'HIGH', 'MAJOR', 'CRITICAL')),
  origin                text,
  detected_by           uuid NOT NULL REFERENCES users (id),
  status                text NOT NULL DEFAULT 'NEW'
                          CHECK (status IN ('NEW', 'UNDER_ANALYSIS', 'ACTION_IN_PROGRESS', 'CLOSED')),
  associated_actions    text,
  closed_at             timestamptz,
  closure_comment       text,
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX anomalies_tenant_status_idx ON anomalies (tenant_id, status);
CREATE INDEX anomalies_control_idx ON anomalies (control_id);
CREATE INDEX anomalies_risk_idx ON anomalies (risk_id);
