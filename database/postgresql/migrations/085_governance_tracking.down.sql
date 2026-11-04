-- Rollback de 085 : retire tenants.governance_tracking_started_at (le panel D6 ne peut plus dire depuis quand il suit)
-- et configs.last_seen_retention_days (R3 : plus de purge de la « dernière activité »).
-- Le fichier gère sa transaction : `psql -v ON_ERROR_STOP=1 -f` (sans -1).
BEGIN;

ALTER TABLE tenants DROP COLUMN IF EXISTS governance_tracking_started_at;
ALTER TABLE configs DROP COLUMN IF EXISTS last_seen_retention_days;
ALTER TABLE configs DROP COLUMN IF EXISTS dpo_contact;

DELETE FROM schema_migrations WHERE filename = '085_governance_tracking.sql';
COMMIT;
