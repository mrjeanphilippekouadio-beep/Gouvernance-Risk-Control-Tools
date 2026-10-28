-- 077 — q186 (DECISION-096) : retirer les 4 droits de décision de gouvernance (q179) des rôles ordinaires
-- (system_group IS NULL, y compris supprimés : un rôle restauré ne doit pas les retrouver, SEC-077-02) et des droits directs `users.roles`, avec une ligne d'audit_log par rôle / compte modifié.
-- Depuis q179 ils ne peuvent plus y être ajoutés (RoleService), mais un administrateur a pu le faire avant :
-- ces droits comptaient encore comme approbateurs (PostgresGovernanceQueries.existsOther, SEC-SA2-02).
-- Liste identique à GOVERNANCE_DECISION_RIGHTS (backend/src/domain/fixedGroupPermissions.ts, un test garde la synchro).
-- Les groupes fixes ne sont pas touchés. Aucune suppression physique. Idempotente : un second passage ne trouve plus rien.
--
-- Acteur de l'audit : audit_log.user_id est obligatoire et aucun compte « système » n'existe. Pour ne rien attribuer à
-- une personne, un compte technique « Système (migration 077) » est créé, déjà suspendu (deleted_at renseigné : il ne
-- compte nulle part comme actif et ne peut pas se connecter, adresse .invalid), seulement dans les tenants où il y a
-- quelque chose à retirer.

INSERT INTO users (tenant_id, email, display_name, roles, deleted_at)
SELECT t.tenant_id, 'migration-077@system.invalid', 'Système (migration 077)', '{}', now()
FROM (
  SELECT tenant_id FROM roles
  WHERE system_group IS NULL
    AND permissions && ARRAY['config.selfvalidation.approve', 'governanceprinciple.acceptance.confirm', 'governanceexception.review', 'orgprofile.approve']::text[]
  UNION
  SELECT tenant_id FROM users
  WHERE roles && ARRAY['config.selfvalidation.approve', 'governanceprinciple.acceptance.confirm', 'governanceexception.review', 'orgprofile.approve']::text[]
) t
WHERE NOT EXISTS (SELECT 1 FROM users u WHERE u.tenant_id = t.tenant_id AND u.email = 'migration-077@system.invalid');

WITH changed AS (
  UPDATE roles r
  SET permissions = ARRAY(
        SELECT p FROM unnest(r.permissions) WITH ORDINALITY AS x(p, i)
        WHERE p <> ALL (ARRAY['config.selfvalidation.approve', 'governanceprinciple.acceptance.confirm', 'governanceexception.review', 'orgprofile.approve']::text[])
        ORDER BY i),
      updated_at = now()
  FROM roles old
  WHERE old.id = r.id AND r.system_group IS NULL
    AND r.permissions && ARRAY['config.selfvalidation.approve', 'governanceprinciple.acceptance.confirm', 'governanceexception.review', 'orgprofile.approve']::text[]
  RETURNING r.tenant_id, r.id, r.name, old.permissions AS before, r.permissions AS after
)
INSERT INTO audit_log (tenant_id, user_id, entity_type, entity_id, action, old_value, new_value, reason, request_id)
SELECT c.tenant_id, s.id, 'Role', c.id, 'PERMISSION_CHANGE',
       jsonb_build_object('id', c.id, 'name', c.name, 'permissions', c.before),
       jsonb_build_object('id', c.id, 'name', c.name, 'permissions', c.after),
       'Migration 077 (q186, DECISION-096) : droits de décision de gouvernance réservés aux groupes fixes (q179)',
       'migration:077'
FROM changed c
JOIN users s ON s.tenant_id = c.tenant_id AND s.email = 'migration-077@system.invalid';

WITH changed AS (
  UPDATE users u
  SET roles = ARRAY(
        SELECT p FROM unnest(u.roles) WITH ORDINALITY AS x(p, i)
        WHERE p <> ALL (ARRAY['config.selfvalidation.approve', 'governanceprinciple.acceptance.confirm', 'governanceexception.review', 'orgprofile.approve']::text[])
        ORDER BY i)
  FROM users old
  WHERE old.id = u.id
    AND u.roles && ARRAY['config.selfvalidation.approve', 'governanceprinciple.acceptance.confirm', 'governanceexception.review', 'orgprofile.approve']::text[]
  RETURNING u.tenant_id, u.id, old.roles AS before, u.roles AS after
)
INSERT INTO audit_log (tenant_id, user_id, entity_type, entity_id, action, old_value, new_value, reason, request_id)
SELECT c.tenant_id, s.id, 'User', c.id, 'PERMISSION_CHANGE',
       jsonb_build_object('roles', c.before),
       jsonb_build_object('roles', c.after),
       'Migration 077 (q186, DECISION-096) : droits de décision de gouvernance réservés aux groupes fixes (q179)',
       'migration:077'
FROM changed c
JOIN users s ON s.tenant_id = c.tenant_id AND s.email = 'migration-077@system.invalid';
