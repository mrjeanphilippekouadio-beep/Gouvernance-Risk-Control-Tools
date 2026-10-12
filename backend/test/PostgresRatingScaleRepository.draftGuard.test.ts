import { describe, expect, it, vi } from "vitest";
import type { Pool } from "pg";
import { PostgresRatingScaleRepository } from "../src/infrastructure/database/postgres/PostgresRatingScaleRepository.js";
import { NotFoundError, ValidationError } from "../src/domain/errors/DomainErrors.js";

// F-B9-02: JSON sub-configuration writes only hit DRAFT rows; 0 rows -> refusal.
function fakePool(updateRows: unknown[], existsRows: unknown[]) {
  const query = vi.fn(async (sql: string) => ({ rows: sql.startsWith("UPDATE") ? updateRows : sql.startsWith("SELECT") ? existsRows : [] }));
  // F-D044-03: writes now run in a transaction on a client.
  const client = { query, release: vi.fn() };
  return { pool: { connect: async () => client } as unknown as Pool, query, client };
}

describe("PostgresRatingScaleRepository draft guard (F-B9-02)", () => {
  it("filters the UPDATE on status = 'DRAFT'", async () => {
    const { pool, query } = fakePool([], [{ "?column?": 1 }]);
    await expect(new PostgresRatingScaleRepository(pool).updateImpactAxes("t1", "s1", { axes: [], retainedImpactRule: "MAX" })).rejects.toThrow();
    expect(query.mock.calls.find((c) => String(c[0]).startsWith("UPDATE"))![0]).toContain("status = 'DRAFT'");
  });

  it("refuses with ValidationError when the scale exists but is no longer DRAFT", async () => {
    const { pool } = fakePool([], [{ "?column?": 1 }]);
    await expect(new PostgresRatingScaleRepository(pool).updateThresholds("t1", "s1", [])).rejects.toThrow(ValidationError);
  });

  it("keeps NotFoundError when the scale does not exist", async () => {
    const { pool } = fakePool([], []);
    await expect(new PostgresRatingScaleRepository(pool).updateThresholds("t1", "s1", [])).rejects.toThrow(NotFoundError);
  });

  // F-D044-03: the audit row is inserted before COMMIT, and a failing insert rolls the write back.
  const row = { id: "s1", tenant_id: "t1" };
  const event = { tenantId: "t1", userId: "u1", entityType: "RatingScale", entityId: "s1", action: "UPDATE" as const, oldValue: null, newValue: null, reason: null, requestId: "r" };

  it("inserts the audit event before COMMIT", async () => {
    const { pool, query } = fakePool([row], []);
    await new PostgresRatingScaleRepository(pool).updateThresholds("t1", "s1", [], () => [event]);
    const sqls = query.mock.calls.map((c) => String(c[0]).trim().split(/\s+/)[0] + (String(c[0]).includes("audit_log") ? ":audit" : ""));
    expect(sqls).toEqual(["BEGIN", "UPDATE", "INSERT:audit", "COMMIT"]);
  });

  it("rolls the write back when the audit insert fails", async () => {
    const { pool, query, client } = fakePool([row], []);
    query.mockImplementation(async (sql: string) => {
      if (sql.includes("audit_log")) throw new Error("audit down");
      return { rows: sql.startsWith("UPDATE") ? [row] : [] };
    });
    await expect(new PostgresRatingScaleRepository(pool).updateThresholds("t1", "s1", [], () => [event])).rejects.toThrow("audit down");
    expect(query.mock.calls.map((c) => c[0])).toContain("ROLLBACK");
    expect(query.mock.calls.map((c) => c[0])).not.toContain("COMMIT");
    expect(client.release).toHaveBeenCalled();
  });
});
