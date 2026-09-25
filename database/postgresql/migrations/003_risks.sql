CREATE TABLE risks (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id             uuid NOT NULL REFERENCES tenants (id),
  process               text NOT NULL,
  description           text NOT NULL,
  owner_department_id   uuid REFERENCES departments (id),
  status                text NOT NULL DEFAULT 'DRAFT'
                          CHECK (status IN ('DRAFT', 'ACTIVE', 'ARCHIVED')),
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now(),
  -- Soft delete only — a GRC must be able to explain "why doesn't this
  -- risk exist anymore" (ADR-001 §"pas de suppression physique").
  deleted_at            timestamptz,
  deleted_by            uuid REFERENCES users (id),
  deletion_reason       text
);

-- Versioned, effective-dated cotations. A Risk's score is never
-- overwritten in place — see ADR-001 §"Versionner le modèle métier".
CREATE TABLE risk_assessments (
  id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id               uuid NOT NULL REFERENCES tenants (id),
  risk_id                 uuid NOT NULL REFERENCES risks (id),
  version                 integer NOT NULL,
  probability             integer NOT NULL CHECK (probability BETWEEN 1 AND 5),
  impact                  integer NOT NULL CHECK (impact BETWEEN 1 AND 5),
  inherent_score          integer NOT NULL,
  residual_probability    integer CHECK (residual_probability BETWEEN 1 AND 5),
  residual_impact         integer CHECK (residual_impact BETWEEN 1 AND 5),
  residual_score          integer,
  scoring_config_version  text NOT NULL,
  effective_from          timestamptz NOT NULL,
  effective_until         timestamptz,
  created_by              uuid NOT NULL REFERENCES users (id),
  created_at              timestamptz NOT NULL DEFAULT now(),
  UNIQUE (risk_id, version)
);

-- Evidence lives on Google Drive; only the reference is stored here
-- (ADR-001 §1 "séparation données métier / documents").
CREATE TABLE evidences (
  id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id               uuid NOT NULL REFERENCES tenants (id),
  control_execution_id    uuid,
  file_name               text NOT NULL,
  drive_file_id           text NOT NULL,
  drive_url               text NOT NULL,
  document_type           text NOT NULL,
  uploaded_by             uuid NOT NULL REFERENCES users (id),
  uploaded_at             timestamptz NOT NULL DEFAULT now(),
  version                 integer NOT NULL DEFAULT 1,
  status                  text NOT NULL DEFAULT 'ACTIVE'
);
