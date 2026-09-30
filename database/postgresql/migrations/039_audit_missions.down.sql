-- Rollback of 039_audit_missions.sql. Destructive: drops every mission
-- row. Safe to run standalone as long as 040_findings.sql (which FKs
-- findings.audit_mission_id -> audit_missions.id) has not also been
-- applied — run down(040) first if it has.

DROP TABLE audit_missions;

DELETE FROM schema_migrations WHERE filename = '039_audit_missions.sql';
