-- Rollback of 042_module_toggles_audit.sql. Safe only as long as no
-- module_toggles row has been inserted with module_name = 'AUDIT' yet —
-- check before running in a shared environment.

ALTER TABLE module_toggles DROP CONSTRAINT module_toggles_module_name_check;
ALTER TABLE module_toggles ADD CONSTRAINT module_toggles_module_name_check
  CHECK (module_name IN ('RISK', 'CONTROL', 'KRI', 'KPI', 'DASHBOARD', 'ANOMALY', 'ACTION_PLAN', 'EVIDENCE', 'CARTOGRAPHY'));

DELETE FROM schema_migrations WHERE filename = '042_module_toggles_audit.sql';
