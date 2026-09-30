-- Lot 4 (Audit module) follow-up: widen action_plans.source_type's CHECK
-- constraint to accept 'FINDING', per ActionPlan.ts's
-- ACTION_PLAN_SOURCE_TYPES comment and GRC_Target_Domain_Model.md §8.1's
-- "point d'extension proposé (additif)". Expand-only: no existing value
-- removed, no column dropped/renamed, no data touched — every row
-- inserted under the old constraint remains valid under the new one.
--
-- Postgres names an inline `CHECK (...)` on a single column
-- `<table>_<column>_check` by default when no CONSTRAINT name was given
-- in the original CREATE TABLE (022_action_plans.sql) — verified against
-- this table before writing this migration.

ALTER TABLE action_plans DROP CONSTRAINT action_plans_source_type_check;
ALTER TABLE action_plans ADD CONSTRAINT action_plans_source_type_check
  CHECK (source_type IN ('RISK', 'CONTROL', 'KRI', 'AUDIT', 'INCIDENT', 'MANAGEMENT', 'FINDING'));
