-- Rollback de 085 : retire tenants.governance_tracking_started_at (le panel D6 ne peut plus dire depuis quand il suit).
-- Le fichier gère sa transaction : `psql -v ON_ERROR_STOP=1 -f` (sans -1).
BEGIN;

ALTER TABLE tenants DROP COLUMN IF EXISTS governance_tracking_started_at;

DELETE FROM schema_migrations WHERE filename = '085_governance_tracking.sql';
COMMIT;
