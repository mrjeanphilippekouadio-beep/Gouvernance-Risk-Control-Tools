-- Reverts 035_process_department_name_uniqueness.sql. Non-destructive to
-- data: these are indexes/constraints only, nothing references them, and
-- dropping them just re-opens the ability to create/rename to a
-- duplicate name within the same scope — no rows are touched.
DROP INDEX IF EXISTS processes_tenant_root_name_idx;
DROP INDEX IF EXISTS processes_tenant_parent_name_idx;
DROP INDEX IF EXISTS departments_tenant_name_idx;

DELETE FROM schema_migrations WHERE filename = '035_process_department_name_uniqueness.sql';
