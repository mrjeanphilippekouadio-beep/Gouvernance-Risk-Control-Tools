import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

// F-B6b-02: static pins on migration 060 (no Postgres here; see QA-FB6b02-pg.test.ts for the behaviour).
const dir = join(dirname(fileURLToPath(import.meta.url)), "../../database/postgresql/migrations");
const strip = (s: string) => s.replace(/--.*$/gm, "");
const up = strip(readFileSync(join(dir, "060_risk_evaluation_snapshot_guard.sql"), "utf8"));
const down = strip(readFileSync(join(dir, "060_risk_evaluation_snapshot_guard.down.sql"), "utf8"));
const COLS = ["risk_framework_version_id", "committee_evaluation_min_score", "committee_evaluation_enforced", "committee_treatment_min_score", "rating_scale_id"];

describe("060 snapshot guard (F-B6b-02)", () => {
  it("function pins search_path with pg_temp last, inline and by ALTER", () => {
    expect(up).toMatch(/CREATE OR REPLACE FUNCTION risk_evaluations_snapshot_guard\(\) RETURNS trigger LANGUAGE plpgsql\s+SET search_path = pg_catalog, public, pg_temp AS/);
    expect(up).toMatch(/ALTER FUNCTION risk_evaluations_snapshot_guard\(\) SET search_path = pg_catalog, public, pg_temp;/);
  });
  it("BEFORE UPDATE OF exactly the five snapshot columns, row level", () => {
    const m = /CREATE TRIGGER risk_evaluations_snapshot_guard\s+BEFORE UPDATE OF ([^]*?)\s+ON risk_evaluations FOR EACH ROW/.exec(up);
    expect(m).not.toBeNull();
    expect(m![1]!.split(",").map((s) => s.trim()).sort()).toEqual([...COLS].sort());
  });
  it("each column is frozen once non-null (IS DISTINCT FROM, SQLSTATE 42501)", () => {
    for (const c of COLS) expect(up).toContain(`OLD.${c} IS NOT NULL AND NEW.${c} IS DISTINCT FROM OLD.${c}`);
    expect(up).toContain("ERRCODE = '42501'");
  });
  it("NULL -> value stays allowed for rating_scale_id only", () => {
    for (const c of COLS.filter((x) => x !== "rating_scale_id")) expect(up).toContain(`OLD.${c} IS NULL AND NEW.${c} IS NOT NULL`);
    expect(up).not.toContain("OLD.rating_scale_id IS NULL");
  });
  it("tenant-consistent composite FK, NOT VALID, with its unique key; idempotent guards", () => {
    expect(up).toMatch(/risk_framework_versions_tenant_id_key UNIQUE \(tenant_id, id\)/);
    expect(up).toMatch(/FOREIGN KEY \(tenant_id, risk_framework_version_id\) REFERENCES risk_framework_versions \(tenant_id, id\) NOT VALID/);
    expect(up).toContain("DROP TRIGGER IF EXISTS risk_evaluations_snapshot_guard");
    expect(up.match(/IF NOT EXISTS \(SELECT 1 FROM pg_constraint/g)).toHaveLength(2);
  });
  it("down drops trigger, function, FK, then unique key, and its schema_migrations row", () => {
    const order = ["DROP TRIGGER IF EXISTS risk_evaluations_snapshot_guard", "DROP FUNCTION IF EXISTS risk_evaluations_snapshot_guard()",
      "DROP CONSTRAINT IF EXISTS risk_evaluations_framework_version_tenant_fk", "DROP CONSTRAINT IF EXISTS risk_framework_versions_tenant_id_key",
      "DELETE FROM schema_migrations WHERE filename = '060_risk_evaluation_snapshot_guard.sql';"].map((s) => down.indexOf(s));
    expect(order.every((i) => i > -1)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
    expect(down.indexOf("BEGIN;")).toBeLessThan(order[0]!);
    expect(down.lastIndexOf("COMMIT;")).toBeGreaterThan(order[4]!);
  });
});
