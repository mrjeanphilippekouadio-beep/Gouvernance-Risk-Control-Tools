-- Migrates raci_assignments.entity_type from PascalCase ('Risk',
-- 'Control', 'ActionPlan') to the SNAKE_CASE upper convention of the
-- canonical GrcObjectType (backend/src/domain/GrcObjectType.ts):
-- 'RISK', 'CONTROL', 'ACTION_PLAN'. RaciEntityType (RaciAssignment.ts)
-- was the one PascalCase outlier among this codebase's polymorphic
-- object-type whitelists (see GrcObjectType.ts's migration note) — this
-- brings it in line.
--
-- Numbering: 027_raci_assignments.sql is the latest migration in this
-- repo at the time this file was authored — confirmed by listing the
-- migrations directory directly before writing (anti-collision
-- protocol, GRC_Migration_Plan.md §1).
--
-- Data safety: this environment has no live/dev database to inspect
-- directly, so this migration does not assume the table is empty. It
-- renames any existing PascalCase rows before installing the new CHECK,
-- rather than only swapping the constraint — a table already holding
-- 'Risk'/'Control'/'ActionPlan' rows would otherwise fail the new CHECK
-- (if run non-validated data survives) or reject all future reads that
-- filter by the new values. Idempotent: rerunning after the values are
-- already renamed is a no-op (the UPDATE matches zero rows, the DROP/ADD
-- CONSTRAINT still runs but ADD is guarded by the migration runner's
-- once-only semantics like every other migration here).

UPDATE raci_assignments SET entity_type = 'RISK' WHERE entity_type = 'Risk';
UPDATE raci_assignments SET entity_type = 'CONTROL' WHERE entity_type = 'Control';
UPDATE raci_assignments SET entity_type = 'ACTION_PLAN' WHERE entity_type = 'ActionPlan';

ALTER TABLE raci_assignments DROP CONSTRAINT raci_assignments_entity_type_check;
ALTER TABLE raci_assignments ADD CONSTRAINT raci_assignments_entity_type_check
  CHECK (entity_type IN ('RISK', 'CONTROL', 'ACTION_PLAN'));
