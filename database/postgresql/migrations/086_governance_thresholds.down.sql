-- Rollback de 086 : retire les seuils réglables du panneau de gouvernance (q233) ; le panneau revient aux parties
-- « non évaluables » faute de seuil.
-- Le fichier gère sa transaction : `psql -v ON_ERROR_STOP=1 -f` (sans -1).
BEGIN;

ALTER TABLE configs DROP COLUMN IF EXISTS gov_rm_risk_share_max_pct;
ALTER TABLE configs DROP COLUMN IF EXISTS gov_max_admins;
ALTER TABLE configs DROP COLUMN IF EXISTS gov_role_max_permissions;
ALTER TABLE configs DROP COLUMN IF EXISTS gov_role_max_families;
ALTER TABLE configs DROP COLUMN IF EXISTS gov_dormant_days;
ALTER TABLE configs DROP COLUMN IF EXISTS gov_owner_creator_share_max_pct;

DELETE FROM schema_migrations WHERE filename = '086_governance_thresholds.sql';
COMMIT;
