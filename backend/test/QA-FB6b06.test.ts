import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

// F-B6b-06/07, F-CAT-02: static pins on migration 061 (behaviour: QA-FB6b06-pg.test.ts).
const dir = join(dirname(fileURLToPath(import.meta.url)), "../../database/postgresql/migrations");
const strip = (s: string) => s.replace(/--.*$/gm, "");
const up = strip(readFileSync(join(dir, "061_risk_evaluation_insert_guard.sql"), "utf8"));
const down = strip(readFileSync(join(dir, "061_risk_evaluation_insert_guard.down.sql"), "utf8"));
const PIN = "SET search_path = pg_catalog, public, pg_temp";

describe("061 insert guard + composite FKs", () => {
  it("every function pins search_path inline and by ALTER (up and down)", () => {
    for (const [sql, fns] of [[up, ["risk_evaluations_snapshot_insert_guard", "risk_evaluations_snapshot_guard"]], [down, ["risk_evaluations_snapshot_guard"]]] as const) {
      for (const f of fns) {
        expect(sql).toMatch(new RegExp(`CREATE OR REPLACE FUNCTION ${f}\\(\\) RETURNS trigger LANGUAGE plpgsql\\s+${PIN} AS`));
        expect(sql).toContain(`ALTER FUNCTION ${f}() ${PIN};`);
      }
    }
  });
  it("BEFORE INSERT row trigger, SQLSTATE 42501, checks version ACTIVE + tenant + the five snapshot fields", () => {
    expect(up).toMatch(/CREATE TRIGGER risk_evaluations_snapshot_insert_guard\s+BEFORE INSERT ON risk_evaluations FOR EACH ROW/);
    expect(up).toContain("v.status <> 'ACTIVE'");
    expect(up).toContain("tenant_id = NEW.tenant_id AND id = NEW.risk_framework_version_id");
    for (const c of ["rating_scale_id", "committee_evaluation_min_score", "committee_evaluation_enforced", "committee_treatment_min_score"])
      expect(up).toContain(`NEW.${c} IS DISTINCT FROM v.${c}`);
    expect(up).toContain("NEW.rating_scale_version IS DISTINCT FROM scale_version");
    expect(up).toContain("IF NEW.risk_framework_version_id IS NULL THEN");
  });
  it("UPDATE guard also freezes rating_scale_version (NULL -> value still allowed)", () => {
    expect(up).toContain("OLD.rating_scale_version IS NOT NULL AND NEW.rating_scale_version IS DISTINCT FROM OLD.rating_scale_version");
    expect(up).not.toContain("OLD.rating_scale_version IS NULL");
    expect(up).toMatch(/BEFORE UPDATE OF [^;]*rating_scale_version\s+ON risk_evaluations/);
  });
  it("composite FKs are NOT VALID with their UNIQUE keys, idempotent", () => {
    expect(up).toMatch(/rating_scales_tenant_id_key UNIQUE \(tenant_id, id\)/);
    expect(up).toMatch(/FOREIGN KEY \(tenant_id, rating_scale_id\) REFERENCES rating_scales \(tenant_id, id\) NOT VALID/);
    expect(up).toMatch(/risk_categories_tenant_id_key UNIQUE \(tenant_id, id\)/);
    expect(up).toMatch(/FOREIGN KEY \(tenant_id, parent_id\) REFERENCES risk_categories \(tenant_id, id\) NOT VALID/);
    expect(up.match(/IF NOT EXISTS \(SELECT 1 FROM pg_constraint/g)).toHaveLength(4);
  });
  it("down removes everything and its schema_migrations row, in a transaction", () => {
    for (const s of ["DROP TRIGGER IF EXISTS risk_evaluations_snapshot_insert_guard", "DROP FUNCTION IF EXISTS risk_evaluations_snapshot_insert_guard()",
      "DROP CONSTRAINT IF EXISTS risk_evaluations_rating_scale_tenant_fk", "DROP CONSTRAINT IF EXISTS risk_categories_parent_tenant_fk",
      "DROP CONSTRAINT IF EXISTS risk_categories_tenant_id_key", "DROP CONSTRAINT IF EXISTS rating_scales_tenant_id_key",
      "DELETE FROM schema_migrations WHERE filename = '061_risk_evaluation_insert_guard.sql';"]) expect(down).toContain(s);
    expect(down.indexOf("BEGIN;")).toBeLessThan(down.indexOf("DROP TRIGGER"));
    expect(down.lastIndexOf("COMMIT;")).toBeGreaterThan(down.indexOf("DELETE FROM schema_migrations"));
  });
});
