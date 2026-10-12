-- Rollback of 055_risk_frameworks.sql.
--
-- !! DESTRUCTIF ET IRRÉVERSIBLE !!
-- Après toute activation réelle, ce down DÉTRUIT l'historique des Dispositifs (versions, demandes de
-- changement, décisions, décideurs) : c'est la piste d'audit réglementaire de la gouvernance du risque.
-- NE JAMAIS l'exécuter hors base jetable sans (1) export préalable (pg_dump des 3 tables
-- risk_frameworks / risk_framework_versions / risk_framework_change_requests) et (2) accord explicite HUMAN.
--
-- Le fichier gère lui-même sa transaction (BEGIN/COMMIT ci-dessous) : l'exécuter avec
-- `psql -v ON_ERROR_STOP=1 -f` (sans -1/--single-transaction, qui imbriquerait un second BEGIN).
BEGIN;

DROP TRIGGER IF EXISTS rating_scales_framework_freeze ON rating_scales;
DROP FUNCTION IF EXISTS rating_scales_framework_freeze();

ALTER TABLE processes DROP CONSTRAINT IF EXISTS processes_risk_framework_level_check;
DROP INDEX IF EXISTS processes_tenant_risk_framework_idx;
ALTER TABLE processes DROP COLUMN IF EXISTS risk_framework_id;

-- Dropping a table drops its triggers; the functions go afterwards.
DROP TABLE IF EXISTS risk_framework_change_requests;
DROP TABLE IF EXISTS risk_framework_versions;
DROP TABLE IF EXISTS risk_frameworks;

DROP FUNCTION IF EXISTS risk_framework_change_requests_guard();
DROP FUNCTION IF EXISTS risk_framework_versions_guard();
DROP FUNCTION IF EXISTS risk_framework_truncate_guard();

UPDATE roles
SET permissions = ARRAY(SELECT p FROM unnest(permissions) AS p WHERE p NOT LIKE 'riskframework.%')
WHERE EXISTS (SELECT 1 FROM unnest(permissions) AS p WHERE p LIKE 'riskframework.%');

DELETE FROM schema_migrations WHERE filename = '055_risk_frameworks.sql';

COMMIT;
