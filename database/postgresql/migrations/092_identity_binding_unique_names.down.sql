-- Rollback de 092 : retire les deux index d'unicité (nom de client, premier import) et les colonnes d'identité de users
-- (perte des liaisons compte <-> identifiant fournisseur : chaque compte se relie de nouveau à sa prochaine connexion).
-- Rejouable. Le fichier gère sa transaction : `psql -v ON_ERROR_STOP=1 -f` (sans -1).
BEGIN;

DROP INDEX IF EXISTS audit_log_risk_import_once_uq;
DROP INDEX IF EXISTS tenants_name_normalized_uq;
DROP INDEX IF EXISTS users_identity_uq;
ALTER TABLE users DROP CONSTRAINT IF EXISTS users_identity_pair_check;
ALTER TABLE users DROP COLUMN IF EXISTS identity_subject;
ALTER TABLE users DROP COLUMN IF EXISTS identity_provider;

DELETE FROM schema_migrations WHERE filename = '092_identity_binding_unique_names.sql';
COMMIT;
