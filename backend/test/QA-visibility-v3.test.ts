import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { Pool } from "pg";

/**
 * QA-visibility-v3 (level 2): lot V3 (DECISION-108/109). q196/q198: `GET /hidden-counts` (« X éléments non visibles »: one number per type,
 * PERIMETRE only, never NOMINATIF, inherited level for anomalies and plans, limited to the types the reader may read, null for RM / Committee /
 * Audit). q209: `GET /restricted-resources` open to Committee and Audit, `lastChange` (R-1), `limit` / `offset`. q212: a department-group role
 * assignment (`POST /roles/:id/assign`) and a risk owner / N+1 designation (`reason`) that OPEN restricted resources need a reason outside the RM
 * group, write a PERMISSION_CHANGE (widening, DEPARTMENT_GROUP / DESIGNATION) and notify the RM group.
 * Oracles written BEFORE running, from the decisions and the V1/V2 reading matrix. Not a Security / Privacy / Compliance opinion.
 *
 * Live part: QA_VIS3_LIVE=1 + LOCAL cluster of tests/integration/qa-visibility-v1-setup.sh (127.0.0.1:55442, never a remote host); its own base
 * (grc_qa_vv3t) is rebuilt: run live suites with --no-file-parallelism. `it.fails` documents a CONFIRMED defect (turn it into `it` when fixed).
 */
const ROOT = join(__dirname, "..", "..");
const live = process.env["QA_VIS3_LIVE"] === "1";
const PGPORT = 55442;
const DB = "grc_qa_vv3t";
const PORT = 8092;
const API = `http://127.0.0.1:${PORT}/api/v1`;
const I = (x: string) => `aaaaaaaa-0000-4000-8000-000000000${x}`;
const K = (x: string) => `aaaaaaaa-0000-4000-8000-00000000${x}`;
const read = (...p: string[]) => readFileSync(join(ROOT, ...p), "utf8");

describe("QA-visibility-v3 STATIC", () => {
  it("catalog: DEPARTMENT_GROUP_VISIBILITY_WIDENED is a mandatory MANAGEMENT event", () => {
    expect(read("backend", "src", "domain", "notificationCatalog.ts")).toMatch(/resourceType: "MANAGEMENT", eventType: "DEPARTMENT_GROUP_VISIBILITY_WIDENED"[^\n]*mandatory: true/);
  });
  it("wiring: hidden-counts is mounted behind authMiddleware; the manager is injected into RoleService and RiskService", () => {
    const s = read("backend", "src", "server.ts");
    expect(s).toMatch(/app\.use\("\/api\/v1\/hidden-counts", authMiddleware\(identityProvider\), hiddenCountsRouter\(/);
    expect(s).toMatch(/new RoleService\([^;]*resourceVisibilityManager\);/);
    expect(s).toMatch(/new RiskService\([^;]*resourceVisibilityManager/);
  });
  it("routes: pagination is bounded (limit 1..500, offset >= 0, integers), both routes are GET only, `reason` is reasonText(500) on both designation routes", () => {
    const r = read("backend", "src", "api", "v1", "restrictedResources.routes.ts");
    expect(r).toMatch(/limit: z\.coerce\.number\(\)\.int\(\)\.min\(1\)\.max\(500\)\.optional\(\)/);
    expect(r).toMatch(/offset: z\.coerce\.number\(\)\.int\(\)\.min\(0\)\.optional\(\)/);
    expect(r).not.toMatch(/router\.(post|put|patch|delete)/);
    expect((read("backend", "src", "api", "v1", "risks.routes.ts").match(/reason: reasonText\(500\)\.optional\(\)/g) ?? []).length).toBeGreaterThanOrEqual(2);
  });
  it("hidden counts SQL: PERIMETRE only (no NOMINATIF branch), tenant-scoped, soft-deleted excluded", () => {
    const src = read("backend", "src", "infrastructure", "database", "postgres", "PostgresResourceAccessRepository.ts");
    const q = src.slice(src.indexOf("async hiddenCounts"), src.indexOf("async canRead")).split("\n").filter((l) => !l.trim().startsWith("//")).join("\n");
    expect(q).not.toMatch(/NOMINATIF/);
    expect((q.match(/= 'PERIMETRE'/g) ?? []).length).toBeGreaterThanOrEqual(5);
    expect((q.match(/tenant_id = \$1/g) ?? []).length).toBeGreaterThanOrEqual(5);
    expect((q.match(/deleted_at IS NULL/g) ?? []).length).toBeGreaterThanOrEqual(3);
  });
  it("no migration: 083 is still the last one (V3 adds no schema)", () => {
    const names = execFileSync("ls", [join(ROOT, "database", "postgresql", "migrations")], { encoding: "utf8" }).split("\n").filter((f) => f.endsWith(".sql") && !f.endsWith(".down.sql"));
    expect(names.sort((a, b) => a.localeCompare(b)).at(-1)).toBe("083_resource_visibility_v2.sql");
  });
  it("frontend: the notice sits under the 5 lists, the role admin screen offers the reason, the restricted screen is open to RM / Committee / Audit", () => {
    for (const [f, t] of [["risks/RisksPage", "RISK"], ["controls/ControlsPage", "CONTROL"], ["anomalies/AnomaliesPage", "ANOMALY"], ["actions/ActionPlansPage", "ACTION_PLAN"], ["indicators/KpiPage", "KPI"]]) {
      expect(read("frontend", "src", "features", `${f}.tsx`), f).toContain(`<HiddenCountNotice token={token} type="${t}" />`);
    }
    expect(read("frontend", "src", "features", "admin", "RolesAdmin.tsx")).toMatch(/Motif de l'attribution du rôle/);
    expect(read("frontend", "src", "App.tsx")).toMatch(/id: "restricted"[^\n]*resourcevisibility\.set[^\n]*riskevaluation\.validate\.committee[^\n]*audit\.read/);
    expect(read("frontend", "src", "api", "visibility.ts")).toContain("/hidden-counts");
  });
});

type Who = "own" | "n1" | "raci" | "pown" | "dept" | "named" | "out" | "out2" | "rm" | "com" | "aud" | "adm";
const WHO: Who[] = ["own", "n1", "raci", "pown", "dept", "named", "out", "out2", "rm", "com", "aud", "adm"];
const UID: Record<Who, string> = { own: I("101"), n1: I("102"), raci: I("103"), pown: I("104"), dept: I("105"), named: I("106"), out: I("107"), out2: I("108"), rm: I("109"), com: I("10a"), aud: I("10b"), adm: I("10c") };
const SEE_ALL: Who[] = ["rm", "com", "aud"];
const u = (...a: Array<readonly Who[]>): Who[] => [...new Set(a.flat())];
const RISK_PERIM = u(["own", "n1", "raci", "pown", "dept", "named"], SEE_ALL);
const CTL_PERIM = u(["raci", "pown", "dept", "named"], SEE_ALL);
const KPI_PERIM = u(["pown", "dept", "named"], SEE_ALL);
// Items whose EFFECTIVE level is PERIMETRE (spec q198: NOMINATIF and CLIENT never counted; an anomaly / plan counts under the level it inherits), with their readers.
const EFFECTIVE_PERIM: Record<"RISK" | "CONTROL" | "ANOMALY" | "ACTION_PLAN" | "KPI", Array<{ what: string; readers: Who[] }>> = {
  RISK: [{ what: "risk 502", readers: RISK_PERIM }],
  CONTROL: [{ what: "c02", readers: CTL_PERIM }, { what: "c04 orphan", readers: SEE_ALL }],
  KPI: [{ what: "kpi 9002", readers: KPI_PERIM }],
  ANOMALY: [
    { what: "d01 (risk 502)", readers: RISK_PERIM }, { what: "d02 (risk 502, declarer out)", readers: RISK_PERIM }, { what: "V1 anomaly on risk 502", readers: RISK_PERIM },
    { what: "d03 (control c02)", readers: CTL_PERIM }, { what: "d04 (own PERIMETRE, declarer dept)", readers: u(["dept", "named"], SEE_ALL) },
  ],
  ACTION_PLAN: [
    { what: "a01 (risk 502, responsible out)", readers: u(["out"], RISK_PERIM) }, { what: "a02 (risk 502)", readers: u(["own"], RISK_PERIM) },
    { what: "a04 (KRI -> risk 502)", readers: u(["own"], RISK_PERIM) }, { what: "V1 plan on risk 502", readers: u(["own"], RISK_PERIM) },
    { what: "a03 (control c02)", readers: u(["own"], CTL_PERIM) }, { what: "a06 (own PERIMETRE)", readers: u(["own", "raci", "dept", "named"], SEE_ALL) },
  ],
};
const expectedCounts = (who: Who) => Object.fromEntries(Object.entries(EFFECTIVE_PERIM).map(([t, items]) => [t, items.filter((i) => !i.readers.includes(who)).length]));

const TOK = {} as Record<Who, string>;
let pg: Pool;
const sh = (cmd: string, args: string[], env: Record<string, string> = {}) =>
  execFileSync(cmd, args, { encoding: "utf8", env: { ...process.env, ...env }, stdio: ["ignore", "pipe", "pipe"], timeout: 300000 });
const sql = async <T = Record<string, unknown>>(q: string, p: unknown[] = []) => (await pg.query(q, p)).rows as T[];
type Res = { status: number; text: string; json: any };
async function call(who: Who | null, method: string, path: string, body?: unknown): Promise<Res> {
  const r = await fetch(API + path, { method, headers: { "content-type": "application/json", ...(who ? { authorization: `Bearer ${TOK[who]}` } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
  const text = await r.text();
  let json: unknown = null;
  try { json = JSON.parse(text); } catch { /* not JSON */ }
  return { status: r.status, text, json };
}
const get = (w: Who, p: string) => call(w, "GET", p);
const put = (w: Who, p: string, b: unknown) => call(w, "PUT", p, b);
const post = (w: Who, p: string, b: unknown) => call(w, "POST", p, b);
const counts = async (w: Who) => (await get(w, "/hidden-counts")).json?.data;
const audits = (id: string) => sql<{ action: string; reason: string | null; old_value: any; new_value: any; user_id: string; entity_type: string }>(
  "SELECT action, reason, old_value, new_value, user_id, entity_type FROM audit_log WHERE entity_id::text = $1 ORDER BY timestamp, id", [id]);
const permChanges = async (id: string) => (await audits(id)).filter((a) => a.action === "PERMISSION_CHANGE");
const notifs = (who: Who, resourceId: string) => sql<{ event_type: string; message: string }>("SELECT event_type, message FROM notifications WHERE recipient_user_id = $1 AND resource_id = $2 ORDER BY sent_at, id", [UID[who], resourceId]);
const sees = async (w: Who, path: string) => (await get(w, path)).status === 200;
const BAD_REASONS: unknown[] = ["", "   ", "\t\n ", "x".repeat(501), null, 5];
const setVis = (w: Who, path: string, visibility: string, add: string[] = [], reason = "Motif QA V3") => put(w, `${path}/visibility`, { visibility, addUserIds: add, revokeUserIds: [], reason });
const failAudit = async (entityId: string, action = "PERMISSION_CHANGE") => {
  await sql(`CREATE OR REPLACE FUNCTION qa_v3_fail_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.action = '${action}' AND NEW.entity_id::text = '${entityId}' THEN RAISE EXCEPTION 'qa audit failure'; END IF; RETURN NEW; END $$`);
  await sql("DROP TRIGGER IF EXISTS qa_v3_fail ON audit_log");
  await sql("CREATE TRIGGER qa_v3_fail BEFORE INSERT ON audit_log FOR EACH ROW EXECUTE FUNCTION qa_v3_fail_audit()");
};
const restoreAudit = () => sql("DROP TRIGGER IF EXISTS qa_v3_fail ON audit_log");

describe.skipIf(!live)("QA-visibility-v3 on the REAL server + LOCAL PostgreSQL 16", () => {
  beforeAll(async () => {
    sh("bash", [join(ROOT, "tests", "integration", "qa-visibility-v2-setup.sh"), "up", DB]);
    sh("bash", [join(ROOT, "tests", "integration", "qa-visibility-v2-server.sh"), "start"], { QA_PORT: String(PORT), QA_DB: DB });
    pg = new Pool({ host: "127.0.0.1", port: PGPORT, user: "postgres", database: DB, max: 4 });
    await sql("UPDATE users SET roles = roles || ARRAY['execution.read','effectiveness.read','evidence.read']::text[]");
    await sql("UPDATE users SET roles = array_remove(roles, 'resourcevisibility.set') WHERE email = 'adm@vv1.test'"); // the right lives in the RM group
    await sql("UPDATE users SET roles = roles || ARRAY['role.assign','role.read','role.create','role.update']::text[] WHERE email = 'adm@vv1.test'");
    await sql("UPDATE users SET roles = roles || ARRAY['risk.owner.assign']::text[] WHERE email IN ('own@vv1.test','dept@vv1.test')");
    for (const w of WHO) {
      const r = await fetch(`${API}/auth/local`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email: `${w}@vv1.test`, password: "whatever" }) });
      TOK[w] = ((await r.json()) as { accessToken: string }).accessToken;
      expect(TOK[w], w).toBeTruthy();
    }
  }, 280000);
  afterAll(async () => {
    await pg?.end();
    sh("bash", [join(ROOT, "tests", "integration", "qa-visibility-v2-server.sh"), "stop"], { QA_PORT: String(PORT) });
  });

  // ---------------------------------------------------------------------------------------------- HIDDEN COUNTS
  describe("HIDDEN: GET /hidden-counts (q196, q198)", () => {
    it("401 anonymous; null for the three groups that see everything", async () => {
      expect((await call(null, "GET", "/hidden-counts")).status).toBe(401);
      for (const w of SEE_ALL) {
        const r = await get(w, "/hidden-counts");
        expect(r.status, w).toBe(200);
        expect(r.json.data, w).toBeNull();
      }
    });
    for (const who of WHO.filter((w) => !SEE_ALL.includes(w))) {
      it(`${who}: one number per type = the PERIMETRE items (effective level) the profile does not read; NOMINATIF, CLIENT and own-level-ignored never counted`, async () => {
        expect(await counts(who)).toEqual(expectedCounts(who));
      });
    }
    it("the answer is only numbers per type: no id, no label, no canary, no breakdown", async () => {
      for (const who of ["out", "out2", "adm"] as const) {
        const r = await get(who, "/hidden-counts");
        expect(r.text).not.toMatch(/CANARY|[0-9a-f]{8}-[0-9a-f]{4}-/);
        expect(Object.keys(r.json.data).sort((a, b) => a.localeCompare(b))).toEqual(["ACTION_PLAN", "ANOMALY", "CONTROL", "KPI", "RISK"]);
        expect(Object.values(r.json.data).every((n) => Number.isInteger(n) && (n as number) >= 0)).toBe(true);
      }
    });
    it("limited to the types the reader may read: no risk.read => no RISK key; no kpi.read => no KPI key; nothing at all without any read right", async () => {
      await sql("UPDATE users SET roles = array_remove(array_remove(roles, 'risk.read'), 'kpi.read') WHERE email = 'out@vv1.test'");
      try {
        const c = await counts("out");
        expect(Object.keys(c).sort((a, b) => a.localeCompare(b))).toEqual(["ACTION_PLAN", "ANOMALY", "CONTROL"]);
        expect(c.CONTROL).toBe(expectedCounts("out")["CONTROL"]);
      } finally { await sql("UPDATE users SET roles = roles || ARRAY['risk.read','kpi.read']::text[] WHERE email = 'out@vv1.test'"); }
      await sql("UPDATE users SET roles = ARRAY['notification.read']::text[] WHERE email = 'n1@vv1.test'");
      expect(await counts("n1")).toEqual({});
    });
    it("the count follows the data at once: restricting a CLIENT control to PERIMETRE adds 1 for an outsider; naming the outsider removes it; NOMINATIF never counts; opening again removes it", async () => {
      const before = (await counts("out")).CONTROL as number;
      expect((await setVis("rm", `/controls/${I("c01")}`, "PERIMETRE", [])).status).toBe(200);
      expect((await counts("out")).CONTROL).toBe(before + 1);
      expect((await setVis("rm", `/controls/${I("c01")}`, "PERIMETRE", [UID.out])).status).toBe(200);
      expect((await counts("out")).CONTROL, "named => he reads it, not hidden").toBe(before);
      expect((await counts("out2")).CONTROL).toBe((expectedCounts("out2")["CONTROL"] as number) + 1);
      expect((await setVis("rm", `/controls/${I("c01")}`, "NOMINATIF", [])).status).toBe(200);
      expect((await counts("out2")).CONTROL, "NOMINATIF is not counted").toBe(expectedCounts("out2")["CONTROL"]);
      expect((await setVis("rm", `/controls/${I("c01")}`, "CLIENT", [])).status).toBe(200);
      expect((await counts("out")).CONTROL).toBe(before);
    });
    it("a soft-deleted restricted control / KPI is not counted; the count of a parent moves its children (anomalies, plans follow the risk level)", async () => {
      const c0 = await counts("out");
      await sql("UPDATE controls SET deleted_at = now() WHERE id = $1", [I("c02")]);
      await sql("UPDATE kpis SET deleted_at = now() WHERE id = $1", [K("9002")]);
      const c1 = await counts("out");
      expect([c1.CONTROL, c1.KPI]).toEqual([c0.CONTROL - 1, c0.KPI - 1]);
      await sql("UPDATE controls SET deleted_at = NULL WHERE id = $1", [I("c02")]);
      await sql("UPDATE kpis SET deleted_at = NULL WHERE id = $1", [K("9002")]);
      // risk 502 PERIMETRE -> NOMINATIF: it, its 3 anomalies and its 4 plans leave the PERIMETRE counts (q198); back: they return
      await sql("UPDATE risks SET visibility = 'NOMINATIF' WHERE id = $1", [I("502")]);
      try {
        const c2 = await counts("out");
        expect(c2.RISK).toBe(c0.RISK - 1);
        expect(c2.ANOMALY).toBe(c0.ANOMALY - 3);
        expect(c2.ACTION_PLAN).toBe(c0.ACTION_PLAN - 3); // a01 is out's own plan (never hidden for him): 4 plans follow the risk, 3 counted for him
      } finally { await sql("UPDATE risks SET visibility = 'PERIMETRE' WHERE id = $1", [I("502")]); }
      expect(await counts("out")).toEqual(c0);
    });
    it("another tenant's PERIMETRE items are not counted", async () => {
      await sql("INSERT INTO tenants (id, name) VALUES ($1, 'Autre tenant V3') ON CONFLICT DO NOTHING", [I("f00")]);
      await sql("INSERT INTO risks (id, tenant_id, process, description, status, visibility) VALUES ($1, $2, 'p', 'CANARY-V3-FOREIGN', 'ACTIVE', 'PERIMETRE')", [I("f60"), I("f00")]);
      expect(await counts("out")).toEqual(expectedCounts("out"));
    });
    it("a responsible who is also outside the perimeter does not count the plan he is assigned (assigned rule), an executor does not count... only plans: out has a01 and a09 (NOMINATIF)", async () => {
      expect((await counts("out")).ACTION_PLAN).toBe(expectedCounts("out")["ACTION_PLAN"]);
      expect(EFFECTIVE_PERIM.ACTION_PLAN.find((p) => p.what.startsWith("a01"))!.readers).toContain("out");
    });
  });

  // ---------------------------------------------------------------------------------------------- RESTRICTED LIST
  describe("LIST: GET /restricted-resources (q209, R-1, pagination)", () => {
    it("401 anonymous; 200 for the Risk Manager, Committee and Audit groups; 403 for the 9 other profiles", async () => {
      expect((await call(null, "GET", "/restricted-resources")).status).toBe(401);
      const codes: Record<string, number> = {};
      for (const w of WHO) codes[w] = (await get(w, "/restricted-resources")).status;
      expect(codes).toEqual({ own: 403, n1: 403, raci: 403, pown: 403, dept: 403, named: 403, out: 403, out2: 403, rm: 200, com: 200, aud: 200, adm: 403 });
    });
    it("Committee and Audit get exactly the Risk Manager's list", async () => {
      const ids = async (w: Who) => ((await get(w, "/restricted-resources")).json.data as Array<{ type: string; id: string }>).map((x) => `${x.type}:${x.id}`);
      const rm = await ids("rm");
      expect(await ids("com")).toEqual(rm);
      expect(await ids("aud")).toEqual(rm);
      expect(rm.length).toBeGreaterThanOrEqual(10);
    });
    it("R-1 / PRIV-V3-05: the author of the last change is named for the Risk Manager group and Audit, NOT for the Committee (no id, no name); date, reason and widening stay", async () => {
      expect((await setVis("rm", `/controls/${I("c03")}`, "NOMINATIF", [UID.out2], "Auteur QA")).status).toBe(200);
      const row = async (w: Who) => ((await get(w, "/restricted-resources?limit=500")).json.data as Array<{ id: string; lastChange: Record<string, unknown> | null }>).find((x) => x.id === I("c03"))!.lastChange!;
      expect(await row("rm")).toMatchObject({ userId: UID.rm, byName: "QA rm", reason: "Auteur QA" });
      expect(await row("aud")).toMatchObject({ userId: UID.rm, byName: "QA rm", reason: "Auteur QA" });
      const c = await row("com");
      expect(c).toMatchObject({ reason: "Auteur QA", widening: true });
      expect(c).not.toHaveProperty("userId");
      expect(c).not.toHaveProperty("byName");
      expect(JSON.stringify(c)).not.toContain(UID.rm);
    });
    it("pagination: pages of 4 are disjoint and rebuild the whole list in order; default and bound limits; offset past the end => []", async () => {
      const all = (await get("rm", "/restricted-resources?limit=500")).json.data as Array<{ type: string; id: string }>;
      const key = (x: { type: string; id: string }) => `${x.type}:${x.id}`;
      const pages: string[][] = [];
      for (let off = 0; off < all.length + 4; off += 4) pages.push(((await get("com", `/restricted-resources?limit=4&offset=${off}`)).json.data as Array<{ type: string; id: string }>).map(key));
      expect(pages.flat()).toEqual(all.map(key));
      expect(pages.every((p) => p.length <= 4)).toBe(true);
      expect(new Set(pages.flat()).size).toBe(all.length);
      expect(((await get("rm", "/restricted-resources")).json.data as unknown[]).length, "default = whole list when < 200").toBe(all.length);
      expect((await get("rm", `/restricted-resources?offset=${all.length}`)).json.data).toEqual([]);
      expect((await get("rm", "/restricted-resources?offset=999999999999")).status).toBeLessThan(500);
      expect((await get("rm", "/restricted-resources?limit=500&offset=0")).status).toBe(200);
      expect(((await get("rm", "/restricted-resources?limit=1")).json.data as unknown[]).length).toBe(1);
    });
    it("invalid pagination => 400 (never 5xx): limit 0 / 501 / -1 / abc / 1.5 / empty / repeated, offset -1 / abc / 1.5", async () => {
      const bad: string[] = [];
      for (const q of ["limit=0", "limit=501", "limit=-1", "limit=abc", "limit=1.5", "limit=", "limit=1&limit=2", "offset=-1", "offset=abc", "offset=1.5", "limit=Infinity"]) {
        const r = await get("rm", `/restricted-resources?${q}`);
        if (r.status !== 400) bad.push(`${q}: ${r.status}`);
      }
      expect(bad).toEqual([]);
    });
    it("lastChange (R-1): null when the level was never changed; after an RM change = actor, reason, widening, ISO date; the latest of several changes wins; per type (Kpi, ActionPlan, Anomaly, Control, Risk)", async () => {
      const rows = async () => (await get("rm", "/restricted-resources?limit=500")).json.data as Array<{ type: string; id: string; lastChange: { userId: string; at: string; reason: string | null; widening: boolean | null } | null }>;
      const byId = async (id: string) => (await rows()).find((r) => r.id === id);
      expect((await byId(I("c04")))!.lastChange, "seeded, never changed through the API").toBeNull();
      expect((await setVis("rm", `/controls/${I("c03")}`, "NOMINATIF", [UID.named], "Premier QA")).status).toBe(200);
      expect((await setVis("rm", `/controls/${I("c03")}`, "NOMINATIF", [UID.dept], "Second QA")).status).toBe(200);
      const c = (await byId(I("c03")))!.lastChange!;
      expect(c).toMatchObject({ userId: UID.rm, reason: "Second QA", widening: true });
      expect(Number.isNaN(Date.parse(c.at))).toBe(false);
      // other types
      expect((await setVis("rm", `/kpis/${K("9003")}`, "NOMINATIF", [UID.dept], "KPI QA")).status).toBe(200);
      expect((await byId(K("9003")))!.lastChange).toMatchObject({ reason: "KPI QA", userId: UID.rm });
      expect((await setVis("rm", `/actions/${I("a07")}`, "NOMINATIF", [UID.dept], "Plan QA")).status).toBe(200);
      expect((await byId(I("a07")))!.lastChange).toMatchObject({ reason: "Plan QA" });
      expect((await setVis("rm", `/anomalies/${I("d05")}`, "NOMINATIF", [UID.dept], "Anomalie QA")).status).toBe(200);
      expect((await byId(I("d05")))!.lastChange).toMatchObject({ reason: "Anomalie QA" });
      expect((await setVis("own", `/risks/${I("502")}`, "NOMINATIF", [], "Owner restreint QA")).status).toBe(200);
      expect((await byId(I("502")))!.lastChange).toMatchObject({ userId: UID.own, reason: "Owner restreint QA", widening: false });
      expect((await setVis("own", `/risks/${I("502")}`, "PERIMETRE", [], "Owner remet QA")).status).toBe(200);
      expect((await byId(I("502")))!.lastChange).toMatchObject({ reason: "Owner remet QA", widening: true });
    });
    it("lastChange also reflects a RACI opening (q207) and a designation (q212) on the same resource, never a change of another resource or of a process", async () => {
      await sql("UPDATE users SET roles = roles || ARRAY['raci.assign']::text[] WHERE email = 'own@vv1.test'");
      const r = await post("own", "/raci", { entityType: "ACTION_PLAN", entityId: I("a06"), userId: UID.out2, role: "C", reason: "RACI QA V3" });
      expect(r.status, r.text).toBe(201);
      const row = ((await get("rm", "/restricted-resources?limit=500")).json.data as Array<{ id: string; lastChange: { reason: string | null; userId: string } | null }>).find((x) => x.id === I("a06"))!;
      expect(row.lastChange).toMatchObject({ reason: "RACI QA V3", userId: UID.own });
      const other = ((await get("rm", "/restricted-resources?limit=500")).json.data as Array<{ id: string; lastChange: { reason: string | null } | null }>).find((x) => x.id === I("a07"))!;
      expect(other.lastChange?.reason).not.toBe("RACI QA V3");
    });
  });

  // ---------------------------------------------------------------------------------------------- DEPARTMENT GROUP (q212)
  describe("DEPT: a department-group role assignment that opens restricted resources", () => {
    const FIN = I("301");
    const members = async (userId: string, roleId: string) => (await sql<{ n: number }>("SELECT count(*)::int AS n FROM user_roles WHERE user_id = $1 AND role_id = $2 AND revoked_at IS NULL", [userId, roleId]))[0]!.n;
    const drop = (userId: string, roleId: string) => sql("UPDATE user_roles SET revoked_at = now() WHERE user_id = $1 AND role_id = $2 AND revoked_at IS NULL", [userId, roleId]);
    it("non-RM author: no / blank / out-of-bound reason => 400 and nothing written; a reason => 201 + PERMISSION_CHANGE (exact `opened`) + RM notified once, readable at once", async () => {
      expect(await sees("out", `/controls/${I("c02")}`)).toBe(false);
      const a0 = (await audits(FIN)).length;
      const n0 = (await notifs("rm", FIN)).length;
      for (const reason of [undefined, ...BAD_REASONS]) {
        const r = await post("adm", `/roles/${FIN}/assign`, { userId: UID.out, ...(reason === undefined ? {} : { reason }) });
        expect(r.status, `reason ${JSON.stringify(reason)?.slice(0, 12)} ${r.text.slice(0, 100)}`).toBe(400);
      }
      expect(await members(UID.out, FIN)).toBe(0);
      expect((await audits(FIN)).length).toBe(a0);
      expect((await notifs("rm", FIN)).length).toBe(n0);
      const ok = await post("adm", `/roles/${FIN}/assign`, { userId: UID.out, reason: "x".repeat(500) });
      expect(ok.status, ok.text).toBe(201);
      expect(await members(UID.out, FIN)).toBe(1);
      const pc = (await permChanges(FIN)).at(-1)!;
      expect(pc).toMatchObject({ user_id: UID.adm, reason: "x".repeat(500), entity_type: "Role" });
      expect(pc.new_value).toMatchObject({ userId: UID.out, departmentId: I("201"), widening: true, through: "DEPARTMENT_GROUP" });
      expect(pc.new_value.opened).toEqual([{ type: "ACTION_PLAN", id: I("a06") }, { type: "CONTROL", id: I("c02") }, { type: "KPI", id: K("9002") }, { type: "RISK", id: I("502") }]);
      expect((await notifs("rm", FIN)).slice(n0).map((n) => n.event_type)).toEqual(["DEPARTMENT_GROUP_VISIBILITY_WIDENED"]);
      expect((await notifs("rm", FIN)).at(-1)!.message).not.toMatch(/CANARY|[0-9a-f]{8}-/);
      for (const w of ["com", "aud", "adm", "out", "dept"] as const) expect((await notifs(w, FIN)).filter((n) => n.event_type === "DEPARTMENT_GROUP_VISIBILITY_WIDENED"), w).toEqual([]);
      expect([await sees("out", `/controls/${I("c02")}`), await sees("out", `/risks/${I("502")}`), await sees("out", `/kpis/${K("9002")}`), await sees("out", `/actions/${I("a06")}`)]).toEqual([true, true, true, true]);
      expect([await sees("out", `/controls/${I("c03")}`), await sees("out", `/risks/${I("503")}`)], "NOMINATIF stays closed").toEqual([false, false]);
      // the assignment audit row carries the reason too (existing assignment trail)
      expect((await audits(FIN)).slice(a0).some((a) => a.action !== "PERMISSION_CHANGE" && a.reason === "x".repeat(500))).toBe(true);
      await drop(UID.out, FIN);
      expect(await sees("out", `/controls/${I("c02")}`)).toBe(false);
    });
    it("`opened` lists only what the person does NOT read yet: a process owner gains only the plan, a RACI-C on the control and plan gains the KPI and risk-side items he lacks", async () => {
      const r1 = await post("adm", `/roles/${FIN}/assign`, { userId: UID.pown, reason: "Processus QA" });
      expect(r1.status, r1.text).toBe(201);
      expect((await permChanges(FIN)).at(-1)!.new_value.opened).toEqual([{ type: "ACTION_PLAN", id: I("a06") }]);
      await drop(UID.pown, FIN);
      const r2 = await post("adm", `/roles/${FIN}/assign`, { userId: UID.raci, reason: "RACI QA" });
      expect(r2.status, r2.text).toBe(201);
      expect((await permChanges(FIN)).at(-1)!.new_value.opened).toEqual([{ type: "KPI", id: K("9002") }]);
      await drop(UID.raci, FIN);
    });
    it("Risk Manager author: no reason, the opening is still traced (reason null), nobody is notified", async () => {
      const n0 = (await notifs("rm", FIN)).length;
      const p0 = (await permChanges(FIN)).length;
      const r = await post("rm", `/roles/${FIN}/assign`, { userId: UID.out2 });
      // the RM may not hold role.assign: then 403 is the answer, which is also a valid refusal
      if (r.status === 403) { expect(await members(UID.out2, FIN)).toBe(0); return; }
      expect(r.status, r.text).toBe(201);
      const pc = (await permChanges(FIN)).slice(p0);
      expect(pc).toHaveLength(1);
      expect(pc[0]!.reason).toBeNull();
      expect((await notifs("rm", FIN)).length).toBe(n0);
      await drop(UID.out2, FIN);
    });
    it("no reason needed when nothing opens: an Operations department group (no restricted resource), an ordinary role without department, a person who already reads everything of the department", async () => {
      const OPS = I("302");
      const a = await post("adm", `/roles/${OPS}/assign`, { userId: UID.out });
      expect(a.status, a.text).toBe(201);
      expect((await permChanges(OPS))).toEqual([]);
      await drop(UID.out, OPS);
      const plain = await post("adm", "/roles", { name: "Role ordinaire QA V3", permissions: ["risk.read"] });
      expect(plain.status, plain.text).toBe(201);
      const b = await post("adm", `/roles/${plain.json.data.id}/assign`, { userId: UID.out });
      expect(b.status, b.text).toBe(201);
      expect(await permChanges(plain.json.data.id)).toEqual([]);
      await drop(UID.out, plain.json.data.id);
    });
    it("a reason given when nothing opens is accepted and not turned into a PERMISSION_CHANGE", async () => {
      const OPS = I("302");
      const r = await post("adm", `/roles/${OPS}/assign`, { userId: UID.out, reason: "Motif inutile" });
      expect(r.status, r.text).toBe(201);
      expect(await permChanges(OPS)).toEqual([]);
      await drop(UID.out, OPS);
    });
    it("QA-V3-03 (MINOR): atomicity: if the PERMISSION_CHANGE row cannot be written, the membership is not left behind (no silent opening)", async () => {
      await failAudit(FIN);
      let status = 0;
      let left = -1;
      try { status = (await post("adm", `/roles/${FIN}/assign`, { userId: UID.out, reason: "Doit echouer" })).status; left = await members(UID.out, FIN); } finally { await restoreAudit(); await drop(UID.out, FIN); }
      expect(status).toBeGreaterThanOrEqual(500);
      expect(left, "membership persisted without its trace").toBe(0);
    });
    it("concurrency: the same assignment 4 times at once => one 201, the others 409, no 5xx, one PERMISSION_CHANGE, one notification", async () => {
      const p0 = (await permChanges(FIN)).length;
      const n0 = (await notifs("rm", FIN)).length;
      await drop(UID.out, FIN);
      const rs = await Promise.all(Array.from({ length: 4 }, () => post("adm", `/roles/${FIN}/assign`, { userId: UID.out, reason: "Course QA" })));
      expect(rs.filter((r) => r.status >= 500).map((r) => r.text.slice(0, 80))).toEqual([]);
      expect(rs.filter((r) => r.status === 201)).toHaveLength(1);
      expect(await members(UID.out, FIN)).toBe(1);
      expect((await permChanges(FIN)).length - p0).toBe(1);
      expect((await notifs("rm", FIN)).length - n0).toBe(1);
      await drop(UID.out, FIN);
    });
    it("the author cannot assign to himself and the reason rule does not change that (maker-checker)", async () => {
      const r = await post("adm", `/roles/${FIN}/assign`, { userId: UID.adm, reason: "Moi-meme" });
      expect(r.status).toBeGreaterThanOrEqual(400);
      expect(await members(UID.adm, FIN)).toBe(0);
    });
    it("link gap closed (SEC V3-01, q212): linking an existing role that has holders to a department needs a reason (outside the RM group), is traced PERMISSION_CHANGE through DEPARTMENT_GROUP with the opened list per holder, and notifies the RM", async () => {
      const mk = await post("adm", "/roles", { name: "Role a lier QA V3", permissions: ["risk.read"] });
      expect(mk.status, mk.text).toBe(201);
      const rid = mk.json.data.id as string;
      expect((await post("adm", `/roles/${rid}/assign`, { userId: UID.out2 })).status).toBe(201);
      await sql("INSERT INTO departments (id, tenant_id, name) VALUES ($1, $2, 'Departement QA V3') ON CONFLICT DO NOTHING", [I("203"), I("001")]);
      await sql("INSERT INTO controls (id, tenant_id, label, control_type, frequency, executor, compliance_criteria, department_id, visibility) VALUES ($1, $2, 'CANARY-V3-CTL-D3', 'PREVENTIVE', 'MONTHLY', 'x', 'y', $3, 'PERIMETRE')", [I("c20"), I("001"), I("203")]);
      const n0 = (await notifs("rm", rid)).length;
      const no = await call("adm", "PATCH", `/roles/${rid}`, { departmentId: I("203") });
      expect(no.status, no.text).toBe(400);
      expect((await sql<{ department_id: string | null }>("SELECT department_id FROM roles WHERE id = $1", [rid]))[0]!.department_id).toBeNull();
      expect(await sees("out2", `/controls/${I("c20")}`)).toBe(false);
      const ok = await call("adm", "PATCH", `/roles/${rid}`, { departmentId: I("203"), reason: "Rattachement QA V3" });
      expect(ok.status, ok.text).toBe(200);
      expect(await sees("out2", `/controls/${I("c20")}`), "opened by the link").toBe(true);
      const pc = (await permChanges(rid)).at(-1)!;
      expect(pc.new_value).toMatchObject({ widening: true, through: "DEPARTMENT_GROUP" });
      expect(pc.new_value.opened).toEqual([{ userId: UID.out2, opened: [{ type: "CONTROL", id: I("c20") }] }]);
      expect((await notifs("rm", rid)).slice(n0).map((n) => n.event_type)).toEqual(["DEPARTMENT_GROUP_VISIBILITY_WIDENED"]);
    });
  });

  // ---------------------------------------------------------------------------------------------- DESIGNATION (q212)
  describe("DESIG: a risk owner / N+1 designation that opens a restricted risk", () => {
    const R502 = I("502");
    const owner = (w: Who, id: string, ownerId: string | null, reason?: unknown) => post(w, `/risks/${id}/owner`, { ownerId, ...(reason === undefined ? {} : { reason }) });
    const superior = (w: Who, id: string, superiorOwnerId: string | null, reason?: unknown) => post(w, `/risks/${id}/superior-owner`, { superiorOwnerId, ...(reason === undefined ? {} : { reason }) });
    const ownerOf = async (id: string) => (await sql<{ owner_id: string | null; superior_owner_id: string | null }>("SELECT owner_id, superior_owner_id FROM risks WHERE id = $1", [id]))[0]!;
    it("non-RM author, owner designation: no / blank / out-of-bound reason => 400 and nothing changed; a reason => 200, ASSIGN + PERMISSION_CHANGE (DESIGNATION, owner), RM notified once, the new owner reads at once", async () => {
      const own0 = (await ownerOf(R502)).owner_id;
      expect(await sees("out", `/risks/${R502}`)).toBe(false);
      const a0 = (await audits(R502)).length;
      const n0 = (await notifs("rm", R502)).length;
      for (const reason of [undefined, ...BAD_REASONS]) {
        const r = await owner("dept", R502, UID.out, reason);
        expect(r.status, `reason ${JSON.stringify(reason)?.slice(0, 12)} ${r.text.slice(0, 100)}`).toBe(400);
      }
      expect((await ownerOf(R502)).owner_id).toBe(own0);
      expect((await audits(R502)).length).toBe(a0);
      expect((await notifs("rm", R502)).length).toBe(n0);
      const ok = await owner("dept", R502, UID.out, "Nouveau proprietaire QA");
      expect(ok.status, ok.text).toBe(200);
      expect((await ownerOf(R502)).owner_id).toBe(UID.out);
      expect(await sees("out", `/risks/${R502}`)).toBe(true);
      const rows = (await audits(R502)).slice(a0);
      expect(rows.map((r) => r.action).sort((a, b) => a.localeCompare(b))).toEqual(["ASSIGN", "PERMISSION_CHANGE"]);
      const pc = rows.find((r) => r.action === "PERMISSION_CHANGE")!;
      expect(pc).toMatchObject({ user_id: UID.dept, reason: "Nouveau proprietaire QA" });
      expect(pc.new_value).toMatchObject({ designatedUserId: UID.out, as: "owner", reads: true, widening: true, through: "DESIGNATION" });
      expect(rows.find((r) => r.action === "ASSIGN")!.reason).toBe("Nouveau proprietaire QA");
      const n = (await notifs("rm", R502)).slice(n0);
      expect(n.map((x) => x.event_type)).toEqual(["RISK_VISIBILITY_WIDENED"]);
      expect(n[0]!.message).not.toMatch(/CANARY|[0-9a-f]{8}-/);
      for (const w of ["com", "aud", "dept", "own"] as const) expect((await notifs(w, R502)).slice(0).filter((x) => x.message.includes("désignation")), w).toEqual([]);
      // put the owner back (RM)
      expect((await owner("rm", R502, own0)).status).toBe(200);
    });
    it("non-RM author, N+1 (superior owner) designation: same rule, `as: superior owner`", async () => {
      const sup0 = (await ownerOf(R502)).superior_owner_id;
      expect((await superior("dept", R502, UID.out2)).status).toBe(400);
      expect((await ownerOf(R502)).superior_owner_id).toBe(sup0);
      const p0 = (await permChanges(R502)).length;
      expect((await superior("dept", R502, UID.out2, "N+1 QA")).status).toBe(200);
      expect(await sees("out2", `/risks/${R502}`)).toBe(true);
      const pc = (await permChanges(R502)).slice(p0);
      expect(pc).toHaveLength(1);
      expect(pc[0]!.new_value).toMatchObject({ designatedUserId: UID.out2, as: "superior owner", through: "DESIGNATION" });
      expect((await superior("rm", R502, sup0)).status).toBe(200);
    });
    it("Risk Manager author: no reason, traced (reason null), nobody notified", async () => {
      const own0 = (await ownerOf(R502)).owner_id;
      const n0 = (await notifs("rm", R502)).length;
      const p0 = (await permChanges(R502)).length;
      expect((await owner("rm", R502, UID.out)).status).toBe(200);
      const pc = (await permChanges(R502)).slice(p0);
      expect(pc).toHaveLength(1);
      expect(pc[0]!.reason).toBeNull();
      expect((await notifs("rm", R502)).length).toBe(n0);
      expect((await owner("rm", R502, own0)).status).toBe(200);
    });
    it("nothing opens => no reason, no PERMISSION_CHANGE: the designated person already reads (Finance group), the risk is CLIENT, or the owner is cleared", async () => {
      const own0 = (await ownerOf(R502)).owner_id;
      const p0 = (await permChanges(R502)).length;
      expect((await owner("dept", R502, UID.pown)).status, "pown reads through his process").toBe(200);
      expect((await permChanges(R502)).length).toBe(p0);
      expect((await owner("rm", R502, own0)).status).toBe(200);
      const p1 = (await permChanges(I("501"))).length;
      expect((await owner("dept", I("501"), UID.out)).status, "CLIENT risk").toBe(200);
      expect((await permChanges(I("501"))).length).toBe(p1);
      expect((await owner("rm", I("501"), UID.own)).status).toBe(200);
    });
    it("NOMINATIF risk: designating an OWNER opens it (an owner reads NOMINATIF) => reason required and traced", async () => {
      const own0 = (await ownerOf(I("503"))).owner_id;
      expect((await owner("own", I("503"), UID.out)).status).toBe(400);
      const p0 = (await permChanges(I("503"))).length;
      expect((await owner("own", I("503"), UID.out, "Proprietaire NOMINATIF QA")).status).toBe(200);
      expect(await sees("out", `/risks/${I("503")}`)).toBe(true);
      expect((await permChanges(I("503"))).length - p0).toBe(1);
      expect((await owner("rm", I("503"), own0)).status).toBe(200);
    });
    it("(fixed by SEC V3 INFO) designating an N+1 on a NOMINATIF risk does NOT open it (the N+1 never reads NOMINATIF): no PERMISSION_CHANGE claiming `reads: true`, no RM notification (as for RACI, which re-checks the effect)", async () => {
      const sup0 = (await ownerOf(I("503"))).superior_owner_id;
      const p0 = (await permChanges(I("503"))).length;
      const n0 = (await notifs("rm", I("503"))).length;
      const r = await superior("own", I("503"), UID.out2, "N+1 NOMINATIF QA");
      expect(r.status, r.text).toBe(200);
      expect(await sees("out2", `/risks/${I("503")}`), "the N+1 still cannot read it").toBe(false);
      expect((await permChanges(I("503"))).length - p0, "false trace: reads true although nothing opened").toBe(0);
      expect((await notifs("rm", I("503"))).length - n0).toBe(0);
      expect((await superior("rm", I("503"), sup0)).status).toBe(200);
    });
    it("QA-V3-04 (MINOR): atomicity: if the PERMISSION_CHANGE row cannot be written, the designation is not left behind", async () => {
      const own0 = (await ownerOf(R502)).owner_id;
      await failAudit(R502);
      let status = 0;
      try { status = (await owner("dept", R502, UID.out, "Doit echouer")).status; } finally { await restoreAudit(); }
      expect(status).toBeGreaterThanOrEqual(500);
      expect((await ownerOf(R502)).owner_id, "owner changed without its trace").toBe(own0);
      await sql("UPDATE risks SET owner_id = $1 WHERE id = $2", [own0, R502]);
    });
    it("the author cannot designate himself, and the reason does not change that", async () => {
      expect((await owner("dept", R502, UID.dept, "Moi-meme")).status).toBe(400);
    });
  });
});
