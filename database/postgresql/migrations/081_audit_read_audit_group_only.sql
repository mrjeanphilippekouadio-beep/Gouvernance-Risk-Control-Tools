-- 081 — q203 (DECISION-104) : la lecture du journal d'audit (`audit.read`) est réservée au groupe fixe AUDIT.
-- Le journal restitue le contenu complet des ressources (old/new) : un rôle ordinaire portant `audit.read` lirait le
-- contenu des ressources restreintes (visibilité, DECISION-100) sans le droit distinct q197 A3 (SEC-visibility-v0 V0-03).
-- Depuis 081, RoleService refuse `audit.read` sur tout rôle hors groupe AUDIT ; cette migration retire le droit des rôles
-- non-AUDIT (y compris supprimés : un rôle restauré ne doit pas le retrouver) et des droits directs `users.roles`, avec
-- une ligne d'audit_log par rôle / compte modifié. Les autres `audit.*` (missions, constats) ne sont pas touchés.
-- Le groupe AUDIT n'est pas touché. Aucune suppression physique. Idempotente : un second passage ne trouve plus rien.
--
-- Acteur de l'audit : compte technique « Système (migration 081) », créé déjà suspendu (adresse .invalid, reconnu par
-- isSystemAccount : jamais réactivable ni renommable), seulement dans les tenants où il y a quelque chose à retirer.

INSERT INTO users (tenant_id, email, display_name, roles, deleted_at)
SELECT t.tenant_id, 'migration-081@system.invalid', 'Système (migration 081)', '{}', now()
FROM (
  SELECT tenant_id FROM roles WHERE system_group IS DISTINCT FROM 'AUDIT' AND 'audit.read' = ANY (permissions)
  UNION
  SELECT tenant_id FROM users WHERE 'audit.read' = ANY (roles)
) t
WHERE NOT EXISTS (SELECT 1 FROM users u WHERE u.tenant_id = t.tenant_id AND u.email = 'migration-081@system.invalid');

WITH changed AS (
  UPDATE roles r
  SET permissions = array_remove(r.permissions, 'audit.read'),
      updated_at = now()
  FROM roles old
  WHERE old.id = r.id AND r.system_group IS DISTINCT FROM 'AUDIT' AND 'audit.read' = ANY (r.permissions)
  RETURNING r.tenant_id, r.id, r.name, old.permissions AS before, r.permissions AS after
)
INSERT INTO audit_log (tenant_id, user_id, entity_type, entity_id, action, old_value, new_value, reason, request_id)
SELECT c.tenant_id, s.id, 'Role', c.id, 'PERMISSION_CHANGE',
       jsonb_build_object('id', c.id, 'name', c.name, 'permissions', c.before),
       jsonb_build_object('id', c.id, 'name', c.name, 'permissions', c.after),
       'Migration 081 (q203, DECISION-104) : lecture du journal d''audit réservée au groupe Audit',
       'migration:081'
FROM changed c
JOIN users s ON s.tenant_id = c.tenant_id AND s.email = 'migration-081@system.invalid';

WITH changed AS (
  UPDATE users u
  SET roles = array_remove(u.roles, 'audit.read')
  FROM users old
  WHERE old.id = u.id AND 'audit.read' = ANY (u.roles)
  RETURNING u.tenant_id, u.id, old.roles AS before, u.roles AS after
)
INSERT INTO audit_log (tenant_id, user_id, entity_type, entity_id, action, old_value, new_value, reason, request_id)
SELECT c.tenant_id, s.id, 'User', c.id, 'PERMISSION_CHANGE',
       jsonb_build_object('roles', c.before),
       jsonb_build_object('roles', c.after),
       'Migration 081 (q203, DECISION-104) : lecture du journal d''audit réservée au groupe Audit',
       'migration:081'
FROM changed c
JOIN users s ON s.tenant_id = c.tenant_id AND s.email = 'migration-081@system.invalid';
