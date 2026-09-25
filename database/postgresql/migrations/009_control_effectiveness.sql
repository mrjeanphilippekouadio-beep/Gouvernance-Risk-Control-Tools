-- Mirrors apps-script-legacy R06_EVALUATIONS_CONTROLES (13_Efficacite.gs):
-- append-only like control_executions, but answers a different question
-- — not "was the control performed?" (control_executions) but "is the
-- control well-designed and actually effective at mitigating the risk?"
-- Same maker-checker validation circuit as control_executions.

CREATE TABLE control_effectiveness_assessments (
  id                          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id                   uuid NOT NULL REFERENCES tenants (id),
  control_id                  uuid NOT NULL REFERENCES controls (id),
  eval_date                   timestamptz NOT NULL DEFAULT now(),
  eval_type                   text,
  evaluated_by                uuid NOT NULL REFERENCES users (id),
  design_adequacy             text,
  execution_quality           text,
  operational_effectiveness   text NOT NULL
                                CHECK (operational_effectiveness IN ('EFFECTIVE', 'PARTIALLY_EFFECTIVE', 'INEFFECTIVE')),
  result                      text
                                CHECK (result IN ('EFFECTIVE', 'PARTIALLY_EFFECTIVE', 'INEFFECTIVE', 'INCONCLUSIVE')),
  limitations                 text,
  compensating_controls       text,
  conclusion                  text,
  justification               text NOT NULL,
  control_version_snapshot    text,
  status                      text NOT NULL DEFAULT 'COMPLETED'
                                CHECK (status IN ('COMPLETED', 'PROVISIONAL', 'VALIDATED')),
  validated_by                uuid REFERENCES users (id),
  validated_at                timestamptz,
  created_at                  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX control_effectiveness_control_idx ON control_effectiveness_assessments (control_id, created_at DESC);
CREATE INDEX control_effectiveness_tenant_result_idx ON control_effectiveness_assessments (tenant_id, operational_effectiveness);
