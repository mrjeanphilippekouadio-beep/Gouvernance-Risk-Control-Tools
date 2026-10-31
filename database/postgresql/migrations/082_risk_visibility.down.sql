-- Rollback of 082_risk_visibility.sql : supprime `risk_visible_to` et retire `resourcevisibility.set` des seuls groupes
-- Risk Manager que 082 a modifiés (audités `migration:082`, patron F7S3-06), avec sa ligne d'audit. Le compte technique
-- « Système (migration 082) » reste : il est l'auteur des lignes d'audit. Les niveaux de visibilité déjà posés ne sont
-- pas réécrits ici (la colonne appartient à 080) ; le code d'avant 082 ne les lit pas autrement que « CLIENT seulement ».
-- Le fichier gère sa transaction : `psql -v ON_ERROR_STOP=1 -f` (sans -1).
BEGIN;

WITH changed AS (
  UPDATE roles r
  SET permissions = array_remove(r.permissions, 'resourcevisibility.set'),
      updated_at = now()
  FROM roles old
  WHERE old.id = r.id AND r.system_group = 'RISK_MANAGER' AND 'resourcevisibility.set' = ANY (r.permissions)
    AND EXISTS (SELECT 1 FROM audit_log a
                WHERE a.tenant_id = r.tenant_id AND a.entity_id::text = r.id::text AND a.request_id = 'migration:082')
  RETURNING r.tenant_id, r.id, r.name, old.permissions AS before, r.permissions AS after
)
INSERT INTO audit_log (tenant_id, user_id, entity_type, entity_id, action, old_value, new_value, reason, request_id)
SELECT c.tenant_id, s.id, 'Role', c.id, 'PERMISSION_CHANGE',
       jsonb_build_object('id', c.id, 'name', c.name, 'permissions', c.before),
       jsonb_build_object('id', c.id, 'name', c.name, 'permissions', c.after),
       'Retour arrière de la migration 082',
       'migration:082:down'
FROM changed c
JOIN users s ON s.tenant_id = c.tenant_id AND s.email = 'migration-082@system.invalid';

DROP FUNCTION IF EXISTS risk_visible_to(uuid, uuid, uuid);

DELETE FROM schema_migrations WHERE filename = '082_risk_visibility.sql';

COMMIT;
