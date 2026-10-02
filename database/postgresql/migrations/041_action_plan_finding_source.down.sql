-- Rollback of 041_action_plan_finding_source.sql. Safe only as long as no
-- action_plans row has been inserted with source_type = 'FINDING' yet —
-- check `SELECT count(*) FROM action_plans WHERE source_type = 'FINDING'`
-- returns 0 before running this in a shared environment; otherwise the
-- ADD CONSTRAINT below fails (existing rows would violate it).

ALTER TABLE action_plans DROP CONSTRAINT action_plans_source_type_check;
ALTER TABLE action_plans ADD CONSTRAINT action_plans_source_type_check
  CHECK (source_type IN ('RISK', 'CONTROL', 'KRI', 'AUDIT', 'INCIDENT', 'MANAGEMENT'));

DELETE FROM schema_migrations WHERE filename = '041_action_plan_finding_source.sql';
