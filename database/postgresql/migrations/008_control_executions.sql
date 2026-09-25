-- Mirrors apps-script-legacy R04_EXECUTIONS_CONTROLES (12_Executions.gs):
-- append-only, one row per occurrence — never updated except by the
-- maker-checker validation step (validated_by/validated_at), same rule
-- as evaluations in 20_Validation.

CREATE TABLE control_executions (
  id                          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id                   uuid NOT NULL REFERENCES tenants (id),
  control_id                  uuid NOT NULL REFERENCES controls (id),
  planned_date                date,
  completed_date              timestamptz,
  executed_by                 uuid NOT NULL REFERENCES users (id),
  result                      text,
  observed_anomalies          text,
  justification_if_not_done   text,
  status                      text NOT NULL
                                CHECK (status IN ('DONE', 'NOT_DONE', 'NOT_APPLICABLE')),
  validated_by                uuid REFERENCES users (id),
  validated_at                timestamptz,
  created_at                  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX control_executions_control_idx ON control_executions (control_id, created_at DESC);
CREATE INDEX control_executions_tenant_status_idx ON control_executions (tenant_id, status);

-- Now that control_executions exists, constrain the loose reference left
-- on evidences (migration 003) — an evidence must point at a real
-- execution within the same tenant.
ALTER TABLE evidences
  ADD CONSTRAINT evidences_control_execution_fkey
  FOREIGN KEY (control_execution_id) REFERENCES control_executions (id);
