-- 082 — Visibilité des ressources, lot V1 : les risques (et ce qui en hérite) deviennent restreignables
-- (DECISION-100, -102, -103, -104 ; spec docs/architecture/RM-V1-Visibilite-Ressources-spec.md §1, §3, §5).
-- 1. Fonction `risk_visible_to(tenant, risque, compte)` : vrai si le compte voit le risque selon son niveau.
--      CLIENT     tout le client
--      PERIMETRE  propriétaire, N+1 (superior_owner_id), RACI (R/A/C/I), responsable du processus
--                 (processes.owner_user_id), membres actifs du groupe du département du risque (roles.department_id,
--                 appartenance via user_roles, jamais users.department_id) + la liste (resource_access_grants)
--      NOMINATIF  la liste + le propriétaire (I-3)
--    Les groupes fixes Risk Manager, Comité et Audit voient tout (appartenance active via user_roles, comme
--    VisibilityResolver) : la fonction l'applique aussi, pour que toute lecture faite au nom d'un lecteur soit juste.
--    STABLE, sans effet de bord ; `search_path` pinné (`pg_temp` en dernier, F-B6a-11).
-- 2. Le droit `resourcevisibility.set` (modifier la visibilité d'une ressource après sa création, q194) est ajouté aux
--    groupes Risk Manager existants (supprimés compris), une ligne d'audit_log par groupe modifié, signée par un compte
--    technique suspendu « Système (migration 082) » (patron 077/078). Les nouveaux tenants le reçoivent par
--    FIXED_GROUP_PERMISSIONS.
-- Idempotente (OR REPLACE ; un second passage ne trouve plus de groupe à compléter). Aucune suppression.

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

INSERT INTO users (tenant_id, email, display_name, roles, deleted_at)
SELECT DISTINCT r.tenant_id, 'migration-082@system.invalid', 'Système (migration 082)', '{}'::text[], now()
FROM roles r
WHERE r.system_group = 'RISK_MANAGER' AND NOT ('resourcevisibility.set' = ANY (r.permissions))
  AND NOT EXISTS (SELECT 1 FROM users u WHERE u.tenant_id = r.tenant_id AND u.email = 'migration-082@system.invalid');

WITH changed AS (
  UPDATE roles r
  SET permissions = r.permissions || ARRAY['resourcevisibility.set']::text[],
      updated_at = now()
  FROM roles old
  WHERE old.id = r.id AND r.system_group = 'RISK_MANAGER' AND NOT ('resourcevisibility.set' = ANY (r.permissions))
  RETURNING r.tenant_id, r.id, r.name, old.permissions AS before, r.permissions AS after
)
INSERT INTO audit_log (tenant_id, user_id, entity_type, entity_id, action, old_value, new_value, reason, request_id)
SELECT c.tenant_id, s.id, 'Role', c.id, 'PERMISSION_CHANGE',
       jsonb_build_object('id', c.id, 'name', c.name, 'permissions', c.before),
       jsonb_build_object('id', c.id, 'name', c.name, 'permissions', c.after),
       'Migration 082 (DECISION-102, q194) : le groupe Risk Manager peut modifier la visibilité des ressources',
       'migration:082'
FROM changed c
JOIN users s ON s.tenant_id = c.tenant_id AND s.email = 'migration-082@system.invalid';
