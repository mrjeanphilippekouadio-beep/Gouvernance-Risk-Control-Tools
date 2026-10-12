-- B-8 / B-8 bis / B-8 ter : controles a lancer AVANT la production (lecture seule, ne rien modifier).
-- A lancer a la main sur la base cible (staging puis prod) ; jamais par le runner de migrations.

-- 1. Utilisateurs actifs a la fois dans Risk Manager et Audit, ou Risk Manager + un role portant une
--    permission audit.* (regle q43, F-B8b-05). Attendu : 0 ligne. Les groupes adoptes par nom en 049
--    ou des roles crees avant B-8 bis peuvent en contenir ; signaler a A14, ne pas revoquer en silence (q58).
SELECT u.tenant_id, u.id AS user_id, u.email,
       array_agg(DISTINCT r.name) FILTER (WHERE r.system_group = 'RISK_MANAGER') AS risk_manager_roles,
       array_agg(DISTINCT r.name) FILTER (
         WHERE r.system_group = 'AUDIT' OR EXISTS (SELECT 1 FROM unnest(r.permissions) p WHERE p LIKE 'audit.%')
       ) AS audit_roles
FROM users u
JOIN user_roles ur ON ur.tenant_id = u.tenant_id AND ur.user_id = u.id AND ur.revoked_at IS NULL
JOIN roles r ON r.id = ur.role_id AND r.tenant_id = ur.tenant_id AND r.deleted_at IS NULL
WHERE u.deleted_at IS NULL
GROUP BY u.tenant_id, u.id, u.email
HAVING bool_or(r.system_group = 'RISK_MANAGER')
   AND bool_or(r.system_group = 'AUDIT' OR EXISTS (SELECT 1 FROM unnest(r.permissions) p WHERE p LIKE 'audit.%'));

-- 2. Roles adoptes en 049 dont les droits ne sont pas vides (051 ne les ecrase pas) : a revoir contre q42.
SELECT tenant_id, name, system_group, cardinality(permissions) AS nb_permissions
FROM roles
WHERE system_group IS NOT NULL AND deleted_at IS NULL AND cardinality(permissions) > 0;

-- 3. Avant la migration 053 : plusieurs changements PENDING pour un meme role (la migration echoue sinon).
SELECT role_id, count(*) FROM role_permission_changes WHERE status = 'PENDING' GROUP BY role_id HAVING count(*) > 1;

-- 4. Groupes Audit portant deja une permission hors lecture (liste blanche F-B8b-01). Attendu : 0 ligne.
SELECT tenant_id, name, p AS permission
FROM roles, unnest(permissions) AS p
WHERE system_group = 'AUDIT' AND deleted_at IS NULL
  AND NOT (p LIKE '%.read' OR p LIKE '%.download' OR p IN ('dashboard.executive', 'rolegroup.audit.validate'));

-- 5. rolegroup.audit.* porte par un role qui n'est ni Audit ni Comite (validate) ou par n'importe quel role (update).
SELECT tenant_id, name, system_group, p AS permission
FROM roles, unnest(permissions) AS p
WHERE deleted_at IS NULL AND p LIKE 'rolegroup.audit.%'
  AND NOT (p = 'rolegroup.audit.validate' AND system_group IN ('AUDIT', 'RISK_COMMITTEE'));

-- 6. F-B8t-03 : changements de droits Audit PENDING contenant une permission hors liste blanche (a rejeter avant la production). Attendu : 0 ligne.
SELECT c.tenant_id, c.id AS change_id, c.role_id, p AS permission
FROM role_permission_changes c, unnest(c.permissions) AS p
WHERE c.status = 'PENDING'
  AND NOT (p LIKE '%.read' OR p LIKE '%.download' OR p IN ('dashboard.executive', 'rolegroup.audit.validate'));

-- 7. F-B8q-03 : changements de droits Audit APPROVED sans ligne audit_logs (droits appliques ou non, trace manquante).
-- Reconciliation a lancer apres tout incident d'ecriture d'audit. Attendu : 0 ligne ; sinon rejouer l'evenement a la main.
SELECT c.tenant_id, c.id AS change_id, c.role_id, c.decided_by, c.decided_at
FROM role_permission_changes c
WHERE c.status = 'APPROVED'
  AND NOT EXISTS (
    SELECT 1 FROM audit_logs a
    WHERE a.tenant_id = c.tenant_id AND a.entity_type = 'RolePermissionChange'
      AND a.entity_id = c.id AND a.action = 'APPROVE'
  );
