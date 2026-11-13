-- Rollback of 094_perimeter_named_access_expiry.sql. Les échéances posées ne sont pas retirées (la garde 087 l'interdit, et on ne
-- sait plus lesquelles venaient de 094 ; garder une échéance est la solution la plus restrictive). Remet visibility_granted tel que
-- défini par 087 (un accès sans échéance compte sur tout dossier non NOMINATIF) et retire la ligne du suivi des migrations.
-- Le fichier gère sa transaction : `psql -v ON_ERROR_STOP=1 -f`.
BEGIN;

CREATE OR REPLACE FUNCTION visibility_granted(p_tenant uuid, p_type text, p_id uuid, p_user uuid) RETURNS boolean
  LANGUAGE sql STABLE
  SET search_path = pg_catalog, public, pg_temp AS $$
  SELECT EXISTS (SELECT 1 FROM resource_access_grants g
                 WHERE g.tenant_id = p_tenant AND g.resource_type = p_type AND g.resource_id = p_id
                   AND g.user_id = p_user AND g.revoked_at IS NULL
                   AND (CASE WHEN g.expires_at IS NULL THEN visibility_own_level(p_tenant, p_type, p_id) <> 'NOMINATIF'
                             ELSE g.expires_at > now() AND NOT visibility_resource_closed(p_tenant, p_type, p_id) END));
$$;
ALTER FUNCTION visibility_granted(uuid, text, uuid, uuid) SET search_path = pg_catalog, public, pg_temp;

DELETE FROM schema_migrations WHERE filename = '094_perimeter_named_access_expiry.sql';

COMMIT;
