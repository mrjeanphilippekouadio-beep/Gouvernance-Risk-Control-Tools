import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { Pool } from "pg";

/**
 * QA-visibility-v1 (level 2): lot V1 of DECISION-100/102/103/104 (risks and what inherits from them restrictable; q203 audit.read).
 * Oracles written BEFORE running. Not a Security / Privacy / Compliance opinion.
 *
 * INV   static: every read of the risk repository in services/ is scoped (readerScope / SYSTEM_SCOPE / resolver); the unscoped ones
 *       are exactly the id-liveness `listByIds` checks (listed); the QA-V0 snapshot lists no risk read any more.
 * LEAK  REAL server (tsx, AUTH_PROVIDER=local) on LOCAL PostgreSQL 16, real HTTP: for 12 reader profiles x 2 restricted risks (PERIMETRE,
 *       NOMINATIF) x every route that returns risk data or what inherits from it (list, id, raci, 360, evaluations, decisions, KRI, measures,
 *       dashboard, executive, cartography, reports, risk-owners), a restricted risk and its children appear <=> the profile may read it;
 *       a hidden id answers exactly like an unknown id. Canary strings (CANARY-PERIM-*, CANARY-NOMIN-*) are the oracle.
 * CHG   visibility change: reason, forbidden actors, no self-add, back to CLIENT purges the list, RM notified only when the owner widens,
 *       audit row in the same change, concurrent changes stay consistent.
 * Q203  audit.read refused on every way to carry it outside the Audit group; GET /audit-log 403 for everyone but Audit; migration 081 up/down/up.
 *
 * Live part: QA_VIS1_LIVE=1 and the LOCAL cluster of tests/integration/qa-visibility-v1-setup.sh (127.0.0.1:55442, never a remote host).
 */
const ROOT = join(__dirname, "..", "..");
const MIG = join(ROOT, "database", "postgresql", "migrations");
const live = process.env["QA_VIS1_LIVE"] === "1";
const PGPORT = 55442;
const DB = "grc_qa_vv1t";
const PORT = 8098;
const API = `http://127.0.0.1:${PORT}/api/v1`;
const PSQL = "/usr/bin/psql";
const I = (x: string) => `aaaaaaaa-0000-4000-8000-000000000${x}`;
const UNKNOWN = I("9ff");
const R = { CLIENT: I("501"), PERIM: I("502"), NOMIN: I("503") };
const EVAL = { CLIENT: I("610"), PERIM: I("710"), NOMIN: I("810") };
const KRI = { CLIENT: I("620"), PERIM: I("720"), NOMIN: I("820") };

// ================================================================================================ INV (static)
function scanRiskReads() {
  const dir = join(__dirname, "..", "src", "services");
  const out: Array<{ file: string; method: string; scoped: boolean }> = [];
  const re = /this\.risks\??\.(getById|list|listByIds)\(/g;
  for (const file of readdirSync(dir).filter((f) => f.endsWith(".ts")).sort((a, b) => a.localeCompare(b))) {
    const src = readFileSync(join(dir, file), "utf8");
    for (let m = re.exec(src); m; m = re.exec(src)) {
      let depth = 1;
      let i = re.lastIndex;
      while (depth > 0 && i < src.length) { const ch = src[i++]; if (ch === "(") depth++; else if (ch === ")") depth--; }
      out.push({ file, method: m[1]!, scoped: /readerScope|SYSTEM_SCOPE|READER_DEFAULT_SCOPE|visibility\.resolve|\bscope\b|\bread\b/.test(src.slice(re.lastIndex, i)) });
    }
  }
  return out;
}

describe("QA-visibility-v1 INV: reads of the risk repository", () => {
  const reads = scanRiskReads();
  it("getById and list always carry a scope (no unscoped user-facing read of risks)", () => {
    expect(reads.filter((r) => r.method !== "listByIds" && !r.scoped).map((r) => `${r.file}:${r.method}`)).toEqual([]);
    expect(reads.filter((r) => r.method !== "listByIds").length).toBeGreaterThanOrEqual(25);
  });
  it("the only unscoped reads are the 6 id-liveness `listByIds` (they return ids/existence, never content): any new one must be reviewed", () => {
    expect(reads.filter((r) => !r.scoped).map((r) => `${r.file}:${r.method}`).sort((a, b) => a.localeCompare(b))).toEqual([
      "ControlService.ts:listByIds", "DashboardScopeResolver.ts:listByIds", "DashboardScopeResolver.ts:listByIds",
      "KriService.ts:listByIds", "KriService.ts:listByIds", "KriService.ts:listByIds",
    ]);
  });
  it("the QA-V0 instantané lists no risk read any more (only controls / anomalies / action plans / KPIs, V2)", () => {
    const v0 = readFileSync(join(__dirname, "QA-visibility-v0.test.ts"), "utf8");
    expect(v0).toMatch(/if \(m\[1\] === "risks"\) continue;/);
    expect(v0).not.toMatch(/"RiskService\.ts:risks\./);
    expect(v0).not.toMatch(/"(CartographyService|KriService|TreatmentDecisionService|RiskEvaluationService|RiskFrameworkService|RiskOwnershipService|DashboardScopeResolver|ProcessEvaluationModeRequestService)\.ts": \d/);
  });
  it("every risk-restricting child clause hands the reader id as a strict uuid literal (no string built from a request value)", () => {
    const f = readFileSync(join(__dirname, "..", "src", "infrastructure", "database", "postgres", "visibilityFilter.ts"), "utf8");
    expect(f).toMatch(/UUID\.test\(userId\)/);
    expect(f).toMatch(/::uuid/);
  });
  it("risk import neither reads nor sets a level: imported risks are CLIENT (default)", () => {
    const s = readFileSync(join(__dirname, "..", "src", "services", "RiskImportService.ts"), "utf8");
    expect(s).not.toMatch(/visibility/i);
    expect(s).not.toMatch(/this\.risks\.(list|getById)/);
  });
});

// ================================================================================================ live
type Who = "own" | "n1" | "raci" | "pown" | "dept" | "named" | "out" | "out2" | "rm" | "com" | "aud" | "adm";
const WHO: Who[] = ["own", "n1", "raci", "pown", "dept", "named", "out", "out2", "rm", "com", "aud", "adm"];
/** PERIM / NOMIN visibility per profile (spec: PERIMETRE = owner, N+1, RACI, process owner, department group + list; NOMINATIF = owner + list; RM, Committee, Audit see all). */
const SEES: Record<Who, { PERIM: boolean; NOMIN: boolean }> = {
  own: { PERIM: true, NOMIN: true }, n1: { PERIM: true, NOMIN: false }, raci: { PERIM: true, NOMIN: false }, pown: { PERIM: true, NOMIN: false },
  dept: { PERIM: true, NOMIN: false }, named: { PERIM: true, NOMIN: true }, out: { PERIM: false, NOMIN: false }, out2: { PERIM: false, NOMIN: false },
  rm: { PERIM: true, NOMIN: true }, com: { PERIM: true, NOMIN: true }, aud: { PERIM: true, NOMIN: true }, adm: { PERIM: false, NOMIN: false },
};
const TOK = {} as Record<Who, string>;
let pg: Pool;
const sh = (cmd: string, args: string[], env: Record<string, string> = {}) =>
  execFileSync(cmd, args, { encoding: "utf8", env: { ...process.env, ...env }, stdio: ["ignore", "pipe", "pipe"], timeout: 300000 });
const sql = async <T = Record<string, unknown>>(q: string, p: unknown[] = []) => (await pg.query(q, p)).rows as T[];

type Res = { status: number; text: string; json: any };
async function call(who: Who | null, method: string, path: string, body?: unknown, headers: Record<string, string> = {}): Promise<Res> {
  const r = await fetch(API + path, {
    method,
    headers: { "content-type": "application/json", ...(who ? { authorization: `Bearer ${TOK[who]}` } : {}), ...headers },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await r.text();
  let json: unknown = null;
  try { json = JSON.parse(text); } catch { /* not JSON */ }
  return { status: r.status, text, json };
}
const get = (who: Who, path: string) => call(who, "GET", path);
/** Same answer as an unknown id once the id is substituted (no existence oracle). */
const norm = (r: Res, id: string) => `${r.status} ${r.text.replaceAll(id, "<id>").replace(/"requestId":"[^"]*"/, "")}`;

describe.skipIf(!live)("QA-visibility-v1 on the REAL server + LOCAL PostgreSQL 16", () => {
  beforeAll(async () => {
    sh("bash", [join(ROOT, "tests", "integration", "qa-visibility-v1-setup.sh"), "up", DB]);
    sh("bash", [join(ROOT, "tests", "integration", "qa-visibility-v1-server.sh"), "start"], { QA_PORT: String(PORT), QA_DB: DB });
    pg = new Pool({ host: "127.0.0.1", port: PGPORT, user: "postgres", database: DB, max: 4 });
    for (const w of WHO) {
      const r = await fetch(`${API}/auth/local`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email: `${w}@vv1.test`, password: "whatever" }) });
      TOK[w] = ((await r.json()) as { accessToken: string }).accessToken;
      expect(TOK[w], w).toBeTruthy();
    }
  }, 280000);
  afterAll(async () => {
    await pg?.end();
    sh("bash", [join(ROOT, "tests", "integration", "qa-visibility-v1-server.sh"), "stop"]);
  });

  // ---------------------------------------------------------------------------------------------- LEAK
  describe("LEAK: 12 profiles x 2 restricted risks x every risk route", () => {
    for (const who of WHO) {
      for (const lvl of ["PERIM", "NOMIN"] as const) {
        const sees = SEES[who][lvl];
        it(`${who} ${sees ? "READS" : "does NOT read"} the ${lvl} risk and everything that inherits from it`, async () => {
          const id = R[lvl];
          const canary = `CANARY-${lvl}`;
          // the id-addressed routes: visible -> 200, hidden -> the very answer of an unknown id
          const byId: Array<[string, string]> = [
            [`/risks/${id}`, `/risks/${UNKNOWN}`], [`/risks/${id}/raci`, `/risks/${UNKNOWN}/raci`], [`/risks/${id}/360`, `/risks/${UNKNOWN}/360`],
            [`/risks/${id}/visibility`, `/risks/${UNKNOWN}/visibility`],
            [`/risk-evaluations/${EVAL[lvl]}`, `/risk-evaluations/${UNKNOWN}`],
            [`/kris/${KRI[lvl]}`, `/kris/${UNKNOWN}`], [`/kri-measures?kriId=${KRI[lvl]}`, `/kri-measures?kriId=${UNKNOWN}`],
            [`/risk-evaluations?riskId=${id}`, `/risk-evaluations?riskId=${UNKNOWN}`],
          ];
          for (const [path, unknownPath] of byId) {
            const r = await get(who, path);
            if (sees) {
              expect(r.status, `${who} ${path}`).toBe(200);
            } else {
              const u = await get(who, unknownPath);
              expect(r.status, `${who} ${path}`).toBeGreaterThanOrEqual(400);
              expect(r.text, `${who} ${path}`).not.toContain(canary);
              expect(norm(r, id).replaceAll(EVAL[lvl], "<id>").replaceAll(KRI[lvl], "<id>"), `${who} ${path} vs unknown`).toBe(norm(u, UNKNOWN));
            }
          }
          // the collections: the canary (description, evaluation, decision, KRI label, measure source) shows up iff readable
          const desc = `${canary}-DESC`;
          const collections: Array<[string, string]> = [
            ["/risks", desc], ["/risk-owners", desc], ["/dashboard/risks", desc], ["/dashboard/executive", desc], ["/reports/consolidated", desc], ["/reports/risk-committee", desc],
            ["/kris", `${canary}-KRI`], ["/kris/dashboard", `${canary}-KRI`], ["/reports/kri-consolidated", `${canary}-KRI`],
            ["/cartography", id], ["/cartography?version=residual", id], ["/cartography/compare", id],
            [`/treatment-decisions?riskId=${id}`, `${canary}-DECISION`], [`/kri-measures?kriId=${KRI[lvl]}`, `${canary}-MEASURE`],
            [`/risk-evaluations?riskId=${id}`, `${canary}-EVAL`], [`/risks/${id}/360`, `${canary}-EVAL`],
          ];
          for (const [path, marker] of collections) {
            const r = await get(who, path);
            expect(r.text.includes(marker), `${who} ${path} contains ${marker}`).toBe(sees);
            if (!sees) { if (!path.includes(id)) expect(r.text, `${who} ${path}`).not.toContain(id); expect(r.text, `${who} ${path}`).not.toContain(canary); }
          }
          // KRI of a hidden risk: neither its label, id nor measures anywhere
          if (!sees) {
            for (const path of ["/kris", "/kris/dashboard", "/reports/kri-consolidated", "/dashboard/risk-owner"]) {
              const t = (await get(who, path)).text;
              expect(t, `${who} ${path}`).not.toContain(KRI[lvl]);
              expect(t, `${who} ${path}`).not.toContain(EVAL[lvl]);
            }
          }
        });
      }
    }

    it("counts: the executive dashboard counts only readable active risks (1 CLIENT + the restricted ones the profile reads)", async () => {
      for (const who of WHO) {
        const n = 1 + (SEES[who].PERIM ? 1 : 0) + (SEES[who].NOMIN ? 1 : 0);
        const r = await get(who, "/dashboard/executive");
        expect(r.json.data.totalActiveRisks, who).toBe(n);
        const rc = await get(who, "/reports/consolidated");
        expect(rc.json.data.entities.reduce((a: number, e: { riskCount: number }) => a + e.riskCount, 0), `${who} consolidated`).toBe(n);
      }
    });

    it("the registry list returns exactly the readable risks, per profile", async () => {
      for (const who of WHO) {
        const ids = ((await get(who, "/risks")).json.data as Array<{ id: string }>).map((x) => x.id).sort((a, b) => a.localeCompare(b));
        const want = [R.CLIENT, ...(SEES[who].PERIM ? [R.PERIM] : []), ...(SEES[who].NOMIN ? [R.NOMIN] : [])].sort((a, b) => a.localeCompare(b));
        expect(ids, who).toEqual(want);
      }
    });

    it("owner's personal view (?ownerId=me, dashboard/risk-owner) never shows another owner's restricted risk to a non-reader", async () => {
      const t = (await get("out", `/risks?ownerId=${I("101")}`)).text;
      expect(t).not.toContain("CANARY-PERIM");
      expect(t).not.toContain("CANARY-NOMIN");
      expect((await get("own", "/dashboard/risk-owner")).text).toContain("CANARY-NOMIN");
    });

    it("CLIENT risk and its children stay readable by everybody (no regression of the default level)", async () => {
      for (const who of WHO) {
        for (const p of [`/risks/${R.CLIENT}`, `/risk-evaluations/${EVAL.CLIENT}`, `/kris/${KRI.CLIENT}`, `/risks/${R.CLIENT}/360`]) {
          expect((await get(who, p)).status, `${who} ${p}`).toBe(200);
        }
      }
    });

    it("an administrator holding resourcevisibility.set DIRECTLY but outside the A3 right cannot read or change a restricted risk (404)", async () => {
      expect((await get("adm", `/risks/${R.PERIM}`)).status).toBe(404);
      const r = await call("adm", "PUT", `/risks/${R.PERIM}/visibility`, { visibility: "CLIENT", reason: "Tentative" });
      expect(r.status).toBe(404);
      expect((await sql("SELECT visibility FROM risks WHERE id = $1", [R.PERIM]))[0]).toEqual({ visibility: "PERIMETRE" });
    });

    it("write routes aimed at a hidden risk answer like an unknown id (no oracle through POST): evaluation, decision, KRI, RACI, KRI link", async () => {
      const cases: Array<[string, string, (id: string) => unknown, Who]> = [
        ["POST", "/risk-evaluations", (id) => ({ riskId: id, evaluationType: "AD_HOC", subCategoryId: I("9aa") }), "out2"],
        ["POST", "/kris", (id) => ({ label: "x", formula: "f", thresholdGreen: 1, thresholdOrange: 2, thresholdRed: 3, frequency: "MONTHLY", riskId: id }), "out2"],
        ["POST", "/raci", (id) => ({ entityType: "RISK", entityId: id, userId: I("107"), role: "C" }), "out2"],
        ["POST", `/kris/${KRI.CLIENT}/risks`, (id) => ({ riskIds: [id] }), "out2"],
      ];
      for (const [m, p, body, who] of cases) {
        const h = await call(who, m, p, body(R.PERIM));
        const u = await call(who, m, p, body(UNKNOWN));
        expect(norm(h, R.PERIM), `${m} ${p}`).toBe(norm(u, UNKNOWN));
      }
      expect((await sql("SELECT count(*)::int AS n FROM raci_assignments WHERE entity_id = $1", [R.PERIM]))[0]).toEqual({ n: 1 });
    });

    it("QA-VIS1-03: GET /risk-evaluations/:id/context of an evaluation of a hidden risk answers like an unknown evaluation (fixed: no other entity, no hidden risk id)", async () => {
      const h = await get("out", `/risk-evaluations/${EVAL.PERIM}/context`);
      const u = await get("out", `/risk-evaluations/${UNKNOWN}/context`);
      expect(h.text).not.toContain(R.PERIM);
      expect(norm(h, EVAL.PERIM)).toBe(norm(u, UNKNOWN));
    });

    it("the context of a readable evaluation still works (CLIENT, and a restricted one for a reader)", async () => {
      expect((await get("out", `/risk-evaluations/${EVAL.CLIENT}/context`)).status).toBe(200);
      expect((await get("own", `/risk-evaluations/${EVAL.PERIM}/context`)).status).toBe(200);
      expect((await get("rm", `/risk-evaluations/${EVAL.NOMIN}/context`)).status).toBe(200);
      expect((await get("named", `/risk-evaluations/${EVAL.NOMIN}/context`)).status).toBe(200);
    });

    // ---- defects found by QA, fixed in the V1 correction pass: plain tests since (they were it.fails)
    it("QA-VIS1-01: GET /raci?entityType=RISK&entityId=<hidden> answers like an unknown id (fixed: 200 [] for both)", async () => {
      const h = await get("out", `/raci?entityType=RISK&entityId=${R.PERIM}`);
      const u = await get("out", `/raci?entityType=RISK&entityId=${UNKNOWN}`);
      expect(norm(h, R.PERIM)).toBe(norm(u, UNKNOWN));
    });

    it("QA-VIS1-02 (fixed): ids of hidden risks do not leak through controls (coveredRiskIds), anomalies (riskId) and action plans (links) readable by an outsider", async () => {
      for (const path of ["/controls", "/anomalies", "/dashboard/anomalies", "/actions", `/actions/${I("740")}/links`]) {
        const t = (await get("out", path)).text;
        expect(t, path).not.toContain(R.PERIM);
        expect(t, path).not.toContain(R.NOMIN);
      }
    });

    it("QA-VIS1-02 (scope): the id exposure is limited to ids; no description / canary of a hidden risk is in controls, anomalies, actions", async () => {
      for (const path of ["/controls", "/anomalies", "/dashboard/anomalies", "/actions", `/actions/${I("740")}`, `/actions/${I("740")}/links`, "/kpis", "/notifications"]) {
        const t = (await get("out", path)).text;
        expect(t, path).not.toContain("CANARY-PERIM");
        expect(t, path).not.toContain("CANARY-NOMIN");
      }
    });

    it("notifications and audit-log: nothing about a hidden risk; audit.read only in the Audit group", async () => {
      for (const who of WHO) {
        const n = await get(who, "/notifications");
        expect(n.text, who).not.toContain("CANARY");
        const a = await get(who, "/audit-log");
        expect(a.status, `${who} /audit-log`).toBe(who === "aud" ? 200 : 403);
      }
      for (const q of ["?entityType=Risk", `?entityType=Risk&entityId=${R.NOMIN}`, "?action=CREATE"]) {
        for (const who of WHO.filter((w) => w !== "aud")) expect((await get(who, `/audit-log${q}`)).status, `${who} ${q}`).toBe(403);
      }
    });

    it("the Audit group sees the restricted risks through the audit log too (Audit sees all, DECISION-102)", async () => {
      expect((await get("aud", `/risks/${R.NOMIN}`)).status).toBe(200);
      expect((await get("com", `/risks/${R.NOMIN}`)).status).toBe(200);
    });

    it("unauthenticated and forged tokens: 401 on a restricted risk and on its children", async () => {
      for (const p of [`/risks/${R.PERIM}`, `/kris/${KRI.PERIM}`, `/risk-evaluations/${EVAL.PERIM}`, "/risks"]) {
        expect((await call(null, "GET", p)).status, p).toBe(401);
        const r = await fetch(API + p, { headers: { authorization: "Bearer forged.token.value" } });
        expect(r.status, p).toBe(401);
      }
    });

    it("another tenant: a user of an unrelated tenant reads nothing (tenant scope still holds with the new function)", async () => {
      await sql("INSERT INTO tenants (id, name) VALUES ($1, 'Autre tenant V1') ON CONFLICT DO NOTHING", [I("0f1")]);
      const f = await sql<{ v: boolean }>("SELECT risk_visible_to($1::uuid, $2::uuid, $3::uuid) AS v", [I("0f1"), R.PERIM, I("101")]);
      expect(f[0]!.v).toBe(false); // the owner id under a foreign tenant id: false
      const g = await sql<{ v: boolean }>("SELECT risk_visible_to($1::uuid, $2::uuid, $3::uuid) AS v", [I("001"), R.PERIM, I("101")]);
      expect(g[0]!.v).toBe(true);
    });

    it("risk_visible_to on the real function: soft-deleted group / revoked seat / revoked grant widen nothing", async () => {
      const v = async (u: string, r: string) => (await sql<{ v: boolean }>("SELECT risk_visible_to($1::uuid, $2::uuid, $3::uuid) AS v", [I("001"), r, u]))[0]!.v;
      await sql("UPDATE user_roles SET revoked_at = now() WHERE user_id = $1 AND role_id = $2", [I("105"), I("301")]);
      expect(await v(I("105"), R.PERIM)).toBe(false);
      await sql("UPDATE user_roles SET revoked_at = NULL WHERE user_id = $1 AND role_id = $2", [I("105"), I("301")]);
      expect(await v(I("105"), R.PERIM)).toBe(true);
      await sql("UPDATE roles SET deleted_at = now() WHERE id = $1", [I("301")]);
      expect(await v(I("105"), R.PERIM)).toBe(false);
      await sql("UPDATE roles SET deleted_at = NULL WHERE id = $1", [I("301")]);
      expect(await v(I("105"), R.PERIM)).toBe(true);
      // the Finance group does NOT open the NOMINATIF risk; N+1/RACI/process owner neither
      for (const u of ["102", "103", "104", "105"]) expect(await v(I(u), R.NOMIN), u).toBe(false);
      // a role merely NAMED "Risk Manager" (no system_group) opens nothing
      await sql("INSERT INTO roles (id, tenant_id, name, permissions) VALUES ($1, $2, 'Risk Manager (copie)', '{risk.read}')", [I("3f1"), I("001")]);
      await sql("INSERT INTO user_roles (tenant_id, role_id, user_id, granted_by) VALUES ($1, $2, $3, $4)", [I("001"), I("3f1"), I("107"), I("10c")]);
      expect(await v(I("107"), R.NOMIN)).toBe(false);
    });
  });

  // ---------------------------------------------------------------------------------------------- CHG
  describe("CHG: creation and change of visibility", () => {
    const create = (who: Who, body: Record<string, unknown>) =>
      call(who, "POST", "/risks", { process: "CANARY-NEW-PROC", description: `CANARY-NEW-${Math.random().toString(36).slice(2, 8)}`, ...body }, { "Idempotency-Key": `k-${Math.random().toString(36).slice(2)}-${Date.now()}` });
    const audits = (id: string) => sql<{ action: string; reason: string | null; old_value: any; new_value: any; user_id: string }>("SELECT action, reason, old_value, new_value, user_id FROM audit_log WHERE entity_id::text = $1 ORDER BY timestamp", [id]);

    it("creation PERIMETRE with a named person: visible to the named person, not to an outsider; the list is recorded with the creator as author", async () => {
      const c = await create("dept", { visibility: "PERIMETRE", accessUserIds: [I("106")], ownerDepartmentId: I("201") });
      expect(c.status, c.text).toBe(201);
      const id = c.json.data.id as string;
      expect((await get("named", `/risks/${id}`)).status).toBe(200);
      expect((await get("out", `/risks/${id}`)).status).toBe(404);
      expect((await get("dept", `/risks/${id}/visibility`)).json.data).toMatchObject({ visibility: "PERIMETRE", accessUserIds: [I("106")], accessUsers: [{ id: I("106"), displayName: "QA named" }] }); // q205: names added to the contract
      const g = await sql<{ granted_by: string }>("SELECT granted_by FROM resource_access_grants WHERE resource_id = $1 AND revoked_at IS NULL", [id]);
      expect(g).toEqual([{ granted_by: I("105") }]);
      expect((await audits(id)).map((a) => a.action)).toContain("CREATE");
    });

    it("creation: the creator may not add themselves (400); a creator who would not see a NOMINATIF risk is refused (400); a list on CLIENT is refused (400)", async () => {
      expect((await create("dept", { visibility: "PERIMETRE", accessUserIds: [I("105")], ownerDepartmentId: I("201") })).status).toBe(400);
      expect((await create("out", { visibility: "NOMINATIF", accessUserIds: [I("106")] })).status).toBe(400);
      expect((await create("dept", { visibility: "CLIENT", accessUserIds: [I("106")] })).status).toBe(400);
      expect((await create("dept", { visibility: "SECRET" })).status).toBe(400);
      expect((await create("dept", { visibility: "PERIMETRE", accessUserIds: [UNKNOWN] })).status).toBe(400);
      expect((await create("dept", { visibility: "PERIMETRE", accessUserIds: ["not-a-uuid"] })).status).toBe(400);
      expect((await create("dept", { visibility: "PERIMETRE", accessUserIds: Array.from({ length: 51 }, (_, i) => I(`a${String(i).padStart(2, "0")}`)) })).status).toBe(400);
      expect((await create("dept", { visibility: null })).status).toBe(400);
    });

    it("creation NOMINATIF by a first-line creator who is not the owner and not on the list is refused (400): he would not see it", async () => {
      expect((await create("dept", { visibility: "NOMINATIF", accessUserIds: [I("106")], ownerDepartmentId: I("201") })).status).toBe(400);
    });

    it("creation PERIMETRE by a creator OUTSIDE the perimeter (owner is not set at creation) is refused (400); by a department member accepted", async () => {
      expect((await create("own", { visibility: "PERIMETRE", ownerDepartmentId: I("201") })).status).toBe(400);
      expect((await create("dept", { visibility: "PERIMETRE", ownerDepartmentId: I("201") })).status).toBe(201);
    });

    it("creation NOMINATIF by an RM (who sees everything) is accepted; an unrequested level is CLIENT; a client-supplied grantedBy is ignored", async () => {
      const c = await create("rm", { visibility: "NOMINATIF", accessUserIds: [I("106")], grantedBy: I("102") });
      expect(c.status, c.text).toBe(201);
      const g = await sql<{ granted_by: string }>("SELECT granted_by FROM resource_access_grants WHERE resource_id = $1", [c.json.data.id]);
      expect(g).toEqual([{ granted_by: I("109") }]);
      const d = await create("own", {});
      expect(d.status).toBe(201);
      expect((await get("out", `/risks/${d.json.data.id}`)).status).toBe(200);
    });

    it("creation idempotency: the same key with a different level is refused, the same payload replays", async () => {
      const key = `idem-${Date.now()}`;
      const body = { process: "P-idem", description: "D-idem", visibility: "PERIMETRE", ownerDepartmentId: I("201") };
      const a = await call("dept", "POST", "/risks", body, { "Idempotency-Key": key });
      const b = await call("dept", "POST", "/risks", body, { "Idempotency-Key": key });
      expect(a.status).toBe(201);
      expect([200, 201]).toContain(b.status);
      expect(b.json.data.id).toBe(a.json.data.id);
      const c = await call("dept", "POST", "/risks", { ...body, visibility: "CLIENT" }, { "Idempotency-Key": key });
      expect(c.status).toBe(400);
    });

    async function fresh(level: "PERIMETRE" | "NOMINATIF" = "PERIMETRE", list: string[] = [I("106")]) {
      const c = await create("rm", { visibility: level, accessUserIds: list, ownerDepartmentId: I("201") });
      expect(c.status, c.text).toBe(201);
      const id = c.json.data.id as string;
      await sql("UPDATE risks SET owner_id = $1 WHERE id = $2", [I("101"), id]); // 'own' becomes the owner
      return id;
    }

    it("who may change: a reader who is neither owner nor RM -> 403; a non-reader -> 404; the owner and the RM -> 200", async () => {
      const id = await fresh();
      const body = { visibility: "PERIMETRE", reason: "Motif de test" };
      expect((await call("named", "PUT", `/risks/${id}/visibility`, body)).status).toBe(403);
      expect((await call("out", "PUT", `/risks/${id}/visibility`, body)).status).toBe(404);
      expect((await call(null, "PUT", `/risks/${id}/visibility`, body)).status).toBe(401);
      expect((await call("own", "PUT", `/risks/${id}/visibility`, body)).status).toBe(200);
      expect((await call("rm", "PUT", `/risks/${id}/visibility`, body)).status).toBe(200);
      expect((await call("com", "PUT", `/risks/${id}/visibility`, body)).status).toBe(403); // Committee sees, never changes
      expect((await call("aud", "PUT", `/risks/${id}/visibility`, body)).status).toBe(403); // Audit sees, never changes
    });

    it("reason: missing, empty, blank, tab/newline only, 501 chars -> 400, nothing changed, nothing audited; 500 chars accepted", async () => {
      const id = await fresh();
      const before = (await audits(id)).length;
      for (const reason of [undefined, "", "   ", "\t\n", "x".repeat(501), 42 as unknown as string]) {
        const r = await call("own", "PUT", `/risks/${id}/visibility`, { visibility: "NOMINATIF", ...(reason === undefined ? {} : { reason }) });
        expect(r.status, JSON.stringify(reason)).toBe(400);
      }
      expect((await sql("SELECT visibility FROM risks WHERE id = $1", [id]))[0]).toEqual({ visibility: "PERIMETRE" });
      expect((await audits(id)).length).toBe(before);
      expect((await call("own", "PUT", `/risks/${id}/visibility`, { visibility: "PERIMETRE", reason: "x".repeat(500) })).status).toBe(200);
    });

    it("payload: unknown level, non-uuid, 51 ids, suspended / unknown / foreign user in addUserIds -> 400; self-add (owner and RM) -> 400", async () => {
      const id = await fresh();
      const ok = { visibility: "PERIMETRE", reason: "Motif" };
      expect((await call("own", "PUT", `/risks/${id}/visibility`, { ...ok, visibility: "SECRET" })).status).toBe(400);
      expect((await call("own", "PUT", `/risks/${id}/visibility`, { ...ok, addUserIds: ["x"] })).status).toBe(400);
      expect((await call("own", "PUT", `/risks/${id}/visibility`, { ...ok, addUserIds: Array.from({ length: 51 }, (_, i) => I(`b${String(i).padStart(2, "0")}`)) })).status).toBe(400);
      expect((await call("own", "PUT", `/risks/${id}/visibility`, { ...ok, addUserIds: [UNKNOWN] })).status).toBe(400);
      await sql("UPDATE users SET deleted_at = now() WHERE id = $1", [I("108")]);
      expect((await call("own", "PUT", `/risks/${id}/visibility`, { ...ok, addUserIds: [I("108")] })).status).toBe(400);
      await sql("UPDATE users SET deleted_at = NULL WHERE id = $1", [I("108")]);
      expect((await call("own", "PUT", `/risks/${id}/visibility`, { ...ok, addUserIds: [I("101")] })).status).toBe(400);
      expect((await call("rm", "PUT", `/risks/${id}/visibility`, { ...ok, addUserIds: [I("109")] })).status).toBe(400);
      expect((await call("own", "PUT", `/risks/${id}/visibility`, { ...ok, extra: 1 })).status).toBeLessThan(500);
      expect((await sql("SELECT count(*)::int AS n FROM resource_access_grants WHERE resource_id = $1 AND revoked_at IS NULL", [id]))[0]).toEqual({ n: 1 });
    });

    it("RM restricts with a list: one PERMISSION_CHANGE audit row (reason, before/after, widening TRUE since Codex P2 6: N+1 102 reads it only through the new list), no notification (RM)", async () => {
      const id = await fresh();
      await sql("DELETE FROM notifications WHERE true");
      const r = await call("rm", "PUT", `/risks/${id}/visibility`, { visibility: "NOMINATIF", addUserIds: [I("102")], reason: "Dossier sensible" });
      expect(r.status, r.text).toBe(200);
      expect(r.json.data.visibility).toBe("NOMINATIF");
      expect([...r.json.data.accessUserIds].sort((a: string, b: string) => a.localeCompare(b))).toEqual([I("102"), I("106")]);
      const a = (await audits(id)).filter((x) => x.action === "PERMISSION_CHANGE");
      expect(a).toHaveLength(1);
      expect(a[0]).toMatchObject({ reason: "Dossier sensible", user_id: I("109") });
      expect(a[0]!.old_value.visibility).toBe("PERIMETRE");
      expect(a[0]!.new_value).toMatchObject({ visibility: "NOMINATIF", widening: true }); // 102 was outside the PERIMETRE set (no N+1 on this risk): admitted = widening
      expect(await sql("SELECT 1 FROM notifications")).toHaveLength(0);
      // N+1 (102) is now on the list: reads; RACI user 103 (PERIMETRE only) no longer reads
      expect((await get("n1", `/risks/${id}`)).status).toBe(200);
      expect((await get("raci", `/risks/${id}`)).status).toBe(404);
    });

    it("revokeUserIds removes access immediately, with the revoker and reason recorded on the grant", async () => {
      const id = await fresh();
      const r = await call("rm", "PUT", `/risks/${id}/visibility`, { visibility: "NOMINATIF", revokeUserIds: [I("106")], reason: "Retrait" });
      expect(r.status).toBe(200);
      expect((await get("named", `/risks/${id}`)).status).toBe(404);
      expect((await sql("SELECT revoked_by, revoke_reason FROM resource_access_grants WHERE resource_id = $1 AND user_id = $2", [id, I("106")]))[0]).toEqual({ revoked_by: I("109"), revoke_reason: "Retrait" });
    });

    it("owner widens PERIMETRE -> CLIENT: allowed, list purged (and does not come back), exactly one notification per RM-group member, none to the owner / Committee / Audit, no risk content in it", async () => {
      const id = await fresh();
      await sql("DELETE FROM notifications WHERE true");
      const r = await call("own", "PUT", `/risks/${id}/visibility`, { visibility: "CLIENT", reason: "Plus sensible" });
      expect(r.status, r.text).toBe(200);
      expect(r.json.data).toMatchObject({ visibility: "CLIENT", accessUserIds: [], accessUsers: [] });
      expect((await get("out", `/risks/${id}`)).status).toBe(200);
      expect(await sql("SELECT 1 FROM resource_access_grants WHERE resource_id = $1 AND revoked_at IS NULL", [id])).toHaveLength(0);
      const n = await sql<{ recipient_user_id: string; event_type: string; resource_id: string; message: string }>("SELECT recipient_user_id, event_type, resource_id, message FROM notifications");
      // recipients = holders of resourcevisibility.set: the RM group + `adm`, whom this harness gives the right DIRECTLY (RoleService refuses that; see QA-VIS1-04)
      expect(n.map((x) => x.recipient_user_id).sort((a, b) => a.localeCompare(b))).toEqual([I("109"), I("10c")]);
      expect(n.every((x) => x.event_type === "RISK_VISIBILITY_WIDENED" && x.resource_id === id)).toBe(true);
      expect(n[0]!.message).not.toContain("CANARY");
      expect((await audits(id)).find((x) => x.action === "PERMISSION_CHANGE")!.new_value.widening).toBe(true);
      // RM notification visible through the API, to the RM only
      expect((await get("rm", "/notifications")).text).toContain("RISK_VISIBILITY_WIDENED");
      expect((await get("com", "/notifications")).text).not.toContain("RISK_VISIBILITY_WIDENED");
      // restricting again without a list: the old names did not come back
      expect((await call("rm", "PUT", `/risks/${id}/visibility`, { visibility: "PERIMETRE", reason: "Re-restreindre" })).status).toBe(200);
      expect((await get("named", `/risks/${id}`)).status).toBe(404);
      expect((await get("own", `/risks/${id}`)).status).toBe(200);
    });

    it("owner widens NOMINATIF -> PERIMETRE and adds a name at the same level: notified; owner narrows: notified too since q208 (DECISION-107); RM widens: not notified", async () => {
      const id = await fresh("NOMINATIF");
      const count = async () => (await sql<{ n: number }>("SELECT count(*)::int AS n FROM notifications WHERE resource_id = $1 AND recipient_user_id = $2", [id, I("109")]))[0]!.n;
      await sql("DELETE FROM notifications WHERE true");
      expect((await call("own", "PUT", `/risks/${id}/visibility`, { visibility: "NOMINATIF", addUserIds: [I("102")], reason: "Ajout" })).status).toBe(200);
      expect(await count()).toBe(1);
      expect((await call("own", "PUT", `/risks/${id}/visibility`, { visibility: "PERIMETRE", reason: "Elargir" })).status).toBe(200);
      expect(await count()).toBe(2);
      expect((await call("own", "PUT", `/risks/${id}/visibility`, { visibility: "NOMINATIF", reason: "Restreindre" })).status).toBe(200);
      expect(await count()).toBe(3); // q208 (DECISION-107): a restriction by the owner is reported too (RISK_VISIBILITY_RESTRICTED)
      expect((await sql<{ event_type: string }>("SELECT event_type FROM notifications WHERE resource_id = $1 AND recipient_user_id = $2 ORDER BY sent_at, id", [id, I("109")])).map((r) => r.event_type)).toEqual(["RISK_VISIBILITY_WIDENED", "RISK_VISIBILITY_WIDENED", "RISK_VISIBILITY_RESTRICTED"]);
      expect((await call("rm", "PUT", `/risks/${id}/visibility`, { visibility: "CLIENT", reason: "RM ouvre" })).status).toBe(200);
      expect(await count()).toBe(3);
    });

    it("a notification failure does not undo the change (best effort): RM group with no member to notify still gives 200", async () => {
      const id = await fresh();
      await sql("UPDATE user_roles SET revoked_at = now() WHERE user_id = $1 AND role_id IN (SELECT id FROM roles WHERE system_group = 'RISK_MANAGER')", [I("109")]);
      try {
        const r = await call("own", "PUT", `/risks/${id}/visibility`, { visibility: "CLIENT", reason: "Sans destinataire" });
        expect(r.status).toBe(200);
        expect((await sql("SELECT visibility FROM risks WHERE id = $1", [id]))[0]).toEqual({ visibility: "CLIENT" });
      } finally {
        await sql("UPDATE user_roles SET revoked_at = NULL WHERE user_id = $1", [I("109")]);
      }
    });

    it("same change twice: second call answers 200 and leaves no duplicate active grant (unique index holds)", async () => {
      const id = await fresh();
      const b = { visibility: "PERIMETRE", addUserIds: [I("102")], reason: "Deux fois" };
      expect((await call("rm", "PUT", `/risks/${id}/visibility`, b)).status).toBe(200);
      const second = await call("rm", "PUT", `/risks/${id}/visibility`, b);
      expect(second.status, second.text).toBeLessThan(500);
      expect((await sql<{ n: number }>("SELECT count(*)::int AS n FROM resource_access_grants WHERE resource_id = $1 AND user_id = $2 AND revoked_at IS NULL", [id, I("102")]))[0]!.n).toBe(1);
    });

    it("concurrency: owner and RM change the same risk at once -> both answer < 500, final level is one of the two, grants consistent", async () => {
      const id = await fresh();
      const [a, b] = await Promise.all([
        call("own", "PUT", `/risks/${id}/visibility`, { visibility: "CLIENT", reason: "Concurrent A" }),
        call("rm", "PUT", `/risks/${id}/visibility`, { visibility: "NOMINATIF", addUserIds: [I("102")], reason: "Concurrent B" }),
      ]);
      expect(a.status).toBeLessThan(500);
      expect(b.status).toBeLessThan(500);
      const level = (await sql<{ visibility: string }>("SELECT visibility FROM risks WHERE id = $1", [id]))[0]!.visibility;
      expect(["CLIENT", "NOMINATIF"]).toContain(level);
      const active = await sql<{ n: number }>("SELECT count(*)::int AS n FROM resource_access_grants WHERE resource_id = $1 AND revoked_at IS NULL", [id]);
      if (level === "CLIENT") expect(active[0]!.n, "CLIENT with an active list: grants would return silently").toBe(0);
      const state = (await get("rm", `/risks/${id}/visibility`)).json.data;
      expect(state.visibility).toBe(level);
      expect(state.accessUserIds.length).toBe(active[0]!.n);
    });

    it("an archived risk keeps its level; visibility cannot be changed through the generic PATCH /risks/:id", async () => {
      const id = await fresh();
      const r = await call("rm", "PATCH", `/risks/${id}`, { visibility: "CLIENT" });
      expect(r.status).toBeLessThan(500);
      expect((await sql("SELECT visibility FROM risks WHERE id = $1", [id]))[0]).toEqual({ visibility: "PERIMETRE" });
    });

    it("GET /risks/:id/visibility: the list is shown to readers only (hidden -> 404)", async () => {
      const id = await fresh();
      expect((await get("out", `/risks/${id}/visibility`)).status).toBe(404);
      expect((await get("named", `/risks/${id}/visibility`)).status).toBe(200);
    });
  });

  // ---------------------------------------------------------------------------------------------- Q203
  describe("Q203: audit.read reserved to the Audit group", () => {
    it("RoleService via HTTP: create / update an ordinary role carrying audit.read -> 400; the Audit group role is untouched", async () => {
      const c = await call("adm", "POST", "/roles", { name: "Lecteurs journal", permissions: ["audit.read"] });
      expect(c.status, c.text).toBe(400);
      const ok = await call("adm", "POST", "/roles", { name: "Lecteurs risques", permissions: ["risk.read"] });
      expect(ok.status, ok.text).toBeLessThan(300);
      const roleId = ok.json.data.id as string;
      const u = await call("adm", "PATCH", `/roles/${roleId}`, { permissions: ["risk.read", "audit.read"] });
      expect(u.status, u.text).toBe(400);
      expect((await sql<{ permissions: string[] }>("SELECT permissions FROM roles WHERE id = $1", [roleId]))[0]!.permissions).toEqual(["risk.read"]);
      expect(await sql("SELECT 1 FROM roles WHERE system_group = 'AUDIT' AND 'audit.read' = ANY (permissions)")).toHaveLength(1);
    });

    it("no ordinary route can attach audit.read to the Risk Manager / Committee group (RoleService rules)", async () => {
      const rows = await sql<{ id: string; system_group: string }>("SELECT id, system_group FROM roles WHERE system_group IN ('RISK_MANAGER','RISK_COMMITTEE')");
      for (const r of rows) {
        const res = await call("adm", "PATCH", `/roles/${r.id}`, { permissions: ["risk.read", "audit.read"] });
        expect(res.status, `${r.system_group}`).toBeGreaterThanOrEqual(400);
        expect(res.status).toBeLessThan(500);
      }
      expect(await sql("SELECT 1 FROM roles WHERE system_group IN ('RISK_MANAGER','RISK_COMMITTEE') AND 'audit.read' = ANY (permissions)")).toHaveLength(0);
    });

    it("assigning a role to a user: only Audit group members read the log (nothing else is enough)", async () => {
      const rows = await sql<{ id: string }>("SELECT id FROM roles WHERE name = 'Lecteurs risques' LIMIT 1");
      const a = await call("adm", "POST", `/roles/${rows[0]!.id}/assign`, { userId: I("107") });
      expect(a.status, a.text).toBeLessThan(500);
      expect((await get("out", "/audit-log")).status).toBe(403);
    });

    const mig = async (dbName: string, upTo: number) => {
      const admin = new Pool({ host: "127.0.0.1", port: PGPORT, user: "postgres", database: "postgres", max: 1 });
      await admin.query(`DROP DATABASE IF EXISTS ${dbName} WITH (FORCE)`);
      await admin.query(`CREATE DATABASE ${dbName}`);
      await admin.end();
      const psql = (args: string[]) => sh(PSQL, ["-X", "-q", "-v", "ON_ERROR_STOP=1", "-h", "127.0.0.1", "-p", String(PGPORT), "-U", "postgres", "-d", dbName, ...args]);
      try { psql(["-c", "CREATE ROLE grc_app_runtime NOLOGIN"]); } catch { /* exists cluster-wide */ }
      try { psql(["-c", "CREATE ROLE grc_migrator NOLOGIN"]); } catch { /* exists cluster-wide */ }
      psql(["-c", "CREATE TABLE schema_migrations (filename text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())"]);
      for (const f of readdirSync(MIG).filter((x) => x.endsWith(".sql") && !x.endsWith(".down.sql")).sort((a, b) => a.localeCompare(b))) {
        if (Number(f.slice(0, 3)) <= upTo) psql(["-1", "-f", join(MIG, f)]);
      }
      const p = new Pool({ host: "127.0.0.1", port: PGPORT, user: "postgres", database: dbName, max: 2 });
      return { psql, p, close: () => p.end() };
    };

    it("migration 081 up / down / up on a 080 base: strips audit.read from ordinary roles (deleted ones included) and users.roles, audits each removal by a suspended technical account, spares Audit and other audit.*", async () => {
      const { psql, p, close } = await mig("grc_qa_vv1_m081", 80);
      try {
        const T = I("001");
        await p.query("INSERT INTO tenants (id, name) VALUES ($1, 'T081')", [T]);
        await p.query("INSERT INTO roles (id, tenant_id, name, permissions, system_group) VALUES ($1,$2,'Audit','{audit.read,audit.mission.read}','AUDIT'), ($3,$2,'Ordinaire','{risk.read,audit.read,audit.mission.read}',NULL), ($4,$2,'Supprime','{audit.read}',NULL), ($5,$2,'Sans','{risk.read}',NULL)", [I("301"), T, I("302"), I("303"), I("304")]);
        await p.query("UPDATE roles SET deleted_at = now() WHERE id = $1", [I("303")]);
        await p.query("INSERT INTO users (id, tenant_id, email, display_name, roles) VALUES ($1,$2,'a@x.io','A','{audit.read,risk.read}'), ($3,$2,'b@x.io','B','{risk.read}')", [I("101"), T, I("102")]);
        const f = "081_audit_read_audit_group_only.sql";
        psql(["-1", "-f", join(MIG, f)]);
        const perms = async (id: string) => (await p.query("SELECT permissions FROM roles WHERE id = $1", [id])).rows[0].permissions as string[];
        expect(await perms(I("301"))).toEqual(["audit.read", "audit.mission.read"]);
        expect(await perms(I("302"))).toEqual(["risk.read", "audit.mission.read"]);
        expect(await perms(I("303"))).toEqual([]);
        expect(await perms(I("304"))).toEqual(["risk.read"]);
        expect((await p.query("SELECT roles FROM users WHERE id = $1", [I("101")])).rows[0].roles).toEqual(["risk.read"]);
        const rows = async () => (await p.query("SELECT a.entity_type, a.entity_id::text AS eid, a.reason, u.email, u.deleted_at IS NOT NULL AS suspended FROM audit_log a JOIN users u ON u.id = a.user_id WHERE a.request_id = 'migration:081' ORDER BY 1, 2")).rows;
        const first = await rows();
        expect(first.map((r) => `${r.entity_type}:${r.eid}`)).toEqual([`Role:${I("302")}`, `Role:${I("303")}`, `User:${I("101")}`]);
        expect(first.every((r) => r.email === "migration-081@system.invalid" && r.suspended)).toBe(true);
        expect(first.every((r) => /q203/.test(r.reason))).toBe(true);
        // idempotent: a second pass finds nothing
        psql(["-1", "-f", join(MIG, f)]);
        expect(await rows()).toEqual(first);
        // down: only forgets the migration record, never restores audit.read (q203)
        await p.query("INSERT INTO schema_migrations (filename) VALUES ($1) ON CONFLICT DO NOTHING", [f]);
        psql(["-f", join(MIG, "081_audit_read_audit_group_only.down.sql")]);
        expect((await p.query("SELECT 1 FROM schema_migrations WHERE filename = $1", [f])).rowCount).toBe(0);
        expect(await perms(I("302"))).toEqual(["risk.read", "audit.mission.read"]);
        // up again: still nothing to do, no new audit row, no restored right
        psql(["-1", "-f", join(MIG, f)]);
        expect(await rows()).toEqual(first);
        expect((await p.query("SELECT count(*)::int AS n FROM roles WHERE system_group IS DISTINCT FROM 'AUDIT' AND 'audit.read' = ANY (permissions)")).rows[0].n).toBe(0);
        // a tenant with nothing to strip gets no technical account
        const clean = await mig("grc_qa_vv1_m081b", 80);
        try {
          await clean.p.query("INSERT INTO tenants (id, name) VALUES ($1, 'T081b')", [T]);
          clean.psql(["-1", "-f", join(MIG, f)]);
          expect((await clean.p.query("SELECT count(*)::int AS n FROM users WHERE email = 'migration-081@system.invalid'")).rows[0].n).toBe(0);
        } finally { await clean.close(); }
      } finally { await close(); }
    }, 280000);

    it("migration 082 up / down / up on the full base: the function and the right come and go; Risk Manager groups audited; restricted levels survive the down", async () => {
      const f = "082_risk_visibility.sql";
      const psqlLive = (args: string[]) => sh(PSQL, ["-X", "-q", "-v", "ON_ERROR_STOP=1", "-h", "127.0.0.1", "-p", String(PGPORT), "-U", "postgres", "-d", DB, ...args]);
      const hasFn = async () => (await sql<{ n: number }>("SELECT count(*)::int AS n FROM pg_proc WHERE proname = 'risk_visible_to'"))[0]!.n;
      const rmPerms = async () => (await sql<{ permissions: string[] }>("SELECT permissions FROM roles WHERE system_group = 'RISK_MANAGER'"))[0]!.permissions;
      expect(await hasFn()).toBe(1);
      expect((await sql<{ proconfig: string[] }>("SELECT proconfig FROM pg_proc WHERE proname = 'risk_visible_to'"))[0]!.proconfig).toEqual(["search_path=pg_catalog, public, pg_temp"]);
      expect(await rmPerms()).toContain("resourcevisibility.set"); // inserted by the harness from FIXED_GROUP_PERMISSIONS, not by 082
      psqlLive(["-f", join(MIG, "082_risk_visibility.down.sql")]);
      expect(await hasFn()).toBe(0);
      psqlLive(["-1", "-f", join(MIG, f)]);
      expect(await hasFn()).toBe(1);
      expect(await rmPerms()).toContain("resourcevisibility.set");
      expect((await sql("SELECT visibility FROM risks WHERE id = $1", [R.NOMIN]))[0]).toEqual({ visibility: "NOMINATIF" });
      psqlLive(["-1", "-f", join(MIG, f)]); // idempotent
      expect(await hasFn()).toBe(1);
      // a real RM role created BEFORE 082 (without the right) gets it, audited by the suspended technical account
      const old = await mig("grc_qa_vv1_m082", 81);
      try {
        const T = I("001");
        await old.p.query("INSERT INTO tenants (id, name) VALUES ($1, 'T082')", [T]);
        await old.p.query("INSERT INTO roles (tenant_id, name, permissions, system_group) VALUES ($1,'RM','{risk.read}','RISK_MANAGER'), ($1,'Comite','{risk.read}','RISK_COMMITTEE')", [T]);
        old.psql(["-1", "-f", join(MIG, f)]);
        const perms = (await old.p.query("SELECT system_group, permissions FROM roles ORDER BY 1")).rows;
        expect(perms.find((r) => r.system_group === "RISK_MANAGER").permissions).toContain("resourcevisibility.set");
        expect(perms.find((r) => r.system_group === "RISK_COMMITTEE").permissions).not.toContain("resourcevisibility.set");
        const au = (await old.p.query("SELECT u.email, u.deleted_at IS NOT NULL AS suspended FROM audit_log a JOIN users u ON u.id = a.user_id WHERE a.request_id = 'migration:082'")).rows;
        expect(au).toEqual([{ email: "migration-082@system.invalid", suspended: true }]);
        old.psql(["-f", join(MIG, "082_risk_visibility.down.sql")]);
        expect((await old.p.query("SELECT permissions FROM roles WHERE system_group = 'RISK_MANAGER'")).rows[0].permissions).not.toContain("resourcevisibility.set");
        old.psql(["-1", "-f", join(MIG, f)]);
        expect((await old.p.query("SELECT permissions FROM roles WHERE system_group = 'RISK_MANAGER'")).rows[0].permissions).toContain("resourcevisibility.set");
      } finally { await old.close(); }
    }, 280000);
  });
});
