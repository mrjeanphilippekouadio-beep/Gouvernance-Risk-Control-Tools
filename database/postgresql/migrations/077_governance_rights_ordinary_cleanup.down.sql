-- Rollback of 077_governance_rights_ordinary_cleanup.sql : ne restaure PAS les droits retirés (q186 : ils ne doivent
-- plus exister hors groupes fixes). Les valeurs d'avant restent lisibles dans audit_log (request_id 'migration:077') ;
-- le compte technique « Système (migration 077) », suspendu, reste aussi : il est l'auteur de ces lignes d'audit.
-- Le fichier gère sa transaction : `psql -v ON_ERROR_STOP=1 -f` (sans -1).
BEGIN;

DELETE FROM schema_migrations WHERE filename = '077_governance_rights_ordinary_cleanup.sql';

COMMIT;
