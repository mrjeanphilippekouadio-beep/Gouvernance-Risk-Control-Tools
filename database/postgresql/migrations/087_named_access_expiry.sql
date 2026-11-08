-- 087 — Visibilité des ressources, lot V5 (q225 A, DECISION-112) : l'accès d'une personne nommée à un dossier
-- « personnes nommées » (niveau NOMINATIF) expire à la clôture du dossier, ou au plus tard 30 jours après l'ajout, et se
-- renouvelle (nouvelle échéance = maintenant + 30 jours, jamais au-delà).
--   resource_access_grants.expires_at   échéance de l'accès. NULL = pas d'échéance (liste d'un dossier PERIMETRE : hors
--                                       q225, inchangé). Posée à l'ajout sur un dossier NOMINATIF ; le garde empêche de
--                                       la repousser au-delà de now() + 30 jours, ou de la retirer une fois posée.
--   visibility_resource_closed          « clôture » par type : RISK et CONTROL = status ARCHIVED ou supprimé logiquement ;
--                                       KPI = supprimé logiquement (archivage, pas de statut) ; ANOMALY = status CLOSED ;
--                                       ACTION_PLAN = status TERMINEE. Ressource introuvable = close (ferme).
--   visibility_granted                  ignore un accès échu, et un accès à échéance dont le dossier est clos. Aucune ligne
--                                       n'est supprimée ni révoquée : c'est la lecture qui retire l'accès.
--   risk_visible_core                   passe par visibility_granted (son EXISTS en ligne ignorait l'échéance).
-- Les accès NOMINATIF existants reçoivent une échéance à 30 jours à compter de cette migration (jamais de révocation
-- immédiate). `search_path` pinné (`pg_temp` en dernier, F-B6a-11) et répété par ALTER FUNCTION sur chaque définition.
-- Idempotente (IF NOT EXISTS / OR REPLACE ; l'UPDATE ne touche que les lignes sans échéance). Jamais à la main : `npm run migrate`.

ALTER TABLE resource_access_grants ADD COLUMN IF NOT EXISTS expires_at timestamptz NULL;

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
    IF NEW.expires_at IS NOT NULL AND NEW.expires_at > now() + interval '30 days' THEN
      RAISE EXCEPTION 'resource_access_grants: an access lasts 30 days at most' USING ERRCODE = '42501';
    END IF;
    RETURN NEW;
  END IF;
  IF NEW.id IS DISTINCT FROM OLD.id OR NEW.tenant_id IS DISTINCT FROM OLD.tenant_id
     OR NEW.resource_type IS DISTINCT FROM OLD.resource_type OR NEW.resource_id IS DISTINCT FROM OLD.resource_id
     OR NEW.user_id IS DISTINCT FROM OLD.user_id OR NEW.granted_by IS DISTINCT FROM OLD.granted_by
     OR NEW.granted_at IS DISTINCT FROM OLD.granted_at OR NEW.grant_reason IS DISTINCT FROM OLD.grant_reason THEN
    RAISE EXCEPTION 'resource_access_grants: the content of an access is immutable' USING ERRCODE = '42501';
  END IF;
  IF OLD.revoked_at IS NOT NULL THEN
    RAISE EXCEPTION 'resource_access_grants: an access is revoked once, never restored' USING ERRCODE = '42501';
  END IF;
  IF NEW.revoked_at IS NULL THEN
    -- Echéance posée ou renouvelée sur un accès vivant : jamais retirée, jamais au-delà de 30 jours.
    IF NEW.expires_at IS NULL OR NEW.expires_at > now() + interval '30 days'
       OR NEW.revoked_by IS NOT NULL OR NEW.revoke_reason IS NOT NULL THEN
      RAISE EXCEPTION 'resource_access_grants: an access is revoked once, never restored; its expiry is never removed nor beyond 30 days' USING ERRCODE = '42501';
    END IF;
    RETURN NEW;
  END IF;
  -- Révocation : l'échéance ne bouge pas.
  IF NEW.expires_at IS DISTINCT FROM OLD.expires_at THEN
    RAISE EXCEPTION 'resource_access_grants: a revocation does not change the expiry' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$$;
ALTER FUNCTION resource_access_grants_guard() SET search_path = pg_catalog, public, pg_temp;

-- Les accès nominatifs existants (dossier NOMINATIF, accès vivant) : 30 jours à partir de maintenant.
UPDATE resource_access_grants g SET expires_at = now() + interval '30 days'
WHERE g.revoked_at IS NULL AND g.expires_at IS NULL AND CASE g.resource_type
  WHEN 'RISK' THEN EXISTS (SELECT 1 FROM risks x WHERE x.tenant_id = g.tenant_id AND x.id = g.resource_id AND x.visibility = 'NOMINATIF')
  WHEN 'CONTROL' THEN EXISTS (SELECT 1 FROM controls x WHERE x.tenant_id = g.tenant_id AND x.id = g.resource_id AND x.visibility = 'NOMINATIF')
  WHEN 'ANOMALY' THEN EXISTS (SELECT 1 FROM anomalies x WHERE x.tenant_id = g.tenant_id AND x.id = g.resource_id AND x.visibility = 'NOMINATIF')
  WHEN 'ACTION_PLAN' THEN EXISTS (SELECT 1 FROM action_plans x WHERE x.tenant_id = g.tenant_id AND x.id = g.resource_id AND x.visibility = 'NOMINATIF')
  WHEN 'KPI' THEN EXISTS (SELECT 1 FROM kpis x WHERE x.tenant_id = g.tenant_id AND x.id = g.resource_id AND x.visibility = 'NOMINATIF')
  ELSE false END;

CREATE OR REPLACE FUNCTION visibility_resource_closed(p_tenant uuid, p_type text, p_id uuid) RETURNS boolean
  LANGUAGE sql STABLE
  SET search_path = pg_catalog, public, pg_temp AS $$
  SELECT COALESCE(CASE p_type
    WHEN 'RISK' THEN (SELECT x.status = 'ARCHIVED' OR x.deleted_at IS NOT NULL FROM risks x WHERE x.tenant_id = p_tenant AND x.id = p_id)
    WHEN 'CONTROL' THEN (SELECT x.status = 'ARCHIVED' OR x.deleted_at IS NOT NULL FROM controls x WHERE x.tenant_id = p_tenant AND x.id = p_id)
    WHEN 'KPI' THEN (SELECT x.deleted_at IS NOT NULL FROM kpis x WHERE x.tenant_id = p_tenant AND x.id = p_id)
    WHEN 'ANOMALY' THEN (SELECT x.status = 'CLOSED' FROM anomalies x WHERE x.tenant_id = p_tenant AND x.id = p_id)
    WHEN 'ACTION_PLAN' THEN (SELECT x.status = 'TERMINEE' FROM action_plans x WHERE x.tenant_id = p_tenant AND x.id = p_id)
  END, true);
$$;
ALTER FUNCTION visibility_resource_closed(uuid, text, uuid) SET search_path = pg_catalog, public, pg_temp;

CREATE OR REPLACE FUNCTION visibility_granted(p_tenant uuid, p_type text, p_id uuid, p_user uuid) RETURNS boolean
  LANGUAGE sql STABLE
  SET search_path = pg_catalog, public, pg_temp AS $$
  SELECT EXISTS (SELECT 1 FROM resource_access_grants g
                 WHERE g.tenant_id = p_tenant AND g.resource_type = p_type AND g.resource_id = p_id
                   AND g.user_id = p_user AND g.revoked_at IS NULL
                   -- q225 : un accès à échéance tombe à l'échéance, ou à la clôture du dossier.
                   AND (g.expires_at IS NULL
                        OR (g.expires_at > now() AND NOT visibility_resource_closed(p_tenant, p_type, p_id))));
$$;
ALTER FUNCTION visibility_granted(uuid, text, uuid, uuid) SET search_path = pg_catalog, public, pg_temp;

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
      OR visibility_granted(p_tenant, 'RISK', r.id, p_user)
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
