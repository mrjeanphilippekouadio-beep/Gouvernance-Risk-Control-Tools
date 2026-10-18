-- Lot D2c (DECISION-074/075, RM-V1-Panel-Principes-Gouvernance.md, R-3) : désignations de gouvernance.
--
-- governance_designations : gérant désigné (MANAGER) et intérimaire du Risk Manager (RISK_MANAGER_INTERIM).
--   - Fin = ended_at (soft), jamais de DELETE. Une désignation active par (tenant, kind).
--   - RISK_MANAGER_INTERIM : date de fin prévue (valid_until) obligatoire (DECISION-074 q137). Jamais de retrait automatique.
--   - activated_at / activated_ref : posés par handOverLastRiskManager quand l'intérimaire reçoit le rôle au départ du dernier RM.
--   - designated_by <> user_id : pas d'auto-désignation (I-R1, DECISION-072).
--   - Aucune fonction trigger ici (le garde-fou d'amorçage 062 reste celui de user_roles).
--   - FK simples vers users(id) : le tenant de l'utilisateur est vérifié par le service (comme user_roles, 013).
--
-- Permission designation.manage : rattrapée pour les rôles « administrateur » (hors groupes fixes) et users.roles,
-- même règle que 066 (porteurs d'une permission de gestion de ADMIN_PERMISSIONS). Aucun groupe fixe n'en reçoit.
-- Idempotente.

CREATE TABLE IF NOT EXISTS governance_designations (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     uuid NOT NULL REFERENCES tenants (id),
  kind          text NOT NULL CHECK (kind IN ('MANAGER', 'RISK_MANAGER_INTERIM')),
  user_id       uuid NOT NULL REFERENCES users (id),
  reason        text NOT NULL CHECK (length(btrim(reason)) > 0),
  valid_until   timestamptz,
  activated_at  timestamptz,
  activated_ref uuid,
  designated_by uuid NOT NULL REFERENCES users (id),
  created_at    timestamptz NOT NULL DEFAULT now(),
  ended_at      timestamptz,
  ended_by      uuid REFERENCES users (id),
  end_reason    text,
  CONSTRAINT governance_designations_no_self CHECK (designated_by <> user_id),
  CONSTRAINT governance_designations_interim_end_date CHECK (kind <> 'RISK_MANAGER_INTERIM' OR valid_until IS NOT NULL),
  CONSTRAINT governance_designations_end_consistent CHECK (
    (ended_at IS NULL AND ended_by IS NULL AND end_reason IS NULL)
    OR (ended_at IS NOT NULL AND ended_by IS NOT NULL AND end_reason IS NOT NULL AND length(btrim(end_reason)) > 0)
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS governance_designations_active_kind_idx
  ON governance_designations (tenant_id, kind) WHERE ended_at IS NULL;
CREATE INDEX IF NOT EXISTS governance_designations_tenant_idx
  ON governance_designations (tenant_id, created_at DESC);

UPDATE roles
SET permissions = ARRAY(SELECT DISTINCT unnest(permissions || ARRAY['designation.manage']::text[]))
WHERE system_group IS NULL AND deleted_at IS NULL
  AND permissions && ARRAY[
    'role.create', 'role.update', 'role.delete', 'role.assign',
    'user.create', 'user.update', 'user.delete', 'user.reactivate',
    'rolegroup.audit.update', 'config.cumul.set', 'config.committeeenforcement.set', 'config.manage',
    'config.selfvalidation.set'
  ]::text[];

UPDATE users
SET roles = ARRAY(SELECT DISTINCT unnest(roles || ARRAY['designation.manage']::text[]))
WHERE roles && ARRAY[
    'role.create', 'role.update', 'role.delete', 'role.assign',
    'user.create', 'user.update', 'user.delete', 'user.reactivate',
    'rolegroup.audit.update', 'config.cumul.set', 'config.committeeenforcement.set', 'config.manage',
    'config.selfvalidation.set'
  ]::text[];
