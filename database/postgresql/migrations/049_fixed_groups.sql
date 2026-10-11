-- B-8 (R1.2): groupes fixes + rattachement département.
-- Un groupe = un rôle (roles/user_roles, migration 013). Trois groupes
-- fixes par tenant (Risk Manager, Risk Committee, Audit), non supprimables
-- (appliqué par RoleService). Un département est un groupe : roles.department_id
-- (nullable, unique par tenant parmi les rôles actifs). Chaque Processus se
-- rattache à un département : processes.department_id (nullable en base le
-- temps du rattrapage des données existantes, F-11).

ALTER TABLE roles
  ADD COLUMN system_group  text CHECK (system_group IN ('RISK_MANAGER', 'RISK_COMMITTEE', 'AUDIT')),
  ADD COLUMN department_id uuid REFERENCES departments (id);

CREATE UNIQUE INDEX roles_active_system_group_idx ON roles (tenant_id, system_group)
  WHERE system_group IS NOT NULL AND deleted_at IS NULL;
CREATE UNIQUE INDEX roles_active_department_idx ON roles (tenant_id, department_id)
  WHERE department_id IS NOT NULL AND deleted_at IS NULL;

-- Un groupe fixe n'est jamais aussi un groupe de département.
ALTER TABLE roles ADD CONSTRAINT roles_system_group_no_department
  CHECK (system_group IS NULL OR department_id IS NULL);

ALTER TABLE processes ADD COLUMN department_id uuid REFERENCES departments (id);
CREATE INDEX processes_department_idx ON processes (tenant_id, department_id) WHERE deleted_at IS NULL;

-- Tenants existants : un rôle actif déjà nommé comme un groupe fixe est
-- adopté (ses permissions sont conservées) ; sinon le groupe est créé sans
-- permission (appartenir à un groupe n'accorde rien tant que le PO n'a pas
-- décidé des droits du groupe).
UPDATE roles SET system_group = 'RISK_MANAGER'   WHERE name = 'Risk Manager'   AND deleted_at IS NULL;
UPDATE roles SET system_group = 'RISK_COMMITTEE' WHERE name = 'Risk Committee' AND deleted_at IS NULL;
UPDATE roles SET system_group = 'AUDIT'          WHERE name = 'Audit'          AND deleted_at IS NULL;

INSERT INTO roles (tenant_id, name, description, permissions, system_group)
SELECT t.id, g.name, g.description, '{}', g.system_group
FROM tenants t
CROSS JOIN (VALUES
  ('Risk Manager',   'Groupe fixe : équipe risque (jamais vide)', 'RISK_MANAGER'),
  ('Risk Committee', 'Groupe fixe : Comité des risques (peut être vide)', 'RISK_COMMITTEE'),
  ('Audit',          'Groupe fixe : Audit (peut être vide)', 'AUDIT')
) AS g (name, description, system_group)
WHERE NOT EXISTS (
  SELECT 1 FROM roles r
  WHERE r.tenant_id = t.id AND r.system_group = g.system_group AND r.deleted_at IS NULL
);
