import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { Client, Pool } from "pg";
import { PG_HOST, hasLocalPg } from "./migrationHarness.js";

/**
 * QA-L2a (migration 096), automated data-migration test on a database built at state 095 WITH legacy rows.
 * Oracle (written before running): every legacy text of resource_access_grants (grant / revoke) and sensitive_view_grants
 * (request / decision / revocation) moves into visibility_reasons, one motif per (tenant, author, instant, text) for the access
 * grants and one per column and row for the sensitive-view grants; the technical creation constant stays; audit_log.reason is
 * untouched; the guards are enabled again and cover the references; replaying 096 changes nothing; the down gives the 095 rows back
 * byte for byte, and refuses when the journal references a motif or a motif is erased.
 * Live part: QA_SWP_PGHOST=<socket dir> QA_SWP_PGPORT=55442 (local disposable cluster, never Neon). Each scenario clones a template.
 */
const MIGRATIONS = join(__dirname, "..", "..", "database", "postgresql", "migrations");
const file = (name: string) => readFileSync(join(MIGRATIONS, name), "utf8");
const UP = "096_visibility_reasons.sql";
const DOWN = "096_visibility_reasons.down.sql";
const upTo095 = () => readdirSync(MIGRATIONS).filter((f) => f.endsWith(".sql") && !f.endsWith(".down.sql") && f < UP).sort((a, b) => a.localeCompare(b));

const PORT = Number(process.env["QA_SWP_PGPORT"] ?? 55442);
const tag = randomUUID().replaceAll("-", "").slice(0, 8);
const TEMPLATE = `grc_qa_l2am_${tag}`;
const connect = (database: string, max = 1) => new Pool({ host: PG_HOST, port: PORT, user: "postgres", database, max });

const CREATION = "Accès accordé à la création du risque";
const LONG = `${"L'ordre \"D\"; DROP TABLE x;-- é ŝ \\ \n".repeat(14)}`.slice(0, 440);
const SHARED = "Dossier sensible";
const T1 = "2026-03-01T10:00:00Z";
const T2 = "2026-04-01T10:00:00Z";
const T3 = "2026-05-01T10:00:00Z";
const T4 = "2026-06-01T10:00:00Z";
const id = (n: number) => `aaaaaaaa-0000-4000-8000-${String(n).padStart(12, "0")}`;
const U = [1, 2, 3, 4, 5, 6].map((n) => id(100 + n));
const TENANT = id(1);
const R = [1, 2, 3, 4, 5].map((n) => id(500 + n));

/** Legacy rows as the application wrote them before 096 (guards of 087 and 084 are active: rows go through their real lifecycle). */
const SEED = `
INSERT INTO tenants (id, name) VALUES ('${TENANT}', 'QA L2a');
${U.map((u, i) => `INSERT INTO users (id, tenant_id, email, display_name) VALUES ('${u}', '${TENANT}', 'u${i}@l2a.test', 'U${i}');`).join("\n")}
-- g1, g2 and g4 share author, instant and text (one action) ; g3 same text, other instant ; g9 same text and instant, other author
INSERT INTO resource_access_grants (id, tenant_id, resource_type, resource_id, user_id, granted_by, granted_at, grant_reason, expires_at) VALUES ('${id(901)}', '${TENANT}', 'RISK', '${R[0]}', '${U[1]}', '${U[0]}', '${T1}', '${SHARED}', now() + interval '10 days');
INSERT INTO resource_access_grants (id, tenant_id, resource_type, resource_id, user_id, granted_by, granted_at, grant_reason, expires_at) VALUES ('${id(902)}', '${TENANT}', 'RISK', '${R[0]}', '${U[2]}', '${U[0]}', '${T1}', '${SHARED}', now() + interval '10 days');
INSERT INTO resource_access_grants (id, tenant_id, resource_type, resource_id, user_id, granted_by, granted_at, grant_reason, expires_at) VALUES ('${id(903)}', '${TENANT}', 'RISK', '${R[0]}', '${U[3]}', '${U[0]}', '${T2}', '${SHARED}', now() + interval '10 days');
INSERT INTO resource_access_grants (id, tenant_id, resource_type, resource_id, user_id, granted_by, granted_at, grant_reason, expires_at) VALUES ('${id(904)}', '${TENANT}', 'RISK', '${R[1]}', '${U[1]}', '${U[0]}', '${T1}', '${SHARED}', now() + interval '10 days');
INSERT INTO resource_access_grants (id, tenant_id, resource_type, resource_id, user_id, granted_by, granted_at, grant_reason, expires_at) VALUES ('${id(905)}', '${TENANT}', 'RISK', '${R[2]}', '${U[1]}', '${U[0]}', '${T1}', '${CREATION}', NULL);
INSERT INTO resource_access_grants (id, tenant_id, resource_type, resource_id, user_id, granted_by, granted_at, grant_reason, expires_at) VALUES ('${id(906)}', '${TENANT}', 'RISK', '${R[3]}', '${U[1]}', '${U[0]}', '${T3}', '${LONG.replaceAll("'", "''")}', now() + interval '10 days');
INSERT INTO resource_access_grants (id, tenant_id, resource_type, resource_id, user_id, granted_by, granted_at, grant_reason, expires_at) VALUES ('${id(907)}', '${TENANT}', 'RISK', '${R[3]}', '${U[2]}', '${U[0]}', '${T3}', '${LONG.replaceAll("'", "''")}', now() + interval '10 days');
INSERT INTO resource_access_grants (id, tenant_id, resource_type, resource_id, user_id, granted_by, granted_at, grant_reason, expires_at) VALUES ('${id(909)}', '${TENANT}', 'RISK', '${R[0]}', '${U[4]}', '${U[1]}', '${T1}', '${SHARED}', now() + interval '10 days');
UPDATE resource_access_grants SET revoked_at = '${T4}', revoked_by = '${U[4]}', revoke_reason = 'Retrait QA' WHERE id IN ('${id(906)}', '${id(907)}');
INSERT INTO sensitive_view_grants (id, tenant_id, user_id, reason, requested_by, requested_at) VALUES
 ('${id(801)}', '${TENANT}', '${U[0]}', 'Demande en attente', '${U[5]}', '${T1}'),
 ('${id(802)}', '${TENANT}', '${U[1]}', 'Demande approuvée', '${U[5]}', '${T1}'),
 ('${id(803)}', '${TENANT}', '${U[2]}', 'Demande refusée', '${U[5]}', '${T1}'),
 ('${id(804)}', '${TENANT}', '${U[3]}', 'Demande puis révoquée', '${U[5]}', '${T1}'),
 ('${id(805)}', '${TENANT}', '${U[4]}', '${LONG.replaceAll("'", "''")}', '${U[5]}', '${T2}');
UPDATE sensitive_view_grants SET status = 'APPROVED', decided_by = '${U[0]}', decided_at = '${T2}', decision_reason = 'Accord justifié', access_expires_at = now() + interval '10 days' WHERE id IN ('${id(802)}', '${id(804)}');
UPDATE sensitive_view_grants SET status = 'REJECTED', decided_by = '${U[0]}', decided_at = '${T2}', decision_reason = 'Refus justifié' WHERE id = '${id(803)}';
UPDATE sensitive_view_grants SET status = 'REVOKED', revoked_by = '${U[0]}', revoked_at = '${T3}', revoke_reason = 'Fin du besoin' WHERE id = '${id(804)}';
UPDATE sensitive_view_grants SET status = 'REVOKED', revoked_by = '${U[0]}', revoked_at = '${T4}', revoke_reason = 'Remplacée par une nouvelle demande' WHERE id = '${id(805)}';
INSERT INTO audit_log (tenant_id, user_id, entity_type, entity_id, action, old_value, new_value, reason, request_id)
  VALUES ('${TENANT}', '${U[0]}', 'Risk', '${R[0]}', 'PERMISSION_CHANGE', '{}', '{}', 'Texte clair historique', 'legacy-1');
`;

// Everything the migration touches, in one deterministic text per table (compared before the up and after the down).
const SNAPSHOT_RAG = `SELECT id, grant_reason, revoke_reason, granted_at, revoked_at, revoked_by, expires_at FROM resource_access_grants ORDER BY id`;
const SNAPSHOT_SVG = `SELECT id, reason, decision_reason, revoke_reason, status, requested_at, decided_at, revoked_at FROM sensitive_view_grants ORDER BY id`;

describe.skipIf(!hasLocalPg)("QA-L2a migration 096 on a database at state 095 with legacy rows (real PostgreSQL, local only)", () => {
  let admin: Pool;
  const clones: string[] = [];

  async function runFile(database: string, sql: string): Promise<string | null> {
    const c = new Client({ host: PG_HOST, port: PORT, user: "postgres", database });
    await c.connect();
    try { await c.query(sql); return null; } catch (e) { return `${(e as { code?: string }).code ?? ""} ${(e as Error).message}`; } finally { await c.end(); }
  }
  async function clone(): Promise<{ name: string; pool: Pool; q: (sql: string, p?: unknown[]) => Promise<Array<Record<string, any>>> }> { // eslint-disable-line @typescript-eslint/no-explicit-any
    const name = `grc_qa_l2am_c${randomUUID().replaceAll("-", "").slice(0, 10)}`;
    await admin.query(`CREATE DATABASE ${name} TEMPLATE ${TEMPLATE}`);
    clones.push(name);
    const pool = connect(name, 2);
    return { name, pool, q: async (sql, p = []) => (await pool.query(sql, p)).rows as Array<Record<string, any>> }; // eslint-disable-line @typescript-eslint/no-explicit-any
  }

  beforeAll(async () => {
    admin = connect("postgres", 2);
    await admin.query(`CREATE DATABASE ${TEMPLATE}`);
    const setup = new Client({ host: PG_HOST, port: PORT, user: "postgres", database: TEMPLATE });
    await setup.connect();
    try {
      await setup.query("CREATE TABLE schema_migrations (filename text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())");
      for (const f of upTo095()) await setup.query(file(f));
      for (const stmt of SEED.split(";\n").filter((x) => x.trim())) {
        await setup.query(stmt).catch((e: Error) => { throw new Error(`${e.message} :: ${stmt.slice(150, 420)}`); });
      }
    } finally { await setup.end(); }
  }, 280000);

  afterAll(async () => {
    for (const n of [...clones, TEMPLATE]) await admin?.query(`DROP DATABASE IF EXISTS ${n} WITH (FORCE)`);
    await admin?.end();
  }, 60000);

  it("the template really is at 095 (no visibility_reasons, no reference column) and carries the legacy rows", async () => {
    const c = await clone();
    try {
      expect((await c.q(`SELECT to_regclass('public.visibility_reasons') AS t`))[0]!["t"]).toBeNull();
      expect(await c.q(`SELECT 1 FROM information_schema.columns WHERE table_name = 'audit_log' AND column_name = 'reason_ref'`)).toHaveLength(0);
      expect(await c.q(`SELECT 1 FROM resource_access_grants`)).toHaveLength(8);
      expect(await c.q(`SELECT 1 FROM sensitive_view_grants`)).toHaveLength(5);
    } finally { await c.pool.end(); }
  });

  it("up: texts moved, shared motif = one row, creation constant kept, audit_log untouched, references immutable, guards enabled again", async () => {
    const c = await clone();
    try {
      expect(await runFile(c.name, file(UP))).toBeNull();
      // 5 motifs for the access grants (M1 g1+g2+g4, M2 g3, M3 g6+g7, M4 g9, revoke of g6+g7) + 10 for the sensitive-view grants.
      const all = await c.q(`SELECT source, text, created_at, erased_at, effect_ended_at, reviewed_at FROM visibility_reasons`);
      expect(all).toHaveLength(15);
      expect(all.filter((r) => r["source"] === "VISIBILITY_CHANGE")).toHaveLength(5);
      expect(all.filter((r) => r["source"] === "SENSITIVE_VIEW_REQUEST")).toHaveLength(5);
      expect(all.filter((r) => r["source"] === "SENSITIVE_VIEW_DECISION")).toHaveLength(3);
      expect(all.filter((r) => r["source"] === "SENSITIVE_VIEW_REVOCATION")).toHaveLength(2);
      expect(all.every((r) => r["erased_at"] === null && r["effect_ended_at"] === null && r["reviewed_at"] === null)).toBe(true);
      expect(all.filter((r) => r["text"] === SHARED)).toHaveLength(3); // T1 by u0, T2 by u0, T1 by u1

      const rag = await c.q(`SELECT g.id, g.grant_reason, g.grant_reason_ref, g.revoke_reason, g.revoke_reason_ref, v.text, v.created_at, v.source, w.text AS revoke_text, w.created_at AS revoke_created
                             FROM resource_access_grants g LEFT JOIN visibility_reasons v ON v.id = g.grant_reason_ref LEFT JOIN visibility_reasons w ON w.id = g.revoke_reason_ref`);
      const by = Object.fromEntries(rag.map((r) => [r["id"] as string, r]));
      expect(by[id(901)]!["grant_reason_ref"]).not.toBeNull();
      expect(by[id(902)]!["grant_reason_ref"]).toBe(by[id(901)]!["grant_reason_ref"]);
      expect(by[id(904)]!["grant_reason_ref"]).toBe(by[id(901)]!["grant_reason_ref"]); // same author and instant, other resource: one physical action
      expect(by[id(903)]!["grant_reason_ref"]).not.toBe(by[id(901)]!["grant_reason_ref"]); // other instant
      expect(by[id(909)]!["grant_reason_ref"]).not.toBe(by[id(901)]!["grant_reason_ref"]); // other author
      expect(new Date(by[id(901)]!["created_at"]).toISOString()).toBe("2026-03-01T10:00:00.000Z");
      expect(new Date(by[id(903)]!["created_at"]).toISOString()).toBe("2026-04-01T10:00:00.000Z");
      expect(by[id(901)]!["grant_reason"]).toBeNull();
      expect(by[id(901)]!["text"]).toBe(SHARED);
      expect(by[id(905)]).toMatchObject({ grant_reason: CREATION, grant_reason_ref: null }); // technical constant stays, no motif for it
      expect(by[id(906)]!["text"]).toBe(LONG); // 500 characters, quotes, backslash, newlines, SQL-looking text: byte for byte
      expect(by[id(906)]!["grant_reason_ref"]).toBe(by[id(907)]!["grant_reason_ref"]);
      expect(by[id(906)]!["revoke_reason_ref"]).toBe(by[id(907)]!["revoke_reason_ref"]);
      expect([by[id(906)]!["revoke_reason"], by[id(906)]!["revoke_text"]]).toEqual([null, "Retrait QA"]);
      expect(new Date(by[id(906)]!["revoke_created"]).toISOString()).toBe("2026-06-01T10:00:00.000Z");
      expect(rag.filter((r) => r["grant_reason"] !== null)).toHaveLength(1); // only the constant is still a text

      const svg = await c.q(`SELECT g.id, g.reason, g.decision_reason, g.revoke_reason, a.text AS rq, a.created_at AS rq_at, d.text AS dc, d.created_at AS dc_at, r.text AS rv, r.created_at AS rv_at
                             FROM sensitive_view_grants g LEFT JOIN visibility_reasons a ON a.id = g.reason_ref LEFT JOIN visibility_reasons d ON d.id = g.decision_reason_ref LEFT JOIN visibility_reasons r ON r.id = g.revoke_reason_ref`);
      const s = Object.fromEntries(svg.map((r) => [r["id"] as string, r]));
      expect(svg.every((r) => r["reason"] === null && r["decision_reason"] === null && r["revoke_reason"] === null)).toBe(true);
      expect([s[id(801)]!["rq"], s[id(801)]!["dc"], s[id(801)]!["rv"]]).toEqual(["Demande en attente", null, null]);
      expect([s[id(802)]!["rq"], s[id(802)]!["dc"], s[id(802)]!["rv"]]).toEqual(["Demande approuvée", "Accord justifié", null]);
      expect([s[id(803)]!["rq"], s[id(803)]!["dc"]]).toEqual(["Demande refusée", "Refus justifié"]);
      expect([s[id(804)]!["rq"], s[id(804)]!["dc"], s[id(804)]!["rv"]]).toEqual(["Demande puis révoquée", "Accord justifié", "Fin du besoin"]);
      expect([s[id(805)]!["rq"], s[id(805)]!["dc"], s[id(805)]!["rv"]]).toEqual([LONG, null, "Remplacée par une nouvelle demande"]);
      expect(new Date(s[id(804)]!["dc_at"]).toISOString()).toBe("2026-04-01T10:00:00.000Z");
      expect(new Date(s[id(804)]!["rv_at"]).toISOString()).toBe("2026-05-01T10:00:00.000Z");
      // two decisions with the same text on two rows stay two motifs (one per row and column)
      expect(s[id(802)]!["dc"]).toBe(s[id(804)]!["dc"]);
      expect(new Set((await c.q(`SELECT decision_reason_ref FROM sensitive_view_grants WHERE decision_reason_ref IS NOT NULL`)).map((r) => r["decision_reason_ref"])).size).toBe(3);

      // the journal is left alone: clear legacy text, no reference, still append-only
      const log = (await c.q(`SELECT reason, reason_ref FROM audit_log WHERE request_id = 'legacy-1'`))[0]!;
      expect(log).toEqual({ reason: "Texte clair historique", reason_ref: null });
      await expect(c.pool.query(`UPDATE audit_log SET reason = 'x' WHERE request_id = 'legacy-1'`)).rejects.toThrow();

      // guards re-enabled ('O' = enabled) and updated
      const trg = await c.q(`SELECT tgname, tgenabled FROM pg_trigger WHERE tgname IN ('resource_access_grants_guard', 'sensitive_view_grants_guard', 'visibility_reasons_guard', 'visibility_reasons_truncate_guard') ORDER BY tgname`);
      expect(trg.map((t) => `${t["tgname"]}:${t["tgenabled"]}`)).toEqual(["resource_access_grants_guard:O", "sensitive_view_grants_guard:O", "visibility_reasons_guard:O", "visibility_reasons_truncate_guard:O"]);
      const fn = await c.q(`SELECT proname, proconfig FROM pg_proc WHERE proname IN ('resource_access_grants_guard', 'sensitive_view_grants_guard', 'visibility_reasons_guard', 'visibility_reasons_truncate_guard')`);
      expect(fn).toHaveLength(4);
      for (const f of fn) expect(f["proconfig"], f["proname"]).toEqual(["search_path=pg_catalog, public, pg_temp"]);
      const refused = async (sql: string) => c.pool.query(sql).then(() => null, (e: Error) => e.message);
      expect(await refused(`UPDATE resource_access_grants SET grant_reason_ref = revoke_reason_ref WHERE id = '${id(906)}'`)).toMatch(/immutable/);
      expect(await refused(`UPDATE resource_access_grants SET grant_reason = 'autre' WHERE id = '${id(905)}'`)).toMatch(/immutable/);
      expect(await refused(`UPDATE sensitive_view_grants SET reason_ref = decision_reason_ref WHERE id = '${id(802)}'`)).toMatch(/immutable/);
      expect(await refused(`UPDATE sensitive_view_grants SET decision_reason_ref = NULL WHERE id = '${id(804)}'`)).toMatch(/forbidden transition|immutable|check/);
      expect(await refused(`DELETE FROM sensitive_view_grants WHERE id = '${id(801)}'`)).toMatch(/never deleted/);
      expect(await refused(`DELETE FROM resource_access_grants WHERE id = '${id(901)}'`)).toMatch(/never deleted/);
      expect(await refused(`DELETE FROM visibility_reasons`)).toMatch(/never deleted/);
      expect(await refused(`TRUNCATE visibility_reasons`)).not.toBeNull();
      // the CHECK that replaced the shape checks still bites
      expect(await refused(`INSERT INTO resource_access_grants (tenant_id, resource_type, resource_id, user_id, granted_by) VALUES ('${TENANT}', 'RISK', '${R[4]}', '${U[1]}', '${U[0]}')`)).toMatch(/rag_grant_reason_present_check/);
    } finally { await c.pool.end(); }
  }, 120000);

  it("replaying 096 on a migrated base is a no-op (no error, same rows, same references)", async () => {
    const c = await clone();
    try {
      expect(await runFile(c.name, file(UP))).toBeNull();
      const before = JSON.stringify(await c.q(`SELECT id, grant_reason_ref, revoke_reason_ref FROM resource_access_grants ORDER BY id`))
        + JSON.stringify(await c.q(`SELECT id, reason_ref, decision_reason_ref, revoke_reason_ref FROM sensitive_view_grants ORDER BY id`))
        + JSON.stringify(await c.q(`SELECT id FROM visibility_reasons ORDER BY id`));
      expect(await runFile(c.name, file(UP))).toBeNull();
      const after = JSON.stringify(await c.q(`SELECT id, grant_reason_ref, revoke_reason_ref FROM resource_access_grants ORDER BY id`))
        + JSON.stringify(await c.q(`SELECT id, reason_ref, decision_reason_ref, revoke_reason_ref FROM sensitive_view_grants ORDER BY id`))
        + JSON.stringify(await c.q(`SELECT id FROM visibility_reasons ORDER BY id`));
      expect(after).toBe(before);
    } finally { await c.pool.end(); }
  }, 120000);

  it("down gives the 095 rows back byte for byte, then up again reproduces the same motifs; the down is replayable", async () => {
    const c = await clone();
    try {
      const rag = JSON.stringify(await c.q(SNAPSHOT_RAG));
      const svg = JSON.stringify(await c.q(SNAPSHOT_SVG));
      expect(await runFile(c.name, file(UP))).toBeNull();
      expect(await runFile(c.name, file(DOWN))).toBeNull();
      expect(JSON.stringify(await c.q(SNAPSHOT_RAG))).toBe(rag);
      expect(JSON.stringify(await c.q(SNAPSHOT_SVG))).toBe(svg);
      expect((await c.q(`SELECT to_regclass('public.visibility_reasons') AS t`))[0]!["t"]).toBeNull();
      expect(await c.q(`SELECT 1 FROM information_schema.columns WHERE table_name IN ('audit_log', 'resource_access_grants', 'sensitive_view_grants') AND column_name LIKE '%reason_ref'`)).toHaveLength(0);
      expect((await c.q(`SELECT is_nullable FROM information_schema.columns WHERE table_name = 'resource_access_grants' AND column_name = 'grant_reason'`))[0]!["is_nullable"]).toBe("NO");
      expect((await c.q(`SELECT is_nullable FROM information_schema.columns WHERE table_name = 'sensitive_view_grants' AND column_name = 'reason'`))[0]!["is_nullable"]).toBe("NO");
      // the 087 / 084 guards are back in their 095 form: a content change is refused, a revocation is not blocked by a missing column
      const refused = (sql: string) => c.pool.query(sql).then(() => null, (e: Error) => e.message);
      expect(await refused(`UPDATE resource_access_grants SET grant_reason = 'x' WHERE id = '${id(901)}'`)).toMatch(/immutable/);
      expect(await refused(`UPDATE sensitive_view_grants SET reason = 'x' WHERE id = '${id(801)}'`)).toMatch(/immutable/);
      // up again
      expect(await runFile(c.name, file(UP))).toBeNull();
      expect(await c.q(`SELECT 1 FROM visibility_reasons`)).toHaveLength(15);
    } finally { await c.pool.end(); }
  }, 180000);

  it.fails("QA-L2A-03 (MINOR, it.fails): the down run a second time (already rolled back) is rejected cleanly, like 095's after QA-L1-04", async () => {
    const c = await clone();
    try {
      expect(await runFile(c.name, file(UP))).toBeNull();
      expect(await runFile(c.name, file(DOWN))).toBeNull();
      expect(await runFile(c.name, file(DOWN))).toBeNull();
    } finally { await c.pool.end(); }
  }, 120000);

  it("down refuses (55000) when a journal row references a motif, and leaves the 096 state intact", async () => {
    const c = await clone();
    try {
      expect(await runFile(c.name, file(UP))).toBeNull();
      const ref = (await c.q(`SELECT id FROM visibility_reasons LIMIT 1`))[0]!["id"] as string;
      await c.pool.query(`INSERT INTO audit_log (tenant_id, user_id, entity_type, entity_id, action, reason, request_id, reason_ref) VALUES ($1, $2, 'Risk', $3, 'PERMISSION_CHANGE', NULL, 'l2a-ref', $4)`, [TENANT, U[0], R[0], ref]);
      expect(await runFile(c.name, file(DOWN))).toMatch(/^55000 /);
      expect((await c.q(`SELECT count(*)::int AS n FROM visibility_reasons`))[0]!["n"]).toBe(15);
      expect((await c.q(`SELECT count(*)::int AS n FROM resource_access_grants WHERE grant_reason_ref IS NOT NULL`))[0]!["n"]).toBe(7);
    } finally { await c.pool.end(); }
  }, 120000);

  it("down refuses (55000) when a motif is erased; an erased motif keeps the guard's once-only rule", async () => {
    const c = await clone();
    try {
      expect(await runFile(c.name, file(UP))).toBeNull();
      await c.pool.query(`UPDATE visibility_reasons SET text = NULL, erased_at = now() WHERE id = (SELECT id FROM visibility_reasons LIMIT 1)`);
      expect(await runFile(c.name, file(DOWN))).toMatch(/^55000 /);
      expect((await c.q(`SELECT count(*)::int AS n FROM visibility_reasons`))[0]!["n"]).toBe(15);
    } finally { await c.pool.end(); }
  }, 120000);

  it.fails("QA-L2A-04 (MINOR latent, it.fails): a legacy sensitive-view reason made only of tab / newline (accepted by 079's spaces-only btrim) does not break the migration", async () => {
    const c = await clone();
    try {
      await c.pool.query(`INSERT INTO sensitive_view_grants (tenant_id, user_id, reason, requested_by) VALUES ($1, $2, E'\\t', $3)`, [TENANT, U[5], U[0]]);
      const err = await runFile(c.name, file(UP));
      // 096 checks btrim with the whitespace set, 079 only trimmed spaces: the migration aborts (atomically) on such a row.
      expect(err).toBeNull();
    } finally { await c.pool.end(); }
  }, 120000);
});
