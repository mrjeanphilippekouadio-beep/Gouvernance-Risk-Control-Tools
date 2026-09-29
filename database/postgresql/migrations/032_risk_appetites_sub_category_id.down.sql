-- Rollback for 032_risk_appetites_sub_category_id.sql
--
-- Drops the index and the nullable sub_category_id column added by the
-- forward migration. Safe at any time this column has never been
-- written by application code with real data a rollback would need to
-- preserve — no later migration in this repo (as of 032) depends on
-- risk_appetites.sub_category_id.
--
-- How to run this file: see README.md in this directory.

DROP INDEX IF EXISTS risk_appetites_tenant_sub_category_idx;
ALTER TABLE risk_appetites DROP COLUMN IF EXISTS sub_category_id;

DELETE FROM schema_migrations WHERE filename = '032_risk_appetites_sub_category_id.sql';
