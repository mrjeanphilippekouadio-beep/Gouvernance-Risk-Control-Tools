import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { Pool } from "pg";

/**
 * QA-visibility-v2bis (level 2): DECISION-107. q207 A: a RACI assignment (`POST /raci`, `reason`) or a new process owner
 * (`PUT /processes/:id/responsibilities`, `reason`) that OPENS the reading of a restricted resource needs a reason outside the Risk
 * Manager group, writes a PERMISSION_CHANGE (widening, through RACI / PROCESS_OWNER) and notifies the RM group. q208 A: the RM is told
 * of every owner change of a level (widened OR restricted) and has `GET /api/v1/restricted-resources` (`resourcevisibility.set`).
 * Oracles written BEFORE running, from the PO decision. Not a Security / Privacy / Compliance opinion.
 *
 * STATIC  catalog, wiring, frontend contract.
 * RACI    reason rules (who, when, bounds), audit rows, notification, real effect on reading, revoke, atomicity, concurrency.
 * PROC    process owner: reason, `opened` list, audit in the same transaction, no bypass through the other process routes.
 * OWNER   q208 events for every owner change, none for the RM / controls / KPIs, no content in the message.
 * LIST    restricted-resources: who, content against the database, tenant, access count.
 *
 * Live part: QA_VIS2B_LIVE=1 + LOCAL cluster of tests/integration/qa-visibility-v1-setup.sh (127.0.0.1:55442, never a remote host).
 * It drops / rebuilds its own base (grc_qa_vv2bt): run with --no-file-parallelism next to the other live suites.
 * `it.fails` documents a CONFIRMED defect (turn it into `it` when fixed).
 */
const ROOT = join(__dirname, "..", "..");
const live = process.env["QA_VIS2B_LIVE"] === "1";
const PGPORT = 55442;
const DB = "grc_qa_vv2bt";
const PORT = 8094;
const API = `http://127.0.0.1:${PORT}/api/v1`;
const I = (x: string) => `aaaaaaaa-0000-4000-8000-000000000${x}`;
const K = (x: string) => `aaaaaaaa-0000-4000-8000-00000000${x}`;
const UNKNOWN = I("9ff");
const read = (...p: string[]) => readFileSync(join(ROOT, ...p), "utf8");

describe("QA-visibility-v2bis STATIC", () => {
  it("catalog: the 5 new events exist, are mandatory, and sit under the right resource type", () => {
    const c = read("backend", "src", "domain", "notificationCatalog.ts");
    for (const [type, ev] of [["RISK", "RISK_VISIBILITY_RESTRICTED"], ["ACTION_PLAN", "ACTION_PLAN_VISIBILITY_RESTRICTED"], ["ANOMALY", "ANOMALY_VISIBILITY_RESTRICTED"], ["CONTROL", "CONTROL_VISIBILITY_WIDENED"], ["MANAGEMENT", "PROCESS_OWNER_VISIBILITY_WIDENED"]]) {
      expect(c, ev).toMatch(new RegExp(`resourceType: "${type}", eventType: "${ev}"[^\\n]*mandatory: true`));
    }
  });
  it("wiring: the manager is injected into RaciAssignmentService and ProcessService and the list is mounted behind authMiddleware", () => {
    const s = read("backend", "src", "server.ts");
    expect(s).toMatch(/new RaciAssignmentService\([^)]*resourceVisibilityManager\)/);
    expect(s).toMatch(/ProcessService\([\s\S]{0,400}resourceVisibilityManager/);
    expect(s).toMatch(/app\.use\("\/api\/v1\/restricted-resources", authMiddleware\(identityProvider\)/);
  });
  it("routes: `reason` is bounded reasonText(500) on RACI and on responsibilities; the list route has no body and is GET only", () => {
    expect(read("backend", "src", "api", "v1", "raci.routes.ts")).toMatch(/reason: reasonText\(500\)\.optional\(\)/);
    expect(read("backend", "src", "api", "v1", "processes.routes.ts")).toMatch(/reason: reasonText\(500\)\.optional\(\)/);
    const r = read("backend", "src", "api", "v1", "restrictedResources.routes.ts");
    expect(r).toMatch(/router\.get\("\/"/);
    expect(r).not.toMatch(/router\.(post|put|patch|delete)/);
  });
  it("no migration: 083 is still the last one (DECISION-107 adds no schema)", () => {
    const names = execFileSync("ls", [join(ROOT, "database", "postgresql", "migrations")], { encoding: "utf8" }).split("\n").filter((f) => f.endsWith(".sql") && !f.endsWith(".down.sql"));
    expect(names.sort((a, b) => a.localeCompare(b)).at(-1)).toBe("083_resource_visibility_v2.sql");
  });
  it("OBSERVATION: the list query has no LIMIT / pagination (grows with the number of restricted resources)", () => {
    const src = read("backend", "src", "infrastructure", "database", "postgres", "PostgresResourceAccessRepository.ts");
    const q = src.slice(src.indexOf("async listRestricted"));
    expect(q).not.toMatch(/\bLIMIT\b/i);
  });
  it("frontend: menu entry gated by resourcevisibility.set, page calls the endpoint, RACI panel and process card send `reason`", () => {
    expect(read("frontend", "src", "App.tsx")).toMatch(/restricted[\s\S]{0,200}resourcevisibility\.set|resourcevisibility\.set[\s\S]{0,200}restricted/i);
    expect(read("frontend", "src", "api", "visibility.ts")).toContain("/restricted-resources");
    expect(read("frontend", "src", "api", "raci.ts")).toMatch(/reason/);
    expect(read("frontend", "src", "api", "processes.ts")).toMatch(/reason/);
    expect(read("frontend", "src", "features", "risks", "RestrictedResourcesPage.tsx")).toContain("restricted");
  });
});

type Who = "own" | "n1" | "raci" | "pown" | "dept" | "named" | "out" | "out2" | "rm" | "com" | "aud" | "adm";
const WHO: Who[] = ["own", "n1", "raci", "pown", "dept", "named", "out", "out2", "rm", "com", "aud", "adm"];
const UID: Record<Who, string> = { own: I("101"), n1: I("102"), raci: I("103"), pown: I("104"), dept: I("105"), named: I("106"), out: I("107"), out2: I("108"), rm: I("109"), com: I("10a"), aud: I("10b"), adm: I("10c") };
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
const audits = (id: string) => sql<{ action: string; reason: string | null; old_value: any; new_value: any; user_id: string; entity_type: string }>(
  "SELECT action, reason, old_value, new_value, user_id, entity_type FROM audit_log WHERE entity_id::text = $1 ORDER BY timestamp, id", [id]);
const permChanges = async (id: string) => (await audits(id)).filter((a) => a.action === "PERMISSION_CHANGE");
const notifs = (who: Who, resourceId: string) => sql<{ event_type: string; message: string }>("SELECT event_type, message FROM notifications WHERE recipient_user_id = $1 AND resource_id = $2 ORDER BY sent_at, id", [UID[who], resourceId]);
const raciRows = (entityId: string, userId: string) => sql<{ id: string; role: string; deleted_at: Date | null }>("SELECT id, role, deleted_at FROM raci_assignments WHERE entity_id = $1 AND user_id = $2 ORDER BY created_at", [entityId, userId]);
const sees = async (w: Who, path: string) => (await get(w, path)).status === 200;
const raci = (w: Who, entityType: string, entityId: string, user: Who, role: string, reason?: unknown) =>
  post(w, "/raci", { entityType, entityId, userId: UID[user], role, ...(reason === undefined ? {} : { reason }) });
const BAD_REASONS: unknown[] = ["", "   ", "\t\n ", "x".repeat(501), null, 5];

describe.skipIf(!live)("QA-visibility-v2bis on the REAL server + LOCAL PostgreSQL 16", () => {
  beforeAll(async () => {
    sh("bash", [join(ROOT, "tests", "integration", "qa-visibility-v2-setup.sh"), "up", DB]);
    sh("bash", [join(ROOT, "tests", "integration", "qa-visibility-v2-server.sh"), "start"], { QA_PORT: String(PORT), QA_DB: DB });
    pg = new Pool({ host: "127.0.0.1", port: PGPORT, user: "postgres", database: DB, max: 4 });
    await sql("UPDATE users SET roles = roles || ARRAY['execution.read','effectiveness.read','evidence.read']::text[]");
    // non-RM assigners: they read the objects (department group / owner / listed) and hold the assignment rights
    await sql("UPDATE users SET roles = roles || ARRAY['raci.assign','raci.revoke','process.responsibility.assign','anomaly.create','anomaly.update']::text[] WHERE email IN ('dept@vv1.test','own@vv1.test','named@vv1.test')");
    await sql("UPDATE users SET roles = array_remove(roles, 'resourcevisibility.set') WHERE email = 'adm@vv1.test'"); // real case: the right lives in the RM group (re-added in the dedicated test)
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

  // ---------------------------------------------------------------------------------------------- RACI (q207)
  describe("RACI: a reason when the assignment opens a restricted resource", () => {
    const CASES: Array<{ name: string; type: string; id: string; by: Who; read: string; event: string }> = [
      { name: "control c02 (PERIMETRE, RACI counts)", type: "CONTROL", id: I("c02"), by: "dept", read: `/controls/${I("c02")}`, event: "CONTROL_VISIBILITY_WIDENED" },
      { name: "risk 502 (PERIMETRE)", type: "RISK", id: I("502"), by: "own", read: `/risks/${I("502")}`, event: "RISK_VISIBILITY_WIDENED" },
      { name: "plan a06 (PERIMETRE, standalone)", type: "ACTION_PLAN", id: I("a06"), by: "own", read: `/actions/${I("a06")}`, event: "ACTION_PLAN_VISIBILITY_WIDENED" },
    ];
    for (const c of CASES) {
      it(`${c.name}: no / blank / out-of-bound reason => 400 and NOTHING written (no row, no audit, no notification, still hidden); a reason => 201 + audit + RM notified + readable at once; revoke closes it again`, async () => {
        expect(await sees("out", c.read)).toBe(false);
        const a0 = (await audits(c.id)).length;
        const n0 = (await notifs("rm", c.id)).length;
        for (const reason of [undefined, ...BAD_REASONS]) {
          const r = await raci(c.by, c.type, c.id, "out", "C", reason);
          expect(r.status, `${c.name} reason ${JSON.stringify(reason)?.slice(0, 12)}: ${r.text.slice(0, 100)}`).toBe(400);
        }
        expect(await raciRows(c.id, UID.out)).toEqual([]);
        expect((await audits(c.id)).length).toBe(a0);
        expect((await notifs("rm", c.id)).length).toBe(n0);
        expect(await sees("out", c.read)).toBe(false);

        const ok = await raci(c.by, c.type, c.id, "out", "C", "x".repeat(500)); // exactly 500 characters is accepted
        expect(ok.status, ok.text).toBe(201);
        expect(await sees("out", c.read), "readable at once").toBe(true);
        const pc = await permChanges(c.id);
        expect(pc).toHaveLength(1);
        expect(pc[0]).toMatchObject({ user_id: UID[c.by], reason: "x".repeat(500) });
        expect(pc[0]!.new_value).toMatchObject({ raciUserId: UID.out, role: "C", reads: true, widening: true, through: "RACI" });
        expect(pc[0]!.old_value).toMatchObject({ raciUserId: UID.out, reads: false });
        const createRow = (await audits(ok.json.data.id)).find((a) => a.action === "CREATE");
        expect(createRow?.reason).toBe("x".repeat(500));
        const n = (await notifs("rm", c.id)).slice(n0);
        expect(n.map((x) => x.event_type)).toEqual([c.event]);
        expect(n[0]!.message).not.toMatch(/CANARY|[0-9a-f]{8}-/);
        for (const w of ["com", "aud", "own", "dept", "out", "adm"] as const) expect((await notifs(w, c.id)).filter((x) => x.event_type === c.event), `no ${c.event} for ${w}`).toEqual([]);
        // revoke: the resource closes again (and nobody is told: it narrows)
        const rv = await call(c.by, "DELETE", `/raci/${ok.json.data.id}?entityType=${c.type}&entityId=${c.id}`);
        expect(rv.status, rv.text).toBe(200);
        expect(await sees("out", c.read)).toBe(false);
      });
    }

    it("the four RACI roles (R, A, C, I) all open the same way and all need the reason", async () => {
      for (const role of ["R", "A", "C", "I"]) {
        expect((await raci("dept", "CONTROL", I("c02"), "out2", role)).status, `${role} without reason`).toBe(400);
      }
      const r = await raci("dept", "CONTROL", I("c02"), "out2", "I", "Information QA");
      expect(r.status, r.text).toBe(201);
      expect(await sees("out2", `/controls/${I("c02")}`)).toBe(true);
      expect((await call("dept", "DELETE", `/raci/${r.json.data.id}?entityType=CONTROL&entityId=${I("c02")}`)).status).toBe(200);
    });

    it("no reason needed when nothing opens: the person already reads (process owner), the resource is CLIENT, or the author is the Risk Manager group; an unneeded reason is accepted but not recorded", async () => {
      const before = (await permChanges(I("c02"))).length;
      const a = await raci("dept", "CONTROL", I("c02"), "pown", "C"); // pown reads c02 through his process
      expect(a.status, a.text).toBe(201);
      const b = await raci("dept", "CONTROL", I("c01"), "out", "C"); // CLIENT control
      expect(b.status, b.text).toBe(201);
      const c = await raci("dept", "CONTROL", I("c01"), "out2", "I", "Motif inutile");
      expect(c.status, c.text).toBe(201);
      const w0 = (await notifs("rm", I("c02"))).filter((n) => n.event_type === "CONTROL_VISIBILITY_WIDENED").length;
      expect((await permChanges(I("c02"))).length, "nothing opened, nothing traced").toBe(before);
      expect((await audits(c.json.data.id)).find((x) => x.action === "CREATE")!.reason, "unneeded reason is not stored").toBeNull();
      expect((await notifs("rm", I("c02"))).filter((n) => n.event_type === "CONTROL_VISIBILITY_WIDENED")).toHaveLength(w0);
    });

    it("Risk Manager author: no reason required, the opening is still traced (PERMISSION_CHANGE, reason null) but nobody is notified (the RM did it)", async () => {
      const before = (await permChanges(I("c02"))).length;
      const nBefore = (await notifs("rm", I("c02"))).length;
      const r = await raci("rm", "CONTROL", I("c02"), "out", "R");
      expect(r.status, r.text).toBe(201);
      const pc = (await permChanges(I("c02"))).slice(before);
      expect(pc).toHaveLength(1);
      expect(pc[0]).toMatchObject({ user_id: UID.rm, reason: null });
      expect(pc[0]!.new_value.through).toBe("RACI");
      expect((await notifs("rm", I("c02"))).length).toBe(nBefore);
      expect((await call("rm", "DELETE", `/raci/${r.json.data.id}?entityType=CONTROL&entityId=${I("c02")}`)).status).toBe(200);
      // an RM giving a reason keeps it
      const r2 = await raci("rm", "CONTROL", I("c02"), "out", "R", "RM avec motif");
      expect(r2.status).toBe(201);
      expect((await permChanges(I("c02"))).at(-1)!.reason).toBe("RM avec motif");
      expect((await call("rm", "DELETE", `/raci/${r2.json.data.id}?entityType=CONTROL&entityId=${I("c02")}`)).status).toBe(200);
    });

    it("NOMINATIF (RACI does not open it, I-3): a non-RM author is still asked for a reason, but nothing is opened, traced or notified", async () => {
      const without = await raci("named", "CONTROL", I("c03"), "out", "C");
      expect(without.status).toBe(400);
      const withReason = await raci("named", "CONTROL", I("c03"), "out", "C", "Pas d'effet");
      expect(withReason.status, withReason.text).toBe(201);
      expect(await sees("out", `/controls/${I("c03")}`)).toBe(false);
      expect(await permChanges(I("c03"))).toEqual([]);
      expect((await notifs("rm", I("c03")))).toEqual([]);
    });

    it("hidden entity: an author who cannot read it gets the unknown-id answer BEFORE any reason check (no oracle through the reason rule)", async () => {
      const h = await raci("out2", "CONTROL", I("c02"), "out", "C", "Motif");
      const u = await raci("out2", "CONTROL", UNKNOWN, "out", "C", "Motif");
      const hb = await raci("out2", "CONTROL", I("c02"), "out", "C");
      const ub = await raci("out2", "CONTROL", UNKNOWN, "out", "C");
      for (const [x, y, id] of [[h, u, I("c02")], [hb, ub, I("c02")]] as const) expect(`${x.status} ${x.text.replaceAll(id, "<id>")}`.replace(/"requestId":"[^"]*"/, "")).toBe(`${y.status} ${y.text.replaceAll(UNKNOWN, "<id>")}`.replace(/"requestId":"[^"]*"/, ""));
    });

    it("atomicity: if the PERMISSION_CHANGE row cannot be written, no opening is left behind (no RACI row, resource still hidden)", async () => {
      await sql(`CREATE OR REPLACE FUNCTION qa_v2b_fail_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.action = 'PERMISSION_CHANGE' AND NEW.entity_id::text = '${I("c02")}' THEN RAISE EXCEPTION 'qa audit failure'; END IF; RETURN NEW; END $$`);
      await sql("DROP TRIGGER IF EXISTS qa_v2b_fail ON audit_log");
      await sql("CREATE TRIGGER qa_v2b_fail BEFORE INSERT ON audit_log FOR EACH ROW EXECUTE FUNCTION qa_v2b_fail_audit()");
      let status = 0;
      try { status = (await raci("dept", "CONTROL", I("c02"), "out", "A", "Doit echouer")).status; } finally { await sql("DROP TRIGGER IF EXISTS qa_v2b_fail ON audit_log"); }
      expect(status).toBeGreaterThanOrEqual(500);
      expect((await raciRows(I("c02"), UID.out)).filter((r) => !r.deleted_at)).toEqual([]);
      expect(await sees("out", `/controls/${I("c02")}`)).toBe(false);
    });

    it.fails("QA-V2B-01 (MINOR): the same opening assignment sent 5 times at once leaves ONE active row, ONE PERMISSION_CHANGE and ONE RM notification (today every request passes the `canRead` pre-check: 5 rows, 5 audit rows, 5 notifications; raci_assignments has no uniqueness)", async () => {
      const before = (await permChanges(I("a06"))).length;
      const n0 = (await notifs("rm", I("a06"))).length;
      const rs = await Promise.all(Array.from({ length: 5 }, () => raci("own", "ACTION_PLAN", I("a06"), "out2", "C", "Course QA")));
      expect(rs.filter((r) => r.status >= 500).map((r) => r.text.slice(0, 80))).toEqual([]);
      expect((await raciRows(I("a06"), UID.out2)).filter((r) => !r.deleted_at)).toHaveLength(1);
      expect((await permChanges(I("a06"))).length - before).toBe(1);
      expect((await notifs("rm", I("a06"))).length - n0).toBe(1);
    });

    it("OBSERVATION (other openings of PERIMETRE are not covered by q207): a department group assigned to a person opens the department's restricted resources with no reason, no PERMISSION_CHANGE and no notification", async () => {
      await sql("UPDATE users SET roles = roles || ARRAY['role.assign','role.read']::text[] WHERE email = 'adm@vv1.test'");
      const n0 = (await notifs("rm", I("c02"))).length;
      const r = await post("adm", `/roles/${I("301")}/assign`, { userId: UID.out });
      expect([200, 201], r.text).toContain(r.status);
      expect(await sees("out", `/controls/${I("c02")}`)).toBe(true);
      expect((await permChanges(I("c02"))).filter((p) => p.user_id === UID.adm)).toEqual([]);
      expect((await notifs("rm", I("c02"))).length).toBe(n0);
      // the last role of an account cannot be revoked through the API: restore the state by SQL
      await sql("UPDATE user_roles SET revoked_at = now() WHERE user_id = $1 AND role_id = $2 AND revoked_at IS NULL", [UID.out, I("301")]);
      expect(await sees("out", `/controls/${I("c02")}`)).toBe(false);
    });
  });

  // ---------------------------------------------------------------------------------------------- PROCESS OWNER (q207)
  describe("PROCESS: a new process owner opens the PERIMETRE resources of the process", () => {
    const P = I("401");
    const own = async () => (await sql<{ owner_user_id: string | null }>("SELECT owner_user_id FROM processes WHERE id = $1", [P]))[0]!.owner_user_id;
    it("non-RM author: no / blank / out-of-bound reason => 400 and the owner is unchanged; a reason => 200, UPDATE + PERMISSION_CHANGE in the same trail with the exact `opened` list, RM notified once", async () => {
      expect(await own()).toBe(UID.pown);
      const a0 = (await audits(P)).length;
      for (const reason of [undefined, ...BAD_REASONS]) {
        const r = await put("dept", `/processes/${P}/responsibilities`, { ownerUserId: UID.out, ...(reason === undefined ? {} : { reason }) });
        expect(r.status, `reason ${JSON.stringify(reason)?.slice(0, 12)} ${r.text.slice(0, 90)}`).toBe(400);
      }
      expect(await own()).toBe(UID.pown);
      expect((await audits(P)).length).toBe(a0);
      expect(await sees("out", `/controls/${I("c02")}`)).toBe(false);
      const ok = await put("dept", `/processes/${P}/responsibilities`, { ownerUserId: UID.out, reason: "Nouveau responsable QA" });
      expect(ok.status, ok.text).toBe(200);
      expect(await own()).toBe(UID.out);
      const rows = (await audits(P)).slice(a0);
      expect(rows.map((r) => r.action).sort((a, b) => a.localeCompare(b))).toEqual(["PERMISSION_CHANGE", "UPDATE"]);
      const pc = rows.find((r) => r.action === "PERMISSION_CHANGE")!;
      expect(pc).toMatchObject({ user_id: UID.dept, reason: "Nouveau responsable QA", entity_type: "Process" });
      expect(pc.new_value).toMatchObject({ ownerUserId: UID.out, widening: true, through: "PROCESS_OWNER" });
      expect(pc.old_value).toEqual({ ownerUserId: UID.pown });
      // what `out` could not read before and now reads: PERIMETRE risk 502, control c02, KPI 9002 (not the NOMINATIF ones, not the orphan, not the CLIENT ones)
      expect(pc.new_value.opened).toEqual([{ type: "CONTROL", id: I("c02") }, { type: "KPI", id: K("9002") }, { type: "RISK", id: I("502") }]);
      const n = await notifs("rm", P);
      expect(n.map((x) => x.event_type)).toEqual(["PROCESS_OWNER_VISIBILITY_WIDENED"]);
      expect(n[0]!.message).not.toMatch(/CANARY|[0-9a-f]{8}-/);
      for (const w of ["com", "aud", "dept", "out", "pown"] as const) expect(await notifs(w, P), w).toEqual([]);
      // real effect: out reads the three, never the NOMINATIF ones; the previous owner loses what only the process gave him
      expect([await sees("out", `/controls/${I("c02")}`), await sees("out", `/kpis/${K("9002")}`), await sees("out", `/risks/${I("502")}`)]).toEqual([true, true, true]);
      expect([await sees("out", `/controls/${I("c03")}`), await sees("out", `/risks/${I("503")}`), await sees("out", `/controls/${I("c04")}`)]).toEqual([false, false, false]);
      expect([await sees("pown", `/kpis/${K("9002")}`), await sees("pown", `/risks/${I("502")}`)]).toEqual([false, false]); // pown read through the process only
    });

    it("Risk Manager author: no reason, trace kept, nobody notified; owner back to pown", async () => {
      const a0 = (await audits(P)).length;
      const n0 = (await notifs("rm", P)).length;
      const r = await put("rm", `/processes/${P}/responsibilities`, { ownerUserId: UID.pown });
      expect(r.status, r.text).toBe(200);
      const pc = (await audits(P)).slice(a0).filter((x) => x.action === "PERMISSION_CHANGE");
      expect(pc).toHaveLength(1);
      expect(pc[0]!.reason).toBeNull();
      expect((await notifs("rm", P)).length).toBe(n0);
      expect(await sees("out", `/controls/${I("c02")}`)).toBe(false);
    });

    it("nothing opened => no reason, no PERMISSION_CHANGE: a process without restricted resources, same owner again, risk champion / deputy only, owner cleared", async () => {
      await sql("INSERT INTO processes (id, tenant_id, level, name, owner_user_id, department_id) VALUES ($1, $2, 'PROCESS', 'Processus vide QA V2bis', NULL, $3)", [I("402"), I("001"), I("201")]);
      const a0 = (await audits(I("402"))).length;
      const r = await put("dept", `/processes/${I("402")}/responsibilities`, { ownerUserId: UID.out });
      expect(r.status, r.text).toBe(200);
      expect((await audits(I("402"))).slice(a0).map((x) => x.action)).toEqual(["UPDATE"]);
      const again = await put("dept", `/processes/${I("402")}/responsibilities`, { ownerUserId: UID.out });
      expect(again.status).toBe(200);
      expect((await audits(I("402"))).length - a0).toBe(1);
      expect((await put("dept", `/processes/${P}/responsibilities`, { deputyUserId: UID.out2 })).status).toBe(200); // N-1 does not read (only the owner does)
      expect(await sees("out2", `/controls/${I("c02")}`)).toBe(false);
      expect((await put("dept", `/processes/${P}/responsibilities`, { riskChampionUserId: UID.out2 })).status).toBe(200);
      expect(await sees("out2", `/controls/${I("c02")}`)).toBe(false);
      expect((await put("dept", `/processes/${I("402")}/responsibilities`, { ownerUserId: null })).status).toBe(200);
      await put("rm", `/processes/${P}/responsibilities`, { deputyUserId: null, riskChampionUserId: null });
    });

    it("the author never designates themselves, and the reason rule does not change that", async () => {
      const r = await put("dept", `/processes/${P}/responsibilities`, { ownerUserId: UID.dept, reason: "Moi-meme" });
      expect(r.status).toBe(400);
      expect(await own()).toBe(UID.pown);
    });

    it("no bypass: the other process routes (POST / PATCH) never write ownerUserId, an unknown field is ignored or refused, the owner stays", async () => {
      const bad = await call("rm", "PATCH", `/processes/${P}`, { ownerUserId: UID.out, owner: "Texte libre" });
      expect(bad.status, bad.text).toBeLessThan(500);
      expect(await own()).toBe(UID.pown);
      const created = await post("rm", "/processes", { level: "PROCESS", name: "Processus QA bypass", ownerUserId: UID.out, departmentId: I("201") });
      expect(created.status, created.text).toBeLessThan(500);
      if (created.status === 201) expect(created.json.data.ownerUserId ?? null).toBeNull();
      expect(await sees("out", `/controls/${I("c02")}`)).toBe(false);
    });

    it("atomicity: the PERMISSION_CHANGE row is written in the same transaction as the owner change (failure => owner unchanged)", async () => {
      await sql(`CREATE OR REPLACE FUNCTION qa_v2b_fail_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.action = 'PERMISSION_CHANGE' AND NEW.entity_id::text = '${P}' THEN RAISE EXCEPTION 'qa audit failure'; END IF; RETURN NEW; END $$`);
      await sql("DROP TRIGGER IF EXISTS qa_v2b_fail ON audit_log");
      await sql("CREATE TRIGGER qa_v2b_fail BEFORE INSERT ON audit_log FOR EACH ROW EXECUTE FUNCTION qa_v2b_fail_audit()");
      let status = 0;
      try { status = (await put("dept", `/processes/${P}/responsibilities`, { ownerUserId: UID.out, reason: "Doit echouer" })).status; } finally { await sql("DROP TRIGGER IF EXISTS qa_v2b_fail ON audit_log"); }
      expect(status).toBeGreaterThanOrEqual(500);
      expect(await own()).toBe(UID.pown);
      expect(await sees("out", `/controls/${I("c02")}`)).toBe(false);
    });

    it("a process whose only restricted items are NOMINATIF opens nothing (I-3): no reason, no PERMISSION_CHANGE", async () => {
      await sql("INSERT INTO processes (id, tenant_id, level, name, owner_user_id, department_id) VALUES ($1, $2, 'PROCESS', 'Processus NOMIN QA V2bis', NULL, $3)", [I("403"), I("001"), I("201")]);
      await sql("INSERT INTO controls (id, tenant_id, label, control_type, frequency, executor, compliance_criteria, department_id, process_id, visibility) VALUES ($1, $2, 'CANARY-V2B-CTL-NOMIN', 'PREVENTIVE', 'MONTHLY', 'x', 'y', $3, $4, 'NOMINATIF')", [I("c10"), I("001"), I("201"), I("403")]);
      const r = await put("dept", `/processes/${I("403")}/responsibilities`, { ownerUserId: UID.out });
      expect(r.status, r.text).toBe(200); // NOMINATIF is not opened by a process owner (I-3): no reason
      expect((await permChanges(I("403")))).toEqual([]);
      expect(await sees("out", `/controls/${I("c10")}`)).toBe(false);
    });
  });

  // ---------------------------------------------------------------------------------------------- OWNER (q208)
  describe("OWNER: the RM group is told of every owner change of a level", () => {
    const ev = async (w: Who, id: string) => (await notifs(w, id)).map((x) => x.event_type);
    const vis = (w: Who, path: string, visibility: string, add: string[] = [], reason = "Motif QA") => put(w, `${path}/visibility`, { visibility, addUserIds: add, revokeUserIds: [], reason });
    it("plan (owner = responsible): restricting => *_RESTRICTED once per RM member, widening => *_WIDENED; the RM changing it, other accounts, controls and KPIs => nothing; no content in the message", async () => {
      const c = await post("rm", "/actions", { title: "CANARY-V2B-PLAN-TITRE", sourceType: "MANAGEMENT", responsibleUserId: UID.own, departmentId: I("201"), dueDate: "2027-06-30", visibility: "PERIMETRE" });
      expect(c.status, c.text).toBe(201);
      const id = c.json.data.id as string;
      expect((await vis("rm", `/actions/${id}`, "PERIMETRE", [UID.named])).status).toBe(200);
      expect(await ev("rm", id)).toEqual([]); // RM author
      expect((await vis("own", `/actions/${id}`, "NOMINATIF")).status).toBe(200); // owner restricts
      expect(await ev("rm", id)).toEqual(["ACTION_PLAN_VISIBILITY_RESTRICTED"]);
      expect((await vis("own", `/actions/${id}`, "CLIENT")).status).toBe(200); // owner widens
      expect(await ev("rm", id)).toEqual(["ACTION_PLAN_VISIBILITY_RESTRICTED", "ACTION_PLAN_VISIBILITY_WIDENED"]);
      expect((await vis("own", `/actions/${id}`, "PERIMETRE", [UID.named])).status).toBe(200); // narrow again, with a person: still a restriction? (list added at lower level)
      const all = await notifs("rm", id);
      expect(all).toHaveLength(3); // exactly one notification per owner change (3 changes by the owner)
      expect(all.every((n) => !/CANARY|TITRE/.test(n.message))).toBe(true);
      for (const w of ["com", "aud", "own", "named", "dept", "out", "adm"] as const) expect((await notifs(w, id)).filter((n) => /VISIBILITY/.test(n.event_type)), w).toEqual([]);
    });
    it("anomaly (owner = declarer): restricted / widened events", async () => {
      const c = await post("dept", "/anomalies", { description: "CANARY-V2B-ANO", severity: "LOW", visibility: "PERIMETRE" });
      expect(c.status, c.text).toBe(201);
      const id = c.json.data.id as string;
      expect((await vis("dept", `/anomalies/${id}`, "NOMINATIF")).status).toBe(200); // PERIMETRE without department = declarer only: NOMINATIF opens nobody
      expect((await vis("dept", `/anomalies/${id}`, "CLIENT")).status).toBe(200);
      expect(await ev("rm", id)).toEqual(["ANOMALY_VISIBILITY_RESTRICTED", "ANOMALY_VISIBILITY_WIDENED"]);
    });
    it("risk (owner): restricting => RISK_VISIBILITY_RESTRICTED, widening => RISK_VISIBILITY_WIDENED (already existing)", async () => {
      const n0 = (await notifs("rm", I("502"))).length;
      expect((await vis("own", `/risks/${I("502")}`, "NOMINATIF")).status).toBe(200);
      expect((await vis("own", `/risks/${I("502")}`, "PERIMETRE")).status).toBe(200);
      expect((await notifs("rm", I("502"))).slice(n0).map((x) => x.event_type)).toEqual(["RISK_VISIBILITY_RESTRICTED", "RISK_VISIBILITY_WIDENED"]);
    });
    it("control / KPI: the RM alone changes them; no owner event exists, nothing is sent", async () => {
      const c = await post("rm", "/controls", { label: "Controle QA V2bis", coveredRiskIds: [I("501")], controlType: "PREVENTIVE", frequency: "MONTHLY", executor: "x", complianceCriteria: "y", visibility: "PERIMETRE", departmentId: I("201") });
      const k = await post("rm", "/kpis", { label: "KPI QA V2bis", targetValue: 1, unit: "%", frequency: "MONTHLY", owner: "x", departmentId: I("201"), visibility: "PERIMETRE" });
      expect([c.status, k.status]).toEqual([201, 201]);
      expect((await vis("rm", `/controls/${c.json.data.id}`, "NOMINATIF", [UID.named])).status).toBe(200);
      expect((await vis("rm", `/kpis/${k.json.data.id}`, "CLIENT")).status).toBe(200);
      for (const id of [c.json.data.id as string, k.json.data.id as string]) for (const w of WHO) expect((await notifs(w, id)).filter((n) => /VISIBILITY/.test(n.event_type)), `${w} ${id}`).toEqual([]);
    });
    it.fails("QA-V2B-02 (MINOR): an owner request that changes NOTHING (same level, no list change) does not wake the RM group", async () => {
      const c = await post("rm", "/actions", { title: "Plan noop QA", sourceType: "MANAGEMENT", responsibleUserId: UID.own, departmentId: I("201"), dueDate: "2027-06-30", visibility: "PERIMETRE" });
      const id = c.json.data.id as string;
      await vis("rm", `/actions/${id}`, "PERIMETRE", [UID.named]);
      const before = (await notifs("rm", id)).length;
      expect((await vis("own", `/actions/${id}`, "PERIMETRE")).status).toBe(200); // identical level, list untouched
      expect((await notifs("rm", id)).length - before).toBe(0);
    });
    it("the new events are mandatory: they cannot be unsubscribed", async () => {
      for (const [resourceType, eventType] of [["RISK", "RISK_VISIBILITY_RESTRICTED"], ["ACTION_PLAN", "ACTION_PLAN_VISIBILITY_RESTRICTED"], ["ANOMALY", "ANOMALY_VISIBILITY_RESTRICTED"], ["CONTROL", "CONTROL_VISIBILITY_WIDENED"], ["MANAGEMENT", "PROCESS_OWNER_VISIBILITY_WIDENED"]]) {
        const r = await call("rm", "PUT", "/notification-subscriptions", { resourceType, eventType, enabled: false });
        expect([400, 403, 404, 405], `${eventType} ${r.status} ${r.text.slice(0, 80)}`).toContain(r.status);
        expect(r.status === 200 || r.status === 201).toBe(false);
      }
    });
  });

  // ---------------------------------------------------------------------------------------------- LIST (q208)
  describe("LIST: GET /restricted-resources", () => {
    it("401 anonymous; 200 for the Risk Manager group only; 403 for Committee, Audit and every ordinary profile", async () => {
      expect((await call(null, "GET", "/restricted-resources")).status).toBe(401);
      const codes: Record<string, number> = {};
      for (const w of WHO) codes[w] = (await get(w, "/restricted-resources")).status;
      expect(codes).toEqual({ own: 403, n1: 403, raci: 403, pown: 403, dept: 403, named: 403, out: 403, out2: 403, rm: 200, com: 403, aud: 403, adm: 403 });
    });
    it("content = exactly the restricted rows of the tenant in the database (type, id, level, active access count), no CLIENT row, no foreign tenant, ordered by update date desc", async () => {
      await sql("INSERT INTO tenants (id, name) VALUES ($1, 'Autre tenant V2bis') ON CONFLICT DO NOTHING", [I("f00")]);
      await sql("INSERT INTO risks (id, tenant_id, process, description, status, visibility) VALUES ($1, $2, 'p', 'CANARY-V2B-FOREIGN-RISK', 'ACTIVE', 'NOMINATIF')", [I("f50"), I("f00")]);
      const r = await get("rm", "/restricted-resources");
      expect(r.status).toBe(200);
      const rows = r.json.data as Array<{ type: string; id: string; label: string; visibility: string; accessCount: number; updatedAt: string }>;
      expect(r.text).not.toContain("CANARY-V2B-FOREIGN");
      expect(rows.every((x) => x.visibility === "PERIMETRE" || x.visibility === "NOMINATIF")).toBe(true);
      const truth = await sql<{ type: string; id: string; visibility: string }>(`
        SELECT 'RISK' AS type, id::text, visibility FROM risks WHERE tenant_id = $1 AND deleted_at IS NULL AND visibility <> 'CLIENT'
        UNION ALL SELECT 'CONTROL', id::text, visibility FROM controls WHERE tenant_id = $1 AND deleted_at IS NULL AND visibility <> 'CLIENT'
        UNION ALL SELECT 'ANOMALY', id::text, visibility FROM anomalies WHERE tenant_id = $1 AND visibility <> 'CLIENT'
        UNION ALL SELECT 'ACTION_PLAN', id::text, visibility FROM action_plans WHERE tenant_id = $1 AND visibility <> 'CLIENT'
        UNION ALL SELECT 'KPI', id::text, visibility FROM kpis WHERE tenant_id = $1 AND deleted_at IS NULL AND visibility <> 'CLIENT'`, [I("001")]);
      const key = (x: { type: string; id: string; visibility: string }) => `${x.type}:${x.id}:${x.visibility}`;
      expect(rows.map(key).sort((a, b) => a.localeCompare(b))).toEqual(truth.map(key).sort((a, b) => a.localeCompare(b)));
      for (const x of rows) {
        const n = (await sql<{ n: number }>("SELECT count(*)::int AS n FROM resource_access_grants WHERE resource_type = $1 AND resource_id = $2 AND revoked_at IS NULL", [x.type, x.id]))[0]!.n;
        expect(x.accessCount, `${x.type} ${x.id}`).toBe(n);
      }
      const times = rows.map((x) => Date.parse(x.updatedAt));
      expect(times).toEqual([...times].sort((a, b) => b - a));
      expect(rows.length).toBeGreaterThanOrEqual(10);
    });
    it("a level change shows at once: restricting a CLIENT control adds it, opening it removes it; revoking a grant lowers the count", async () => {
      const c = await post("rm", "/controls", { label: "CANARY-V2B-CTL-" + "L".repeat(300), coveredRiskIds: [I("501")], controlType: "PREVENTIVE", frequency: "MONTHLY", executor: "x", complianceCriteria: "y", visibility: "NOMINATIF" });
      expect(c.status, c.text).toBe(201);
      const id = c.json.data.id as string;
      expect((await put("rm", `/controls/${id}/visibility`, { visibility: "NOMINATIF", addUserIds: [UID.named, UID.dept], revokeUserIds: [], reason: "QA" })).status).toBe(200);
      const find = async () => ((await get("rm", "/restricted-resources")).json.data as Array<{ id: string; label: string; accessCount: number }>).find((x) => x.id === id);
      expect(await find()).toMatchObject({ accessCount: 2 });
      expect((await put("rm", `/controls/${id}/visibility`, { visibility: "NOMINATIF", addUserIds: [], revokeUserIds: [UID.dept], reason: "QA" })).status).toBe(200);
      expect(await find()).toMatchObject({ accessCount: 1 });
      expect((await put("rm", `/controls/${id}/visibility`, { visibility: "CLIENT", addUserIds: [], revokeUserIds: [], reason: "QA" })).status).toBe(200);
      expect(await find()).toBeUndefined();
    });
    it("a soft-deleted restricted control / KPI / risk leaves the list (deleted_at)", async () => {
      await sql("UPDATE controls SET deleted_at = now() WHERE id = $1", [I("c04")]);
      const ids = ((await get("rm", "/restricted-resources")).json.data as Array<{ id: string }>).map((x) => x.id);
      expect(ids).not.toContain(I("c04"));
    });
    it("OBSERVATION: the list shows the stored level of each ROOT; an anomaly or plan that follows its parent is not listed on its own even when its parent is restricted", async () => {
      const rows = (await get("rm", "/restricted-resources")).json.data as Array<{ id: string; type: string }>;
      const ids = rows.map((x) => x.id);
      expect(ids).toContain(I("502")); // restricted parent risk
      expect(ids).not.toContain(I("d01")); // anomaly following it
      expect(ids).not.toContain(I("a02")); // plan following it
    });
    it("OBSERVATION (edge): a holder of resourcevisibility.set DIRECTLY in users.roles but outside the Risk Manager group reads the whole list (labels of restricted items he cannot read himself)", async () => {
      await sql("UPDATE users SET roles = roles || ARRAY['resourcevisibility.set']::text[] WHERE email = 'adm@vv1.test'");
      try {
        expect((await get("adm", `/risks/${I("503")}`)).status, "he cannot read the risk").toBe(404);
        const r = await get("adm", "/restricted-resources");
        expect(r.status).toBe(200); // pinned: the gate is the permission string, not the group
        expect(r.text).toContain("CANARY-NOMIN-DESC");
      } finally {
        await sql("UPDATE users SET roles = array_remove(roles, 'resourcevisibility.set') WHERE email = 'adm@vv1.test'");
      }
    });
    it("a custom role cannot carry resourcevisibility.set (the right stays in the RM group)", async () => {
      await sql("UPDATE users SET roles = roles || ARRAY['role.create','role.update','role.assign','role.read']::text[] WHERE email = 'adm@vv1.test'");
      const r = await post("adm", "/roles", { name: "Role QA V2bis", permissions: ["resourcevisibility.set"] });
      expect(r.status, r.text.slice(0, 120)).toBe(400);
    });
  });
});
