import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { Pool } from "pg";

// Migration 094 (q253 A): existing live accesses without expiry on a PERIMETRE dossier get now() + 30 days, as 087 did for NOMINATIF.
// Static part always runs; live part needs a disposable LOCAL database at 094: MIG094_LIVE=1 MIG094_DB=grc_... (127.0.0.1:55442). Never Neon.
const up = readFileSync("../database/postgresql/migrations/094_perimeter_named_access_expiry.sql", "utf8");

describe("094 (static)", () => {
  it("only stamps live grants without expiry on PERIMETRE dossiers; no function redefined, no delete", () => {
    expect(up).toMatch(/revoked_at IS NULL AND g\.expires_at IS NULL/);
    expect(up.match(/x\.visibility = 'PERIMETRE'/g)).toHaveLength(5);
    expect(up).not.toMatch(/CREATE\s+(OR\s+REPLACE\s+)?FUNCTION|DELETE\s+FROM/i);
  });
});

const live = process.env["MIG094_LIVE"] === "1" && /^grc_/.test(process.env["MIG094_DB"] ?? "");

describe.skipIf(!live)("094 on a real local database", () => {
  let pool: Pool;
  const tag = randomUUID().slice(0, 8);
  beforeAll(() => { pool = new Pool({ host: "127.0.0.1", port: Number(process.env["MIG094_PORT"] ?? 55442), user: "postgres", database: process.env["MIG094_DB"]!, max: 2 }); });
  afterAll(async () => { await pool?.end(); });

  it("stamps the PERIMETRE access, leaves CLIENT and already-dated ones, and a replay moves nothing", async () => {
    const tenant = (await pool.query(`INSERT INTO tenants (name) VALUES ($1) RETURNING id`, [`T094-${tag}`])).rows[0].id;
    const mk = async (e: string) => (await pool.query(`INSERT INTO users (tenant_id, email, display_name) VALUES ($1, $2, 'U') RETURNING id`, [tenant, `${e}-${tag}@x.test`])).rows[0].id;
    const user = await mk("u");
    const by = await mk("by");
    const control = async (level: string) => (await pool.query(
      `INSERT INTO controls (tenant_id, label, control_type, frequency, executor, compliance_criteria, visibility) VALUES ($1, 'c', 'PREVENTIVE', 'MONTHLY', 'x', 'y', $2) RETURNING id`,
      [tenant, level])).rows[0].id as string;
    const grant = async (id: string, expiry: string | null) => (await pool.query(
      `INSERT INTO resource_access_grants (tenant_id, resource_type, resource_id, user_id, granted_by, grant_reason, expires_at)
       VALUES ($1, 'CONTROL', $2, $3, $4, 'q253', ${expiry ? `now() + interval '${expiry}'` : "NULL"}) RETURNING id`, [tenant, id, user, by])).rows[0].id as string;
    const expiry = async (gid: string) => (await pool.query(`SELECT expires_at FROM resource_access_grants WHERE id = $1`, [gid])).rows[0].expires_at as Date | null;

    const perim = await grant(await control("PERIMETRE"), null);
    const client = await grant(await control("CLIENT"), null);
    const dated = await grant(await control("PERIMETRE"), "5 days");
    const before = await expiry(dated);
    await pool.query(up);
    const days = ((await expiry(perim))!.getTime() - Date.now()) / 86_400_000;
    expect(days).toBeGreaterThan(29.9);
    expect(days).toBeLessThanOrEqual(30);
    expect(await expiry(client)).toBeNull();
    expect(await expiry(dated)).toEqual(before);
    const stamped = await expiry(perim);
    await pool.query(up);
    expect(await expiry(perim)).toEqual(stamped);
  });
});
