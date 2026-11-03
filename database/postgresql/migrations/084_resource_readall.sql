-- 084 — Visibilité des ressources, lot V4 : cas de l'administrateur (DECISION-103 q197 A3, DECISION-111 q219-q221 ; spec
-- docs/architecture/RM-V1-Visibilite-Ressources-spec.md §4 et §7).
-- Par défaut, un administrateur qui n'est ni Risk Manager, ni Comité, ni Audit ne voit pas les contenus restreints (A1).
-- Le droit `resource.readall` lui est donné INDIVIDUELLEMENT par le circuit de 079 : demandé par un autre administrateur
-- avec motif, confirmé ou refusé par un membre du Comité ou de l'Audit (jamais l'auteur, jamais le bénéficiaire, jamais un
-- administrateur), révocable. Il n'est jamais posé sur un rôle.
--   sensitive_view_grants.kind            ROLE_READ_SENSITIVE (q200, lignes existantes) | RESOURCE_READALL (V4)
--   sensitive_view_grants.access_expires_at  q221 : échéance d'une attribution RESOURCE_READALL, fixée à la confirmation
--                                         depuis configs.resource_readall_max_days (90 par défaut), jamais recalculée
--   l'index « vivant » de 079 (une demande vivante par compte) reste : les bénéficiaires sont disjoints.
--   visibility_is_administrator   le compte détient, par un rôle actif, une permission d'administration (copie de
--                                 ADMIN_PERMISSIONS, domain/fixedGroupPermissions.ts : un test compare les deux listes)
--   visibility_reads_all          attribution RESOURCE_READALL APPROVED, non échue, compte actif, encore administrateur
--   <ressource>_visible_core      les règles de 082/083 (groupes fixes = tout), sans resource.readall
--   <ressource>_visible_to        core OU (niveau effectif PERIMETRE ET visibility_reads_all) : q219, resource.readall
--                                 n'ouvre jamais un niveau effectif NOMINATIF (seule la liste nominative l'ouvre)
--   anomaly_/action_plan_effective_visibility  niveau effectif hérité (risque, contrôle, KRI) ou propre
-- `visibility_sees_everything` reste celui de 083 (groupes fixes seulement). `kind` et l'échéance rejoignent le contenu
-- immuable d'une attribution. `search_path` pinné (`pg_temp` en dernier, F-B6a-11) et répété par ALTER FUNCTION sur chaque
-- redéfinition. Idempotente (IF NOT EXISTS / OR REPLACE). Jamais à la main : `npm run migrate`.

ALTER TABLE sensitive_view_grants ADD COLUMN IF NOT EXISTS kind text NOT NULL DEFAULT 'ROLE_READ_SENSITIVE';
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'svg_kind_check') THEN
    ALTER TABLE sensitive_view_grants ADD CONSTRAINT svg_kind_check CHECK (kind IN ('ROLE_READ_SENSITIVE', 'RESOURCE_READALL'));
  END IF;
END $$;
ALTER TABLE sensitive_view_grants ADD COLUMN IF NOT EXISTS access_expires_at timestamptz NULL;
-- q221 (DECISION-111) : durée d'une attribution RESOURCE_READALL confirmée, plafonnée à 90 jours (réglable vers le bas
-- seulement, Privacy Q3) ; NULL = non configuré, le service applique 90.
ALTER TABLE configs ADD COLUMN IF NOT EXISTS resource_readall_max_days integer DEFAULT 90
  CHECK (resource_readall_max_days BETWEEN 1 AND 90);

CREATE OR REPLACE FUNCTION sensitive_view_grants_guard() RETURNS trigger LANGUAGE plpgsql
  SET search_path = pg_catalog, public, pg_temp AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'sensitive_view_grants: rows are never deleted' USING ERRCODE = '42501';
  END IF;
  IF TG_OP = 'INSERT' THEN
    IF NEW.status <> 'PENDING' OR NEW.decided_by IS NOT NULL OR NEW.decided_at IS NOT NULL OR NEW.decision_reason IS NOT NULL
       OR NEW.revoked_by IS NOT NULL OR NEW.revoked_at IS NOT NULL OR NEW.revoke_reason IS NOT NULL
       OR NEW.access_expires_at IS NOT NULL THEN
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
  -- q221 : l'échéance d'accès se pose à la confirmation seulement, puis ne bouge plus.
  IF NEW.access_expires_at IS DISTINCT FROM OLD.access_expires_at AND NOT (OLD.status = 'PENDING' AND NEW.status = 'APPROVED') THEN
    RAISE EXCEPTION 'sensitive_view_grants: the access expiry is set at the confirmation only' USING ERRCODE = '42501';
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

CREATE OR REPLACE FUNCTION visibility_reads_all(p_tenant uuid, p_user uuid) RETURNS boolean
  LANGUAGE sql STABLE
  SET search_path = pg_catalog, public, pg_temp AS $$
  SELECT EXISTS (SELECT 1 FROM sensitive_view_grants g JOIN users u ON u.tenant_id = g.tenant_id AND u.id = g.user_id
                 WHERE g.tenant_id = p_tenant AND g.user_id = p_user AND g.kind = 'RESOURCE_READALL' AND g.status = 'APPROVED'
                   AND g.access_expires_at > now() AND u.deleted_at IS NULL)
     AND visibility_is_administrator(p_tenant, p_user);
$$;
ALTER FUNCTION visibility_reads_all(uuid, uuid) SET search_path = pg_catalog, public, pg_temp;

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

CREATE OR REPLACE FUNCTION control_visible_core(p_tenant uuid, p_control uuid, p_user uuid) RETURNS boolean
  LANGUAGE sql STABLE
  SET search_path = pg_catalog, public, pg_temp AS $$
  SELECT EXISTS (
    SELECT 1 FROM controls c
    WHERE c.tenant_id = p_tenant AND c.id = p_control AND (
      c.visibility = 'CLIENT'
      OR visibility_sees_everything(p_tenant, p_user)
      OR visibility_granted(p_tenant, 'CONTROL', c.id, p_user)
      OR (c.visibility = 'PERIMETRE' AND (
            visibility_in_department_group(p_tenant, p_user, c.department_id)
            OR EXISTS (SELECT 1 FROM processes p
                       WHERE p.tenant_id = p_tenant AND p.id = c.process_id AND p.owner_user_id = p_user)
            OR EXISTS (SELECT 1 FROM raci_assignments ra
                       WHERE ra.tenant_id = p_tenant AND ra.entity_type = 'CONTROL' AND ra.entity_id = c.id
                         AND ra.user_id = p_user AND ra.deleted_at IS NULL)
      ))
    )
  );
$$;
ALTER FUNCTION control_visible_core(uuid, uuid, uuid) SET search_path = pg_catalog, public, pg_temp;

CREATE OR REPLACE FUNCTION kpi_visible_core(p_tenant uuid, p_kpi uuid, p_user uuid) RETURNS boolean
  LANGUAGE sql STABLE
  SET search_path = pg_catalog, public, pg_temp AS $$
  SELECT EXISTS (
    SELECT 1 FROM kpis k
    WHERE k.tenant_id = p_tenant AND k.id = p_kpi AND (
      k.visibility = 'CLIENT'
      OR visibility_sees_everything(p_tenant, p_user)
      OR visibility_granted(p_tenant, 'KPI', k.id, p_user)
      OR (k.visibility = 'PERIMETRE' AND (
            visibility_in_department_group(p_tenant, p_user, k.department_id)
            OR EXISTS (SELECT 1 FROM processes p
                       WHERE p.tenant_id = p_tenant AND p.id = k.process_id AND p.owner_user_id = p_user)
      ))
    )
  );
$$;
ALTER FUNCTION kpi_visible_core(uuid, uuid, uuid) SET search_path = pg_catalog, public, pg_temp;

CREATE OR REPLACE FUNCTION anomaly_visible_core(p_tenant uuid, p_anomaly uuid, p_user uuid) RETURNS boolean
  LANGUAGE sql STABLE
  SET search_path = pg_catalog, public, pg_temp AS $$
  SELECT EXISTS (
    SELECT 1 FROM anomalies a
    WHERE a.tenant_id = p_tenant AND a.id = p_anomaly AND CASE
      WHEN a.risk_id IS NOT NULL THEN risk_visible_core(p_tenant, a.risk_id, p_user)
      WHEN a.control_id IS NOT NULL THEN control_visible_core(p_tenant, a.control_id, p_user)
      -- SEC V2-02 : une anomalie rattachée à une seule exécution suit le contrôle de cette exécution (ou son exécutant).
      WHEN a.control_execution_id IS NOT NULL THEN COALESCE(
        (SELECT ce.executed_by = p_user OR control_visible_core(p_tenant, ce.control_id, p_user)
         FROM control_executions ce WHERE ce.tenant_id = p_tenant AND ce.id = a.control_execution_id), false)
      ELSE (
        a.visibility = 'CLIENT'
        OR visibility_sees_everything(p_tenant, p_user)
        OR a.detected_by = p_user
        OR visibility_granted(p_tenant, 'ANOMALY', a.id, p_user)
      )
    END IS TRUE
  );
$$;
ALTER FUNCTION anomaly_visible_core(uuid, uuid, uuid) SET search_path = pg_catalog, public, pg_temp;

CREATE OR REPLACE FUNCTION action_plan_visible_core(p_tenant uuid, p_plan uuid, p_user uuid) RETURNS boolean
  LANGUAGE sql STABLE
  SET search_path = pg_catalog, public, pg_temp AS $$
  SELECT EXISTS (
    SELECT 1 FROM action_plans ap
    WHERE ap.tenant_id = p_tenant AND ap.id = p_plan AND (
      ap.responsible_user_id = p_user
      OR CASE
        WHEN ap.source_type = 'RISK' AND ap.source_id IS NOT NULL THEN risk_visible_core(p_tenant, ap.source_id, p_user)
        WHEN ap.source_type = 'CONTROL' AND ap.source_id IS NOT NULL THEN control_visible_core(p_tenant, ap.source_id, p_user)
        -- Codex P2 : KRI introuvable = refus (fermé) ; KRI sans risque principal = aucune restriction héritée.
        WHEN ap.source_type = 'KRI' AND ap.source_id IS NOT NULL THEN COALESCE(
          (SELECT k.risk_id IS NULL OR risk_visible_core(p_tenant, k.risk_id, p_user) FROM kris k
           WHERE k.tenant_id = p_tenant AND k.id = ap.source_id), false)
        ELSE (
          ap.visibility = 'CLIENT'
          OR visibility_sees_everything(p_tenant, p_user)
          OR visibility_granted(p_tenant, 'ACTION_PLAN', ap.id, p_user)
          OR (ap.visibility = 'PERIMETRE' AND (
                visibility_in_department_group(p_tenant, p_user, ap.department_id)
                OR EXISTS (SELECT 1 FROM raci_assignments ra
                           WHERE ra.tenant_id = p_tenant AND ra.entity_type = 'ACTION_PLAN' AND ra.entity_id = ap.id
                             AND ra.user_id = p_user AND ra.deleted_at IS NULL)
          ))
        )
      END IS TRUE
    )
  );
$$;
ALTER FUNCTION action_plan_visible_core(uuid, uuid, uuid) SET search_path = pg_catalog, public, pg_temp;

CREATE OR REPLACE FUNCTION anomaly_effective_visibility(p_tenant uuid, p_anomaly uuid) RETURNS text
  LANGUAGE sql STABLE
  SET search_path = pg_catalog, public, pg_temp AS $$
  SELECT CASE
    WHEN a.risk_id IS NOT NULL THEN (SELECT r.visibility FROM risks r WHERE r.tenant_id = p_tenant AND r.id = a.risk_id)
    WHEN a.control_id IS NOT NULL THEN (SELECT c.visibility FROM controls c WHERE c.tenant_id = p_tenant AND c.id = a.control_id)
    WHEN a.control_execution_id IS NOT NULL THEN (SELECT c.visibility FROM control_executions ce JOIN controls c
        ON c.tenant_id = ce.tenant_id AND c.id = ce.control_id WHERE ce.tenant_id = p_tenant AND ce.id = a.control_execution_id)
    ELSE a.visibility END
  FROM anomalies a WHERE a.tenant_id = p_tenant AND a.id = p_anomaly;
$$;
ALTER FUNCTION anomaly_effective_visibility(uuid, uuid) SET search_path = pg_catalog, public, pg_temp;

CREATE OR REPLACE FUNCTION action_plan_effective_visibility(p_tenant uuid, p_plan uuid) RETURNS text
  LANGUAGE sql STABLE
  SET search_path = pg_catalog, public, pg_temp AS $$
  SELECT CASE
    WHEN ap.source_type = 'RISK' AND ap.source_id IS NOT NULL THEN (SELECT r.visibility FROM risks r WHERE r.tenant_id = p_tenant AND r.id = ap.source_id)
    WHEN ap.source_type = 'CONTROL' AND ap.source_id IS NOT NULL THEN (SELECT c.visibility FROM controls c WHERE c.tenant_id = p_tenant AND c.id = ap.source_id)
    WHEN ap.source_type = 'KRI' AND ap.source_id IS NOT NULL THEN (SELECT COALESCE(r.visibility, 'CLIENT') FROM kris k
        LEFT JOIN risks r ON r.tenant_id = k.tenant_id AND r.id = k.risk_id WHERE k.tenant_id = p_tenant AND k.id = ap.source_id)
    ELSE ap.visibility END
  FROM action_plans ap WHERE ap.tenant_id = p_tenant AND ap.id = p_plan;
$$;
ALTER FUNCTION action_plan_effective_visibility(uuid, uuid) SET search_path = pg_catalog, public, pg_temp;

CREATE OR REPLACE FUNCTION risk_visible_to(p_tenant uuid, p_risk uuid, p_user uuid) RETURNS boolean
  LANGUAGE sql STABLE
  SET search_path = pg_catalog, public, pg_temp AS $$
  SELECT risk_visible_core(p_tenant, p_risk, p_user)
      -- q219 (DECISION-111) : resource.readall ouvre le niveau effectif PERIMETRE, jamais NOMINATIF.
      OR ((SELECT r.visibility FROM risks r WHERE r.tenant_id = p_tenant AND r.id = p_risk) = 'PERIMETRE' AND visibility_reads_all(p_tenant, p_user));
$$;
ALTER FUNCTION risk_visible_to(uuid, uuid, uuid) SET search_path = pg_catalog, public, pg_temp;

CREATE OR REPLACE FUNCTION control_visible_to(p_tenant uuid, p_control uuid, p_user uuid) RETURNS boolean
  LANGUAGE sql STABLE
  SET search_path = pg_catalog, public, pg_temp AS $$
  SELECT control_visible_core(p_tenant, p_control, p_user)
      -- q219 (DECISION-111) : resource.readall ouvre le niveau effectif PERIMETRE, jamais NOMINATIF.
      OR ((SELECT c.visibility FROM controls c WHERE c.tenant_id = p_tenant AND c.id = p_control) = 'PERIMETRE' AND visibility_reads_all(p_tenant, p_user));
$$;
ALTER FUNCTION control_visible_to(uuid, uuid, uuid) SET search_path = pg_catalog, public, pg_temp;

CREATE OR REPLACE FUNCTION kpi_visible_to(p_tenant uuid, p_kpi uuid, p_user uuid) RETURNS boolean
  LANGUAGE sql STABLE
  SET search_path = pg_catalog, public, pg_temp AS $$
  SELECT kpi_visible_core(p_tenant, p_kpi, p_user)
      -- q219 (DECISION-111) : resource.readall ouvre le niveau effectif PERIMETRE, jamais NOMINATIF.
      OR ((SELECT k.visibility FROM kpis k WHERE k.tenant_id = p_tenant AND k.id = p_kpi) = 'PERIMETRE' AND visibility_reads_all(p_tenant, p_user));
$$;
ALTER FUNCTION kpi_visible_to(uuid, uuid, uuid) SET search_path = pg_catalog, public, pg_temp;

CREATE OR REPLACE FUNCTION anomaly_visible_to(p_tenant uuid, p_anomaly uuid, p_user uuid) RETURNS boolean
  LANGUAGE sql STABLE
  SET search_path = pg_catalog, public, pg_temp AS $$
  SELECT anomaly_visible_core(p_tenant, p_anomaly, p_user)
      -- q219 (DECISION-111) : resource.readall ouvre le niveau effectif PERIMETRE, jamais NOMINATIF.
      OR (anomaly_effective_visibility(p_tenant, p_anomaly) = 'PERIMETRE' AND visibility_reads_all(p_tenant, p_user));
$$;
ALTER FUNCTION anomaly_visible_to(uuid, uuid, uuid) SET search_path = pg_catalog, public, pg_temp;

CREATE OR REPLACE FUNCTION action_plan_visible_to(p_tenant uuid, p_plan uuid, p_user uuid) RETURNS boolean
  LANGUAGE sql STABLE
  SET search_path = pg_catalog, public, pg_temp AS $$
  SELECT action_plan_visible_core(p_tenant, p_plan, p_user)
      -- q219 (DECISION-111) : resource.readall ouvre le niveau effectif PERIMETRE, jamais NOMINATIF.
      OR (action_plan_effective_visibility(p_tenant, p_plan) = 'PERIMETRE' AND visibility_reads_all(p_tenant, p_user));
$$;
ALTER FUNCTION action_plan_visible_to(uuid, uuid, uuid) SET search_path = pg_catalog, public, pg_temp;

