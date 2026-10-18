-- D2d (RM-V1-Panel-Principes-Gouvernance.md, « Révision DECISION-074 », donnée 10) : régime « structure à une personne »
-- (DECISION-059, DECISION-066 « ne jamais bloquer », DECISION-075 q148). SCHÉMA ET GARDES SEULEMENT : le mécanisme de
-- déclaration par l'éditeur (opération d'exploitation hors API, q117 : jamais par le client) reste à définir avec A09.
-- Ne jamais appliquer à la main : passe par `npm run migrate`.
--
--   tenants.single_person_regime_declared_at    NULL = régime non déclaré. Posé par l'éditeur, immuable ensuite.
--   tenants.single_person_regime_lift_threshold nombre de personnes actives ayant un rôle qui lève le régime
--                                               (DECISION-066 point 6 : configurable ; défaut 2 = « deuxième personne »).
--   tenants.single_person_regime_lifted_at      levée MÉMORISÉE, posée par trigger, jamais remise à NULL.
--   tenants.single_person_regime_lift_ref       id de la ligne déclencheuse (user_roles, users ou roles).
--
-- Même modèle que 062 mais fonctions DISTINCTES (risk_framework_bootstrap_end_mark n'est pas redéfinie). Toutes les
-- fonctions épinglent search_path = pg_catalog, public, pg_temp (F-B6a-11, migration 058).
-- Idempotente : IF NOT EXISTS, DO $$ sur pg_constraint, CREATE OR REPLACE, DROP TRIGGER IF EXISTS.

ALTER TABLE tenants ADD COLUMN IF NOT EXISTS single_person_regime_declared_at timestamptz NULL;
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS single_person_regime_lift_threshold integer NOT NULL DEFAULT 2;
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS single_person_regime_lifted_at timestamptz NULL;
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS single_person_regime_lift_ref uuid NULL;
COMMENT ON COLUMN tenants.single_person_regime_declared_at IS
  'régime structure à une personne déclaré par l''éditeur (NULL = non déclaré) ; set-once';
COMMENT ON COLUMN tenants.single_person_regime_lift_threshold IS
  'nombre de personnes actives ayant un rôle qui lève le régime (>= 2) ; modifiable tant que le régime n''est pas levé';
COMMENT ON COLUMN tenants.single_person_regime_lifted_at IS
  'levée définitive du régime, posée par trigger, jamais remise à NULL';
COMMENT ON COLUMN tenants.single_person_regime_lift_ref IS
  'id de la ligne déclencheuse (user_roles, users ou roles)';

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'tenants_single_person_regime_shape_check'
                 AND conrelid = 'tenants'::regclass) THEN
    ALTER TABLE tenants ADD CONSTRAINT tenants_single_person_regime_shape_check
      CHECK (single_person_regime_lift_threshold >= 2
             AND (single_person_regime_lifted_at IS NULL OR single_person_regime_declared_at IS NOT NULL)
             AND (single_person_regime_lift_ref IS NULL OR single_person_regime_lifted_at IS NOT NULL));
  END IF;
END $$;

-- Personnes DISTINCTES actives ayant un rôle (affectation non révoquée, rôle et utilisateur non supprimés, même tenant).
CREATE OR REPLACE FUNCTION single_person_regime_people(t uuid) RETURNS integer LANGUAGE sql STABLE
  SET search_path = pg_catalog, public, pg_temp AS $$
  SELECT count(DISTINCT ur.user_id)::integer
  FROM user_roles ur
  JOIN roles r ON r.id = ur.role_id AND r.tenant_id = ur.tenant_id AND r.deleted_at IS NULL
  JOIN users u ON u.id = ur.user_id AND u.tenant_id = ur.tenant_id AND u.deleted_at IS NULL
  WHERE ur.tenant_id = t AND ur.revoked_at IS NULL;
$$;

-- Garde set-once sur tenants. La levée (lifted_at, lift_ref, seuil) est définitive ; la déclaration est refusée si le
-- seuil est déjà atteint (le régime serait levé dès sa naissance).
CREATE OR REPLACE FUNCTION tenants_single_person_regime_guard() RETURNS trigger LANGUAGE plpgsql
  SET search_path = pg_catalog, public, pg_temp AS $$
BEGIN
  IF OLD.single_person_regime_declared_at IS NOT NULL
     AND NEW.single_person_regime_declared_at IS DISTINCT FROM OLD.single_person_regime_declared_at THEN
    RAISE EXCEPTION 'tenants: the single-person regime declaration is set-once' USING ERRCODE = '42501';
  END IF;
  IF OLD.single_person_regime_lifted_at IS NOT NULL
     AND (NEW.single_person_regime_lifted_at IS DISTINCT FROM OLD.single_person_regime_lifted_at
          OR NEW.single_person_regime_lift_ref IS DISTINCT FROM OLD.single_person_regime_lift_ref
          OR NEW.single_person_regime_lift_threshold IS DISTINCT FROM OLD.single_person_regime_lift_threshold) THEN
    RAISE EXCEPTION 'tenants: the lifting of the single-person regime is definitive and cannot be changed' USING ERRCODE = '42501';
  END IF;
  IF OLD.single_person_regime_declared_at IS NULL AND NEW.single_person_regime_declared_at IS NOT NULL
     AND NEW.single_person_regime_lifted_at IS NULL
     AND single_person_regime_people(NEW.id) >= NEW.single_person_regime_lift_threshold THEN
    RAISE EXCEPTION 'tenants: the lift threshold is already reached, the single-person regime cannot be declared' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS tenants_single_person_regime_guard ON tenants;
CREATE TRIGGER tenants_single_person_regime_guard
  BEFORE UPDATE ON tenants
  FOR EACH ROW EXECUTE FUNCTION tenants_single_person_regime_guard();

-- Levée mémorisée. Verrou NO KEY UPDATE du tenant comme 062 : deux affectations concurrentes sont sérialisées.
CREATE OR REPLACE FUNCTION single_person_regime_lift_mark() RETURNS trigger LANGUAGE plpgsql
  SET search_path = pg_catalog, public, pg_temp AS $$
DECLARE
  t uuid := NEW.tenant_id;
  thr integer;
BEGIN
  SELECT single_person_regime_lift_threshold INTO thr FROM tenants
  WHERE id = t AND single_person_regime_declared_at IS NOT NULL AND single_person_regime_lifted_at IS NULL
  FOR NO KEY UPDATE;
  IF NOT FOUND THEN
    RETURN NEW; -- non déclaré ou déjà levé
  END IF;
  IF single_person_regime_people(t) >= thr THEN
    UPDATE tenants SET single_person_regime_lifted_at = now(), single_person_regime_lift_ref = NEW.id
    WHERE id = t AND single_person_regime_lifted_at IS NULL;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS user_roles_single_person_lift_insert ON user_roles;
CREATE TRIGGER user_roles_single_person_lift_insert
  AFTER INSERT ON user_roles
  FOR EACH ROW WHEN (NEW.revoked_at IS NULL)
  EXECUTE FUNCTION single_person_regime_lift_mark();

DROP TRIGGER IF EXISTS user_roles_single_person_lift_update ON user_roles;
CREATE TRIGGER user_roles_single_person_lift_update
  AFTER UPDATE OF revoked_at ON user_roles
  FOR EACH ROW WHEN (OLD.revoked_at IS NOT NULL AND NEW.revoked_at IS NULL)
  EXECUTE FUNCTION single_person_regime_lift_mark();

DROP TRIGGER IF EXISTS users_single_person_lift ON users;
CREATE TRIGGER users_single_person_lift
  AFTER UPDATE OF deleted_at ON users
  FOR EACH ROW WHEN (OLD.deleted_at IS NOT NULL AND NEW.deleted_at IS NULL)
  EXECUTE FUNCTION single_person_regime_lift_mark();

DROP TRIGGER IF EXISTS roles_single_person_lift ON roles;
CREATE TRIGGER roles_single_person_lift
  AFTER UPDATE OF deleted_at ON roles
  FOR EACH ROW WHEN (OLD.deleted_at IS NOT NULL AND NEW.deleted_at IS NULL)
  EXECUTE FUNCTION single_person_regime_lift_mark();
