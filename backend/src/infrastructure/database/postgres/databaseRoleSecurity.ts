import type { Pool } from "pg";

type DatabaseRoleRow = {
  role_name: string;
  session_role: string;
  database_name: string;
  database_owner: string;
  is_superuser: boolean;
  can_create_role: boolean;
  can_create_database: boolean;
  can_create_public_schema: boolean;
  can_select_audit_log: boolean;
  can_insert_audit_log: boolean;
  can_update_audit_log: boolean;
  can_delete_audit_log: boolean;
  can_truncate_audit_log: boolean;
};

type Queryable = Pick<Pool, "query">;

export async function assertProductionDatabaseRole(pool: Queryable, environment: string): Promise<void> {
  if (environment !== "production") return;

  const { rows } = await pool.query<DatabaseRoleRow>(`
    SELECT
      current_user AS role_name,
      session_user AS session_role,
      current_database() AS database_name,
      pg_get_userbyid(d.datdba) AS database_owner,
      r.rolsuper AS is_superuser,
      r.rolcreaterole AS can_create_role,
      r.rolcreatedb AS can_create_database,
      has_schema_privilege(current_user, 'public', 'CREATE') AS can_create_public_schema,
      has_table_privilege(current_user, 'audit_log', 'SELECT') AS can_select_audit_log,
      has_table_privilege(current_user, 'audit_log', 'INSERT') AS can_insert_audit_log,
      has_table_privilege(current_user, 'audit_log', 'UPDATE') AS can_update_audit_log,
      has_table_privilege(current_user, 'audit_log', 'DELETE') AS can_delete_audit_log,
      has_table_privilege(current_user, 'audit_log', 'TRUNCATE') AS can_truncate_audit_log
    FROM pg_roles r
    CROSS JOIN pg_database d
    WHERE r.rolname = current_user
      AND d.datname = current_database()
  `);

  const role = rows[0];
  if (!role) {
    throw new Error("Database security check failed: current application role could not be inspected.");
  }

  const violations: string[] = [];

  if (role.is_superuser) violations.push("role is SUPERUSER");
  if (role.role_name === role.database_owner) violations.push("role owns the database");
  if (role.can_create_role) violations.push("role can CREATE ROLE");
  if (role.can_create_database) violations.push("role can CREATE DATABASE");
  if (role.can_create_public_schema) violations.push("role can CREATE in public schema");
  if (!role.can_select_audit_log) violations.push("role lacks SELECT on audit_log");
  if (!role.can_insert_audit_log) violations.push("role lacks INSERT on audit_log");
  if (role.can_update_audit_log) violations.push("role has UPDATE on audit_log");
  if (role.can_delete_audit_log) violations.push("role has DELETE on audit_log");
  if (role.can_truncate_audit_log) violations.push("role has TRUNCATE on audit_log");

  if (violations.length > 0) {
    throw new Error(
      `Database security check failed for role "${role.role_name}" on "${role.database_name}": ${violations.join("; ")}.`,
    );
  }
}
