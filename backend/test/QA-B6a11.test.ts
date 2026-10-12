import { describe, expect, it } from "vitest";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

// QA F-B6a-11 / F-B6a-13: static pins on the SQL text (no Postgres here).
const dir = join(dirname(fileURLToPath(import.meta.url)), "../../database/postgresql/migrations");
const read = (f: string) => readFileSync(join(dir, f), "utf8");
const strip = (s: string) => s.replace(/--.*$/gm, "");
const up = (n: string) => readdirSync(dir).find((f) => f.startsWith(n + "_") && f.endsWith(".sql") && !f.endsWith(".down.sql"))!;
const norm = (s: string) => s.replace(/\s+/g, "");

// Every function created by 055..057 (name + exact signature) must carry SET search_path in 058.
const created = new Set<string>();
for (const n of ["055", "056", "057"]) {
  for (const m of strip(read(up(n))).matchAll(/CREATE\s+(?:OR\s+REPLACE\s+)?FUNCTION\s+([a-z_0-9.]+\s*\([^)]*\))/gi)) {
    created.add(norm(m[1]));
  }
}

describe("058 search_path guard (F-B6a-11)", () => {
  const sql = strip(read(up("058")));
  const alters = [...sql.matchAll(/ALTER\s+FUNCTION\s+([a-z_0-9.]+\s*\([^)]*\))\s+SET\s+search_path\s*=\s*([^;]+);/gi)];

  it("covers exactly the functions created by 055-057 (6), by exact signature", () => {
    expect(created.size).toBe(6);
    expect(alters.map((a) => norm(a[1])).sort()).toEqual([...created].sort());
  });
  it("every function sets pg_catalog, public, pg_temp with pg_temp last", () => {
    for (const a of alters) expect(a[2].split(",").map((s) => s.trim())).toEqual(["pg_catalog", "public", "pg_temp"]);
  });
  it("down resets exactly the same six functions", () => {
    const down = strip(read("058_risk_framework_guard_search_path.down.sql"));
    const resets = [...down.matchAll(/ALTER\s+FUNCTION\s+([a-z_0-9.]+\s*\([^)]*\))\s+RESET\s+search_path;/gi)].map((m) => norm(m[1]));
    expect(resets.sort()).toEqual([...created].sort());
  });
});

describe("down migrations remove their schema_migrations row (F-B6a-13)", () => {
  const downs = readdirSync(dir).filter((f) => /^05[2-8]_.*\.down\.sql$/.test(f));
  it("covers 052..058", () => expect(downs.length).toBe(7));
  for (const d of downs) {
    it(`${d}: BEGIN, DELETE own row (exact up filename), COMMIT`, () => {
      const s = strip(read(d));
      const upName = d.replace(/\.down\.sql$/, ".sql");
      expect(existsSync(join(dir, upName))).toBe(true);
      const del = s.indexOf(`DELETE FROM schema_migrations WHERE filename = '${upName}';`);
      expect(del).toBeGreaterThan(-1);
      expect(s.indexOf("BEGIN;")).toBeGreaterThan(-1);
      expect(s.indexOf("BEGIN;")).toBeLessThan(del);
      expect(s.lastIndexOf("COMMIT;")).toBeGreaterThan(del);
    });
  }
});

// F-B6a-14: CREATE OR REPLACE drops a function's SET search_path. Any trigger function (re)defined from 058 on
// must pin it, either in its definition or by an ALTER FUNCTION ... SET search_path in the same migration.
describe("trigger functions from 058 on pin search_path (F-B6a-14)", () => {
  const ups = readdirSync(dir).filter((f) => /^\d{3}_.*\.sql$/.test(f) && !f.endsWith(".down.sql") && Number(f.slice(0, 3)) >= 58);
  it.each(ups)("%s", (f) => {
    const sql = strip(read(f));
    for (const m of sql.matchAll(/CREATE\s+(?:OR\s+REPLACE\s+)?FUNCTION\s+([a-z_0-9.]+)\s*\([^)]*\)\s*RETURNS\s+trigger([\s\S]*?)(\$[A-Za-z_]*\$)/gi)) {
      const inline = /SET\s+search_path\s*=/i.test(m[2]);
      // Only an ALTER after this CREATE counts: a CREATE OR REPLACE resets any earlier SET.
      const re = new RegExp(`ALTER\\s+FUNCTION\\s+${m[1].replace(".", "\\.")}\\s*\\([^)]*\\)\\s+SET\\s+search_path\\s*=`, "gi");
      const altered = [...sql.matchAll(re)].some((a) => a.index! > m.index!);
      expect(inline || altered, `${f}: ${m[1]} must SET search_path = pg_catalog, public, pg_temp`).toBe(true);
    }
  });
});
