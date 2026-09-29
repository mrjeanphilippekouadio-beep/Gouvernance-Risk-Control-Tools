-- Rollback for 028_raci_entity_type_snake_case.sql
--
-- Reverses the SNAKE_CASE entity_type values back to the original
-- PascalCase values and restores the CHECK constraint installed by
-- 027_raci_assignments.sql.
--
-- Safe to run at any time after 028 has been applied: this is the exact
-- inverse of 028's data UPDATE + constraint swap, so replaying
-- 027 -> 028 -> (this rollback) leaves raci_assignments in the same state
-- it was in right after 027, with no data loss, as long as no later
-- migration has since added a dependency on the SNAKE_CASE values (none
-- does as of 028 — check the migrations directory before running this in
-- an environment that may have advanced further).
--
-- How to run this file: see README.md in this directory.

UPDATE raci_assignments SET entity_type = 'Risk' WHERE entity_type = 'RISK';
UPDATE raci_assignments SET entity_type = 'Control' WHERE entity_type = 'CONTROL';
UPDATE raci_assignments SET entity_type = 'ActionPlan' WHERE entity_type = 'ACTION_PLAN';

ALTER TABLE raci_assignments DROP CONSTRAINT raci_assignments_entity_type_check;
ALTER TABLE raci_assignments ADD CONSTRAINT raci_assignments_entity_type_check
  CHECK (entity_type IN ('Risk', 'Control', 'ActionPlan'));

DELETE FROM schema_migrations WHERE filename = '028_raci_entity_type_snake_case.sql';
