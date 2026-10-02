-- SEC: keep the application runtime role aligned with future schema objects.
--
-- Migrations run as grc_migrator_runtime and therefore own the tables they
-- create. Default privileges are defined by the role that creates future
-- objects, so this migration makes the runtime DML baseline durable without
-- granting the runtime role any DDL or ownership privileges.
--
-- This migration assumes the dedicated runtime role has already been
-- provisioned by infrastructure.

GRANT USAGE ON SCHEMA public TO grc_app_runtime;

GRANT SELECT, INSERT, UPDATE, DELETE
ON ALL TABLES IN SCHEMA public
TO grc_app_runtime;

REVOKE UPDATE, DELETE, TRUNCATE
ON TABLE public.audit_log
FROM grc_app_runtime;

GRANT SELECT, INSERT
ON TABLE public.audit_log
TO grc_app_runtime;

REVOKE INSERT, UPDATE, DELETE, TRUNCATE
ON TABLE public.schema_migrations
FROM grc_app_runtime;

GRANT SELECT
ON TABLE public.schema_migrations
TO grc_app_runtime;

ALTER DEFAULT PRIVILEGES IN SCHEMA public
GRANT SELECT, INSERT, UPDATE, DELETE
ON TABLES
TO grc_app_runtime;
