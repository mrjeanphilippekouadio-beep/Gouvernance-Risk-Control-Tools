import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Pool } from "pg";
import { RiskFrameworkService } from "../src/services/RiskFrameworkService.js";

// QA edge cases of DECISION-071 (q133 server resolution, q134 migration 064). PG part: local database only, via QA_SWP_PGHOST.
const PGHOST = process.env.QA_SWP_PGHOST ?? "";

describe("q133 withResolvedAppetite (service, fake category repository scoped by tenant)", () => {
  const cats: Record<string, { id: string; tenantId: string; name: string; active: boolean; parentId: string | null }> = {
    sub: { id: "sub", tenantId: "T1", name: "Fraude carte", active: true, parentId: "root" },
    off: { id: "off", tenantId: "T1", name: "Inactive", active: false, parentId: "root" },
    top: { id: "top", tenantId: "T1", name: "Racine", active: true, parentId: null },
    foreign: { id: "foreign", tenantId: "T2", name: "Autre tenant", active: true, parentId: "r2" },
  };
  const repo = { async getById(t: string, id: string) { const c = cats[id]; return c && c.tenantId === t ? c : null; } };
  const svc = new RiskFrameworkService(undefined as never, undefined as never, undefined as never, undefined as never, undefined as never, repo as never);
  const resolve = (tenant: string, ids: Array<string | null | undefined>) =>
    (svc as unknown as { withResolvedAppetite(t: string, p: unknown): Promise<{ appetiteThresholds: Array<{ subCategory: string }> }> })
      .withResolvedAppetite(tenant, { appetiteThresholds: ids.map((subCategoryId, i) => ({ subCategory: "forgé", subCategoryId, entity: String(i), threshold: 5, description: null })) });

  it("derives the label from the id and ignores the client text", async () => {
    expect((await resolve("T1", ["sub"])).appetiteThresholds[0]!.subCategory).toBe("Fraude carte");
  });
  it.each([["missing", undefined], ["null", null], ["empty", ""], ["another tenant", "foreign"], ["unknown", "zzz"], ["inactive", "off"], ["top-level", "top"]])("refuses %s", async (_n, id) => {
    await expect(resolve("T1", [id])).rejects.toThrow();
  });
  it("one bad entry among good ones refuses the whole list", async () => {
    await expect(resolve("T1", ["sub", "sub", "foreign"])).rejects.toThrow();
  });
  it("empty list and omitted list need no category repository", async () => {
    const bare = new RiskFrameworkService(undefined as never, undefined as never, undefined as never, undefined as never, undefined as never, undefined);
    const f = (p: unknown) => (bare as unknown as { withResolvedAppetite(t: string, p: unknown): Promise<unknown> }).withResolvedAppetite("T1", p);
    await expect(f({ appetiteThresholds: [] })).resolves.toBeTruthy();
    await expect(f({})).resolves.toEqual({});
  });

  // QA-064-01 (MINOR): the activation-time check (assertSubCategories) only tests EXISTENCE, not active/sub-category, so a category
  // deactivated or made top-level between the draft save and the activation request is accepted, as is a legacy free-text entry.
  it.fails("QA-064-01: activation request re-checks that the category is still active (F-FW-01 'catégorie désactivée entre le choix et l'activation')", async () => {
    const check = (svc as unknown as { assertSubCategories(t: string, e: unknown[]): Promise<void> }).assertSubCategories.bind(svc);
    await expect(check("T1", [{ subCategoryId: "off" }])).rejects.toThrow();
  });
  it.fails("QA-064-01b: activation request refuses a legacy entry without subCategoryId", async () => {
    const check = (svc as unknown as { assertSubCategories(t: string, e: unknown[]): Promise<void> }).assertSubCategories.bind(svc);
    await expect(check("T1", [{ subCategory: "texte libre", subCategoryId: null }])).rejects.toThrow();
  });
});

describe.skipIf(!PGHOST.startsWith("/"))("migration 064 through the REAL version triggers (no replication-role shortcut)", () => {
  let pool: Pool;
  beforeAll(() => { pool = new Pool({ host: PGHOST, port: Number(process.env.QA_SWP_PGPORT ?? 5531), user: "postgres", database: process.env.QA_SWP_PGDB ?? "grc_qa_a08", max: 2 }); });
  afterAll(async () => { await pool.end(); });
  const one = async (sql: string, p: unknown[] = []) => (await pool.query(sql, p)).rows[0].id as string;
  const code = async (sql: string, p: unknown[] = []) => { try { await pool.query(sql, p); return "OK"; } catch (e) { return (e as { code: string }).code; } };
  async function world() {
    const t = await one(`INSERT INTO tenants (name) VALUES ($1) RETURNING id`, [`q064-${Math.random()}`]);
    const u = await one(`INSERT INTO users (tenant_id, email, display_name) VALUES ($1,$2,'x') RETURNING id`, [t, `q064-${Math.random()}@x`]);
    const scale = await one(`INSERT INTO rating_scales (tenant_id, name, version, probability_levels, impact_levels) VALUES ($1,'s','1',4,4) RETURNING id`, [t]);
    const fw = await one(`INSERT INTO risk_frameworks (tenant_id, name) VALUES ($1,'f') RETURNING id`, [t]);
    const v = await one(`INSERT INTO risk_framework_versions (tenant_id, framework_id, version_number, rating_scale_id, committee_evaluation_min_score) VALUES ($1,$2,1,$3,10) RETURNING id`, [t, fw, scale]);
    return { t, u, scale, fw, v };
  }
  const archive = (w: { v: string; u: string }) =>
    code(`UPDATE risk_framework_versions SET status='ARCHIVED', archived_at=now(), archived_by=$2, archive_reason='abandon' WHERE id=$1`, [w.v, w.u]);
  // Activation needs an approved request (guard from 055+); only that one step is shortcut, session-local. ARCHIVE stays real.
  async function activate(w: { v: string }) {
    const c = await pool.connect();
    try {
      await c.query("SET session_replication_role = replica");
      await c.query(`UPDATE risk_framework_versions SET status='ACTIVE', activated_at=now() WHERE id=$1`, [w.v]);
    } finally { await c.query("RESET session_replication_role"); c.release(); }
  }
  const del = (w: { scale: string }) => code(`UPDATE rating_scales SET deleted_at = now() WHERE id = $1`, [w.scale]);

  it("DRAFT archived through the legitimate path: activated_at stays NULL and the scale can be disabled", async () => {
    const w = await world();
    expect(await del(w)).toBe("23503");
    expect(await archive(w)).toBe("OK");
    expect((await pool.query(`SELECT activated_at FROM risk_framework_versions WHERE id=$1`, [w.v])).rows[0].activated_at).toBeNull();
    expect(await del(w)).toBe("OK");
  });
  it("an abandoned draft cannot be reactivated or revived afterwards (ARCHIVED is terminal), nor can activated_at be forged to reopen the block", async () => {
    const w = await world(); await archive(w); await del(w);
    expect(await code(`UPDATE risk_framework_versions SET status='DRAFT' WHERE id=$1`, [w.v])).toBe("42501");
    expect(await code(`UPDATE risk_framework_versions SET status='ACTIVE', activated_at=now() WHERE id=$1`, [w.v])).toBe("42501");
    expect(await code(`UPDATE risk_framework_versions SET activated_at=now() WHERE id=$1`, [w.v])).toBe("42501");
  });
  it("a PENDING_APPROVAL version cannot be archived directly (so it cannot masquerade as abandoned); rejected back to DRAFT it blocks again", async () => {
    const w = await world();
    expect(await code(`UPDATE risk_framework_versions SET status='PENDING_APPROVAL' WHERE id=$1`, [w.v])).toBe("OK");
    expect(await archive(w)).toBe("42501");
    expect(await del(w)).toMatch(/^(23503|42501)$/);
  });
  it("ACTIVE then ARCHIVED via the real path keeps blocking (activated_at is kept)", async () => {
    const w = await world();
    await activate(w);
    expect(await archive(w)).toBe("OK");
    expect((await pool.query(`SELECT activated_at FROM risk_framework_versions WHERE id=$1`, [w.v])).rows[0].activated_at).not.toBeNull();
    expect(await del(w)).toMatch(/^(23503|42501)$/);
  });
  it("one abandoned + one DRAFT on the same scale: still blocked; once the draft is also abandoned: released", async () => {
    const w = await world(); await archive(w);
    await pool.query(`INSERT INTO risk_framework_versions (tenant_id, framework_id, version_number, rating_scale_id, committee_evaluation_min_score) VALUES ($1,$2,2,$3,10)`, [w.t, w.fw, w.scale]);
    expect(await del(w)).toMatch(/^(23503|42501)$/);
    await pool.query(`UPDATE risk_framework_versions SET status='ARCHIVED', archived_at=now(), archived_by=$2, archive_reason='x' WHERE tenant_id=$1 AND version_number=2`, [w.t, w.u]);
    expect(await del(w)).toBe("OK");
  });
  it("a deleted scale cannot receive a NEW version (alive guard) even though the abandoned one still points at it", async () => {
    const w = await world(); await archive(w); await del(w);
    expect(await code(`INSERT INTO risk_framework_versions (tenant_id, framework_id, version_number, rating_scale_id, committee_evaluation_min_score) VALUES ($1,$2,2,$3,10)`, [w.t, w.fw, w.scale])).toBe("23514");
  });
  it("scale content stays frozen for an activated-then-archived version, free for an abandoned one", async () => {
    const a = await world(); await archive(a);
    expect(await code(`UPDATE rating_scales SET name='renamed' WHERE id=$1`, [a.scale])).toBe("OK");
    const b = await world();
    await activate(b);
    await archive(b);
    expect(await code(`UPDATE rating_scales SET name='renamed' WHERE id=$1`, [b.scale])).toBe("42501");
  });
  it("both redefined functions pin search_path with pg_temp last", async () => {
    const { rows } = await pool.query(`SELECT proname, proconfig FROM pg_proc WHERE proname IN ('rating_scales_delete_guard','rating_scales_framework_freeze')`);
    expect(rows).toHaveLength(2);
    for (const r of rows) expect(r.proconfig).toContain("search_path=pg_catalog, public, pg_temp");
  });
});
