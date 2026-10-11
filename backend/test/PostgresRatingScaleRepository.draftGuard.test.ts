import { describe, expect, it, vi } from "vitest";
import type { Pool } from "pg";
import { PostgresRatingScaleRepository } from "../src/infrastructure/database/postgres/PostgresRatingScaleRepository.js";
import { NotFoundError, ValidationError } from "../src/domain/errors/DomainErrors.js";

// F-B9-02: JSON sub-configuration writes only hit DRAFT rows; 0 rows -> refusal.
function fakePool(updateRows: unknown[], existsRows: unknown[]) {
  const query = vi.fn(async (sql: string) => ({ rows: sql.startsWith("UPDATE") ? updateRows : existsRows }));
  return { pool: { query } as unknown as Pool, query };
}

describe("PostgresRatingScaleRepository draft guard (F-B9-02)", () => {
  it("filters the UPDATE on status = 'DRAFT'", async () => {
    const { pool, query } = fakePool([], [{ "?column?": 1 }]);
    await expect(new PostgresRatingScaleRepository(pool).updateImpactAxes("t1", "s1", { axes: [], retainedImpactRule: "MAX" })).rejects.toThrow();
    expect(query.mock.calls[0]![0]).toContain("status = 'DRAFT'");
  });

  it("refuses with ValidationError when the scale exists but is no longer DRAFT", async () => {
    const { pool } = fakePool([], [{ "?column?": 1 }]);
    await expect(new PostgresRatingScaleRepository(pool).updateThresholds("t1", "s1", [])).rejects.toThrow(ValidationError);
  });

  it("keeps NotFoundError when the scale does not exist", async () => {
    const { pool } = fakePool([], []);
    await expect(new PostgresRatingScaleRepository(pool).updateThresholds("t1", "s1", [])).rejects.toThrow(NotFoundError);
  });
});
