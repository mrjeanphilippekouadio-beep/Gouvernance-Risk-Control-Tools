-- Rollback of 049_fixed_groups.sql.
-- Perd : le marquage des groupes fixes et les rattachements département
-- (roles.department_id, processes.department_id). Les trois rôles créés
-- par la migration restent en place comme rôles ordinaires (sans
-- permission) : ils peuvent avoir des membres et des lignes d'audit, on
-- ne les supprime pas.

DROP INDEX IF EXISTS processes_department_idx;
ALTER TABLE processes DROP COLUMN department_id;

ALTER TABLE roles DROP CONSTRAINT roles_system_group_no_department;
DROP INDEX IF EXISTS roles_active_department_idx;
DROP INDEX IF EXISTS roles_active_system_group_idx;
ALTER TABLE roles DROP COLUMN department_id, DROP COLUMN system_group;

DELETE FROM schema_migrations WHERE filename = '049_fixed_groups.sql';
