-- 078 — q187 (DECISION-097) : le groupe fixe Risk Manager peut consulter la matrice des droits (`role.read`, lecture
-- seule). Une entreprise peut avoir un gestionnaire de risque sans département d'audit interne. Les nouveaux tenants le
-- reçoivent par FIXED_GROUP_PERMISSIONS (backend/src/domain/fixedGroupPermissions.ts) ; cette migration l'ajoute aux
-- groupes Risk Manager existants (supprimés compris : un groupe restauré doit avoir la même liste), avec une ligne
-- d'audit_log par groupe modifié. Le groupe Audit n'est PAS touché : il le reçoit par le circuit des droits Audit.
-- Idempotente : un second passage ne trouve plus rien. Aucune suppression.
--
-- Acteur de l'audit : même principe que 077, un compte technique « Système (migration 078) » déjà suspendu (adresse
-- .invalid, ne se connecte pas, ne compte nulle part), créé seulement dans les tenants où il y a quelque chose à ajouter.

INSERT INTO users (tenant_id, email, display_name, roles, deleted_at)
SELECT DISTINCT r.tenant_id, 'migration-078@system.invalid', 'Système (migration 078)', '{}'::text[], now()
FROM roles r
WHERE r.system_group = 'RISK_MANAGER' AND NOT ('role.read' = ANY (r.permissions))
  AND NOT EXISTS (SELECT 1 FROM users u WHERE u.tenant_id = r.tenant_id AND u.email = 'migration-078@system.invalid');

WITH changed AS (
  UPDATE roles r
  SET permissions = r.permissions || ARRAY['role.read']::text[],
      updated_at = now()
  FROM roles old
  WHERE old.id = r.id AND r.system_group = 'RISK_MANAGER' AND NOT ('role.read' = ANY (r.permissions))
  RETURNING r.tenant_id, r.id, r.name, old.permissions AS before, r.permissions AS after
)
INSERT INTO audit_log (tenant_id, user_id, entity_type, entity_id, action, old_value, new_value, reason, request_id)
SELECT c.tenant_id, s.id, 'Role', c.id, 'PERMISSION_CHANGE',
       jsonb_build_object('id', c.id, 'name', c.name, 'permissions', c.before),
       jsonb_build_object('id', c.id, 'name', c.name, 'permissions', c.after),
       'Migration 078 (q187, DECISION-097) : le groupe Risk Manager consulte la matrice des droits (lecture seule)',
       'migration:078'
FROM changed c
JOIN users s ON s.tenant_id = c.tenant_id AND s.email = 'migration-078@system.invalid';
