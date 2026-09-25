import { describe, expect, it } from "vitest";
import { buildUpdateSet } from "../src/infrastructure/database/postgres/dynamicUpdate.js";

describe("buildUpdateSet", () => {
  it("omits fields that are undefined (not provided)", () => {
    const { setClauses, values } = buildUpdateSet({ a: "x", b: undefined, c: 1 }, 3);
    expect(setClauses).toEqual(["a = $3", "c = $4"]);
    expect(values).toEqual(["x", 1]);
  });

  it("includes fields explicitly set to null, distinct from omitted fields", () => {
    // This is the case COALESCE($n, col) gets wrong: an explicit null
    // must clear the column, not be silently dropped.
    const { setClauses, values } = buildUpdateSet({ objective: null }, 3);
    expect(setClauses).toEqual(["objective = $3"]);
    expect(values).toEqual([null]);
  });

  it("returns empty clauses when nothing is provided", () => {
    const { setClauses, values } = buildUpdateSet({ a: undefined, b: undefined }, 3);
    expect(setClauses).toEqual([]);
    expect(values).toEqual([]);
  });
});
