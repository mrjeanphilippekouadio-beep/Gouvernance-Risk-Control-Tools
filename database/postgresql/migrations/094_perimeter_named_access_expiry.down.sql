-- Rollback of 094_perimeter_named_access_expiry.sql. Aucune donnée touchée : les échéances posées ne sont pas retirées (la garde
-- 087 interdit de retirer une échéance, et on ne sait plus lesquelles venaient de 094 ; garder une échéance est la solution la
-- plus restrictive). Seule la ligne du suivi des migrations est retirée. Le fichier gère sa transaction : `psql -v ON_ERROR_STOP=1 -f`.
BEGIN;

DELETE FROM schema_migrations WHERE filename = '094_perimeter_named_access_expiry.sql';

COMMIT;
