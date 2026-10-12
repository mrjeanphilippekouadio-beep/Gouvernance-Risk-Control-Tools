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

-- 8. q94 (DECISION-044 + F-D044-01) : cumuls Risk Manager + Comite DEJA existants (interdits depuis, non configurable). Le Comite
-- compte aussi par permission : riskevaluation.validate.committee, treatmentdecision.validate.committee, governance.validate. Lecture seule, a executer par HUMAN.
-- Attendu : 0 ligne ; sinon decider avec le PO qui garde quel groupe (jamais de revocation silencieuse). Un tel utilisateur ne peut plus etre reactive tant que le cumul subsiste.
SELECT u.tenant_id, u.id AS user_id, u.email, (u.deleted_at IS NOT NULL) AS suspended,
       array_agg(DISTINCT r.name) FILTER (WHERE r.system_group = 'RISK_MANAGER') AS risk_manager_roles,
       array_agg(DISTINCT r.name) FILTER (WHERE r.system_group = 'RISK_COMMITTEE') AS committee_roles,
       array_agg(DISTINCT r.name) FILTER (WHERE r.permissions && ARRAY['riskevaluation.validate.committee','treatmentdecision.validate.committee','governance.validate']) AS committee_permission_roles
FROM users u
JOIN user_roles ur ON ur.tenant_id = u.tenant_id AND ur.user_id = u.id AND ur.revoked_at IS NULL
JOIN roles r ON r.id = ur.role_id AND r.tenant_id = ur.tenant_id AND r.deleted_at IS NULL
GROUP BY u.tenant_id, u.id, u.email, u.deleted_at
HAVING bool_or(r.system_group = 'RISK_MANAGER')
   AND bool_or(r.system_group = 'RISK_COMMITTEE' OR r.permissions && ARRAY['riskevaluation.validate.committee','treatmentdecision.validate.committee','governance.validate']);

-- 9. q79 (DECISION-044) : personnes devenues « administrateur » par la seule permission de gestion du client (config.manage :
-- clients, modules, referentiels, categories de risque, import Excel) et qui sont aussi Risk Manager ou Comite
-- (cumul admin + RM = q63, admin + Comite = q80 : motif + tiers prevenu a poser a posteriori). Lecture seule, a executer par HUMAN.
-- admin_before_q79 = deja administrateur avec la liste d'avant ; sinon la personne n'est concernee QUE depuis q79.
SELECT u.tenant_id, u.id AS user_id, u.email, (u.deleted_at IS NOT NULL) AS suspended,
       array_agg(DISTINCT r.name) FILTER (WHERE 'config.manage' = ANY (r.permissions)) AS client_management_roles,
       bool_or(r.system_group = 'RISK_MANAGER')   AS is_risk_manager,
       bool_or(r.system_group = 'RISK_COMMITTEE') AS is_committee,
       bool_or(r.permissions && ARRAY['role.create','role.update','role.delete','role.assign','user.create','user.update','user.delete',
                                      'user.reactivate','rolegroup.audit.update','config.cumul.set','config.committeeenforcement.set']) AS admin_before_q79
FROM users u
JOIN user_roles ur ON ur.tenant_id = u.tenant_id AND ur.user_id = u.id AND ur.revoked_at IS NULL
JOIN roles r ON r.id = ur.role_id AND r.tenant_id = ur.tenant_id AND r.deleted_at IS NULL
GROUP BY u.tenant_id, u.id, u.email, u.deleted_at
HAVING bool_or('config.manage' = ANY (r.permissions));
