import { describe, expect, it } from "vitest";
import {
  assertDistinctDatabaseRoles,
  assertMigrationOwnsExistingTables,
  assertRuntimeRoleSafe,
  resolveMigrationDatabaseUrl,
} from "../src/infrastructure/database/postgres/migrationDatabaseSecurity.js";

describe("SEC: migration/runtime database role separation", () => {
  it("requires a dedicated migration URL in production", () => {
    expect(() => resolveMigrationDatabaseUrl("production", "runtime-url", undefined))
      .toThrow(/MIGRATION_DATABASE_URL/);
  });

  it("rejects reusing the runtime DATABASE_URL in production", () => {
    expect(() => resolveMigrationDatabaseUrl("production", "same-url", "same-url"))
      .toThrow(/must not equal DATABASE_URL/);
  });

  it("uses MIGRATION_DATABASE_URL in production when it is distinct", () => {
    expect(resolveMigrationDatabaseUrl("production", "runtime-url", "migration-url"))
      .toBe("migration-url");
  });

  it("keeps development compatible with the existing DATABASE_URL workflow", () => {
    expect(resolveMigrationDatabaseUrl("development", "runtime-url", undefined))
      .toBe("runtime-url");
  });

  it("rejects the same PostgreSQL role for migration and runtime", () => {
    expect(() => assertDistinctDatabaseRoles(
      { role_name: "grc_runtime" },
      { role_name: "grc_runtime" },
    )).toThrow(/same as the runtime database role/);
  });

  it("accepts distinct PostgreSQL roles", () => {
    expect(() => assertDistinctDatabaseRoles(
      { role_name: "grc_migrator" },
      { role_name: "grc_runtime" },
    )).not.toThrow();
  });

  it("rejects elevated runtime privileges", () => {
    expect(() => assertRuntimeRoleSafe({
      role_name: "grc_runtime",
      is_superuser: false,
      can_create_role: false,
      can_create_database: false,
      can_create_public_schema: true,
    })).toThrow(/CREATE in public schema/);
  });
});


describe("SEC: migration ownership preflight", () => {
  it("accepts an empty existing schema before the first migration", () => {
    expect(() => assertMigrationOwnsExistingTables("grc_migrator_runtime", [])).not.toThrow();
  });

  it("accepts existing tables owned by the migration role", () => {
    expect(() => assertMigrationOwnsExistingTables(
      "grc_migrator_runtime",
      [
        { object_name: "tenants", owner: "grc_migrator_runtime" },
        { object_name: "action_plans", owner: "grc_migrator_runtime" },
      ],
    )).not.toThrow();
  });

  it("fails before migrations when an existing table has another owner", () => {
    expect(() => assertMigrationOwnsExistingTables(
      "grc_migrator_runtime",
      [
        { object_name: "tenants", owner: "neondb_owner" },
        { object_name: "action_plans", owner: "grc_migrator_runtime" },
      ],
    )).toThrow(/tenants.*neondb_owner/);
  });
});
