-- Rollback of 080_resource_visibility.sql (perte des accès accordés et des niveaux de visibilité ; les lignes
-- d'audit_log restent). Le fichier gère sa transaction : `psql -v ON_ERROR_STOP=1 -f` (sans -1).
BEGIN;

DROP TABLE IF EXISTS resource_access_grants;
DROP FUNCTION IF EXISTS resource_access_grants_guard();
DROP FUNCTION IF EXISTS resource_access_grants_truncate_guard();

ALTER TABLE risks        DROP COLUMN IF EXISTS visibility;
ALTER TABLE controls     DROP COLUMN IF EXISTS visibility;
ALTER TABLE anomalies    DROP COLUMN IF EXISTS visibility;
ALTER TABLE action_plans DROP COLUMN IF EXISTS visibility;
ALTER TABLE kpis         DROP COLUMN IF EXISTS visibility;

DELETE FROM schema_migrations WHERE filename = '080_resource_visibility.sql';

COMMIT;
