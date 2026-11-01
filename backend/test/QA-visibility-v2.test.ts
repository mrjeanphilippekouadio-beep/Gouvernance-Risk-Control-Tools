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
const MIG = join(ROOT, "database", "postgresql", "migrations");
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
    expect(up).not.toMatch(/users\.roles|u\.roles/);
    expect(up).not.toMatch(/\b(DELETE|UPDATE|INSERT)\b/);
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
    expect(MIG.length).toBeGreaterThan(0);
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
  obj(I("d02"), "CANARY-V2-ANO-RISKHID-DECLARER", RISK_PERIM), // declarer `out`: the risk rule wins (QA_CHALLENGE-1)
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
  obj(I("a09"), "CANARY-V2-PLAN-ASSIGNED-NOMIN", u(["out"], SEE_ALL)), // responsible `out`, own NOMINATIF
  obj(I("a0a"), "CANARY-V2-PLAN-TOCLOSE", ALL), obj(I("a0b"), "CANARY-V2-PLAN-LINKS", ALL),
];
const EXECS = [
  { ...obj(I("b01"), "CANARY-V2-EXEC-PERIM-ASSIGNED", u(["out"], CTL_PERIM)), control: I("c02") }, // executor `out` ("ce qui m'est assigne")
  { ...obj(I("b02"), "CANARY-V2-EXEC-PERIM", u(["own"], CTL_PERIM)), control: I("c02") },
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
    await sql("UPDATE users SET roles = roles || ARRAY['execution.create','execution.validate','effectiveness.create','effectiveness.validate','anomaly.create','anomaly.update','actionplan.create','actionplan.update','kpi.create','kpi.update','control.create','control.update','raci.assign','evidence.delete','actionplan.validate']::text[] WHERE email IN ('out@vv1.test','out2@vv1.test')");
    await sql("UPDATE users SET roles = roles || ARRAY['control.create','control.update','kpi.create','kpi.update','anomaly.create','anomaly.update','actionplan.create','actionplan.update']::text[] WHERE email IN ('dept@vv1.test','own@vv1.test','named@vv1.test')");
    // a second tenant with one user (foreign-tenant user in addUserIds)
    await sql("INSERT INTO tenants (id, name) VALUES ($1, 'Autre tenant QA V2') ON CONFLICT DO NOTHING", [I("f00")]);
    await sql("INSERT INTO users (id, tenant_id, email, display_name, roles) VALUES ($1, $2, 'foreign@vv2.test', 'Foreign', '{}') ON CONFLICT DO NOTHING", [I("f01").replace("f01", "f10"), I("f00")]);
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
});
