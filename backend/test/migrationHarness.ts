import { afterAll, beforeAll } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { Pool } from "pg";

/** Shared by the data-migration tests (077, 078): the SQL text and a disposable-database tenant. */
export const migrationSql = (file: string): string =>
  readFileSync(join(__dirname, "..", "..", "database", "postgresql", "migrations", file), "utf8");

/** Live parts run only when QA_SWP_PGHOST is a unix socket directory (never a remote database). */
export const PG_HOST = process.env.QA_SWP_PGHOST ?? "";
export const hasLocalPg = PG_HOST.startsWith("/");

/** The distinct e-mail literals of a migration (its technical account). */
export const emailLiterals = (sql: string): string[] => [...new Set([...sql.matchAll(/'([^']+@[^']+)'/g)].map((m) => m[1]))];

/** Registers beforeAll/afterAll inside the calling describe: one pool and one fresh tenant. */
export function useMigrationTenant(prefix: string) {
  const ctx = { pool: undefined as unknown as Pool, tenant: "" };
  const one = async (sql: string, p: unknown[] = []) => (await ctx.pool.query(sql, p)).rows[0];
  beforeAll(async () => {
    ctx.pool = new Pool({ host: PG_HOST, port: Number(process.env.QA_SWP_PGPORT ?? 5531), user: "postgres", database: process.env.QA_SWP_PGDB ?? "grc_qa_a08", max: 2 });
    ctx.tenant = (await one(`INSERT INTO tenants (name) VALUES ($1) RETURNING id`, [`${prefix}-${Date.now()}`])).id;
  });
  afterAll(async () => { await ctx.pool?.end(); });
  return { ctx, one };
}
