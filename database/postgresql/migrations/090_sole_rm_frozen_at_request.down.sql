-- Rollback of 090_sole_rm_frozen_at_request.sql. Rejouable. Remet le CHECK de forme de 089 et retire la colonne.
-- Le fichier gère sa transaction : `psql -v ON_ERROR_STOP=1 -f`.
BEGIN;

ALTER TABLE risk_framework_change_requests DROP CONSTRAINT IF EXISTS risk_framework_change_requests_sole_rm_shape_check;
ALTER TABLE risk_framework_change_requests ADD CONSTRAINT risk_framework_change_requests_sole_rm_shape_check
  CHECK (decision_regime IS DISTINCT FROM 'SOLE_RM' OR (
    kind = 'ASSIGN_PROCESS' AND status = 'APPROVED' AND decided_by = requested_by
    AND decider_group = 'RISK_MANAGER' AND ratification_status IS NULL AND fallback_cause IS NULL
    AND bootstrap_justification IS NULL AND decision_comment IS NOT NULL AND length(btrim(decision_comment)) > 0
  ));
ALTER TABLE risk_framework_change_requests DROP COLUMN IF EXISTS sole_rm_at_request;

DELETE FROM schema_migrations WHERE filename = '090_sole_rm_frozen_at_request.sql';

COMMIT;
