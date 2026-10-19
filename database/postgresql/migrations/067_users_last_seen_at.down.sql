-- Rollback de 067 : retire users.last_seen_at (perte des dates de dernière connexion).
-- Le fichier gère sa transaction : `psql -v ON_ERROR_STOP=1 -f` (sans -1).
BEGIN;

ALTER TABLE users DROP COLUMN IF EXISTS last_seen_at;

DELETE FROM schema_migrations WHERE filename = '067_users_last_seen_at.sql';
COMMIT;
