-- 084 — Visibilité des ressources, lot V4 : cas de l'administrateur (DECISION-103, q197 A3 ; spec
-- docs/architecture/RM-V1-Visibilite-Ressources-spec.md §4 et §7).
-- Par défaut, un administrateur qui n'est ni Risk Manager, ni Comité, ni Audit ne voit pas les contenus restreints (A1).
-- Le droit `resource.readall` (lire tous les contenus) lui est donné INDIVIDUELLEMENT par le circuit de 079 : demandé par
-- un autre administrateur avec motif, confirmé ou refusé par un membre du Comité ou de l'Audit (jamais l'auteur, jamais le
-- bénéficiaire), révocable, expirant (q174). Il n'est jamais posé sur un rôle.
--   sensitive_view_grants.kind   ROLE_READ_SENSITIVE (q200, toutes les lignes existantes) | RESOURCE_READALL (V4)
--   l'index « vivant » de 079 (une demande vivante par compte) reste : les bénéficiaires sont disjoints (un membre du Risk
--   Manager pour ROLE_READ_SENSITIVE, un administrateur hors des groupes fixes pour RESOURCE_READALL)
--   visibility_is_administrator  le compte détient, par un rôle actif, une permission d'administration (copie de
--                                ADMIN_PERMISSIONS, domain/fixedGroupPermissions.ts : un test compare les deux listes)
--   visibility_sees_everything   groupes fixes (083) OU attribution RESOURCE_READALL APPROVED d'un compte actif qui est
--                                encore administrateur (perdre l'administration éteint l'effet sans attendre la révocation)
--   risk_visible_to              passe désormais par visibility_sees_everything (082 dupliquait la condition des groupes)
-- `kind` rejoint le contenu immuable d'une attribution. `search_path` pinné (`pg_temp` en dernier, F-B6a-11) et répété par
-- ALTER FUNCTION sur chaque redéfinition. Idempotente (IF NOT EXISTS / OR REPLACE). Jamais à la main : `npm run migrate`.

ALTER TABLE sensitive_view_grants ADD COLUMN IF NOT EXISTS kind text NOT NULL DEFAULT 'ROLE_READ_SENSITIVE';
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'svg_kind_check') THEN
    ALTER TABLE sensitive_view_grants ADD CONSTRAINT svg_kind_check CHECK (kind IN ('ROLE_READ_SENSITIVE', 'RESOURCE_READALL'));
  END IF;
END $$;

CREATE OR REPLACE FUNCTION sensitive_view_grants_guard() RETURNS trigger LANGUAGE plpgsql
  SET search_path = pg_catalog, public, pg_temp AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'sensitive_view_grants: rows are never deleted' USING ERRCODE = '42501';
  END IF;
  IF TG_OP = 'INSERT' THEN
    IF NEW.status <> 'PENDING' OR NEW.decided_by IS NOT NULL OR NEW.decided_at IS NOT NULL OR NEW.decision_reason IS NOT NULL
       OR NEW.revoked_by IS NOT NULL OR NEW.revoked_at IS NOT NULL OR NEW.revoke_reason IS NOT NULL THEN
      RAISE EXCEPTION 'sensitive_view_grants: a grant is inserted PENDING, without any decision' USING ERRCODE = '42501';
    END IF;
    RETURN NEW;
  END IF;
  IF NEW.id IS DISTINCT FROM OLD.id OR NEW.tenant_id IS DISTINCT FROM OLD.tenant_id OR NEW.user_id IS DISTINCT FROM OLD.user_id
     OR NEW.reason IS DISTINCT FROM OLD.reason OR NEW.requested_by IS DISTINCT FROM OLD.requested_by
     OR NEW.requested_at IS DISTINCT FROM OLD.requested_at OR NEW.expires_at IS DISTINCT FROM OLD.expires_at
     OR NEW.kind IS DISTINCT FROM OLD.kind THEN
    RAISE EXCEPTION 'sensitive_view_grants: the content of a grant is immutable' USING ERRCODE = '42501';
  END IF;
  -- PENDING -> APPROVED | REJECTED | REVOKED ; APPROVED -> REVOKED (the decision stays) ; nothing else.
  IF NOT ((OLD.status = 'PENDING' AND NEW.status IN ('APPROVED', 'REJECTED', 'REVOKED'))
          OR (OLD.status = 'APPROVED' AND NEW.status = 'REVOKED'
              AND NEW.decided_by IS NOT DISTINCT FROM OLD.decided_by AND NEW.decided_at IS NOT DISTINCT FROM OLD.decided_at
              AND NEW.decision_reason IS NOT DISTINCT FROM OLD.decision_reason)) THEN
    RAISE EXCEPTION 'sensitive_view_grants: forbidden transition % -> %', OLD.status, NEW.status USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$$;
ALTER FUNCTION sensitive_view_grants_guard() SET search_path = pg_catalog, public, pg_temp;

CREATE OR REPLACE FUNCTION visibility_is_administrator(p_tenant uuid, p_user uuid) RETURNS boolean
  LANGUAGE sql STABLE
  SET search_path = pg_catalog, public, pg_temp AS $$
  SELECT EXISTS (SELECT 1 FROM user_roles ur JOIN roles ro ON ro.id = ur.role_id AND ro.tenant_id = ur.tenant_id
                 WHERE ur.tenant_id = p_tenant AND ur.user_id = p_user AND ur.revoked_at IS NULL AND ro.deleted_at IS NULL
                   AND ro.permissions && ARRAY['role.create', 'role.update', 'role.delete', 'role.assign', 'user.create', 'user.update', 'user.delete', 'user.reactivate', 'rolegroup.audit.update', 'config.cumul.set', 'config.committeeenforcement.set', 'config.manage', 'config.selfvalidation.set', 'designation.manage', 'config.governancedelays.set']::text[]);
$$;
ALTER FUNCTION visibility_is_administrator(uuid, uuid) SET search_path = pg_catalog, public, pg_temp;

CREATE OR REPLACE FUNCTION visibility_sees_everything(p_tenant uuid, p_user uuid) RETURNS boolean
  LANGUAGE sql STABLE
  SET search_path = pg_catalog, public, pg_temp AS $$
  SELECT EXISTS (SELECT 1 FROM user_roles ur JOIN roles ro ON ro.id = ur.role_id AND ro.tenant_id = ur.tenant_id
                 WHERE ur.tenant_id = p_tenant AND ur.user_id = p_user AND ur.revoked_at IS NULL
                   AND ro.deleted_at IS NULL AND ro.system_group IN ('RISK_MANAGER', 'RISK_COMMITTEE', 'AUDIT'))
      OR (EXISTS (SELECT 1 FROM sensitive_view_grants g JOIN users u ON u.tenant_id = g.tenant_id AND u.id = g.user_id
                  WHERE g.tenant_id = p_tenant AND g.user_id = p_user AND g.kind = 'RESOURCE_READALL'
                    AND g.status = 'APPROVED' AND u.deleted_at IS NULL)
          AND visibility_is_administrator(p_tenant, p_user));
$$;
ALTER FUNCTION visibility_sees_everything(uuid, uuid) SET search_path = pg_catalog, public, pg_temp;

CREATE OR REPLACE FUNCTION risk_visible_to(p_tenant uuid, p_risk uuid, p_user uuid) RETURNS boolean
  LANGUAGE sql STABLE
  SET search_path = pg_catalog, public, pg_temp AS $$
  SELECT EXISTS (
    SELECT 1 FROM risks r
    WHERE r.tenant_id = p_tenant AND r.id = p_risk AND (
      r.visibility = 'CLIENT'
      -- Risk Manager, Comité, Audit, et l'administrateur titulaire de resource.readall (084) : voient tout.
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
ALTER FUNCTION risk_visible_to(uuid, uuid, uuid) SET search_path = pg_catalog, public, pg_temp;
