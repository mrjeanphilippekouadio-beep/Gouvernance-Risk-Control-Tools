-- Rollback of 060_risk_evaluation_snapshot_guard.sql (F-B6b-02) : retire le trigger, sa fonction, la FK composite et la
-- contrainte UNIQUE (tenant_id, id). Non destructif pour les données ; l'instantané n'est plus gelé que par l'application.
-- Le fichier gère sa transaction : `psql -v ON_ERROR_STOP=1 -f` (sans -1).
BEGIN;

DROP TRIGGER IF EXISTS risk_evaluations_snapshot_guard ON risk_evaluations;
DROP FUNCTION IF EXISTS risk_evaluations_snapshot_guard();
ALTER TABLE risk_evaluations DROP CONSTRAINT IF EXISTS risk_evaluations_framework_version_tenant_fk;
ALTER TABLE risk_framework_versions DROP CONSTRAINT IF EXISTS risk_framework_versions_tenant_id_key;

DELETE FROM schema_migrations WHERE filename = '060_risk_evaluation_snapshot_guard.sql';

COMMIT;
