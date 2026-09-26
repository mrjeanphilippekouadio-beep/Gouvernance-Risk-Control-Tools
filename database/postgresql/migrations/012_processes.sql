-- Mirrors apps-script-legacy R_PROCESSUS (07_Processus.gs): updated in
-- place (like departments), self-referencing hierarchy capped at 3
-- levels (Processus > Sous-processus > Activité). The level-matching
-- rule ("a Sous-processus's parent must be a Processus") lives in
-- ProcessService, not as a DB constraint — it needs to read the parent
-- row, which CHECK constraints can't do.

CREATE TABLE processes (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id           uuid NOT NULL REFERENCES tenants (id),
  parent_id           uuid REFERENCES processes (id),
  level               text NOT NULL CHECK (level IN ('PROCESS', 'SUBPROCESS', 'ACTIVITY')),
  name                text NOT NULL,
  description         text,
  document_type       text CHECK (document_type IN (
                        'CHARTER', 'POLICY', 'PROCEDURES_MANUAL', 'PROCEDURE', 'WORK_INSTRUCTION'
                      )),
  document_reference  text,
  owner               text,
  active              boolean NOT NULL DEFAULT true,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  deleted_at          timestamptz,
  deleted_by          uuid REFERENCES users (id),
  deletion_reason     text
);

CREATE INDEX processes_tenant_parent_idx ON processes (tenant_id, parent_id) WHERE deleted_at IS NULL;
