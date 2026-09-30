import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = resolve(fileURLToPath(import.meta.url), "../..");
const migrationPath = resolve(
  repoRoot,
  "../database/postgresql/migrations/038_audit_log_append_only.sql",
);

describe("SEC: audit_log database append-only migration", () => {
  const sql = readFileSync(migrationPath, "utf8");

  it("denies direct mutation privileges to PUBLIC", () => {
    expect(sql).toMatch(
      /REVOKE\s+UPDATE\s*,\s*DELETE\s*,\s*TRUNCATE\s+ON\s+TABLE\s+audit_log\s+FROM\s+PUBLIC/i,
    );
  });

  it("blocks UPDATE and DELETE at database level", () => {
    expect(sql).toMatch(
      /CREATE\s+TRIGGER\s+audit_log_append_only_mutation[\s\S]*?BEFORE\s+UPDATE\s+OR\s+DELETE[\s\S]*?ON\s+audit_log/i,
    );
  });

  it("blocks TRUNCATE at database level", () => {
    expect(sql).toMatch(
      /CREATE\s+TRIGGER\s+audit_log_append_only_truncate[\s\S]*?BEFORE\s+TRUNCATE[\s\S]*?ON\s+audit_log/i,
    );
  });

  it("fails closed with an authorization error", () => {
    expect(sql).toMatch(
      /RAISE\s+EXCEPTION\s+'audit_log is append-only:[^']*'\s+USING\s+ERRCODE\s*=\s*'42501'/i,
    );
  });
});
