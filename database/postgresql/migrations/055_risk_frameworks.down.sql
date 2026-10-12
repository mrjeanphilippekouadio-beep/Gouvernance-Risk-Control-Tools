-- Rollback of 055_risk_frameworks.sql.
-- Atomic: run with `psql -1 -v ON_ERROR_STOP=1 -f`.
-- Destructive: drops the Dispositif tables and every version / request they hold.
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
