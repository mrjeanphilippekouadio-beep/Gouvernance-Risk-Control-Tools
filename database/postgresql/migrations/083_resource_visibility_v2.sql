-- 083 — Visibilité des ressources, lot V2 : contrôles, anomalies, plans d'action et KPI deviennent restreignables
-- (DECISION-100, -102, -103 ; spec docs/architecture/RM-V1-Visibilite-Ressources-spec.md §1, §3, §5).
-- Quatre fonctions `<ressource>_visible_to(tenant, id, compte)`, sur le modèle exact de `risk_visible_to` (082) :
--   control_visible_to      réglage propre. PERIMETRE : membres du groupe du département du contrôle, responsable du
--                           processus, RACI (CONTROL) + la liste. NOMINATIF : la liste (un contrôle n'a pas de
--                           propriétaire qui soit un compte : `executor` est un texte).
--   kpi_visible_to          réglage propre (I-4). PERIMETRE : groupe du département, responsable du processus + la liste.
--                           NOMINATIF : la liste (`kpis.owner` est un texte libre, pas un compte).
--   anomaly_visible_to      suit le risque, sinon le contrôle, sinon le contrôle de son exécution, sinon son réglage propre ; le déclarant (`detected_by`)
--                           tient lieu de propriétaire pour le réglage propre (PERIMETRE sans département : le déclarant
--                           et la liste).
--   action_plan_visible_to  le responsable voit toujours son plan (règle « ce qui m'est assigné », sans voir la source) ;
--                           sinon suit la source RISK / CONTROL / KRI (par le risque principal du KRI), sinon réglage
--                           propre : PERIMETRE = groupe du département du plan, RACI (ACTION_PLAN) + la liste.
-- Les groupes fixes Risk Manager, Comité et Audit voient tout (appartenance active via user_roles, jamais users.roles).
-- Un compte NULL ne voit que ce qui est entièrement CLIENT (lecture sans lecteur identifié).
-- STABLE, sans effet de bord ; `search_path` pinné (`pg_temp` en dernier, F-B6a-11), répété par ALTER FUNCTION.
-- Idempotente (OR REPLACE). Aucune donnée modifiée : `resourcevisibility.set` est déjà posé par 082.

CREATE OR REPLACE FUNCTION visibility_sees_everything(p_tenant uuid, p_user uuid) RETURNS boolean
  LANGUAGE sql STABLE
  SET search_path = pg_catalog, public, pg_temp AS $$
  SELECT EXISTS (SELECT 1 FROM user_roles ur JOIN roles ro ON ro.id = ur.role_id AND ro.tenant_id = ur.tenant_id
                 WHERE ur.tenant_id = p_tenant AND ur.user_id = p_user AND ur.revoked_at IS NULL
                   AND ro.deleted_at IS NULL AND ro.system_group IN ('RISK_MANAGER', 'RISK_COMMITTEE', 'AUDIT'));
$$;
ALTER FUNCTION visibility_sees_everything(uuid, uuid) SET search_path = pg_catalog, public, pg_temp;

CREATE OR REPLACE FUNCTION visibility_in_department_group(p_tenant uuid, p_user uuid, p_department uuid) RETURNS boolean
  LANGUAGE sql STABLE
  SET search_path = pg_catalog, public, pg_temp AS $$
  SELECT p_department IS NOT NULL AND EXISTS (
    SELECT 1 FROM user_roles ur JOIN roles ro ON ro.id = ur.role_id AND ro.tenant_id = ur.tenant_id
    WHERE ur.tenant_id = p_tenant AND ur.user_id = p_user AND ur.revoked_at IS NULL
      AND ro.deleted_at IS NULL AND ro.department_id = p_department);
$$;
ALTER FUNCTION visibility_in_department_group(uuid, uuid, uuid) SET search_path = pg_catalog, public, pg_temp;

CREATE OR REPLACE FUNCTION visibility_granted(p_tenant uuid, p_type text, p_id uuid, p_user uuid) RETURNS boolean
  LANGUAGE sql STABLE
  SET search_path = pg_catalog, public, pg_temp AS $$
  SELECT EXISTS (SELECT 1 FROM resource_access_grants g
                 WHERE g.tenant_id = p_tenant AND g.resource_type = p_type AND g.resource_id = p_id
                   AND g.user_id = p_user AND g.revoked_at IS NULL);
$$;
ALTER FUNCTION visibility_granted(uuid, text, uuid, uuid) SET search_path = pg_catalog, public, pg_temp;

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
        WHEN ap.source_type = 'KRI' AND ap.source_id IS NOT NULL THEN COALESCE(
          (SELECT risk_visible_to(p_tenant, k.risk_id, p_user) FROM kris k
           WHERE k.tenant_id = p_tenant AND k.id = ap.source_id AND k.risk_id IS NOT NULL), true)
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
