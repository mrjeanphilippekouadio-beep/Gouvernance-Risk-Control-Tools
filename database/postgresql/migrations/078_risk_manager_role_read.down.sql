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
    -- F7S3-06 : seulement les groupes que 078 a modifiés (audités `migration:078`), jamais ceux qui ont reçu
    -- `role.read` à leur création (constante), qui n'ont pas de compte technique 078 et perdraient le droit sans trace.
    AND EXISTS (SELECT 1 FROM audit_log a
                WHERE a.tenant_id = r.tenant_id AND a.entity_id::text = r.id::text AND a.request_id = 'migration:078')
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
