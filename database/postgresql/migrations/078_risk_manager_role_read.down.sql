-- Rollback of 078_risk_manager_role_read.sql : retire `role.read` des groupes Risk Manager, avec sa ligne d'audit
-- (même compte technique, déjà suspendu). Le compte technique reste : il est l'auteur des lignes d'audit.
-- Le fichier gère sa transaction : `psql -v ON_ERROR_STOP=1 -f` (sans -1).
BEGIN;

WITH changed AS (
  UPDATE roles r
  SET permissions = array_remove(r.permissions, 'role.read'),
      updated_at = now()
  FROM roles old
  WHERE old.id = r.id AND r.system_group = 'RISK_MANAGER' AND 'role.read' = ANY (r.permissions)
  RETURNING r.tenant_id, r.id, r.name, old.permissions AS before, r.permissions AS after
)
INSERT INTO audit_log (tenant_id, user_id, entity_type, entity_id, action, old_value, new_value, reason, request_id)
SELECT c.tenant_id, s.id, 'Role', c.id, 'PERMISSION_CHANGE',
       jsonb_build_object('id', c.id, 'name', c.name, 'permissions', c.before),
       jsonb_build_object('id', c.id, 'name', c.name, 'permissions', c.after),
       'Retour arrière de la migration 078 (q187)',
       'migration:078:down'
FROM changed c
JOIN users s ON s.tenant_id = c.tenant_id AND s.email = 'migration-078@system.invalid';

DELETE FROM schema_migrations WHERE filename = '078_risk_manager_role_read.sql';

COMMIT;
