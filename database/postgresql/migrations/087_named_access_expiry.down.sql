-- Rollback of 087_named_access_expiry.sql : restaure le garde de 080, `visibility_granted` de 083 et `risk_visible_core`
-- de 084, supprime `visibility_resource_closed`, `visibility_own_level` et la colonne `expires_at`. Les accès qui ne lisent plus
-- (échus, dossier clos, sans échéance sur un NOMINATIF) sont révoqués d'abord (soft) ; les autres restent, sans échéance.
-- Le fichier gère sa transaction : `psql -v ON_ERROR_STOP=1 -f` (sans -1).
BEGIN;

-- SEC-V5-01 : les accès qui ne lisent plus (échus, d'un dossier clos, ou sans échéance sur un dossier NOMINATIF) sont
-- révoqués (soft, garde 087 encore en place) AVANT de restaurer les fonctions, sinon ils redeviendraient permanents.
UPDATE resource_access_grants g SET revoked_at = now(), revoked_by = g.granted_by,
  revoke_reason = 'q225 : échéance ou clôture, rollback 087'
WHERE g.revoked_at IS NULL AND NOT visibility_granted(g.tenant_id, g.resource_type, g.resource_id, g.user_id);

CREATE OR REPLACE FUNCTION risk_visible_core(p_tenant uuid, p_risk uuid, p_user uuid) RETURNS boolean
  LANGUAGE sql STABLE
  SET search_path = pg_catalog, public, pg_temp AS $$
  SELECT EXISTS (
    SELECT 1 FROM risks r
    WHERE r.tenant_id = p_tenant AND r.id = p_risk AND (
      r.visibility = 'CLIENT'
      -- Risk Manager, Comité, Audit : voient tout (spec §4, q191) — appartenance réelle, jamais users.roles.
      OR visibility_sees_everything(p_tenant, p_user)
      OR r.owner_id = p_user
      OR EXISTS (SELECT 1 FROM resource_access_grants g
                 WHERE g.tenant_id = p_tenant AND g.resource_type = 'RISK' AND g.resource_id = r.id
                   AND g.user_id = p_user AND g.revoked_at IS NULL)
      OR (r.visibility = 'PERIMETRE' AND (
            r.superior_owner_id = p_user
            OR EXISTS (SELECT 1 FROM raci_assignments ra
                       WHERE ra.tenant_id = p_tenant AND ra.entity_type = 'RISK' AND ra.entity_id = r.id
                         AND ra.user_id = p_user AND ra.deleted_at IS NULL)
            OR EXISTS (SELECT 1 FROM processes p
                       WHERE p.tenant_id = p_tenant AND p.id = r.process_id AND p.owner_user_id = p_user)
            OR EXISTS (SELECT 1 FROM user_roles ur JOIN roles ro ON ro.id = ur.role_id AND ro.tenant_id = ur.tenant_id
                       WHERE ur.tenant_id = p_tenant AND ur.user_id = p_user AND ur.revoked_at IS NULL
                         AND ro.deleted_at IS NULL AND ro.department_id IS NOT NULL
                         AND ro.department_id = r.owner_department_id)
      ))
    )
  );
$$;
ALTER FUNCTION risk_visible_core(uuid, uuid, uuid) SET search_path = pg_catalog, public, pg_temp;

CREATE OR REPLACE FUNCTION visibility_granted(p_tenant uuid, p_type text, p_id uuid, p_user uuid) RETURNS boolean
  LANGUAGE sql STABLE
  SET search_path = pg_catalog, public, pg_temp AS $$
  SELECT EXISTS (SELECT 1 FROM resource_access_grants g
                 WHERE g.tenant_id = p_tenant AND g.resource_type = p_type AND g.resource_id = p_id
                   AND g.user_id = p_user AND g.revoked_at IS NULL);
$$;
ALTER FUNCTION visibility_granted(uuid, text, uuid, uuid) SET search_path = pg_catalog, public, pg_temp;

DROP FUNCTION IF EXISTS visibility_resource_closed(uuid, text, uuid);
DROP FUNCTION IF EXISTS visibility_own_level(uuid, text, uuid);

CREATE OR REPLACE FUNCTION resource_access_grants_guard() RETURNS trigger LANGUAGE plpgsql
  SET search_path = pg_catalog, public, pg_temp AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'resource_access_grants: rows are never deleted (revoke with revoked_at)' USING ERRCODE = '42501';
  END IF;
  IF TG_OP = 'INSERT' THEN
    IF NEW.revoked_at IS NOT NULL OR NEW.revoked_by IS NOT NULL OR NEW.revoke_reason IS NOT NULL THEN
      RAISE EXCEPTION 'resource_access_grants: an access is inserted active' USING ERRCODE = '42501';
    END IF;
    RETURN NEW;
  END IF;
  IF NEW.id IS DISTINCT FROM OLD.id OR NEW.tenant_id IS DISTINCT FROM OLD.tenant_id
     OR NEW.resource_type IS DISTINCT FROM OLD.resource_type OR NEW.resource_id IS DISTINCT FROM OLD.resource_id
     OR NEW.user_id IS DISTINCT FROM OLD.user_id OR NEW.granted_by IS DISTINCT FROM OLD.granted_by
     OR NEW.granted_at IS DISTINCT FROM OLD.granted_at OR NEW.grant_reason IS DISTINCT FROM OLD.grant_reason THEN
    RAISE EXCEPTION 'resource_access_grants: the content of an access is immutable' USING ERRCODE = '42501';
  END IF;
  IF OLD.revoked_at IS NOT NULL OR NEW.revoked_at IS NULL THEN
    RAISE EXCEPTION 'resource_access_grants: an access is revoked once, never restored' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$$;
ALTER FUNCTION resource_access_grants_guard() SET search_path = pg_catalog, public, pg_temp;

ALTER TABLE resource_access_grants DROP COLUMN IF EXISTS expires_at;

DELETE FROM schema_migrations WHERE filename = '087_named_access_expiry.sql';

COMMIT;
