-- Rollback for 027_raci_assignments.sql
--
-- Run 028_raci_entity_type_snake_case.down.sql FIRST if migration 028 has
-- also been applied (this repo has no other migration or code depending
-- on raci_assignments beyond 027/028 as of this writing — reconfirm by
-- grepping the migrations directory and backend/src for
-- "raci_assignments" before running this in an environment that may have
-- advanced further).
--
-- Destructive: drops the whole table, including any RACI assignment rows
-- (soft-deleted or not). Only safe to run before this data is relied upon
-- elsewhere. Per dev-db's migration mandate, this is a destructive
-- operation and requires the same justification/impact-analysis/backup
-- discipline as any DROP TABLE before running against a real environment.
--
-- How to run this file: see README.md in this directory.

DROP TABLE IF EXISTS raci_assignments;
-- raci_assignments_tenant_entity_idx (from 027) is dropped automatically
-- with the table; no separate DROP INDEX needed.

DELETE FROM schema_migrations WHERE filename = '027_raci_assignments.sql';
