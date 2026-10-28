-- Rollback of 079_sensitive_view_grants.sql (perte des attributions de `role.read.sensitive` : le Risk Manager revient
-- aux seules lignes 1 et 2 ; les lignes d'audit_log restent).
-- Le fichier gère sa transaction : `psql -v ON_ERROR_STOP=1 -f` (sans -1).
BEGIN;

DROP TABLE IF EXISTS sensitive_view_grants;
DROP FUNCTION IF EXISTS sensitive_view_grants_guard();
DROP FUNCTION IF EXISTS sensitive_view_grants_truncate_guard();

DELETE FROM schema_migrations WHERE filename = '079_sensitive_view_grants.sql';

COMMIT;
