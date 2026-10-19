-- Rollback de 074 : retire users.last_token_iat.
-- Le fichier gère sa transaction : `psql -v ON_ERROR_STOP=1 -f` (sans -1).
BEGIN;

ALTER TABLE users DROP COLUMN IF EXISTS last_token_iat;

DELETE FROM schema_migrations WHERE filename = '074_users_last_token_iat.sql';
COMMIT;
