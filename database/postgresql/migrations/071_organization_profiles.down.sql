-- Rollback de 071 : retire les permissions orgprofile.*, la table organization_profiles et ses fonctions de garde.
-- Perte de données : toutes les versions du profil d'organisation (réponses, auteurs, décisions) sont supprimées. Plus sûr
-- avant toute utilisation ; après, exporter la table d'abord. Les entrées d'audit_log (entity_type OrganizationProfile)
-- restent (journal append-only).
-- Les permissions retirées le sont pour TOUS les rôles/utilisateurs (y compris un octroi manuel postérieur à 071).
-- Le fichier gère sa transaction : `psql -v ON_ERROR_STOP=1 -f` (sans -1).
BEGIN;

UPDATE roles
SET permissions = array_remove(array_remove(array_remove(permissions, 'orgprofile.read'), 'orgprofile.submit'), 'orgprofile.approve')
WHERE permissions && ARRAY['orgprofile.read', 'orgprofile.submit', 'orgprofile.approve']::text[];
UPDATE users
SET roles = array_remove(array_remove(array_remove(roles, 'orgprofile.read'), 'orgprofile.submit'), 'orgprofile.approve')
WHERE roles && ARRAY['orgprofile.read', 'orgprofile.submit', 'orgprofile.approve']::text[];

DROP TRIGGER IF EXISTS organization_profiles_truncate_guard ON organization_profiles;
DROP TRIGGER IF EXISTS organization_profiles_guard ON organization_profiles;
DROP TABLE IF EXISTS organization_profiles;
DROP FUNCTION IF EXISTS organization_profiles_truncate_guard();
DROP FUNCTION IF EXISTS organization_profiles_guard();

DELETE FROM schema_migrations WHERE filename = '071_organization_profiles.sql';
COMMIT;
