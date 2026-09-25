-- Mirrors apps-script-legacy R03_MATRICE_CONTROLES (11_Controles.gs),
-- with risquesCouverts normalized into a join table instead of a
-- comma-joined string — a control covers >=1 risk, enforced in
-- ControlService, not here (a DB CHECK can't count join-table rows).

CREATE TABLE controls (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id              uuid NOT NULL REFERENCES tenants (id),
  label                  text NOT NULL,
  objective              text,
  process                text,
  department_id          uuid REFERENCES departments (id),
  procedure_description  text,
  control_type           text NOT NULL
                           CHECK (control_type IN ('PREVENTIVE', 'DETECTIVE', 'CORRECTIVE')),
  nature                 text,
  defense_line           text,
  frequency              text NOT NULL,
  executor               text NOT NULL,
  validator              text,
  expected_evidence      text,
  compliance_criteria    text NOT NULL,
  status                 text NOT NULL DEFAULT 'DRAFT'
                           CHECK (status IN ('DRAFT', 'ACTIVE', 'ARCHIVED')),
  created_at             timestamptz NOT NULL DEFAULT now(),
  updated_at             timestamptz NOT NULL DEFAULT now(),
  deleted_at             timestamptz,
  deleted_by             uuid REFERENCES users (id),
  deletion_reason        text
);

CREATE TABLE control_risks (
  tenant_id   uuid NOT NULL REFERENCES tenants (id),
  control_id  uuid NOT NULL REFERENCES controls (id),
  risk_id     uuid NOT NULL REFERENCES risks (id),
  PRIMARY KEY (control_id, risk_id)
);

CREATE INDEX controls_tenant_status_idx ON controls (tenant_id, status) WHERE deleted_at IS NULL;
CREATE INDEX control_risks_risk_idx ON control_risks (risk_id);
