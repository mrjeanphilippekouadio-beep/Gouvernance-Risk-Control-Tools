-- Rollback de 069 : retire la permission et les trois colonnes de responsabilité de processus.
-- Perte de données : les propriétaires/champions/N-1 désignés depuis 069 (le texte processes.owner n'est pas touché).
-- La permission est retirée pour TOUS les rôles/utilisateurs (y compris un octroi manuel postérieur à 069).
-- Le fichier gère sa transaction : `psql -v ON_ERROR_STOP=1 -f` (sans -1).
BEGIN;

UPDATE roles SET permissions = array_remove(permissions, 'process.responsibility.assign')
WHERE 'process.responsibility.assign' = ANY(permissions);
UPDATE users SET roles = array_remove(roles, 'process.responsibility.assign')
WHERE 'process.responsibility.assign' = ANY(roles);

ALTER TABLE processes DROP COLUMN IF EXISTS deputy_user_id;
ALTER TABLE processes DROP COLUMN IF EXISTS risk_champion_user_id;
ALTER TABLE processes DROP COLUMN IF EXISTS owner_user_id;

DELETE FROM schema_migrations WHERE filename = '069_process_responsibilities.sql';
COMMIT;
