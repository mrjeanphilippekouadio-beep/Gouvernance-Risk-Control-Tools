-- Lot D2c (DECISION-074/075, RM-V1-Panel-Principes-Gouvernance.md, R-3) : désignations de gouvernance.
--
-- governance_designations : gérant désigné (MANAGER) et intérimaire du Risk Manager (RISK_MANAGER_INTERIM).
--   - Fin = ended_at (soft), jamais de DELETE. Une désignation active par (tenant, kind).
--   - RISK_MANAGER_INTERIM : date de fin prévue (valid_until) obligatoire (DECISION-074 q137). Jamais de retrait automatique.
--   - activated_at / activated_ref : posés par handOverLastRiskManager quand l'intérimaire reçoit le rôle au départ du dernier RM.
--   - designated_by <> user_id : pas d'auto-désignation (I-R1, DECISION-072).
--   - Garde (SEC-PNL-06, F-PNL-07, CMP-PNL-10) sur le modèle de 071 : trigger BEFORE UPDATE OR DELETE + BEFORE TRUNCATE,
--     search_path épinglé, REVOKE DELETE/TRUNCATE au rôle d'exécution. Le contenu (kind, user_id, reason, valid_until,
--     designated_by, created_at) est immuable. Seules transitions : consommation de l'intérimaire (activated_at +
--     activated_ref posés ENSEMBLE, une fois, sur une désignation active et non échue, jamais remis à NULL) et fin
--     (ended_at/ended_by/end_reason posés ensemble, une fois). Le garde-fou d'amorçage 062 reste celui de user_roles.
--   - FK COMPOSITES (tenant_id, user_id | designated_by | ended_by) -> users (tenant_id, id) : pas d'utilisateur d'un autre
--     tenant (UNIQUE (tenant_id, id) sur users, ajoutée par 069 ; recréée ici si absente).
--
-- Permission designation.manage : rattrapée pour les rôles « administrateur » (hors groupes fixes) et users.roles,
-- même règle que 066 (porteurs d'une permission de gestion de ADMIN_PERMISSIONS). Aucun groupe fixe n'en reçoit.
-- Idempotente.

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'users_tenant_id_id_key' AND conrelid = 'users'::regclass) THEN
    ALTER TABLE users ADD CONSTRAINT users_tenant_id_id_key UNIQUE (tenant_id, id);
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS governance_designations (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     uuid NOT NULL REFERENCES tenants (id),
  kind          text NOT NULL CHECK (kind IN ('MANAGER', 'RISK_MANAGER_INTERIM')),
  user_id       uuid NOT NULL,
  reason        text NOT NULL CHECK (length(btrim(reason)) > 0),
  valid_until   timestamptz,
  activated_at  timestamptz,
  activated_ref uuid,
  designated_by uuid NOT NULL,
  created_at    timestamptz NOT NULL DEFAULT now(),
  ended_at      timestamptz,
  ended_by      uuid,
  end_reason    text,
  CONSTRAINT governance_designations_user_tenant_fk FOREIGN KEY (tenant_id, user_id) REFERENCES users (tenant_id, id),
  CONSTRAINT governance_designations_designated_by_tenant_fk FOREIGN KEY (tenant_id, designated_by) REFERENCES users (tenant_id, id),
  CONSTRAINT governance_designations_ended_by_tenant_fk FOREIGN KEY (tenant_id, ended_by) REFERENCES users (tenant_id, id),
  CONSTRAINT governance_designations_activation_consistent CHECK ((activated_at IS NULL) = (activated_ref IS NULL)),
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

CREATE OR REPLACE FUNCTION governance_designations_guard() RETURNS trigger LANGUAGE plpgsql
  SET search_path = pg_catalog, public, pg_temp AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'governance_designations: rows are never deleted' USING ERRCODE = '42501';
  END IF;
  IF NEW.id IS DISTINCT FROM OLD.id OR NEW.tenant_id IS DISTINCT FROM OLD.tenant_id OR NEW.kind IS DISTINCT FROM OLD.kind
     OR NEW.user_id IS DISTINCT FROM OLD.user_id OR NEW.reason IS DISTINCT FROM OLD.reason
     OR NEW.valid_until IS DISTINCT FROM OLD.valid_until OR NEW.designated_by IS DISTINCT FROM OLD.designated_by
     OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
    RAISE EXCEPTION 'governance_designations: the content of a designation is immutable' USING ERRCODE = '42501';
  END IF;
  IF OLD.activated_at IS NOT NULL THEN
    IF NEW.activated_at IS DISTINCT FROM OLD.activated_at OR NEW.activated_ref IS DISTINCT FROM OLD.activated_ref THEN
      RAISE EXCEPTION 'governance_designations: a used interim cannot be re-armed' USING ERRCODE = '42501';
    END IF;
  ELSIF NEW.activated_at IS NOT NULL THEN
    IF OLD.kind <> 'RISK_MANAGER_INTERIM' OR OLD.ended_at IS NOT NULL OR NEW.ended_at IS NOT NULL OR OLD.valid_until <= now() THEN
      RAISE EXCEPTION 'governance_designations: only an active, unexpired interim designation can be used' USING ERRCODE = '42501';
    END IF;
  END IF;
  IF OLD.ended_at IS NOT NULL THEN
    IF NEW.ended_at IS DISTINCT FROM OLD.ended_at OR NEW.ended_by IS DISTINCT FROM OLD.ended_by
       OR NEW.end_reason IS DISTINCT FROM OLD.end_reason THEN
      RAISE EXCEPTION 'governance_designations: the end of a designation is set once' USING ERRCODE = '42501';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
ALTER FUNCTION governance_designations_guard() SET search_path = pg_catalog, public, pg_temp;

DROP TRIGGER IF EXISTS governance_designations_guard ON governance_designations;
CREATE TRIGGER governance_designations_guard
  BEFORE UPDATE OR DELETE ON governance_designations
  FOR EACH ROW EXECUTE FUNCTION governance_designations_guard();

CREATE OR REPLACE FUNCTION governance_designations_truncate_guard() RETURNS trigger LANGUAGE plpgsql
  SET search_path = pg_catalog, public, pg_temp AS $$
BEGIN
  RAISE EXCEPTION 'governance_designations cannot be truncated' USING ERRCODE = '42501';
END;
$$;
ALTER FUNCTION governance_designations_truncate_guard() SET search_path = pg_catalog, public, pg_temp;

DROP TRIGGER IF EXISTS governance_designations_truncate_guard ON governance_designations;
CREATE TRIGGER governance_designations_truncate_guard
  BEFORE TRUNCATE ON governance_designations
  FOR EACH STATEMENT EXECUTE FUNCTION governance_designations_truncate_guard();

REVOKE DELETE, TRUNCATE ON governance_designations FROM grc_app_runtime;

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
