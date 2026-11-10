-- Rollback of 088_process_framework_guard.sql (SEC-B6C-03).
-- Retire les deux triggers et leurs fonctions. Aucune donnée supprimée ou modifiée.
-- Le fichier gère sa transaction : l'exécuter avec `psql -v ON_ERROR_STOP=1 -f` (sans -1).
BEGIN;

DROP TRIGGER IF EXISTS processes_framework_guard ON processes;
DROP TRIGGER IF EXISTS risk_framework_assign_tenant_guard ON risk_framework_change_requests;
DROP FUNCTION IF EXISTS processes_framework_guard();
DROP FUNCTION IF EXISTS risk_framework_assign_tenant_guard();

DELETE FROM schema_migrations WHERE filename = '088_process_framework_guard.sql';

COMMIT;
