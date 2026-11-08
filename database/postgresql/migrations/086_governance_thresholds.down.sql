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

-- DECISION-061 : le défaut des nouvelles lignes redevient true (054) ; les lignes existantes ne sont pas touchées.
-- D6B-03 : les lignes configs créées par 086 sont LAISSÉES (aucun marqueur fiable : elles ont pu être modifiées depuis).
-- Sans effet sur le comportement d'avant 086 : elles portent le cumul autorisé (true) et les valeurs par défaut affichées.
ALTER TABLE configs ALTER COLUMN committee_audit_cumul_allowed SET DEFAULT true;

DELETE FROM schema_migrations WHERE filename = '086_governance_thresholds.sql';
COMMIT;
