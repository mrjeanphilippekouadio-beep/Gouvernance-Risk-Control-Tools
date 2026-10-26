-- Rollback of 068_single_person_regime.sql (D2d).
--
-- !! A ne pas jouer sur un tenant dont le régime est déclaré ou levé sans export préalable : la descente efface la
-- !! déclaration, la levée mémorisée et le seuil (un régime levé se rouvrirait).
-- Le fichier gère sa transaction : `psql -v ON_ERROR_STOP=1 -f` (sans -1).
BEGIN;

DROP TRIGGER IF EXISTS user_roles_single_person_lift_insert ON user_roles;
DROP TRIGGER IF EXISTS user_roles_single_person_lift_update ON user_roles;
DROP TRIGGER IF EXISTS users_single_person_lift ON users;
DROP TRIGGER IF EXISTS roles_single_person_lift ON roles;
DROP TRIGGER IF EXISTS tenants_single_person_regime_guard ON tenants;
DROP FUNCTION IF EXISTS single_person_regime_lift_mark();
DROP FUNCTION IF EXISTS tenants_single_person_regime_guard();
DROP FUNCTION IF EXISTS single_person_regime_people(uuid);
ALTER TABLE tenants DROP CONSTRAINT IF EXISTS tenants_single_person_regime_shape_check;
ALTER TABLE tenants DROP COLUMN IF EXISTS single_person_regime_lift_ref;
ALTER TABLE tenants DROP COLUMN IF EXISTS single_person_regime_lifted_at;
ALTER TABLE tenants DROP COLUMN IF EXISTS single_person_regime_lift_threshold;
ALTER TABLE tenants DROP COLUMN IF EXISTS single_person_regime_declared_at;

DELETE FROM schema_migrations WHERE filename = '068_single_person_regime.sql';

COMMIT;
