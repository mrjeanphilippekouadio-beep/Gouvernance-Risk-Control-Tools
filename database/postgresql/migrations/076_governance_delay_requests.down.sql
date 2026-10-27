-- Rollback of 076_governance_delay_requests.sql (perte des demandes d'allongement ; les lignes d'audit_log restent).
-- Le fichier gère sa transaction : `psql -v ON_ERROR_STOP=1 -f` (sans -1).
BEGIN;

DROP TABLE IF EXISTS governance_delay_requests;
DROP FUNCTION IF EXISTS governance_delay_requests_guard();
DROP FUNCTION IF EXISTS governance_delay_requests_truncate_guard();

ALTER TABLE configs DROP COLUMN IF EXISTS risk_manager_vacancy_max_days;

DELETE FROM schema_migrations WHERE filename = '076_governance_delay_requests.sql';

COMMIT;
