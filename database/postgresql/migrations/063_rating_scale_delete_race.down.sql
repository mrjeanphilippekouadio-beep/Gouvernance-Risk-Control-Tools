-- Rollback of 063_rating_scale_delete_race.sql. Le fichier gère sa transaction : `psql -v ON_ERROR_STOP=1 -f`.
BEGIN;
DROP TRIGGER IF EXISTS rating_scales_delete_guard ON rating_scales;
DROP FUNCTION IF EXISTS rating_scales_delete_guard();
DROP TRIGGER IF EXISTS risk_framework_versions_scale_alive ON risk_framework_versions;
DROP FUNCTION IF EXISTS risk_framework_versions_scale_alive();
DELETE FROM schema_migrations WHERE filename = '063_rating_scale_delete_race.sql';
COMMIT;
