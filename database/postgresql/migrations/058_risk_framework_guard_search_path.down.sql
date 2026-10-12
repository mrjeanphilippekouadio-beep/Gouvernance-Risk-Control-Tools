-- Rollback of 058_risk_framework_guard_search_path.sql (F-B6a-11).
-- Retire le search_path fixé des six fonctions de trigger (retour à l'état 055/056/057, vulnérable à F-B6a-11).
-- Aucune donnée touchée. Le fichier gère sa transaction : `psql -v ON_ERROR_STOP=1 -f` (sans -1).
BEGIN;

ALTER FUNCTION risk_framework_truncate_guard() RESET search_path;
ALTER FUNCTION risk_framework_versions_guard() RESET search_path;
ALTER FUNCTION risk_framework_change_requests_guard() RESET search_path;
ALTER FUNCTION rating_scales_framework_freeze() RESET search_path;
ALTER FUNCTION risk_framework_versions_insert_guard() RESET search_path;
ALTER FUNCTION risk_framework_change_requests_insert_guard() RESET search_path;

DELETE FROM schema_migrations WHERE filename = '058_risk_framework_guard_search_path.sql';

COMMIT;
