import { describe, expect, it, vi } from "vitest";
import { assertProductionDatabaseRole } from "../src/infrastructure/database/postgres/databaseRoleSecurity.js";

function mockPool(row: Record<string, unknown>) {
  return {
    query: vi.fn().mockResolvedValue({ rows: [row] }),
  };
}

const safeRole = {
  role_name: "grc_app",
  session_role: "grc_app",
  database_name: "grc",
  database_owner: "neon_owner",
  is_superuser: false,
  can_create_role: false,
  can_create_database: false,
  can_create_public_schema: false,
  can_select_audit_log: true,
  can_insert_audit_log: true,
  can_update_audit_log: false,
  can_delete_audit_log: false,
  can_truncate_audit_log: false,
};

describe("SEC: production database role guard", () => {
  it("does not inspect the database outside production", async () => {
    const pool = mockPool(safeRole);
    await expect(assertProductionDatabaseRole(pool as never, "development")).resolves.toBeUndefined();
    expect(pool.query).not.toHaveBeenCalled();
  });

  it("accepts a dedicated non-owner role with minimum audit_log privileges", async () => {
    const pool = mockPool(safeRole);
    await expect(assertProductionDatabaseRole(pool as never, "production")).resolves.toBeUndefined();
  });

  it("fails closed for a database owner or superuser", async () => {
    const pool = mockPool({
      ...safeRole,
      role_name: "neon_owner",
      session_role: "neon_owner",
      database_owner: "neon_owner",
      is_superuser: true,
    });

    await expect(assertProductionDatabaseRole(pool as never, "production"))
      .rejects.toThrow(/SUPERUSER|owns the database/);
  });

  it("fails closed when audit_log can be mutated", async () => {
    const pool = mockPool({
      ...safeRole,
      can_update_audit_log: true,
      can_delete_audit_log: true,
      can_truncate_audit_log: true,
    });

    await expect(assertProductionDatabaseRole(pool as never, "production"))
      .rejects.toThrow(/UPDATE on audit_log|DELETE on audit_log|TRUNCATE on audit_log/);
  });

  it("fails closed when required audit_log privileges are missing", async () => {
    const pool = mockPool({
      ...safeRole,
      can_select_audit_log: false,
      can_insert_audit_log: false,
    });

    await expect(assertProductionDatabaseRole(pool as never, "production"))
      .rejects.toThrow(/lacks SELECT on audit_log|lacks INSERT on audit_log/);
  });
});
