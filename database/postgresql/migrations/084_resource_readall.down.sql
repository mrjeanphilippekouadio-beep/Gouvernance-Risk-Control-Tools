-- Rollback of 084_resource_readall.sql : retire le droit `resource.readall` (V4). Refuse s'il existe une attribution
-- RESOURCE_READALL, quel que soit son statut : sans `kind`, elle deviendrait une vue élargie q200, et la table refuse DELETE.
-- Restaure les définitions de 079 (garde), 082 (risk_visible_to) et 083 (contrôle, KPI, anomalie, plan d'action).
-- Le fichier gère sa transaction : `psql -v ON_ERROR_STOP=1 -f` (sans -1).
BEGIN;

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM sensitive_view_grants WHERE kind = 'RESOURCE_READALL') THEN
    RAISE EXCEPTION '084 rollback: RESOURCE_READALL grants exist; they cannot be turned into role.read.sensitive grants';
  END IF;
END $$;

CREATE OR REPLACE FUNCTION risk_visible_to(p_tenant uuid, p_risk uuid, p_user uuid) RETURNS boolean
  LANGUAGE sql STABLE
  SET search_path = pg_catalog, public, pg_temp AS $$
  SELECT EXISTS (
    SELECT 1 FROM risks r
    WHERE r.tenant_id = p_tenant AND r.id = p_risk AND (
      r.visibility = 'CLIENT'
      -- Risk Manager, Comité, Audit : voient tout (spec §4, q191) — appartenance réelle, jamais users.roles.
      OR EXISTS (SELECT 1 FROM user_roles ur JOIN roles ro ON ro.id = ur.role_id AND ro.tenant_id = ur.tenant_id
                 WHERE ur.tenant_id = p_tenant AND ur.user_id = p_user AND ur.revoked_at IS NULL
                   AND ro.deleted_at IS NULL AND ro.system_group IN ('RISK_MANAGER', 'RISK_COMMITTEE', 'AUDIT'))
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

CREATE OR REPLACE FUNCTION control_visible_to(p_tenant uuid, p_control uuid, p_user uuid) RETURNS boolean
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
ALTER FUNCTION control_visible_to(uuid, uuid, uuid) SET search_path = pg_catalog, public, pg_temp;

CREATE OR REPLACE FUNCTION kpi_visible_to(p_tenant uuid, p_kpi uuid, p_user uuid) RETURNS boolean
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
ALTER FUNCTION kpi_visible_to(uuid, uuid, uuid) SET search_path = pg_catalog, public, pg_temp;

CREATE OR REPLACE FUNCTION anomaly_visible_to(p_tenant uuid, p_anomaly uuid, p_user uuid) RETURNS boolean
  LANGUAGE sql STABLE
  SET search_path = pg_catalog, public, pg_temp AS $$
  SELECT EXISTS (
    SELECT 1 FROM anomalies a
    WHERE a.tenant_id = p_tenant AND a.id = p_anomaly AND CASE
      WHEN a.risk_id IS NOT NULL THEN risk_visible_to(p_tenant, a.risk_id, p_user)
      WHEN a.control_id IS NOT NULL THEN control_visible_to(p_tenant, a.control_id, p_user)
      -- SEC V2-02 : une anomalie rattachée à une seule exécution suit le contrôle de cette exécution (ou son exécutant).
      WHEN a.control_execution_id IS NOT NULL THEN COALESCE(
        (SELECT ce.executed_by = p_user OR control_visible_to(p_tenant, ce.control_id, p_user)
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
ALTER FUNCTION anomaly_visible_to(uuid, uuid, uuid) SET search_path = pg_catalog, public, pg_temp;

CREATE OR REPLACE FUNCTION action_plan_visible_to(p_tenant uuid, p_plan uuid, p_user uuid) RETURNS boolean
  LANGUAGE sql STABLE
  SET search_path = pg_catalog, public, pg_temp AS $$
  SELECT EXISTS (
    SELECT 1 FROM action_plans ap
    WHERE ap.tenant_id = p_tenant AND ap.id = p_plan AND (
      ap.responsible_user_id = p_user
      OR CASE
        WHEN ap.source_type = 'RISK' AND ap.source_id IS NOT NULL THEN risk_visible_to(p_tenant, ap.source_id, p_user)
        WHEN ap.source_type = 'CONTROL' AND ap.source_id IS NOT NULL THEN control_visible_to(p_tenant, ap.source_id, p_user)
        -- Codex P2 : KRI introuvable = refus (fermé) ; KRI sans risque principal = aucune restriction héritée.
        WHEN ap.source_type = 'KRI' AND ap.source_id IS NOT NULL THEN COALESCE(
          (SELECT k.risk_id IS NULL OR risk_visible_to(p_tenant, k.risk_id, p_user) FROM kris k
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
ALTER FUNCTION action_plan_visible_to(uuid, uuid, uuid) SET search_path = pg_catalog, public, pg_temp;

DROP FUNCTION IF EXISTS action_plan_effective_visibility(uuid, uuid);
DROP FUNCTION IF EXISTS anomaly_effective_visibility(uuid, uuid);
DROP FUNCTION IF EXISTS action_plan_visible_core(uuid, uuid, uuid);
DROP FUNCTION IF EXISTS anomaly_visible_core(uuid, uuid, uuid);
DROP FUNCTION IF EXISTS kpi_visible_core(uuid, uuid, uuid);
DROP FUNCTION IF EXISTS control_visible_core(uuid, uuid, uuid);
DROP FUNCTION IF EXISTS risk_visible_core(uuid, uuid, uuid);
DROP FUNCTION IF EXISTS visibility_reads_all(uuid, uuid);
DROP FUNCTION IF EXISTS visibility_is_administrator(uuid, uuid);

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
     OR NEW.requested_at IS DISTINCT FROM OLD.requested_at OR NEW.expires_at IS DISTINCT FROM OLD.expires_at THEN
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

ALTER TABLE configs DROP COLUMN IF EXISTS resource_readall_max_days;
ALTER TABLE sensitive_view_grants DROP COLUMN IF EXISTS access_expires_at;
ALTER TABLE sensitive_view_grants DROP CONSTRAINT IF EXISTS svg_kind_check;
ALTER TABLE sensitive_view_grants DROP COLUMN IF EXISTS kind;

DELETE FROM schema_migrations WHERE filename = '084_resource_readall.sql';

COMMIT;
