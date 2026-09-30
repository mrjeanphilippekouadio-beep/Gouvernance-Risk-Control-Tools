-- Rollback of 040_findings.sql. Destructive: drops every finding row.
-- Non-destructive to audit_missions (no FK from audit_missions back to
-- findings). Must be run before down(039_audit_missions.sql) since
-- findings.audit_mission_id FKs into audit_missions.

DROP TABLE findings;

DELETE FROM schema_migrations WHERE filename = '040_findings.sql';
