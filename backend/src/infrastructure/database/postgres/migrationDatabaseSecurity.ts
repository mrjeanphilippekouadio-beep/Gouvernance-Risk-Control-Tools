export type DatabaseRoleSnapshot = {
  role_name: string;
  is_superuser: boolean;
  can_create_role: boolean;
  can_create_database: boolean;
  can_create_public_schema: boolean;
};

export function resolveMigrationDatabaseUrl(
  nodeEnv: string,
  runtimeDatabaseUrl: string | undefined,
  migrationDatabaseUrl: string | undefined,
): string {
  if (nodeEnv === "production") {
    if (!migrationDatabaseUrl) {
      throw new Error(
        "Production migrations require MIGRATION_DATABASE_URL; never run migrations with the runtime DATABASE_URL.",
      );
    }

    if (!runtimeDatabaseUrl) {
      throw new Error(
        "Production migration safety check requires DATABASE_URL so the migration and runtime roles can be compared.",
      );
    }

    if (migrationDatabaseUrl === runtimeDatabaseUrl) {
      throw new Error(
        "Production migration safety check failed: MIGRATION_DATABASE_URL must not equal DATABASE_URL.",
      );
    }

    return migrationDatabaseUrl;
  }

  const resolved = migrationDatabaseUrl ?? runtimeDatabaseUrl;
  if (!resolved) {
    throw new Error("A database connection string is required to run migrations.");
  }

  return resolved;
}

export function assertDistinctDatabaseRoles(
  migrationRole: Pick<DatabaseRoleSnapshot, "role_name">,
  runtimeRole: Pick<DatabaseRoleSnapshot, "role_name">,
): void {
  if (migrationRole.role_name === runtimeRole.role_name) {
    throw new Error(
      `Production migration safety check failed: migration role "${migrationRole.role_name}" is the same as the runtime database role.`,
    );
  }
}

export function assertRuntimeRoleSafe(role: DatabaseRoleSnapshot): void {
  const violations: string[] = [];

  if (role.is_superuser) violations.push("role is SUPERUSER");
  if (role.can_create_role) violations.push("role can CREATE ROLE");
  if (role.can_create_database) violations.push("role can CREATE DATABASE");
  if (role.can_create_public_schema) violations.push("role can CREATE in public schema");

  if (violations.length > 0) {
    throw new Error(
      `Production runtime database role security check failed for "${role.role_name}": ${violations.join("; ")}.`,
    );
  }
}


export type MigrationObjectOwnership = {
  object_name: string;
  owner: string;
};

export function assertMigrationOwnsExistingTables(
  migrationRoleName: string,
  objects: MigrationObjectOwnership[],
): void {
  const foreignOwnedObjects = objects.filter(({ owner }) => owner !== migrationRoleName);

  if (foreignOwnedObjects.length === 0) return;

  const details = foreignOwnedObjects
    .map(({ object_name, owner }) => `"${object_name}" (owner: "${owner}")`)
    .join(", ");

  throw new Error(
    `Migration preflight failed: role "${migrationRoleName}" does not own existing public tables: ${details}. ` +
      "Transfer ownership of the existing application tables to the dedicated migration role before running migrations.",
  );
}
