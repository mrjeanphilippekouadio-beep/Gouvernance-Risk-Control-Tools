-- Rollback de 070 : supprime governance_designations (PERTE des désignations, y compris les intérims activés) et retire
-- designation.manage des rôles / users.roles. Sûr tant qu'aucune migration ultérieure (D5 : gérant) ne dépend de la table ;
-- le code D2c doit être retiré AVANT (sinon les routes /governance-designations échouent).
-- Le fichier gère sa transaction : `psql -v ON_ERROR_STOP=1 -f` (sans -1).
BEGIN;

UPDATE roles SET permissions = array_remove(permissions, 'designation.manage') WHERE 'designation.manage' = ANY (permissions);
UPDATE users SET roles = array_remove(roles, 'designation.manage') WHERE 'designation.manage' = ANY (roles);

DROP TRIGGER IF EXISTS governance_designations_truncate_guard ON governance_designations;
DROP TRIGGER IF EXISTS governance_designations_guard ON governance_designations;
DROP TABLE IF EXISTS governance_designations;
DROP FUNCTION IF EXISTS governance_designations_truncate_guard();
DROP FUNCTION IF EXISTS governance_designations_guard();

DELETE FROM schema_migrations WHERE filename = '070_governance_designations.sql';
COMMIT;
