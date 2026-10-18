-- Rollback de 065 : retire la garde, la FK et la colonne sub_category_id.
-- Perte de données : les rattachements par id posés depuis 065 (le libellé sub_category reste).
-- Le fichier gère sa transaction : `psql -v ON_ERROR_STOP=1 -f` (sans -1).
BEGIN;

DROP TRIGGER IF EXISTS risk_evaluations_sub_category_guard ON risk_evaluations;
DROP FUNCTION IF EXISTS risk_evaluations_sub_category_guard();
ALTER TABLE risk_evaluations DROP CONSTRAINT IF EXISTS risk_evaluations_sub_category_tenant_fk;
ALTER TABLE risk_evaluations DROP COLUMN IF EXISTS sub_category_id;

DELETE FROM schema_migrations WHERE filename = '065_risk_evaluation_sub_category_id.sql';
COMMIT;
