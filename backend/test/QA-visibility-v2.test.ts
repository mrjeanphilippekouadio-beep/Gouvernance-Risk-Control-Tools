import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { Pool } from "pg";

/**
 * QA-visibility-v2 (level 2): lot V2 of DECISION-100/102/103/105 (controls, anomalies, action plans, KPIs restrictable; migration 083).
 * Oracles written BEFORE running, from spec RM-V1-Visibilite-Ressources-spec.md §1 (inheritance), §3 (who reads), §5 (who changes). Not a Security /
 * Privacy / Compliance opinion.
 *
 * STATIC  migration 083 (7 functions pinned, no SECURITY DEFINER, down), every repository INSERT carries `visibility`, route / wiring / frontend contract.
 * LEAK    REAL server (tsx, AUTH_PROVIDER=local) on LOCAL PostgreSQL 16, real HTTP: 12 profiles of IDENTICAL read rights x every V2 object (3 levels +
 *         orphan PERIMETRE + inheriting anomalies / plans) x list, by id, /visibility, children (executions, effectiveness, evidences, KPI measures):
 *         canary strings (CANARY-V2-*) appear <=> the profile may read; a hidden id answers exactly like an unknown id; dashboards and counters.
 * XMOD    cross-module: write routes aimed at hidden objects answer like unknown ids (execution, effectiveness, anomaly, plan, KPI measure, RACI,
 *         validation, evidence delete / plan closure), ids of hidden objects inside readable ones, dangling source.
 * CREATE  level at creation (4 resources): persisted, refusals, no list at creation.
 * CHG     who changes (RM / owner / others), reason, payload, inheritance refusal, purge back to CLIENT, audit row, notifications, concurrency.
 * PERIM   department / process change on a restricted control or KPI: guard, reason, widening measured on effective readers, atomicity.
 * INHER   dynamic inheritance: toggling the parent (risk / control) moves the children at once, in both directions.
 *
 * Live part: QA_VIS2_LIVE=1 and the LOCAL cluster of tests/integration/qa-visibility-v1-setup.sh (127.0.0.1:55442, never a remote host).
 * A test marked `it.fails` documents a CONFIRMED defect (turn it into `it` when fixed).
 */
const ROOT = join(__dirname, "..", "..");
const live = process.env["QA_VIS2_LIVE"] === "1";
const PGPORT = 55442;
const DB = "grc_qa_vv2t";
const PORT = 8096;
const API = `http://127.0.0.1:${PORT}/api/v1`;
const I = (x: string) => `aaaaaaaa-0000-4000-8000-000000000${x}`;
const K = (x: string) => `aaaaaaaa-0000-4000-8000-00000000${x}`;
const UNKNOWN = I("9ff");
const read = (...p: string[]) => readFileSync(join(ROOT, ...p), "utf8");

// ================================================================================================ STATIC
describe("QA-visibility-v2 STATIC", () => {
  const up = read("database", "postgresql", "migrations", "083_resource_visibility_v2.sql");
  const down = read("database", "postgresql", "migrations", "083_resource_visibility_v2.down.sql");
  const FUNCS = ["visibility_sees_everything", "visibility_in_department_group", "visibility_granted", "control_visible_to", "kpi_visible_to", "anomaly_visible_to", "action_plan_visible_to"];

  it("083: 7 functions, each pins search_path with pg_temp LAST both inline and by ALTER FUNCTION, none SECURITY DEFINER", () => {
    expect((up.match(/CREATE OR REPLACE FUNCTION /g) ?? []).length).toBe(7);
    expect((up.match(/SET search_path = pg_catalog, public, pg_temp/g) ?? []).length).toBe(14);
    expect(up).not.toMatch(/SECURITY\s+DEFINER/i);
    for (const f of FUNCS) expect(up, f).toMatch(new RegExp(`ALTER FUNCTION ${f}\\(`));
    expect(up).not.toMatch(/pg_temp,\s*(pg_catalog|public)/);
  });
  it("083 down: drops the 7 functions (callers first) and removes its schema_migrations row; atomic", () => {
    for (const f of FUNCS) expect(down, f).toContain(f);
    expect(down).toMatch(/schema_migrations/);
    expect(down).toMatch(/BEGIN;/);
    expect(down.lastIndexOf("action_plan_visible_to")).toBeLessThan(down.lastIndexOf("visibility_granted"));
  });
  it("083 never reads users.roles for 'sees everything' (user_roles + system_group only) and never any DELETE / UPDATE", () => {
    const code = up.split("\n").filter((l) => !l.trim().startsWith("--")).join("\n");
    expect(code).not.toMatch(/users\.roles|u\.roles/);
    expect(code).not.toMatch(/\b(DELETE|UPDATE|INSERT)\b/);
  });
  it("every repository INSERT of a restrictable root writes the `visibility` column (a creation level must not fall back to the DB default)", () => {
    const dir = ["backend", "src", "infrastructure", "database", "postgres"];
    for (const f of ["PostgresControlRepository", "PostgresAnomalyRepository", "PostgresActionPlanRepository", "PostgresKpiRepository"]) {
      const src = read(...dir, `${f}.ts`);
      const m = /INSERT INTO (controls|anomalies|action_plans|kpis)\b[^`]*?`/s.exec(src);
      expect(m, f).not.toBeNull();
      expect(m![0], `${f} INSERT`).toMatch(/\bvisibility\b/);
    }
  });
  it("the four routers mount the generic visibility routes and accept `visibility` at creation only (not on PATCH: no mass assignment)", () => {
    for (const [f, update] of [["controls", "UpdateControlBody"], ["anomalies", ""], ["actionPlans", ""], ["kpis", "UpdateKpiBody"]] as const) {
      const src = read("backend", "src", "api", "v1", `${f}.routes.ts`);
      expect(src, f).toMatch(/mountVisibilityRoutes\(router,/);
      expect(src, f).toMatch(/visibility: VisibilityLevel\.optional\(\)/);
      if (update) expect(src, f).toMatch(new RegExp(`${update} = [A-Za-z]+Body\\.omit\\(\\{ visibility: true \\}\\)`));
    }
  });
  it("route file: ids are z.guid(), lists boundedArray(.,50), reason reasonText(500); no bare z.array", () => {
    const src = read("backend", "src", "api", "v1", "resourceVisibility.routes.ts");
    expect(src).toMatch(/boundedArray\(z\.guid\(\), MAX_ACCESS_CHANGE\)/);
    expect(src).toMatch(/MAX_ACCESS_CHANGE = 50/);
    expect(src).toMatch(/reasonText\(500\)/);
    expect(src).not.toMatch(/z\.array\(/);
  });
  it("resourcevisibility.set lives in the Risk Manager group only (never in Committee / Audit, never folded into a *.update)", () => {
    const f = read("backend", "src", "domain", "fixedGroupPermissions.ts");
    const blocks = f.split(/\n  (?=RISK_MANAGER|RISK_COMMITTEE|AUDIT)/);
    const holders = blocks.filter((b) => b.includes('"resourcevisibility.set"')).map((b) => b.slice(0, 14));
    expect(holders).toHaveLength(1);
    expect(holders[0]).toMatch(/^RISK_MANAGER/);
  });
  it("frontend: the generic card is on the four screens and calls /controls /anomalies /actions /kpis (id)/visibility", () => {
    const api = read("frontend", "src", "api", "visibility.ts");
    for (const p of ["/controls", "/anomalies", "/actions", "/kpis"]) expect(api, p).toContain(p);
    for (const [f, name] of [["controls/ControlsPage", "ResourceVisibilityCard"], ["anomalies/AnomaliesPage", "ResourceVisibilityCard"], ["actions/ActionPlansPage", "ResourceVisibilityCard"], ["indicators/KpiPage", "ResourceVisibilityCard"]] as const) {
      expect(read("frontend", "src", "features", `${f}.tsx`), f).toContain(name);
    }
  });
  it("the two new notification events are mandatory catalog entries", () => {
    const c = read("backend", "src", "domain", "notificationCatalog.ts");
    expect(c).toContain("ACTION_PLAN_VISIBILITY_WIDENED");
    expect(c).toContain("ANOMALY_VISIBILITY_WIDENED");
  });
  it("no V2 route can write the level through a generic body (no `visibility` in an UPDATE set of the 4 repositories)", () => {
    const dir = ["backend", "src", "infrastructure", "database", "postgres"];
    for (const f of ["PostgresControlRepository", "PostgresAnomalyRepository", "PostgresActionPlanRepository", "PostgresKpiRepository"]) {
      expect(read(...dir, `${f}.ts`), f).not.toMatch(/UPDATE (controls|anomalies|action_plans|kpis)[^`]*visibility/s);
    }
  });
});

// ================================================================================================ live
type Who = "own" | "n1" | "raci" | "pown" | "dept" | "named" | "out" | "out2" | "rm" | "com" | "aud" | "adm";
const WHO: Who[] = ["own", "n1", "raci", "pown", "dept", "named", "out", "out2", "rm", "com", "aud", "adm"];
const UID: Record<Who, string> = { own: I("101"), n1: I("102"), raci: I("103"), pown: I("104"), dept: I("105"), named: I("106"), out: I("107"), out2: I("108"), rm: I("109"), com: I("10a"), aud: I("10b"), adm: I("10c") };
const SEE_ALL: Who[] = ["rm", "com", "aud"];
const u = (...a: Array<readonly Who[]>): Who[] => [...new Set(a.flat())];
// spec §3, derived BEFORE running: who reads what.
const RISK_PERIM = u(["own", "n1", "raci", "pown", "dept", "named"], SEE_ALL); // risk 502 (owner own, N+1 n1, RACI raci, process owner pown, Finance group dept, list named)
const RISK_NOMIN = u(["own", "named"], SEE_ALL);
const CTL_PERIM = u(["raci", "pown", "dept", "named"], SEE_ALL); // control: Finance group + process owner + RACI + list (no owner account: `own` is NOT a reader)
const CTL_NOMIN = u(["named"], SEE_ALL);
const KPI_PERIM = u(["pown", "dept", "named"], SEE_ALL); // KPI: no RACI
const ALL = WHO;

interface Obj { id: string; canary: string; readers: readonly Who[] }
const obj = (id: string, canary: string, readers: readonly Who[]): Obj => ({ id, canary, readers });
const CONTROLS = [obj(I("c01"), "CANARY-V2-CTL-CLIENT", ALL), obj(I("c02"), "CANARY-V2-CTL-PERIM", CTL_PERIM), obj(I("c03"), "CANARY-V2-CTL-NOMIN", CTL_NOMIN), obj(I("c04"), "CANARY-V2-CTL-ORPHAN", SEE_ALL)];
const KPIS = [obj(K("9001"), "CANARY-V2-KPI-CLIENT", ALL), obj(K("9002"), "CANARY-V2-KPI-PERIM", KPI_PERIM), obj(K("9003"), "CANARY-V2-KPI-NOMIN", CTL_NOMIN)];
const ANOMALIES = [
  obj(I("d01"), "CANARY-V2-ANO-RISKHID", RISK_PERIM), // follows risk 502
  obj(I("d02"), "CANARY-V2-ANO-DECL-RISKHID", RISK_PERIM), // declarer `out`: the risk rule wins (QA_CHALLENGE-1)
  obj(I("d03"), "CANARY-V2-ANO-CTL", CTL_PERIM), // follows control c02
  obj(I("d04"), "CANARY-V2-ANO-PERIM", u(["dept", "named"], SEE_ALL)), // own PERIMETRE, no department: declarer (dept) + list
  obj(I("d05"), "CANARY-V2-ANO-NOMIN", u(["own", "named"], SEE_ALL)), // declarer own + list
  obj(I("d06"), "CANARY-V2-ANO-CLIENT", ALL), obj(I("d07"), "CANARY-V2-ANO-RISKCLIENT", ALL),
  obj(I("d08"), "CANARY-V2-ANO-IGNORED-OWN-LEVEL", ALL), // own level NOMINATIF but the risk (CLIENT) decides
  obj(I("d09"), "CANARY-V2-ANO-CITES-HIDDEN-CTL", ALL), // risk 501 CLIENT wins over the (hidden) control it cites
];
const PLANS = [
  obj(I("a01"), "CANARY-V2-PLAN-ASSIGNED", u(["out"], RISK_PERIM)), // responsible `out`, source risk 502
  obj(I("a02"), "CANARY-V2-PLAN-RISKHID", u(["own"], RISK_PERIM)),
  obj(I("a03"), "CANARY-V2-PLAN-CTLHID", u(["own"], CTL_PERIM)), // source control c02
  obj(I("a04"), "CANARY-V2-PLAN-KRIHID", u(["own"], RISK_PERIM)), // source KRI 720 -> risk 502
  obj(I("a06"), "CANARY-V2-PLAN-PERIM", u(["own", "raci", "dept", "named"], SEE_ALL)), // own PERIMETRE, department Finance, RACI raci, list named (no process owner on plans)
  obj(I("a07"), "CANARY-V2-PLAN-NOMIN", u(["own", "named"], SEE_ALL)),
  obj(I("a08"), "CANARY-V2-PLAN-CLIENT", ALL),
  obj(I("a09"), "CANARY-V2-PLAN-OUTNOM", u(["out"], SEE_ALL)), // responsible `out`, own NOMINATIF
  obj(I("a0a"), "CANARY-V2-PLAN-TOCLOSE", ALL), obj(I("a0b"), "CANARY-V2-PLAN-LINKS", ALL),
];
const EXECS = [
  { ...obj(I("b01"), "CANARY-V2-EXEC-ASSIGNED-PERIM", u(["out"], CTL_PERIM)), control: I("c02") }, // executor `out` ("ce qui m'est assigne")
  { ...obj(I("b02"), "CANARY-V2-EXEC-OWN-PERIM", u(["own"], CTL_PERIM)), control: I("c02") },
  { ...obj(I("b03"), "CANARY-V2-EXEC-NOMIN", u(["own"], CTL_NOMIN)), control: I("c03") },
  { ...obj(I("b04"), "CANARY-V2-EXEC-CLIENT", ALL), control: I("c01") },
];
const EFFS = [
  { ...obj(I("e01"), "CANARY-V2-EFF-PERIM", CTL_PERIM), control: I("c02") },
  { ...obj(I("e02"), "CANARY-V2-EFF-NOMIN", CTL_NOMIN), control: I("c03") },
  { ...obj(I("e03"), "CANARY-V2-EFF-CLIENT", ALL), control: I("c01") },
];
const EVIDS = [
  { ...obj(I("f01"), "CANARY-V2-EVID-PERIM.pdf", u(["own"], CTL_PERIM)), exec: I("b02") },
  { ...obj(I("f02"), "CANARY-V2-EVID-NOMIN.pdf", u(["own"], CTL_NOMIN)), exec: I("b03") },
  { ...obj(I("f03"), "CANARY-V2-EVID-ASSIGNED.pdf", u(["out"], CTL_PERIM)), exec: I("b01") },
];
const MEASURES = [
  { ...obj(KPIS[0]!.id, "CANARY-V2-KPIM-LIENT", ALL) }, { ...obj(KPIS[1]!.id, "CANARY-V2-KPIM-PERIM", KPI_PERIM) }, { ...obj(KPIS[2]!.id, "CANARY-V2-KPIM-NOMIN", CTL_NOMIN) },
];
const EVERYTHING = [...CONTROLS, ...KPIS, ...ANOMALIES, ...PLANS, ...EXECS, ...EFFS, ...EVIDS, ...MEASURES];

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
const put = (who: Who, path: string, body: unknown) => call(who, "PUT", path, body);
const post = (who: Who, path: string, body: unknown) => call(who, "POST", path, body);
const patch = (who: Who, path: string, body: unknown) => call(who, "PATCH", path, body);
const norm = (r: Res, ...ids: string[]) => `${r.status} ${ids.reduce((t, id) => t.replaceAll(id, "<id>"), r.text).replace(/"requestId":"[^"]*"/, "")}`;
const ids = (r: Res): string[] => ((r.json?.data ?? []) as Array<{ id: string }>).map((x) => x.id);
const audits = (id: string) => sql<{ action: string; reason: string | null; old_value: any; new_value: any; user_id: string; entity_type: string }>(
  "SELECT action, reason, old_value, new_value, user_id, entity_type FROM audit_log WHERE entity_id::text = $1 ORDER BY timestamp, id", [id]);
const grants = (type: string, id: string) => sql<{ user_id: string; revoked_at: Date | null; revoke_reason: string | null }>(
  "SELECT user_id, revoked_at, revoke_reason FROM resource_access_grants WHERE resource_type = $1 AND resource_id = $2 ORDER BY granted_at, id", [type, id]);
const active = async (type: string, id: string) => (await grants(type, id)).filter((g) => !g.revoked_at).map((g) => g.user_id);
const level = async (table: string, id: string) => (await sql<{ visibility: string }>(`SELECT visibility FROM ${table} WHERE id = $1`, [id]))[0]?.visibility;
const notifs = (who: Who, resourceId: string) => sql<{ event_type: string; message: string }>(
  "SELECT event_type, message FROM notifications WHERE recipient_user_id = $1 AND resource_id = $2", [UID[who], resourceId]);

const controlBody = (over: Record<string, unknown> = {}) => ({ label: "Controle QA V2 cree", coveredRiskIds: [I("501")], controlType: "PREVENTIVE", frequency: "MONTHLY", executor: "x", complianceCriteria: "y", ...over });
const kpiBody = (over: Record<string, unknown> = {}) => ({ label: "KPI QA V2 cree", targetValue: 10, unit: "%", frequency: "MONTHLY", owner: "x", departmentId: I("201"), ...over });
const anomalyBody = (over: Record<string, unknown> = {}) => ({ description: "Anomalie QA V2 creee", severity: "LOW", ...over });
const planBody = (over: Record<string, unknown> = {}) => ({ title: "Plan QA V2 cree", sourceType: "MANAGEMENT", responsibleUserId: UID.own, departmentId: I("201"), dueDate: "2027-06-30", ...over });

describe.skipIf(!live)("QA-visibility-v2 on the REAL server + LOCAL PostgreSQL 16", () => {
  beforeAll(async () => {
    sh("bash", [join(ROOT, "tests", "integration", "qa-visibility-v2-setup.sh"), "up", DB]);
    sh("bash", [join(ROOT, "tests", "integration", "qa-visibility-v2-server.sh"), "start"], { QA_PORT: String(PORT), QA_DB: DB });
    pg = new Pool({ host: "127.0.0.1", port: PGPORT, user: "postgres", database: DB, max: 4 });
    // Read rights stay IDENTICAL for every profile (only the visibility rules may differ); write rights go to the accounts that need them.
    await sql("UPDATE users SET roles = roles || ARRAY['execution.read','effectiveness.read','evidence.read']::text[]");
    await sql("UPDATE users SET roles = roles || ARRAY['execution.create','execution.validate','effectiveness.create','effectiveness.validate','anomaly.create','anomaly.update','actionplan.create','actionplan.update','kpi.create','kpi.update','control.create','control.update','raci.assign','evidence.delete','actionplan.validate','kpi.delete','control.delete']::text[] WHERE email IN ('out@vv1.test','out2@vv1.test')");
    await sql("UPDATE users SET roles = roles || ARRAY['control.create','control.update','kpi.create','kpi.update','anomaly.create','anomaly.update','actionplan.create','actionplan.update']::text[] WHERE email IN ('dept@vv1.test','own@vv1.test','named@vv1.test')");
    await sql("UPDATE users SET roles = roles || ARRAY['control.create','kpi.create']::text[] WHERE email = 'pown@vv1.test'");
    // a second tenant with one user (foreign-tenant user in addUserIds)
    await sql("INSERT INTO tenants (id, name) VALUES ($1, 'Autre tenant QA V2') ON CONFLICT DO NOTHING", [I("f00")]);
    await sql("INSERT INTO users (id, tenant_id, email, display_name, roles) VALUES ($1, $2, 'foreign@vv2.test', 'Foreign', '{}') ON CONFLICT DO NOTHING", [I("f10"), I("f00")]);
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

  // ---------------------------------------------------------------------------------------------- LEAK
  describe("LEAK: 12 profiles x every V2 object", () => {
    const KINDS: Array<{ name: string; list: string; objs: Obj[]; path: (id: string) => string }> = [
      { name: "controls", list: "/controls", objs: CONTROLS, path: (id) => `/controls/${id}` },
      { name: "anomalies", list: "/anomalies", objs: ANOMALIES, path: (id) => `/anomalies/${id}` },
      { name: "actions", list: "/actions", objs: PLANS, path: (id) => `/actions/${id}` },
      { name: "kpis", list: "/kpis", objs: KPIS, path: (id) => `/kpis/${id}` },
    ];
    for (const who of WHO) {
      for (const kind of KINDS) {
        it(`${who}: ${kind.name} list / by id / visibility card match the spec (canary iff readable; hidden id == unknown id)`, async () => {
          const list = await get(who, kind.list);
          expect(list.status, `${who} ${kind.list}`).toBe(200);
          for (const o of kind.objs) {
            const sees = o.readers.includes(who);
            expect(list.text.includes(o.canary), `${who} list ${o.canary}`).toBe(sees);
            for (const suffix of ["", "/visibility"]) {
              const r = await get(who, kind.path(o.id) + suffix);
              if (sees) { expect(r.status, `${who} ${kind.path(o.id)}${suffix}`).toBe(200); continue; }
              const unk = await get(who, kind.path(UNKNOWN) + suffix);
              expect(r.text, `${who} ${kind.path(o.id)}${suffix}`).not.toContain(o.canary);
              expect(norm(r, o.id), `${who} ${kind.path(o.id)}${suffix} vs unknown`).toBe(norm(unk, UNKNOWN));
            }
          }
        });
      }
      it(`${who}: children (executions, effectiveness, evidences, KPI measures) follow their parent; the executor keeps their own execution`, async () => {
        for (const c of CONTROLS.slice(0, 3)) {
          const ex = await get(who, `/executions?controlId=${c.id}`);
          for (const e of EXECS.filter((x) => x.control === c.id)) expect(ex.text.includes(e.canary), `${who} exec list ${e.canary}`).toBe(e.readers.includes(who));
          const ef = await get(who, `/effectiveness?controlId=${c.id}`);
          for (const e of EFFS.filter((x) => x.control === c.id)) expect(ef.text.includes(e.canary), `${who} eff list ${e.canary}`).toBe(e.readers.includes(who));
        }
        for (const e of EXECS) {
          const sees = e.readers.includes(who);
          const r = await get(who, `/executions/${e.id}`);
          if (sees) expect(r.status, `${who} execution ${e.canary}`).toBe(200);
          else expect(norm(r, e.id), `${who} exec ${e.canary}`).toBe(norm(await get(who, `/executions/${UNKNOWN}`), UNKNOWN));
          const ev = await get(who, `/evidences?controlExecutionId=${e.id}`);
          for (const f of EVIDS.filter((x) => x.exec === e.id)) expect(ev.text.includes(f.canary), `${who} evidences of ${e.canary}`).toBe(f.readers.includes(who));
        }
        for (const e of EFFS) {
          const r = await get(who, `/effectiveness/${e.id}`);
          if (e.readers.includes(who)) expect(r.status, `${who} ${e.canary}`).toBe(200);
          else expect(norm(r, e.id), `${who} ${e.canary}`).toBe(norm(await get(who, `/effectiveness/${UNKNOWN}`), UNKNOWN));
        }
        for (const f of EVIDS) {
          const r = await get(who, `/evidences/${f.id}/url`);
          if (!f.readers.includes(who)) expect(norm(r, f.id), `${who} url ${f.canary}`).toBe(norm(await get(who, `/evidences/${UNKNOWN}/url`), UNKNOWN));
          else expect(r.status, `${who} url ${f.canary}`).not.toBe(404); // visible: 500 here (no Drive in the local provider), never 404
        }
        for (const m of MEASURES) {
          const r = await get(who, `/kpi-measures?kpiId=${m.id}`);
          expect(r.text.includes(m.canary), `${who} measures ${m.canary}`).toBe(m.readers.includes(who));
          if (!m.readers.includes(who)) expect(norm(r, m.id), `${who} measures hidden`).toBe(norm(await get(who, `/kpi-measures?kpiId=${UNKNOWN}`), UNKNOWN));
        }
      });
      it(`${who}: links and RACI of hidden entities answer like unknown ones`, async () => {
        for (const p of PLANS) {
          if (p.readers.includes(who)) continue;
          const r = await get(who, `/actions/${p.id}/links`);
          expect(norm(r, p.id)).toBe(norm(await get(who, `/actions/${UNKNOWN}/links`), UNKNOWN));
          const raci = await get(who, `/raci?entityType=ACTION_PLAN&entityId=${p.id}`);
          expect(norm(raci, p.id), `${who} raci plan ${p.canary}`).toBe(norm(await get(who, `/raci?entityType=ACTION_PLAN&entityId=${UNKNOWN}`), UNKNOWN));
        }
        for (const c of CONTROLS) {
          if (c.readers.includes(who)) continue;
          expect(norm(await get(who, `/controls/${c.id}/raci`), c.id), `${who} control raci`).toBe(norm(await get(who, `/controls/${UNKNOWN}/raci`), UNKNOWN));
          expect(norm(await get(who, `/raci?entityType=CONTROL&entityId=${c.id}`), c.id), `${who} raci control`).toBe(norm(await get(who, `/raci?entityType=CONTROL&entityId=${UNKNOWN}`), UNKNOWN));
        }
      });
    }

    it("no canary of an object the profile cannot read appears in ANY collection / dashboard / report / risk sheet (12 profiles x 14 routes)", async () => {
      const routes = [
        "/controls", "/anomalies", "/actions", "/kpis", "/dashboard/anomalies", "/dashboard/actions", "/dashboard/executive", "/dashboard/risks", "/dashboard/risk-owner",
        `/dashboard/department/${I("201")}`, "/reports/consolidated", "/reports/risk-committee", `/risks/${I("501")}/360`, `/controls?coveringRiskId=${I("501")}`,
      ];
      for (const who of WHO) {
        for (const route of routes) {
          const t = (await get(who, route)).text;
          for (const o of EVERYTHING) if (!o.readers.includes(who)) expect(t.includes(o.canary), `${who} ${route} leaks ${o.canary}`).toBe(false);
        }
      }
    });

    it("risk sheet (360) and covering list show exactly the controls / plans linked to the risk that the profile reads", async () => {
      for (const who of WHO) {
        const cov = await get(who, `/controls?coveringRiskId=${I("501")}`);
        for (const c of CONTROLS.filter((x) => x.id === I("c02") || x.id === I("c03"))) expect(cov.text.includes(c.canary), `${who} covering ${c.canary}`).toBe(c.readers.includes(who));
        const sheet = await get(who, `/risks/${I("501")}/360`);
        expect(sheet.status).toBe(200);
        for (const o of [CONTROLS[1]!, CONTROLS[2]!, PLANS.find((p) => p.id === I("a06"))!, PLANS.find((p) => p.id === I("a07"))!]) {
          if (!o.readers.includes(who)) expect(sheet.text.includes(o.canary), `${who} 360 ${o.canary}`).toBe(false);
        }
      }
    });

    it("COUNTERS (SEC V1-03): openAnomaliesCount, /dashboard/anomalies and /dashboard/actions count only what the profile reads", async () => {
      for (const who of WHO) {
        // V1 jeu: 3 anomalies (risks 501 CLIENT / 502 PERIM / 503 NOMIN) and 3 plans (responsible own, source = those risks)
        const v1An = 1 + (RISK_PERIM.includes(who) ? 1 : 0) + (RISK_NOMIN.includes(who) ? 1 : 0);
        const wantAn = ANOMALIES.filter((a) => a.readers.includes(who)).length + v1An;
        const wantPlans = PLANS.filter((p) => p.readers.includes(who)).length + v1An + (who === "own" ? 3 - v1An : 0);
        const ex = await get(who, "/dashboard/executive");
        expect(ex.json.data.openAnomaliesCount, `${who} executive anomalies`).toBe(wantAn);
        expect(ids(await get(who, "/dashboard/anomalies")).length, `${who} dashboard anomalies`).toBe(wantAn);
        expect(ids(await get(who, "/anomalies")).length, `${who} list anomalies`).toBe(wantAn);
        expect(ids(await get(who, "/actions")).length, `${who} list actions`).toBe(wantPlans);
        expect(ids(await get(who, "/dashboard/actions")).length, `${who} dashboard actions`).toBe(wantPlans);
      }
    });
  });

  // ---------------------------------------------------------------------------------------------- helpers for the mutating blocks
  const setVis = (who: Who, path: string, visibility: string, addUserIds: string[] = [], revokeUserIds: string[] = [], reason = "Motif QA V2") =>
    put(who, `${path}/visibility`, { visibility, addUserIds, revokeUserIds, reason });
  async function mk(kind: "control" | "kpi" | "anomaly" | "plan", level: "CLIENT" | "PERIMETRE" | "NOMINATIF", list: string[] = [], over: Record<string, unknown> = {}, by: Who = "rm") {
    const route = { control: "/controls", kpi: "/kpis", anomaly: "/anomalies", plan: "/actions" }[kind];
    const body = { control: controlBody, kpi: kpiBody, anomaly: anomalyBody, plan: planBody }[kind]({ visibility: level, ...over });
    const r = await post(by, route, body);
    expect(r.status, `${kind} ${r.text}`).toBe(201);
    const id = r.json.data.id as string;
    if (list.length) expect((await setVis("rm", `${route}/${id}`, level, list)).status).toBe(200);
    return { id, route };
  }
  const TABLE = { control: "controls", kpi: "kpis", anomaly: "anomalies", plan: "action_plans" } as const;
  const TYPE = { control: "CONTROL", kpi: "KPI", anomaly: "ANOMALY", plan: "ACTION_PLAN" } as const;
  const ENTITY = { control: "Control", kpi: "Kpi", anomaly: "Anomaly", plan: "ActionPlan" } as const;
  const changes = async (id: string) => (await audits(id)).filter((a) => a.action === "PERMISSION_CHANGE");

  // ---------------------------------------------------------------------------------------------- XMOD
  describe("XMOD: cross-module", () => {
    it("write routes aimed at a hidden object answer exactly like an unknown id (no oracle through POST / PATCH / validate / delete); the same body on a readable one works", async () => {
      const cases: Array<{ name: string; m: string; path: (id: string) => string; body?: (id: string) => unknown; hidden: string; ok?: string }> = [
        { name: "POST execution", m: "POST", path: () => "/executions", body: (id) => ({ controlId: id, status: "DONE" }), hidden: I("c02"), ok: I("c01") },
        { name: "POST effectiveness", m: "POST", path: () => "/effectiveness", body: (id) => ({ controlId: id, operationalEffectiveness: "EFFECTIVE", justification: "x" }), hidden: I("c02"), ok: I("c01") },
        { name: "POST anomaly -> control", m: "POST", path: () => "/anomalies", body: (id) => anomalyBody({ controlId: id }), hidden: I("c02"), ok: I("c01") },
        { name: "POST anomaly -> risk", m: "POST", path: () => "/anomalies", body: (id) => anomalyBody({ riskId: id }), hidden: I("502"), ok: I("501") },
        { name: "POST anomaly -> execution", m: "POST", path: () => "/anomalies", body: (id) => anomalyBody({ controlExecutionId: id }), hidden: I("b02"), ok: I("b04") },
        { name: "POST plan from control", m: "POST", path: () => "/actions", body: (id) => planBody({ sourceType: "CONTROL", sourceId: id, departmentId: null, responsibleUserId: UID.out2 }), hidden: I("c02"), ok: I("c01") },
        { name: "POST plan from risk", m: "POST", path: () => "/actions", body: (id) => planBody({ sourceType: "RISK", sourceId: id, departmentId: null, responsibleUserId: UID.out2 }), hidden: I("502"), ok: I("501") },
        { name: "POST plan from KRI", m: "POST", path: () => "/actions", body: (id) => planBody({ sourceType: "KRI", sourceId: id, departmentId: null, responsibleUserId: UID.out2 }), hidden: I("720"), ok: I("620") },
        { name: "POST kpi measure", m: "POST", path: () => "/kpi-measures", body: (id) => ({ kpiId: id, period: "2026-02-01", value: 1 }), hidden: K("9002"), ok: K("9001") },
        { name: "POST raci control", m: "POST", path: () => "/raci", body: (id) => ({ entityType: "CONTROL", entityId: id, userId: UID.out, role: "C" }), hidden: I("c02"), ok: I("c01") },
        { name: "POST raci plan", m: "POST", path: () => "/raci", body: (id) => ({ entityType: "ACTION_PLAN", entityId: id, userId: UID.out, role: "C" }), hidden: I("a02"), ok: I("a08") },
        { name: "PATCH control", m: "PATCH", path: (id) => `/controls/${id}`, body: () => ({ label: "x" }), hidden: I("c02"), ok: I("c01") },
        { name: "PATCH kpi", m: "PATCH", path: (id) => `/kpis/${id}`, body: () => ({ label: "x" }), hidden: K("9002"), ok: K("9001") },
        { name: "PATCH anomaly status", m: "PATCH", path: (id) => `/anomalies/${id}/status`, body: () => ({ status: "UNDER_ANALYSIS" }), hidden: I("d01"), ok: I("d06") },
        { name: "PATCH plan progress", m: "PATCH", path: (id) => `/actions/${id}/progress`, body: () => ({ progressPercent: 10 }), hidden: I("a06"), ok: I("a08") },
        { name: "PATCH plan start", m: "PATCH", path: (id) => `/actions/${id}/start`, body: () => ({}), hidden: I("a06"), ok: I("a0b") },
        { name: "POST plan links", m: "POST", path: (id) => `/actions/${id}/links`, body: () => ({ links: [] }), hidden: I("a06") },
        { name: "POST execution validate", m: "POST", path: (id) => `/executions/${id}/validate`, body: () => ({}), hidden: I("b02") },
        { name: "POST effectiveness validate", m: "POST", path: (id) => `/effectiveness/${id}/validate`, body: () => ({}), hidden: I("e01") },
        { name: "DELETE evidence", m: "DELETE", path: (id) => `/evidences/${id}`, hidden: I("f05") },
        { name: "POST kpi archive", m: "POST", path: (id) => `/kpis/${id}/archive`, body: () => ({ reason: "motif" }), hidden: K("9002") },
        { name: "POST control archive", m: "POST", path: (id) => `/controls/${id}/archive`, body: () => ({ reason: "motif" }), hidden: I("c02") },
      ];
      const results: string[] = [];
      for (const c of cases) {
        const unk = await call("out2", c.m, c.path(UNKNOWN), c.body?.(UNKNOWN));
        // not vacuous: the unknown id is refused on the NOT-FOUND branch (not on a validation error)
        expect(unk.status, `${c.name} unknown`).toBeGreaterThanOrEqual(400);
        expect(unk.text, `${c.name} unknown`).toMatch(/not found|does not exist/i);
        const h = await call("out2", c.m, c.path(c.hidden), c.body?.(c.hidden));
        if (norm(h, c.hidden) !== norm(unk, UNKNOWN)) results.push(`${c.name}: hidden=${h.status} ${h.text.slice(0, 90)} | unknown=${unk.status}`);
      }
      expect(results).toEqual([]);
      // the readable counterpart is accepted with the very same body (the refusal above is about visibility, not about the body)
      for (const c of cases.filter((x) => x.ok && x.m === "POST" && x.path("") !== "")) {
        const r = await call("out2", c.m, c.path(c.ok!), c.body?.(c.ok!));
        expect(r.status, `${c.name} on a readable object: ${r.text.slice(0, 120)}`).toBeLessThan(300);
      }
    });

    it.fails("QA-VIS2-01 (MINOR, existence oracle + proof from a hidden execution): plan closure with the evidence of a HIDDEN execution answers like an unknown evidence (no link to an evidence the closer cannot read)", async () => {
      const unk = await call("out2", "PATCH", `/actions/${I("a0a")}/close`, { evidenceId: UNKNOWN });
      expect(unk.status).toBe(400);
      expect(unk.text).toMatch(/does not exist/);
      const hid = await call("out2", "PATCH", `/actions/${I("a0a")}/close`, { evidenceId: I("f01") });
      expect(norm(hid, I("f01")), `hidden evidence accepted? ${hid.text.slice(0, 160)}`).toBe(norm(unk, UNKNOWN));
      expect((await sql("SELECT status, evidence_id FROM action_plans WHERE id = $1", [I("a0a")]))[0]).toMatchObject({ status: "PLANIFIEE", evidence_id: null });
    });

    it.fails("QA-VIS2-02 (MINOR): a readable anomaly that cites a hidden control / execution does not hand their ids to an outsider", async () => {
      const t = (await get("out", `/anomalies/${I("d09")}`)).text;
      expect(t).not.toContain(I("c03"));
      expect(t).not.toContain(I("b03"));
    });
    it.fails("QA-VIS2-02 (MINOR): same through the list and the dashboard", async () => {
      for (const p of ["/anomalies", "/dashboard/anomalies"]) {
        const t = (await get("out", p)).text;
        expect(t, p).not.toContain(I("c03"));
        expect(t, p).not.toContain(I("b03"));
      }
    });
    it.fails("QA-VIS2-03 (MINOR): the links of a readable plan list only the targets the reader sees (hidden CONTROL / ANOMALY ids, like the hidden RISK ids, are left out)", async () => {
      const links = (await get("out", `/actions/${I("a0b")}/links`)).json.data as Array<{ resourceType: string; resourceId: string }>;
      expect(links.map((l) => `${l.resourceType}:${l.resourceId}`)).toEqual([]);
    });
    it.fails("QA-VIS2-04 (MINOR, data loss): replacing the links of a readable plan keeps the links the editor cannot see (hidden CONTROL / ANOMALY too, as already done for RISK)", async () => {
      const r = await post("out", `/actions/${I("a0b")}/links`, { links: [] });
      expect(r.status).toBe(200);
      const left = await sql<{ resource_type: string }>("SELECT resource_type FROM action_links WHERE action_id = $1 ORDER BY 1", [I("a0b")]);
      expect(left.map((x) => x.resource_type)).toEqual(["ANOMALY", "CONTROL", "RISK"]);
    });

    it("QA_CHALLENGE-1: the declarer of an anomaly on a risk that is (or later becomes) restricted loses sight of their own anomaly - the risk rule wins over the declarer rule (spec 'ce qui m'est assigne' covers plans and executions only)", async () => {
      expect((await get("out", `/anomalies/${I("d02")}`)).status).toBe(404);
      expect((await patch("out", `/anomalies/${I("d02")}/status`, { status: "UNDER_ANALYSIS" })).status).toBe(404);
      expect((await sql("SELECT status FROM anomalies WHERE id = $1", [I("d02")]))[0]).toEqual({ status: "NEW" });
    });

    it("the responsible of a plan whose source is hidden reads and works the plan but never gets the source id (assigned rule)", async () => {
      const r = await get("out", `/actions/${I("a01")}`);
      expect(r.status).toBe(200);
      expect(r.json.data.sourceId).toBeNull();
      expect(r.text).not.toContain(I("502"));
      expect((await patch("out", `/actions/${I("a01")}/progress`, { progressPercent: 20 })).status).toBe(200);
      const list = await get("out", "/actions");
      expect(list.text).not.toContain(I("502"));
    });

    it("OBSERVATION: a plan whose source row does not exist (dangling) is read by its responsible and by the see-everything groups (service scope), not by anybody else (SQL function fail-closed)", async () => {
      await sql("INSERT INTO action_plans (id, tenant_id, title, source_type, source_id, responsible_user_id, due_date, created_by) VALUES ($1, $2, 'CANARY-V2-PLAN-DANGLING', 'CONTROL', $3, $4, current_date + 5, $4)", [I("a0d"), I("001"), I("9ee"), UID.own]);
      for (const w of ["own", "rm", "aud", "com"] as const) expect((await get(w, `/actions/${I("a0d")}`)).status, w).toBe(200);
      for (const w of ["out", "dept", "named"] as const) expect((await get(w, `/actions/${I("a0d")}`)).status, w).toBe(404);
      await sql("UPDATE action_plans SET status = 'TERMINEE', progress_percent = 100 WHERE id = $1", [I("a0d")]);
    });

    it("a KRI-born plan follows the KRI's primary risk: 'kris.risk_id' is NOT NULL, so the 'KRI without risk => everybody' branch of action_plan_visible_to is unreachable", async () => {
      const col = await sql<{ is_nullable: string }>("SELECT is_nullable FROM information_schema.columns WHERE table_name = 'kris' AND column_name = 'risk_id'");
      expect(col[0]).toEqual({ is_nullable: "NO" });
    });
  });

  // ---------------------------------------------------------------------------------------------- CREATE
  describe("CREATE: level chosen at creation", () => {
    for (const kind of ["control", "kpi", "anomaly", "plan"] as const) {
      it(`${kind}: NOMINATIF by the Risk Manager is persisted (DB + response), unreadable by an outsider and by the future list member until listed`, async () => {
        const { id, route } = await mk(kind, "NOMINATIF");
        expect(await level(TABLE[kind], id), "persisted level").toBe("NOMINATIF");
        expect((await get("rm", `${route}/${id}`)).json.data.visibility).toBe("NOMINATIF");
        for (const w of ["out", "named", "dept"] as const) {
          expect((await get(w, `${route}/${id}`)).status, `${w} before the list`).toBe(404);
          expect(ids(await get(w, route)), `${w} list`).not.toContain(id);
        }
        expect((await setVis("rm", `${route}/${id}`, "NOMINATIF", [UID.named])).status).toBe(200);
        expect((await get("named", `${route}/${id}`)).status).toBe(200);
        expect((await get("out", `${route}/${id}`)).status).toBe(404);
      });
      it(`${kind}: no level given => CLIENT; an invalid level (SECRET, client, '', null, 1, array) => 400 and no row created`, async () => {
        const route = { control: "/controls", kpi: "/kpis", anomaly: "/anomalies", plan: "/actions" }[kind];
        const body = { control: controlBody, kpi: kpiBody, anomaly: anomalyBody, plan: planBody }[kind];
        const def = await post("rm", route, body({ label: "Defaut", title: "Defaut", description: "Defaut" }));
        expect(def.status).toBe(201);
        expect(await level(TABLE[kind], def.json.data.id)).toBe("CLIENT");
        const before = (await sql<{ n: number }>(`SELECT count(*)::int AS n FROM ${TABLE[kind]}`))[0]!.n;
        for (const bad of ["SECRET", "client", "", null, 1, ["CLIENT"]]) expect((await post("rm", route, body({ visibility: bad }))).status, `${kind} ${JSON.stringify(bad)}`).toBe(400);
        expect((await sql<{ n: number }>(`SELECT count(*)::int AS n FROM ${TABLE[kind]}`))[0]!.n).toBe(before);
      });
      it(`${kind}: a list sent at creation (addUserIds / accessUserIds) is not honoured - the list is set afterwards (no grant created)`, async () => {
        const { id } = await mk(kind, "NOMINATIF", [], { addUserIds: [UID.named], accessUserIds: [UID.named], grantedBy: UID.out });
        expect(await grants(TYPE[kind], id)).toEqual([]);
      });
    }

    it("refusals (spec §5): a creator who would not see the result and sees everything nowhere is refused (400); an owner / perimeter member is accepted", async () => {
      // out2 = Operations group, no ownership, no Finance link
      expect((await post("out2", "/controls", controlBody({ visibility: "NOMINATIF" }))).status).toBe(400);
      expect((await post("out2", "/controls", controlBody({ visibility: "PERIMETRE", departmentId: I("201") }))).status).toBe(400);
      expect((await post("out2", "/controls", controlBody({ visibility: "PERIMETRE" }))).status, "PERIMETRE without department nor process").toBe(400);
      const ok = await post("out2", "/controls", controlBody({ visibility: "PERIMETRE", departmentId: I("202") }));
      expect(ok.status, ok.text).toBe(201);
      expect((await post("out2", "/kpis", kpiBody({ visibility: "NOMINATIF" }))).status).toBe(400);
      expect((await post("out2", "/kpis", kpiBody({ visibility: "PERIMETRE", departmentId: I("201") }))).status).toBe(400);
      expect((await post("out2", "/kpis", kpiBody({ visibility: "PERIMETRE", departmentId: I("202") }))).status).toBe(201);
      // the process owner is inside the perimeter of his process; NOMINATIF is refused to him (not on the list)
      expect((await post("pown", "/controls", controlBody({ visibility: "PERIMETRE", departmentId: null, processId: I("401") }))).status).toBe(201);
      expect((await post("pown", "/controls", controlBody({ visibility: "NOMINATIF", departmentId: null, processId: I("401") }))).status).toBe(400);
      // plan: the responsible is the owner account
      expect((await post("out2", "/actions", planBody({ visibility: "NOMINATIF", responsibleUserId: UID.out2 }))).status).toBe(201);
      expect((await post("out2", "/actions", planBody({ visibility: "NOMINATIF", responsibleUserId: UID.own }))).status, "creator not owner").toBe(400);
      expect((await post("out2", "/actions", planBody({ visibility: "PERIMETRE", responsibleUserId: UID.own, departmentId: I("201") }))).status).toBe(400);
      expect((await post("out2", "/actions", planBody({ visibility: "PERIMETRE", responsibleUserId: UID.out2, departmentId: I("201") }))).status, "owner is always inside").toBe(201);
      // anomaly: the declarer is the owner
      expect((await post("out2", "/anomalies", anomalyBody({ visibility: "NOMINATIF" }))).status).toBe(201);
      expect((await post("out2", "/anomalies", anomalyBody({ visibility: "PERIMETRE" }))).status).toBe(201);
    });

    it("inheriting objects cannot carry their own level at creation: anomaly with risk / control / execution, plan with RISK / CONTROL source => 400, nothing created", async () => {
      const n0 = (await sql<{ a: number; p: number }>("SELECT (SELECT count(*) FROM anomalies)::int AS a, (SELECT count(*) FROM action_plans)::int AS p"))[0]!;
      for (const over of [{ riskId: I("501") }, { controlId: I("c01") }, { controlExecutionId: I("b04") }]) {
        for (const level of ["PERIMETRE", "NOMINATIF"]) expect((await post("rm", "/anomalies", anomalyBody({ visibility: level, ...over }))).status, JSON.stringify(over) + level).toBe(400);
      }
      for (const [t, id] of [["RISK", I("501")], ["CONTROL", I("c01")], ["KRI", I("620")]] as const) {
        expect((await post("rm", "/actions", planBody({ visibility: "NOMINATIF", sourceType: t, sourceId: id, departmentId: null }))).status, t).toBe(400);
      }
      expect((await sql<{ a: number; p: number }>("SELECT (SELECT count(*) FROM anomalies)::int AS a, (SELECT count(*) FROM action_plans)::int AS p"))[0]).toEqual(n0);
      // CLIENT with a parent is the normal case
      expect((await post("rm", "/anomalies", anomalyBody({ visibility: "CLIENT", riskId: I("501") }))).status).toBe(201);
    });
  });

  // ---------------------------------------------------------------------------------------------- CHG
  describe("CHG: who changes the level, reason, payload, audit, notifications, concurrency", () => {
    it("control: RM 200; readers who are not RM (Finance group, process owner, listed) 403; Committee / Audit 403; non readers + admin holding the right directly 404; anonymous 401", async () => {
      const { id, route } = await mk("control", "PERIMETRE", [UID.named], { departmentId: I("201"), processId: I("401") });
      const body = { visibility: "PERIMETRE", reason: "Motif de test" };
      const codes: Record<string, number> = {};
      for (const w of ["dept", "pown", "named", "com", "aud", "out", "out2", "adm", "own"] as const) codes[w] = (await put(w, `${route}/${id}/visibility`, body)).status;
      expect(codes).toEqual({ dept: 403, pown: 403, named: 403, com: 403, aud: 403, out: 404, out2: 404, adm: 404, own: 404 });
      expect((await call(null, "PUT", `${route}/${id}/visibility`, body)).status).toBe(401);
      expect((await put("rm", `${route}/${id}/visibility`, body)).status).toBe(200);
    });
    it("kpi: same matrix (no owner account: only the RM changes)", async () => {
      const { id, route } = await mk("kpi", "PERIMETRE", [UID.named], { departmentId: I("201") });
      const body = { visibility: "PERIMETRE", reason: "Motif de test" };
      const codes: Record<string, number> = {};
      for (const w of ["dept", "named", "com", "aud", "out", "adm"] as const) codes[w] = (await put(w, `${route}/${id}/visibility`, body)).status;
      expect(codes).toEqual({ dept: 403, named: 403, com: 403, aud: 403, out: 404, adm: 404 });
      expect((await put("rm", `${route}/${id}/visibility`, body)).status).toBe(200);
    });
    it("anomaly: the DECLARER (owner account) and the RM change it; a listed reader 403; outsider 404; Committee / Audit 403", async () => {
      const { id, route } = await mk("anomaly", "NOMINATIF", [UID.named], {}, "dept");
      const body = { visibility: "NOMINATIF", reason: "Motif de test" };
      const codes: Record<string, number> = {};
      for (const w of ["named", "com", "aud", "out", "own", "adm"] as const) codes[w] = (await put(w, `${route}/${id}/visibility`, body)).status;
      expect(codes).toEqual({ named: 403, com: 403, aud: 403, out: 404, own: 404, adm: 404 });
      expect((await put("dept", `${route}/${id}/visibility`, body)).status).toBe(200);
      expect((await put("rm", `${route}/${id}/visibility`, body)).status).toBe(200);
    });
    it("plan: the RESPONSIBLE (not the creator) is the owner; creator in the department group 403; RM 200; listed 403; outsider 404", async () => {
      const { id, route } = await mk("plan", "PERIMETRE", [UID.named], { departmentId: I("201"), responsibleUserId: UID.own }, "dept");
      const body = { visibility: "PERIMETRE", reason: "Motif de test" };
      expect((await put("dept", `${route}/${id}/visibility`, body)).status, "creator is not the owner").toBe(403);
      expect((await put("named", `${route}/${id}/visibility`, body)).status).toBe(403);
      expect((await put("out", `${route}/${id}/visibility`, body)).status).toBe(404);
      expect((await put("own", `${route}/${id}/visibility`, body)).status).toBe(200);
      expect((await put("rm", `${route}/${id}/visibility`, body)).status).toBe(200);
      expect((await put("adm", `${route}/${id}/visibility`, body)).status).toBe(404);
    });

    for (const kind of ["control", "kpi", "anomaly", "plan"] as const) {
      it(`${kind}: reason missing / '' / blanks / tab+newline / 501 chars => 400 with nothing changed or audited; exactly 500 chars accepted`, async () => {
        const { id, route } = await mk(kind, "NOMINATIF", [UID.named]);
        const a0 = (await changes(id)).length;
        const base = { visibility: "CLIENT", addUserIds: [], revokeUserIds: [] };
        for (const reason of [undefined, "", "   ", "\t\n ", "x".repeat(501), null, 5]) {
          const r = await put("rm", `${route}/${id}/visibility`, reason === undefined ? base : { ...base, reason });
          expect(r.status, `${kind} reason ${JSON.stringify(reason)?.slice(0, 20)}`).toBe(400);
        }
        expect(await level(TABLE[kind], id)).toBe("NOMINATIF");
        expect(await active(TYPE[kind], id)).toEqual([UID.named]);
        expect((await changes(id)).length).toBe(a0);
        expect((await put("rm", `${route}/${id}/visibility`, { ...base, reason: "x".repeat(500) })).status).toBe(200);
      });
      it(`${kind}: payload - unknown level, non-uuid, 51 ids, suspended / unknown / other-tenant user, self-add (RM) and revoke of a non-listed user => 400, nothing changed`, async () => {
        await sql("INSERT INTO users (id, tenant_id, email, display_name, roles, deleted_at) VALUES ($1, $2, 'susp@vv2.test', 'Suspendu', '{}', now()) ON CONFLICT DO NOTHING", [I("f20"), I("001")]);
        const { id, route } = await mk(kind, "NOMINATIF", [UID.named]);
        const reason = "Motif QA";
        const cases: Array<[string, Record<string, unknown>]> = [
          ["unknown level", { visibility: "SECRET", reason }], ["lowercase level", { visibility: "nominatif", reason }],
          ["non uuid", { visibility: "NOMINATIF", addUserIds: ["not-a-uuid"], reason }],
          ["51 ids", { visibility: "NOMINATIF", addUserIds: Array.from({ length: 51 }, (_, i) => `aaaaaaaa-0000-4000-8000-0000000f${String(i).padStart(4, "0")}`), reason }],
          ["suspended", { visibility: "NOMINATIF", addUserIds: [I("f20")], reason }],
          ["unknown user", { visibility: "NOMINATIF", addUserIds: [UNKNOWN], reason }],
          ["other tenant", { visibility: "NOMINATIF", addUserIds: [I("f10")], reason }],
          ["self add (RM)", { visibility: "NOMINATIF", addUserIds: [UID.rm], reason }],
          ["self add uppercase", { visibility: "NOMINATIF", addUserIds: [UID.rm.toUpperCase()], reason }],
          ["revoke non listed", { visibility: "NOMINATIF", revokeUserIds: [UID.out], reason }],
          ["extra field", { visibility: "NOMINATIF", reason, grantedBy: UID.out }],
        ];
        const bad: string[] = [];
        for (const [name, body] of cases) {
          const r = await put("rm", `${route}/${id}/visibility`, body);
          if (name === "extra field") { if (r.status >= 500) bad.push(`${name}: ${r.status}`); continue; } // zod strips unknown keys: 200 is acceptable, 500 is not
          if (r.status !== 400) bad.push(`${name}: ${r.status} ${r.text.slice(0, 80)}`);
        }
        expect(bad).toEqual([]);
        expect(await active(TYPE[kind], id)).toEqual([UID.named]);
        expect((await grants(TYPE[kind], id)).every((g) => g.user_id === UID.named)).toBe(true); // an author sent by the client never reaches the grants
        expect((await sql<{ granted_by: string }>("SELECT granted_by FROM resource_access_grants WHERE resource_id = $1", [id])).every((g) => g.granted_by === UID.rm)).toBe(true);
      });
      it(`${kind}: back to CLIENT purges the list (revoked with the reason), does not come back on a later restriction; one PERMISSION_CHANGE row per change by the actor, widening flagged`, async () => {
        const { id, route } = await mk(kind, "NOMINATIF", [UID.named, UID.dept]);
        const wide = await setVis("rm", `${route}/${id}`, "CLIENT", [], [], "Ouverture QA");
        expect(wide.status).toBe(200);
        expect(wide.json.data.accessUserIds).toEqual([]);
        expect(await active(TYPE[kind], id)).toEqual([]);
        expect((await grants(TYPE[kind], id)).every((g) => g.revoked_at && g.revoke_reason === "Ouverture QA")).toBe(true);
        expect((await setVis("rm", `${route}/${id}`, "NOMINATIF", [], [], "Restriction QA")).status).toBe(200);
        expect((await get("rm", `${route}/${id}/visibility`)).json.data.accessUserIds).toEqual([]);
        expect((await get("named", `${route}/${id}`)).status).toBe(404);
        const rows = await changes(id);
        expect(rows).toHaveLength(3); // restrict + list, widen, restrict
        expect(rows.every((r) => r.user_id === UID.rm && r.entity_type === ENTITY[kind])).toBe(true);
        expect(rows.map((r) => r.reason)).toEqual(["Motif QA V2", "Ouverture QA", "Restriction QA"]);
        expect(rows.map((r) => r.new_value.widening)).toEqual([true, true, false]); // first: list added at the same level (named gains) ; widen ; narrow
        expect(rows[1]!.old_value.visibility).toBe("NOMINATIF");
        expect(rows[1]!.new_value.visibility).toBe("CLIENT");
      });
      it(`${kind}: an audit failure rolls the level change back (same transaction)`, async () => {
        const { id, route } = await mk(kind, "NOMINATIF", [UID.named]);
        await sql(`CREATE OR REPLACE FUNCTION qa_v2_fail_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.entity_id::text = '${id}' AND NEW.action = 'PERMISSION_CHANGE' THEN RAISE EXCEPTION 'qa audit failure'; END IF; RETURN NEW; END $$`);
        await sql("DROP TRIGGER IF EXISTS qa_v2_fail ON audit_log");
        await sql("CREATE TRIGGER qa_v2_fail BEFORE INSERT ON audit_log FOR EACH ROW EXECUTE FUNCTION qa_v2_fail_audit()");
        try {
          const r = await setVis("rm", `${route}/${id}`, "CLIENT", [], [], "Doit echouer");
          expect(r.status).toBeGreaterThanOrEqual(500);
        } finally {
          await sql("DROP TRIGGER IF EXISTS qa_v2_fail ON audit_log");
        }
        expect(await level(TABLE[kind], id)).toBe("NOMINATIF");
        expect(await active(TYPE[kind], id)).toEqual([UID.named]);
        expect((await get("out", `${route}/${id}`)).status).toBe(404);
      });
      it(`${kind}: concurrency - 6 identical list additions and an RM / owner race: no 5xx, one active grant per user, level is one of the requested ones, one audit row per success`, async () => {
        const { id, route } = await mk(kind, "NOMINATIF", [], kind === "plan" ? { responsibleUserId: UID.own } : {});
        const same = await Promise.all(Array.from({ length: 6 }, () => setVis("rm", `${route}/${id}`, "NOMINATIF", [UID.named], [], "Course identique")));
        expect(same.map((r) => r.status).filter((s) => s >= 500), `5xx ${same.map((r) => r.text.slice(0, 60)).join("|")}`).toEqual([]);
        expect(await active(TYPE[kind], id)).toEqual([UID.named]);
        const owner: Who = kind === "plan" ? "own" : "rm";
        const before = (await changes(id)).length;
        const race = await Promise.all([setVis("rm", `${route}/${id}`, "PERIMETRE", [UID.dept], [], "Course A"), setVis(owner, `${route}/${id}`, "CLIENT", [], [], "Course B"), setVis("rm", `${route}/${id}`, "NOMINATIF", [], [UID.named], "Course C")]);
        expect(race.filter((r) => r.status >= 500).map((r) => r.text.slice(0, 80))).toEqual([]);
        expect(["CLIENT", "PERIMETRE", "NOMINATIF"]).toContain(await level(TABLE[kind], id));
        const act = await active(TYPE[kind], id);
        expect(new Set(act).size).toBe(act.length);
        expect((await changes(id)).length - before).toBe(race.filter((r) => r.status === 200).length);
      });
    }

    it("inheriting objects refuse their own level (400, 'follows') even for the owner; a non-owner reader still gets 403; GET reports `inheritsFrom`", async () => {
      const body = { visibility: "NOMINATIF", reason: "Motif QA" };
      const cases: Array<[string, string, string | null]> = [[`/anomalies/${I("d01")}`, "RISK", null], [`/anomalies/${I("d03")}`, "CONTROL", null], [`/actions/${I("a02")}`, "RISK", "own"], [`/actions/${I("a03")}`, "CONTROL", "own"], [`/actions/${I("a04")}`, "KRI", "own"]];
      for (const [path, parent] of cases) {
        const r = await put("rm", `${path}/visibility`, body);
        expect(r.status, `${path} ${r.text}`).toBe(400);
        expect(r.text).toMatch(/follows the visibility/i);
        expect((await get("rm", `${path}/visibility`)).json.data.inheritsFrom, path).toBe(parent);
      }
      for (const [path, , owner] of cases.filter((c) => c[2])) expect((await put(owner as Who, `${path}/visibility`, body)).status, `owner ${path}`).toBe(400);
      expect((await put("dept", `/actions/${I("a02")}/visibility`, body)).status, "non owner reader").toBe(403);
      expect((await get("rm", `/anomalies/${I("d04")}/visibility`)).json.data.inheritsFrom).toBeNull();
      expect(await level("anomalies", I("d01"))).toBe("CLIENT");
    });

    it("notifications (q199/q204): the OWNER widening a plan / anomaly notifies exactly the RM-group holders (once each, no content); narrowing, the RM's own change, controls and KPIs notify nobody", async () => {
      await sql("UPDATE users SET roles = array_remove(roles, 'resourcevisibility.set') WHERE email = 'adm@vv1.test'"); // real case: the right lives in the RM group only
      const plan = await mk("plan", "NOMINATIF", [UID.named], { responsibleUserId: UID.own, title: "CANARY-V2-TITRE-NOTIF-PLAN" });
      const ano = await mk("anomaly", "NOMINATIF", [UID.named], { description: "CANARY-V2-TITRE-NOTIF-ANO" }, "dept");
      // RM changes: nothing
      expect((await setVis("rm", `${plan.route}/${plan.id}`, "PERIMETRE", [], [], "RM elargit")).status).toBe(200);
      expect((await notifs("rm", plan.id))).toEqual([]);
      // owner narrows: nothing
      expect((await setVis("own", `${plan.route}/${plan.id}`, "NOMINATIF", [], [], "Owner restreint")).status).toBe(200);
      expect(await notifs("rm", plan.id)).toEqual([]);
      // owner widens: one per RM member
      expect((await setVis("own", `${plan.route}/${plan.id}`, "CLIENT", [], [], "Owner elargit")).status).toBe(200);
      const n = await notifs("rm", plan.id);
      expect(n).toHaveLength(1);
      expect(n[0]!.event_type).toBe("ACTION_PLAN_VISIBILITY_WIDENED");
      expect(n[0]!.message).not.toMatch(/CANARY|TITRE/);
      for (const w of ["own", "com", "aud", "named", "dept", "out", "adm"] as const) expect(await notifs(w, plan.id), `no notification for ${w}`).toEqual([]);
      // anomaly: declarer widens by ADDING a name at the same level (widening) -> notified
      expect((await setVis("dept", `${ano.route}/${ano.id}`, "NOMINATIF", [UID.out], [], "Ajout declarant")).status).toBe(200);
      const na = await notifs("rm", ano.id);
      expect(na.map((x) => x.event_type)).toEqual(["ANOMALY_VISIBILITY_WIDENED"]);
      expect(na[0]!.message).not.toMatch(/CANARY|TITRE/);
      // control / KPI widened by the RM: no event exists
      const c = await mk("control", "NOMINATIF", [UID.named]);
      expect((await setVis("rm", `${c.route}/${c.id}`, "CLIENT")).status).toBe(200);
      for (const w of WHO) expect(await notifs(w, c.id), `control ${w}`).toEqual([]);
      // the notification lists show nothing of the restricted content to the others
      for (const w of ["out", "com", "aud"] as const) expect((await get(w, "/notifications")).text, w).not.toContain("TITRE-NOTIF");
      await sql("UPDATE users SET roles = roles || ARRAY['resourcevisibility.set']::text[] WHERE email = 'adm@vv1.test'");
    });
  });

  // ---------------------------------------------------------------------------------------------- PERIM
  describe("PERIM: department / process of a restricted control or KPI", () => {
    it("control: guard, reason, widening measured on the EFFECTIVE readers, audit with reason; non-perimeter edits and no-ops need nothing", async () => {
      const { id, route } = await mk("control", "PERIMETRE", [UID.named], { departmentId: I("201"), processId: I("401") });
      // not RM, not owner: 403 (with or without a reason), nothing changed
      for (const body of [{ departmentId: I("202") }, { departmentId: I("202"), reason: "Je veux" }]) expect((await patch("dept", `${route}/${id}`, body)).status).toBe(403);
      expect((await sql<{ department_id: string }>("SELECT department_id FROM controls WHERE id = $1", [id]))[0]!.department_id).toBe(I("201"));
      // RM without a usable reason: 400, nothing changed
      for (const reason of [undefined, "", "   ", "x".repeat(501)]) expect((await patch("rm", `${route}/${id}`, { departmentId: I("202"), ...(reason === undefined ? {} : { reason }) })).status, JSON.stringify(reason)?.slice(0, 10)).toBe(400);
      expect((await sql<{ department_id: string }>("SELECT department_id FROM controls WHERE id = $1", [id]))[0]!.department_id).toBe(I("201"));
      expect((await changes(id)).length).toBe(1); // only the list addition
      // non-perimeter field by a reader holding control.update: allowed, no PERMISSION_CHANGE
      expect((await patch("dept", `${route}/${id}`, { label: "Renomme QA" })).status).toBe(200);
      // no-op on the perimeter (same department) needs no reason
      expect((await patch("dept", `${route}/${id}`, { departmentId: I("201") })).status).toBe(200);
      expect((await changes(id)).length).toBe(1);
      // RM moves Finance -> Operations : Operations group gains (widening true), Finance group loses
      expect((await get("out2", `${route}/${id}`)).status).toBe(404);
      expect((await patch("rm", `${route}/${id}`, { departmentId: I("202"), reason: "Transfert QA" })).status).toBe(200);
      expect((await get("out2", `${route}/${id}`)).status).toBe(200);
      expect((await get("dept", `${route}/${id}`)).status).toBe(404);
      expect((await get("pown", `${route}/${id}`)).status, "process owner keeps it").toBe(200);
      const moved = (await changes(id)).at(-1)!;
      expect(moved.reason).toBe("Transfert QA");
      expect(moved.user_id).toBe(UID.rm);
      expect(moved.new_value.widening).toBe(true);
      expect(moved.old_value.departmentId).toBe(I("201"));
      expect(moved.new_value.departmentId).toBe(I("202"));
      // RM detaches the process : the process owner loses it and nobody gains => widening false
      expect((await patch("rm", `${route}/${id}`, { processId: null, reason: "Detache QA" })).status).toBe(200);
      expect((await get("pown", `${route}/${id}`)).status).toBe(404);
      expect((await changes(id)).at(-1)!.new_value.widening).toBe(false);
      // the generic update trail also exists
      expect((await audits(id)).some((a) => a.action === "UPDATE")).toBe(true);
    });

    it("a CLIENT control changes department / process without reason or guard (nothing to protect), no PERMISSION_CHANGE", async () => {
      const { id, route } = await mk("control", "CLIENT", [], { departmentId: I("201") });
      expect((await patch("dept", `${route}/${id}`, { departmentId: I("202") })).status).toBe(200);
      expect(await changes(id)).toEqual([]);
    });

    it("OBSERVATION: a NOMINATIF control also demands RM + reason for a department change that moves nobody (conservative guard); widening is false", async () => {
      const { id, route } = await mk("control", "NOMINATIF", [UID.named], { departmentId: I("201") });
      expect((await patch("dept", `${route}/${id}`, { departmentId: I("202") })).status).toBe(404); // dept is not a reader of a NOMINATIF control
      expect((await patch("rm", `${route}/${id}`, { departmentId: I("202") })).status).toBe(400);
      expect((await patch("rm", `${route}/${id}`, { departmentId: I("202"), reason: "Sans effet" })).status).toBe(200);
      expect((await changes(id)).at(-1)!.new_value.widening).toBe(false);
    });

    it("control: a combined PATCH {department, forbidden status ARCHIVED} is refused as a whole - the perimeter is not applied first (no partial effect)", async () => {
      const { id, route } = await mk("control", "PERIMETRE", [UID.named], { departmentId: I("201") });
      const r = await patch("rm", `${route}/${id}`, { departmentId: I("202"), reason: "Combine QA", status: "ARCHIVED" });
      expect(r.status).toBe(400);
      expect((await sql<{ department_id: string }>("SELECT department_id FROM controls WHERE id = $1", [id]))[0]!.department_id, "perimeter applied before the refusal").toBe(I("201"));
      expect((await changes(id)).length).toBe(1);
    });

    it("control (process) and KPI (department, process): an unknown department / process is a 4xx, nothing changed", async () => {
      const c = await mk("control", "PERIMETRE", [UID.named], { departmentId: I("201") });
      const r1 = await patch("rm", `${c.route}/${c.id}`, { processId: UNKNOWN, reason: "Inconnu" });
      expect(r1.status, r1.text).toBe(400);
      const k = await mk("kpi", "PERIMETRE", [UID.named], { departmentId: I("201") });
      for (const body of [{ departmentId: UNKNOWN, reason: "Inconnu" }, { processId: UNKNOWN, reason: "Inconnu" }]) {
        const r = await patch("rm", `${k.route}/${k.id}`, body);
        expect(r.status, JSON.stringify(body) + r.text.slice(0, 100)).toBe(400);
      }
      expect((await sql<{ department_id: string; process_id: string | null }>("SELECT department_id, process_id FROM controls WHERE id = $1", [c.id]))[0]).toEqual({ department_id: I("201"), process_id: null });
    });
    it.fails("QA-VIS2-05 (MINOR): PATCH /controls/:id with an unknown departmentId answers 400 like processId and the KPI do (today FK violation => 500), restricted or not", async () => {
      const c = await mk("control", "PERIMETRE", [UID.named], { departmentId: I("201") });
      const r = await patch("rm", `${c.route}/${c.id}`, { departmentId: UNKNOWN, reason: "Inconnu" });
      expect(r.status, r.text.slice(0, 100)).toBe(400);
      const plain = await mk("control", "CLIENT", [], { departmentId: I("201") });
      expect((await patch("rm", `${plain.route}/${plain.id}`, { departmentId: UNKNOWN })).status).toBe(400);
    });

    it("control: the perimeter change is atomic with its PERMISSION_CHANGE row (audit failure => perimeter unchanged)", async () => {
      const { id, route } = await mk("control", "PERIMETRE", [UID.named], { departmentId: I("201") });
      await sql(`CREATE OR REPLACE FUNCTION qa_v2_fail_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.entity_id::text = '${id}' AND NEW.action = 'PERMISSION_CHANGE' THEN RAISE EXCEPTION 'qa audit failure'; END IF; RETURN NEW; END $$`);
      await sql("DROP TRIGGER IF EXISTS qa_v2_fail ON audit_log");
      await sql("CREATE TRIGGER qa_v2_fail BEFORE INSERT ON audit_log FOR EACH ROW EXECUTE FUNCTION qa_v2_fail_audit()");
      try {
        const r = await patch("rm", `${route}/${id}`, { departmentId: I("202"), reason: "Doit echouer" });
        expect(r.status).toBeGreaterThanOrEqual(500);
      } finally {
        await sql("DROP TRIGGER IF EXISTS qa_v2_fail ON audit_log");
      }
      expect((await sql<{ department_id: string }>("SELECT department_id FROM controls WHERE id = $1", [id]))[0]!.department_id).toBe(I("201"));
      expect((await get("out2", `${route}/${id}`)).status).toBe(404);
    });

    it("KPI: PATCH {departmentId, processId} and POST /:id/link follow the same guard (403 non RM, 400 without reason, audited with widening)", async () => {
      const { id, route } = await mk("kpi", "PERIMETRE", [UID.named], { departmentId: I("201"), processId: null });
      expect((await patch("dept", `${route}/${id}`, { departmentId: I("202") })).status).toBe(403);
      expect((await patch("rm", `${route}/${id}`, { departmentId: I("202") })).status).toBe(400);
      expect((await post("dept", `${route}/${id}/link`, { departmentId: I("202"), reason: "Lien" })).status).toBe(403);
      expect((await post("rm", `${route}/${id}/link`, { departmentId: I("202") })).status).toBe(400);
      expect((await sql<{ department_id: string }>("SELECT department_id FROM kpis WHERE id = $1", [id]))[0]!.department_id).toBe(I("201"));
      expect((await patch("rm", `${route}/${id}`, { departmentId: I("202"), reason: "Transfert KPI" })).status).toBe(200);
      expect((await get("out2", `${route}/${id}`)).status).toBe(200);
      expect((await get("dept", `${route}/${id}`)).status).toBe(404);
      expect((await changes(id)).at(-1)!.new_value.widening).toBe(true);
      expect((await post("rm", `${route}/${id}/link`, { departmentId: I("201"), reason: "Retour via link" })).status).toBe(200);
      expect((await get("dept", `${route}/${id}`)).status).toBe(200);
      expect((await changes(id)).at(-1)!.reason).toBe("Retour via link");
    });
  });

  // ---------------------------------------------------------------------------------------------- INHER (dynamic)
  describe("INHER: the children follow the parent at once, in both directions (SQL toggles, restored after each case)", () => {
    const seen = async (who: Who, route: string, id: string) => (await get(who, `${route}/${id}`)).status === 200;
    it("risk 502 -> CLIENT opens its anomalies and plans to an outsider; back to PERIMETRE closes them again", async () => {
      const things: Array<[string, string]> = [["/anomalies", I("d01")], ["/anomalies", I("d02")], ["/actions", I("a02")], ["/actions", I("a04")]];
      for (const [r, id] of things) expect(await seen("out", r, id), `closed ${id}`).toBe(false);
      await sql("UPDATE risks SET visibility = 'CLIENT' WHERE id = $1", [I("502")]);
      try { for (const [r, id] of things) expect(await seen("out", r, id), `open ${id}`).toBe(true); } finally { await sql("UPDATE risks SET visibility = 'PERIMETRE' WHERE id = $1", [I("502")]); }
      for (const [r, id] of things) expect(await seen("out", r, id), `closed again ${id}`).toBe(false);
    });
    it("control c02 -> CLIENT opens it with its executions, assessments, evidences, anomaly and plan; -> NOMINATIF closes them for the Finance group and RACI", async () => {
      const all = (w: Who) => Promise.all([seen(w, "/controls", I("c02")), seen(w, "/executions", I("b02")), seen(w, "/effectiveness", I("e01")), seen(w, "/anomalies", I("d03")), seen(w, "/actions", I("a03"))]);
      expect(await all("out2")).toEqual([false, false, false, false, false]);
      await sql("UPDATE controls SET visibility = 'CLIENT' WHERE id = $1", [I("c02")]);
      try { expect(await all("out2")).toEqual([true, true, true, true, true]); } finally { await sql("UPDATE controls SET visibility = 'PERIMETRE' WHERE id = $1", [I("c02")]); }
      expect(await all("out2")).toEqual([false, false, false, false, false]);
      await sql("UPDATE controls SET visibility = 'NOMINATIF' WHERE id = $1", [I("c02")]);
      try {
        expect(await all("dept")).toEqual([false, false, false, false, false]);
        expect(await all("raci")).toEqual([false, false, false, false, false]);
        expect(await all("named")).toEqual([true, true, true, true, true]);
        expect(await seen("own", "/executions", I("b02")), "executor keeps their own execution").toBe(true);
      } finally { await sql("UPDATE controls SET visibility = 'PERIMETRE' WHERE id = $1", [I("c02")]); }
    });
    it("seat / grant / RACI revocation closes the perimeter at once (Finance seat of dept, grant of named, RACI of raci) and restoring reopens it", async () => {
      const probe = async (w: Who) => [await seen(w, "/controls", I("c02")), await seen(w, "/kpis", K("9002")), await seen(w, "/actions", I("a06"))];
      expect(await probe("dept")).toEqual([true, true, true]);
      await sql("UPDATE user_roles SET revoked_at = now() WHERE user_id = $1 AND role_id = $2", [UID.dept, I("301")]);
      try { expect(await probe("dept")).toEqual([false, false, false]); } finally { await sql("UPDATE user_roles SET revoked_at = NULL WHERE user_id = $1 AND role_id = $2", [UID.dept, I("301")]); }
      expect(await probe("dept")).toEqual([true, true, true]);
      await sql("UPDATE resource_access_grants SET revoked_at = now(), revoked_by = $1, revoke_reason = 'QA' WHERE user_id = $2 AND resource_id IN ($3, $4, $5) AND revoked_at IS NULL", [UID.own, UID.named, I("c02"), K("9002"), I("a06")]);
      try { expect(await probe("named")).toEqual([false, false, false]); } finally {
        // a revocation is final (append-only): the access is restored by a NEW grant
        for (const [t, rid] of [["CONTROL", I("c02")], ["KPI", K("9002")], ["ACTION_PLAN", I("a06")]]) {
          await sql("INSERT INTO resource_access_grants (tenant_id, resource_type, resource_id, user_id, granted_by, grant_reason) VALUES ($1, $2, $3, $4, $5, 'QA restore')", [I("001"), t, rid, UID.named, UID.own]);
        }
      }
      expect(await probe("named")).toEqual([true, true, true]);
      await sql("UPDATE raci_assignments SET deleted_at = now() WHERE user_id = $1 AND entity_id IN ($2, $3)", [UID.raci, I("c02"), I("a06")]);
      try { expect([await seen("raci", "/controls", I("c02")), await seen("raci", "/actions", I("a06"))]).toEqual([false, false]); } finally {
        await sql("UPDATE raci_assignments SET deleted_at = NULL WHERE user_id = $1 AND entity_id IN ($2, $3)", [UID.raci, I("c02"), I("a06")]);
      }
      expect([await seen("raci", "/controls", I("c02")), await seen("raci", "/actions", I("a06"))]).toEqual([true, true]);
    });
    it("a suspended account (deleted_at) with a valid token: no more visibility than before, and never more than a CLIENT reader", async () => {
      const r = await get("out", `/controls/${I("c02")}`);
      expect(r.status).toBe(404);
    });
  });
});
