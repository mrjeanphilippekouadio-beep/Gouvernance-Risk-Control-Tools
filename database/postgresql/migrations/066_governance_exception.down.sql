-- Rollback de 066 : retire les permissions, la colonne configs.self_validation_policy et la colonne
-- audit_log.governance_exception avec ses 2 index.
-- Perte de données : les marqueurs « sans seconde validation » et les choix self_validation_policy posés depuis 066.
-- Les permissions retirées le sont pour TOUS les rôles/utilisateurs (y compris un octroi manuel postérieur à 066).
-- Le fichier gère sa transaction : `psql -v ON_ERROR_STOP=1 -f` (sans -1).
BEGIN;

UPDATE roles
SET permissions = array_remove(array_remove(permissions, 'governancehealth.read'), 'config.selfvalidation.set')
WHERE permissions && ARRAY['governancehealth.read', 'config.selfvalidation.set']::text[];
UPDATE users
SET roles = array_remove(array_remove(roles, 'governancehealth.read'), 'config.selfvalidation.set')
WHERE roles && ARRAY['governancehealth.read', 'config.selfvalidation.set']::text[];

ALTER TABLE configs DROP CONSTRAINT IF EXISTS configs_self_validation_policy_check;
ALTER TABLE configs DROP COLUMN IF EXISTS self_validation_policy;

DROP INDEX IF EXISTS audit_log_governance_exception_entity_idx;
DROP INDEX IF EXISTS audit_log_governance_exception_idx;
ALTER TABLE audit_log DROP COLUMN IF EXISTS governance_exception;

DELETE FROM schema_migrations WHERE filename = '066_governance_exception.sql';
COMMIT;
