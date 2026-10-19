-- Rollback de 073 : retire les permissions du lot D5, les tables governance_exception_reviews et
-- governance_principle_acceptances et leurs fonctions de garde.
-- Perte de données : toutes les revues / contestations et toutes les acceptations de principes sont supprimées. Plus sûr
-- avant toute utilisation ; après, exporter les tables d'abord. Les entrées d'audit_log (GovernanceExceptionReview,
-- GovernancePrincipleAcceptance) restent (journal append-only).
-- Les permissions retirées le sont pour TOUS les rôles/utilisateurs (y compris un octroi manuel postérieur à 073).
-- Le fichier gère sa transaction : `psql -v ON_ERROR_STOP=1 -f` (sans -1).
BEGIN;

UPDATE roles
SET permissions = ARRAY(SELECT p FROM unnest(permissions) AS p WHERE p NOT IN (
  'governanceexception.review', 'governanceprinciple.accept', 'governanceprinciple.acceptance.confirm', 'governanceprinciple.acceptance.revoke'))
WHERE permissions && ARRAY[
  'governanceexception.review', 'governanceprinciple.accept', 'governanceprinciple.acceptance.confirm', 'governanceprinciple.acceptance.revoke']::text[];
UPDATE users
SET roles = ARRAY(SELECT p FROM unnest(roles) AS p WHERE p NOT IN (
  'governanceexception.review', 'governanceprinciple.accept', 'governanceprinciple.acceptance.confirm', 'governanceprinciple.acceptance.revoke'))
WHERE roles && ARRAY[
  'governanceexception.review', 'governanceprinciple.accept', 'governanceprinciple.acceptance.confirm', 'governanceprinciple.acceptance.revoke']::text[];

DROP TRIGGER IF EXISTS governance_principle_acceptances_truncate_guard ON governance_principle_acceptances;
DROP TRIGGER IF EXISTS governance_principle_acceptances_guard ON governance_principle_acceptances;
DROP TABLE IF EXISTS governance_principle_acceptances;
DROP FUNCTION IF EXISTS governance_principle_acceptances_truncate_guard();
DROP FUNCTION IF EXISTS governance_principle_acceptances_guard();

DROP TRIGGER IF EXISTS governance_exception_reviews_truncate_guard ON governance_exception_reviews;
DROP TRIGGER IF EXISTS governance_exception_reviews_guard ON governance_exception_reviews;
DROP TABLE IF EXISTS governance_exception_reviews;
DROP FUNCTION IF EXISTS governance_exception_reviews_truncate_guard();
DROP FUNCTION IF EXISTS governance_exception_reviews_guard();

DELETE FROM schema_migrations WHERE filename = '073_governance_reviews_acceptances.sql';
COMMIT;
