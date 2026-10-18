-- Annule 072 : supprime la table des demandes (perte des demandes en cours/historiques ; les lignes d'audit_log restent)
-- et retire config.selfvalidation.approve de tous les rôles et utilisateurs.
-- Le fichier gère sa transaction : `psql -v ON_ERROR_STOP=1 -f` (sans -1).
BEGIN;

UPDATE roles
SET permissions = array_remove(permissions, 'config.selfvalidation.approve')
WHERE 'config.selfvalidation.approve' = ANY(permissions);
UPDATE users
SET roles = array_remove(roles, 'config.selfvalidation.approve')
WHERE 'config.selfvalidation.approve' = ANY(roles);

DROP TABLE IF EXISTS self_validation_policy_requests;

DELETE FROM schema_migrations WHERE filename = '072_self_validation_policy_requests.sql';
COMMIT;
