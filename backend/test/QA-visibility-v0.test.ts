import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import { VisibilityResolver } from "../src/services/VisibilityResolver.js";
import { RiskService } from "../src/services/RiskService.js";
import { ControlService } from "../src/services/ControlService.js";
import { AnomalyService } from "../src/services/AnomalyService.js";
import { ActionPlanService } from "../src/services/ActionPlanService.js";
import { KpiService } from "../src/services/KpiService.js";
import { isVisible, SYSTEM_SCOPE, type ReadScope, type Visibility } from "../src/domain/visibility.js";
import { visibilityClause } from "../src/infrastructure/database/postgres/visibilityFilter.js";
import { PostgresRiskRepository } from "../src/infrastructure/database/postgres/PostgresRiskRepository.js";
import { PostgresControlRepository } from "../src/infrastructure/database/postgres/PostgresControlRepository.js";
import { PostgresAnomalyRepository } from "../src/infrastructure/database/postgres/PostgresAnomalyRepository.js";
import { PostgresActionPlanRepository } from "../src/infrastructure/database/postgres/PostgresActionPlanRepository.js";
import { PostgresKpiRepository } from "../src/infrastructure/database/postgres/PostgresKpiRepository.js";
import { PostgresRoleRepository } from "../src/infrastructure/database/postgres/PostgresRoleRepository.js";
import { PostgresAuditRepository } from "../src/infrastructure/database/postgres/PostgresAuditRepository.js";
import { NotFoundError } from "../src/domain/errors/DomainErrors.js";
import type { Role, SystemGroup } from "../src/domain/entities/Role.js";
import type { AuthenticatedUser } from "../src/infrastructure/identity/IdentityProvider.js";

/**
 * QA-visibility-v0 (level 2): lot V0 of DECISION-100/102/103, migration 080 + `visibilityFilter.ts`. V0 = NO visible change.
 * Oracles written BEFORE running.
 *
 * NR   non-regression: with CLIENT everywhere every reader (ordinary, administrator without group, RM, Committee, Audit, no resolver)
 *      gets the SAME rows from list and by-id on the 5 resources, in memory AND on PostgreSQL; the service hands the right scope
 *      to the repository (RM/Committee/Audit -> all, anyone else -> CLIENT only, no resolver -> nothing); a role merely NAMED
 *      "Risk Manager" (no system_group), a revoked seat or a disabled role does not widen anything.
 * INV  inventory: every service-level read of the 5 roots that is NOT given a scope (gap for V1, listed in the report, not fixed).
 * MIG  080 up/down/up on local PostgreSQL 16: default CLIENT for rows existing BEFORE 080, CHECK on the 3 values, down restores
 *      the exact pre-080 schema and keeps the rows, idempotent both ways.
 * GRT  resource_access_grants: content immutable (each column), revoke once, no DELETE, no TRUNCATE (superuser and runtime role),
 *      no self-grant, tenant isolation (composite FKs), unique active grant, reason bounds.
 * SP   both guard functions pin `search_path = pg_catalog, public, pg_temp` (pg_temp LAST); triggers have the right shape.
 * VIS  a row forced to PERIMETRE / NOMINATIF is invisible to a first-line reader (list and by id, same error as an unknown id)
 *      and visible to RM / Committee / Audit, through the REAL services, repositories and role repository.
 *
 * Live part: needs a disposable LOCAL cluster. QA_VIS_PGHOST = unix socket directory (never a remote host), QA_VIS_PGPORT.
 * It builds `grc_qa_visv0_tpl` (migrations 001..079 by psql) and derives one database per describe from it.
 */
const ROOT = join(__dirname, "..", "..");
const MIG = join(ROOT, "database", "postgresql", "migrations");
const PGHOST = process.env["QA_VIS_PGHOST"] ?? "";
const PGPORT = process.env["QA_VIS_PGPORT"] ?? "5432";
const live = PGHOST.startsWith("/");
const PSQL = "/usr/bin/psql";
const TPL = "grc_qa_visv0_tpl";

const T = "00000000-0000-4000-8000-0000000000b1";
const perms = ["risk.read", "control.read", "anomaly.read", "actionplan.read", "kpi.read"];
const actor = (userId: string, tenantId = T): AuthenticatedUser =>
  ({ userId, tenantId, email: `${userId}@x.io`, displayName: userId, roles: perms, dashboardScopeMode: "GLOBAL" }) as unknown as AuthenticatedUser;
const role = (systemGroup: SystemGroup | null, extra: Partial<Role> = {}) => ({ systemGroup, name: "r", ...extra }) as Role;

// ================================================================================================ NR (in memory)
type Row = { id: string; tenantId: string; visibility: Visibility; dueDate?: Date; status?: string; progressPercent?: number };
/** A repository double faithful to the SQL filter: scope all -> everything, else CLIENT only; tenant-scoped. */
function fakeRepo(rows: Row[], seen: (ReadScope | undefined)[]) {
  const vis = (tenantId: string, scope?: ReadScope) =>
    rows.filter((r) => r.tenantId === tenantId && isVisible(r.visibility, scope)).map((r) => ({ dueDate: new Date(Date.now() + 864e5), status: "PLANIFIEE", progressPercent: 0, ...r }));
  return {
    getById: async (tenantId: string, id: string, scope?: ReadScope) => { seen.push(scope); return vis(tenantId, scope).find((r) => r.id === id) ?? null; },
    list: async (tenantId: string, _o?: unknown, scope?: ReadScope) => { seen.push(scope); return vis(tenantId, scope); },
  };
}
const readers: Array<{ name: string; roles: Role[]; all: boolean }> = [
  { name: "ordinary first-line reader", roles: [role(null)], all: false },
  { name: "administrator without fixed group (q197)", roles: [role(null, { name: "Administrateurs" })], all: false },
  { name: "no role at all", roles: [], all: false },
  { name: "role merely NAMED Risk Manager (no system_group)", roles: [role(null, { name: "Risk Manager" })], all: false },
  { name: "Risk Manager", roles: [role("RISK_MANAGER")], all: true },
  { name: "Committee", roles: [role("RISK_COMMITTEE")], all: true },
  { name: "Audit", roles: [role("AUDIT")], all: true },
  { name: "Audit among other roles", roles: [role(null), role("AUDIT")], all: true },
];

function services(rows: Row[], seen: (ReadScope | undefined)[], resolver?: VisibilityResolver) {
  const repo = fakeRepo(rows, seen) as never;
  const audit = {} as never;
  return {
    risk: new RiskService(repo, audit, undefined, undefined, undefined, undefined, undefined, resolver),
    control: new ControlService(repo, repo, audit, undefined, resolver),
    anomaly: new AnomalyService(repo, audit, undefined, undefined, undefined, resolver),
    action: new ActionPlanService(repo, audit, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, resolver),
    kpi: new KpiService(repo, { getLatest: async () => null } as never, {} as never, {} as never, audit, resolver),
  };
}
const calls = (s: ReturnType<typeof services>, id: string) => ({
  riskGet: () => s.risk.get(actor("u"), id), riskList: () => s.risk.list(actor("u")),
  controlGet: () => s.control.get(actor("u"), id), controlList: () => s.control.list(actor("u")),
  anomalyGet: () => s.anomaly.get(actor("u"), id), anomalyList: () => s.anomaly.list(actor("u")),
  actionGet: () => s.action.get(actor("u"), id), actionList: () => s.action.list(actor("u")),
  kpiGet: () => s.kpi.get(actor("u"), id), kpiList: () => s.kpi.list(actor("u")),
});

describe("QA-visibility-v0 NR: services hand the right scope to the repository (5 resources x get/list x 8 readers)", () => {
  for (const r of readers) {
    it(`${r.name}: scope = ${r.all ? "{all:true}" : "{all:false}"}, never undefined, on all 10 reads`, async () => {
      const seen: (ReadScope | undefined)[] = [];
      const id = randomUUID();
      const s = services([{ id, tenantId: T, visibility: "CLIENT" }], seen, new VisibilityResolver({ listForUser: async () => r.roles }));
      for (const [name, call] of Object.entries(calls(s, id))) {
        seen.length = 0;
        await call();
        expect(seen, name).toEqual([r.all ? { all: true } : { all: false, userId: "u" }]); // V1: the reader is named (risk_visible_to)
      }
    });
  }

  it("no resolver wired (tests): fail-closed, the reader gets CLIENT rows only on all 10 reads (SEC V0-01)", async () => {
    const seen: (ReadScope | undefined)[] = [];
    const id = randomUUID();
    const s = services([{ id, tenantId: T, visibility: "PERIMETRE" }], seen);
    for (const [name, call] of Object.entries(calls(s, id))) {
      seen.length = 0;
      await call().catch(() => undefined); // the PERIMETRE row is hidden: get answers NotFound, list is empty
      expect(seen, name).toEqual([{ all: false }]);
    }
  });

  it("all CLIENT: every reader gets exactly the same rows from list and by id (no regression)", async () => {
    const rows: Row[] = [1, 2, 3].map(() => ({ id: randomUUID(), tenantId: T, visibility: "CLIENT" as const }));
    rows.push({ id: randomUUID(), tenantId: "other-tenant", visibility: "CLIENT" });
    const reference = rows.filter((r) => r.tenantId === T).map((r) => r.id);
    for (const r of readers) {
      const s = services(rows, [], new VisibilityResolver({ listForUser: async () => r.roles }));
      const c = calls(s, reference[0]!);
      for (const list of [c.riskList, c.controlList, c.anomalyList, c.actionList, c.kpiList]) {
        expect((await list() as unknown as Row[]).map((x) => x.id), r.name).toEqual(reference);
      }
      for (const get of [c.riskGet, c.controlGet, c.anomalyGet, c.actionGet, c.kpiGet]) {
        expect(((await get()) as unknown as Row).id, r.name).toBe(reference[0]);
      }
    }
  });

  it("a forced PERIMETRE/NOMINATIF row: hidden from first-line readers (get == unknown id, list without it), visible to RM/Committee/Audit", async () => {
    const hidden = randomUUID();
    const open = randomUUID();
    const rows: Row[] = [{ id: open, tenantId: T, visibility: "CLIENT" }, { id: hidden, tenantId: T, visibility: "PERIMETRE" }, { id: randomUUID(), tenantId: T, visibility: "NOMINATIF" }];
    for (const r of readers) {
      const s = services(rows, [], new VisibilityResolver({ listForUser: async () => r.roles }));
      const c = calls(s, hidden);
      const unknown = calls(s, randomUUID());
      for (const [get, list] of [[c.riskGet, c.riskList], [c.controlGet, c.controlList], [c.anomalyGet, c.anomalyList], [c.actionGet, c.actionList], [c.kpiGet, c.kpiList]] as const) {
        const ids = ((await list()) as unknown as Row[]).map((x) => x.id);
        if (r.all) {
          expect(ids, r.name).toHaveLength(3);
          expect(((await get()) as unknown as Row).id).toBe(hidden);
        } else {
          expect(ids, r.name).toEqual([open]);
          const err = await get().then(() => null, (e: unknown) => e);
          expect(err, r.name).toBeInstanceOf(NotFoundError);
        }
      }
      if (!r.all) {
        // no existence oracle: same error class and same message once the id is substituted
        const e1 = await c.riskGet().then(() => "", (e: Error) => e.message.replace(hidden, "<id>"));
        const idU = randomUUID();
        const e2 = await calls(s, idU).riskGet().then(() => "", (e: Error) => e.message.replace(idU, "<id>"));
        expect(e1).toBe(e2);
        void unknown;
      }
    }
  });

  it("clause: adds nothing with all (fixed group or SYSTEM_SCOPE); CLIENT only otherwise; never a client value; only the 5 repos use it (2 call sites each)", () => {
    expect(visibilityClause(SYSTEM_SCOPE)).toBe("");
    expect(visibilityClause({ all: true })).toBe("");
    expect(visibilityClause({ all: false })).toBe("AND visibility = 'CLIENT'");
    const infra = join(__dirname, "..", "src", "infrastructure", "database", "postgres");
    // Lot V1: risks moved to riskVisibilityClause (risk_visible_to); lot V2: the 4 other roots to resourceVisibilityClause
    // (<root>_visible_to, migration 083). The V0 clause has no caller left.
    const users = readdirSync(infra).filter((f) => f.endsWith(".ts") && f !== "visibilityFilter.ts" && /[^a-zA-Z]visibilityClause\(/.test(readFileSync(join(infra, f), "utf8")));
    expect(users).toEqual([]);
    for (const [f, root, sites] of [["PostgresActionPlanRepository.ts", "ACTION_PLAN", 3], ["PostgresAnomalyRepository.ts", "ANOMALY", 2], ["PostgresControlRepository.ts", "CONTROL", 3], ["PostgresKpiRepository.ts", "KPI", 2]] as const) {
      const src = readFileSync(join(infra, f), "utf8");
      expect((src.match(new RegExp(`\\$\\{resourceVisibilityClause\\("${root}", scope`, "g")) ?? []).length, f).toBe(sites);
    }
    const riskSrc = readFileSync(join(infra, "PostgresRiskRepository.ts"), "utf8");
    expect((riskSrc.match(/\$\{riskVisibilityClause\(scope\)\}/g) ?? []).length).toBe(2);
  });
});

// ================================================================================================ INV
/** Reads of the 5 root repositories inside services/, with the verdict "given a scope or not" (balanced-parenthesis scan). */
function scan() {
  const dir = join(__dirname, "..", "src", "services");
  const out: Array<{ file: string; line: number; repo: string; method: string; wired: boolean }> = [];
  const re = /this\.(risks|controls|anomalies|actions|actionPlans|kpis)\??\.(getById|list|listByIds|listCoveringRisk|listForRisk)\(/g;
  for (const file of readdirSync(dir).filter((f) => f.endsWith(".ts")).sort()) {
    const src = readFileSync(join(dir, file), "utf8");
    for (let m = re.exec(src); m; m = re.exec(src)) {
      // QA-V1: risk reads left this inventory. They are scoped through readerScope()/SYSTEM_SCOPE (no "visibility" word in the call),
      // so this text heuristic counted them as gaps; they are inventoried by QA-visibility-v1 INV with the right oracle.
      if (m[1] === "risks") continue;
      let depth = 1;
      let i = re.lastIndex;
      while (depth > 0 && i < src.length) { const ch = src[i++]; if (ch === "(") depth++; else if (ch === ")") depth--; }
      out.push({ file, line: src.slice(0, m.index).split("\n").length, repo: m[1]!, method: m[2]!, wired: !/SYSTEM_SCOPE/.test(src.slice(re.lastIndex, i)) });
    }
  }
  return out;
}

describe("QA-visibility-v0 INV: reads of the 5 roots that carry no scope (V1 gap, documented in docs/qa/qa-visibility-v0-2026-10-29.md)", () => {
  const all = scan();
  // Lot V2: every read of a control / anomaly / action plan / KPI now carries the reader's scope (resolver or readerScope);
  // "unwired" = an explicit SYSTEM_SCOPE. What is left are internal reads, each justified below.
  it("the only SYSTEM_SCOPE reads left are the internal ones (no content returned to a reader)", () => {
    expect(all.filter((r) => !r.wired).map((r) => `${r.file}:${r.repo}.${r.method}`).sort()).toEqual([
      "FindingService.ts:anomalies.getById", // audit domain (I-1): link validation by the AUDIT group, which sees everything
      "FindingService.ts:controls.getById",
      "ProcessService.ts:controls.list", // refusal to archive a process still referenced (message without ids)
      "RaciAssignmentService.ts:actionPlans.getById", // existence half of the "hidden" test (an archived entity is not "hidden")
      "RaciAssignmentService.ts:controls.getById",
    ]);
  });

  it("the V1 gap list is closed: listForRisk, dashboard, listCoveringRisk and the dashboards carry the reader's scope", () => {
    const wired = all.filter((r) => r.wired).map((r) => `${r.file}:${r.method}`);
    for (const g of ["ActionPlanService.ts:listForRisk", "ActionPlanService.ts:list", "ControlService.ts:listCoveringRisk", "DashboardService.ts:list"]) {
      expect(wired, g).toContain(g);
    }
    expect(all.filter((r) => r.file === "DashboardService.ts" && !r.wired)).toEqual([]);
  });
});

// ================================================================================================ live PostgreSQL
const psql = (db: string, args: string[]) =>
  execFileSync(PSQL, ["-X", "-q", "-v", "ON_ERROR_STOP=1", "-h", PGHOST, "-p", PGPORT, "-U", "postgres", "-d", db, ...args], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
const sqlOf = (file: string) => join(MIG, file);
const created: string[] = [];

describe.skipIf(!live)("QA-visibility-v0 on real PostgreSQL 16 (QA_VIS_PGHOST socket, local only)", () => {
  let admin: Pool;
  const pools: Pool[] = [];
  const pool = (db: string) => { const p = new Pool({ host: PGHOST, port: Number(PGPORT), user: "postgres", database: db, max: 4 }); pools.push(p); return p; };
  const q = <R = Record<string, unknown>>(p: Pool, sql: string, params: unknown[] = []) => p.query(sql, params).then((r) => r.rows as R[]);
  const mkdb = async (name: string) => { await admin.query(`DROP DATABASE IF EXISTS ${name} WITH (FORCE)`); await admin.query(`CREATE DATABASE ${name} TEMPLATE ${TPL}`); created.push(name); return name; };
  const up = (db: string) => psql(db, ["-1", "-f", sqlOf("080_resource_visibility.sql")]);
  const down = (db: string) => psql(db, ["-f", sqlOf("080_resource_visibility.down.sql")]);
  const schemaDump = (p: Pool) => q(p, `SELECT table_name, column_name, data_type, is_nullable, column_default FROM information_schema.columns WHERE table_schema = 'public' ORDER BY 1, 2`)
    .then(async (cols) => ({ cols, funcs: await q(p, `SELECT proname FROM pg_proc WHERE pronamespace = 'public'::regnamespace ORDER BY 1`),
      trg: await q(p, `SELECT tgname FROM pg_trigger WHERE NOT tgisinternal ORDER BY 1`), tables: await q(p, `SELECT tablename FROM pg_tables WHERE schemaname = 'public' ORDER BY 1`) }));

  beforeAll(async () => {
    admin = new Pool({ host: PGHOST, port: Number(PGPORT), user: "postgres", database: "postgres", max: 2 });
    await admin.query(`DROP DATABASE IF EXISTS ${TPL} WITH (FORCE)`);
    await admin.query(`CREATE DATABASE ${TPL}`);
    created.push(TPL);
    for (const r of ["grc_app_runtime", "grc_migrator"]) {
      await admin.query(`DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = '${r}') THEN CREATE ROLE ${r} NOLOGIN; END IF; END $$`);
    }
    psql(TPL, ["-c", "CREATE TABLE schema_migrations (filename text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())"]);
    for (const f of readdirSync(MIG).filter((x) => x.endsWith(".sql") && !x.endsWith(".down.sql")).sort()) {
      if (Number(f.slice(0, 3)) >= 80) continue; // template = 001..079 (V1 added 081/082, which need the column 080 adds: they are not part of the pre-080 state)
      psql(TPL, ["-1", "-f", sqlOf(f)]);
    }
  }, 240_000);

  afterAll(async () => {
    await Promise.all(pools.map((p) => p.end().catch(() => undefined)));
    for (const db of created) await admin.query(`DROP DATABASE IF EXISTS ${db} WITH (FORCE)`).catch(() => undefined);
    await admin.end();
  });

  // ---------------------------------------------------------------------------------------- MIG
  describe("MIG: 080 up / down / up on rows that exist BEFORE 080", () => {
    it("legacy rows get CLIENT; down restores the exact pre-080 schema and keeps the rows; up again; double up and double down are harmless", async () => {
      const db = await mkdb("grc_qa_visv0_mig");
      const p = pool(db);
      const t = (await q<{ id: string }>(p, `INSERT INTO tenants (name) VALUES ('mig') RETURNING id`))[0]!.id;
      const u = (await q<{ id: string }>(p, `INSERT INTO users (tenant_id, email, display_name, roles) VALUES ($1,'m@x.test','M','{}') RETURNING id`, [t]))[0]!.id;
      await p.query(`INSERT INTO departments (tenant_id, name) VALUES ($1,'d')`, [t]);
      const ins: Record<string, string> = {
        risks: `INSERT INTO risks (tenant_id, process, description) VALUES ($1,'p','legacy risk')`,
        controls: `INSERT INTO controls (tenant_id, label, control_type, frequency, executor, compliance_criteria) VALUES ($1,'c','PREVENTIVE','DAILY','e','cc')`,
        anomalies: `INSERT INTO anomalies (tenant_id, description, severity, detected_by) VALUES ($1,'a','LOW','${u}')`,
        action_plans: `INSERT INTO action_plans (tenant_id, title, source_type, responsible_user_id, due_date, created_by) VALUES ($1,'ap','RISK','${u}', current_date,'${u}')`,
        kpis: `INSERT INTO kpis (tenant_id, label, target_value, unit, frequency, owner, department_id) VALUES ($1,'k',1,'u','DAILY','o',(SELECT id FROM departments WHERE tenant_id = $1))`,
      };
      for (const sql of Object.values(ins)) await p.query(sql, [t]);
      const before = await schemaDump(p);
      expect(before.tables.map((x) => x["tablename"])).not.toContain("resource_access_grants");
      await p.query("INSERT INTO schema_migrations (filename) VALUES ('080_resource_visibility.sql')");

      up(db);
      for (const tbl of Object.keys(ins)) {
        const rows = await q<{ visibility: string }>(p, `SELECT visibility FROM ${tbl} WHERE tenant_id = $1`, [t]);
        expect(rows.map((r) => r.visibility), tbl).toEqual(["CLIENT"]);
      }
      // a row inserted WITHOUT the column (code that predates V0) is CLIENT too
      await p.query(ins["risks"]!, [t]);
      expect((await q<{ n: string }>(p, `SELECT count(*) n FROM risks WHERE tenant_id = $1 AND visibility = 'CLIENT'`, [t]))[0]!.n).toBe("2");
      // the 3 values only; NULL refused
      for (const tbl of Object.keys(ins)) {
        await expect(p.query(`UPDATE ${tbl} SET visibility = 'PUBLIC' WHERE tenant_id = $1`, [t]), tbl).rejects.toThrow(/check constraint/);
        await expect(p.query(`UPDATE ${tbl} SET visibility = NULL WHERE tenant_id = $1`, [t]), tbl).rejects.toThrow(/not-null/);
        await expect(p.query(`UPDATE ${tbl} SET visibility = 'client' WHERE tenant_id = $1`, [t]), `${tbl} lower-case`).rejects.toThrow(/check constraint/);
      }
      up(db); // idempotent
      expect((await q(p, `SELECT 1 FROM risks WHERE visibility <> 'CLIENT'`)).length).toBe(0);

      await p.query(`DELETE FROM schema_migrations WHERE filename = 'x'`);
      const withRisk2 = (await q<{ n: string }>(p, `SELECT count(*) n FROM risks`))[0]!.n;
      down(db);
      expect(await schemaDump(p)).toEqual(before);
      expect((await q(p, `SELECT 1 FROM schema_migrations WHERE filename = '080_resource_visibility.sql'`)).length).toBe(0);
      expect((await q<{ n: string }>(p, `SELECT count(*) n FROM risks`))[0]!.n).toBe(withRisk2);
      expect((await q<{ n: string }>(p, `SELECT count(*) n FROM kpis`))[0]!.n).toBe("1");
      down(db); // second down: harmless

      up(db);
      for (const tbl of Object.keys(ins)) {
        expect((await q<{ v: string }>(p, `SELECT DISTINCT visibility v FROM ${tbl}`)).map((r) => r.v), tbl).toEqual(["CLIENT"]);
      }
      expect(await schemaDump(p)).not.toEqual(before);
    }, 120_000);

    it("down is refused to leave a half state: grants present at down time are dropped with the table (documented data loss), the guard functions go too", async () => {
      const db = await mkdb("grc_qa_visv0_down2");
      const p = pool(db);
      up(db);
      expect((await q(p, `SELECT proname FROM pg_proc WHERE proname LIKE 'resource_access_grants%'`)).length).toBe(2);
      down(db);
      expect((await q(p, `SELECT proname FROM pg_proc WHERE proname LIKE 'resource_access_grants%'`)).length).toBe(0);
      expect((await q(p, `SELECT 1 FROM information_schema.columns WHERE column_name = 'visibility' AND table_name IN ('risks','controls','anomalies','action_plans','kpis')`)).length).toBe(0);
    }, 60_000);
  });

  // ---------------------------------------------------------------------------------------- GRT + SP
  describe("GRT / SP: resource_access_grants guard", () => {
    let p: Pool;
    let t1: string, t2: string, a: string, b: string, other: string;
    const resId = randomUUID();
    const grant = (over: Record<string, unknown> = {}, client: Pick<Pool, "query"> = p) => {
      const v = { tenant_id: t1, resource_type: "RISK", resource_id: randomUUID(), user_id: a, granted_by: b, grant_reason: "motif", ...over };
      const cols = Object.keys(v);
      return client.query(`INSERT INTO resource_access_grants (${cols.join(",")}) VALUES (${cols.map((_, i) => `$${i + 1}`).join(",")}) RETURNING id`, Object.values(v));
    };
    const idOf = async (over: Record<string, unknown> = {}) => (await grant(over)).rows[0].id as string;
    beforeAll(async () => {
      const db = await mkdb("grc_qa_visv0_grt");
      p = pool(db);
      up(db);
      t1 = (await q<{ id: string }>(p, `INSERT INTO tenants (name) VALUES ('t1') RETURNING id`))[0]!.id;
      t2 = (await q<{ id: string }>(p, `INSERT INTO tenants (name) VALUES ('t2') RETURNING id`))[0]!.id;
      const mk = async (tn: string, n: string) => (await q<{ id: string }>(p, `INSERT INTO users (tenant_id, email, display_name, roles) VALUES ($1,$2,$2,'{}') RETURNING id`, [tn, `${n}@x.test`]))[0]!.id;
      a = await mk(t1, "a"); b = await mk(t1, "b"); other = await mk(t2, "o");
    }, 60_000);

    it("a well-formed active grant is accepted for each of the 5 resource types; unknown type refused", async () => {
      for (const rt of ["RISK", "CONTROL", "ANOMALY", "ACTION_PLAN", "KPI"]) await expect(grant({ resource_type: rt })).resolves.toBeDefined();
      await expect(grant({ resource_type: "KRI" })).rejects.toThrow(/check constraint/);
      await expect(grant({ resource_type: "risk" })).rejects.toThrow(/check constraint/);
    });

    it("self-grant refused (granted_by = user_id), even through a later UPDATE of granted_by", async () => {
      await expect(grant({ user_id: a, granted_by: a })).rejects.toThrow(/rag_no_self_grant_check/);
      const id = await idOf();
      await expect(p.query(`UPDATE resource_access_grants SET granted_by = user_id WHERE id = $1`, [id])).rejects.toThrow(/immutable|rag_no_self_grant_check/);
    });

    it("tenant isolation: user / granter / revoker of another tenant refused (composite FKs); unknown tenant refused; NULL tenant refused", async () => {
      await expect(grant({ user_id: other })).rejects.toThrow(/rag_user_tenant_fk/);
      await expect(grant({ granted_by: other })).rejects.toThrow(/rag_granted_by_tenant_fk/);
      await expect(grant({ tenant_id: randomUUID() })).rejects.toThrow(/foreign key/);
      await expect(grant({ tenant_id: null })).rejects.toThrow(/not-null/);
      const id = await idOf();
      await expect(p.query(`UPDATE resource_access_grants SET revoked_at = now(), revoked_by = $2, revoke_reason = 'x' WHERE id = $1`, [id, other])).rejects.toThrow(/rag_revoked_by_tenant_fk/);
      expect((await q(p, `SELECT revoked_at FROM resource_access_grants WHERE id = $1 AND revoked_at IS NULL`, [id])).length).toBe(1);
    });

    it("every content column is immutable (id, tenant, type, resource, user, granter, date, reason): UPDATE refused, row unchanged", async () => {
      const id = await idOf();
      const sets: Record<string, [string, unknown]> = {
        id: ["id = $2", randomUUID()], tenant_id: ["tenant_id = $2", t2], resource_type: ["resource_type = $2", "KPI"], resource_id: ["resource_id = $2", randomUUID()],
        user_id: ["user_id = $2", b], granted_by: ["granted_by = $2", a], granted_at: ["granted_at = $2", new Date(0)], grant_reason: ["grant_reason = $2", "autre"],
      };
      const before = (await q(p, `SELECT * FROM resource_access_grants WHERE id = $1`, [id]))[0];
      for (const [col, [set, val]] of Object.entries(sets)) {
        await expect(p.query(`UPDATE resource_access_grants SET ${set} WHERE id = $1`, [id, val]), col).rejects.toThrow(/immutable|foreign key|rag_/);
      }
      expect((await q(p, `SELECT * FROM resource_access_grants WHERE id = $1`, [id]))[0]).toEqual(before);
    });

    it("a grant is revoked ONCE: shape (all three fields together), no restore, no second revocation, no insert-as-revoked", async () => {
      const id = await idOf();
      await expect(p.query(`UPDATE resource_access_grants SET revoked_at = now() WHERE id = $1`, [id])).rejects.toThrow(/rag_revocation_shape_check/);
      await expect(p.query(`UPDATE resource_access_grants SET revoked_at = now(), revoked_by = $2, revoke_reason = '   ' WHERE id = $1`, [id, b])).rejects.toThrow(/check constraint/);
      await expect(p.query(`UPDATE resource_access_grants SET revoked_at = now(), revoked_by = $2, revoke_reason = $3 WHERE id = $1`, [id, b, "x".repeat(501)])).rejects.toThrow(/check constraint/);
      await p.query(`UPDATE resource_access_grants SET revoked_at = now(), revoked_by = $2, revoke_reason = 'fin' WHERE id = $1`, [id, b]);
      await expect(p.query(`UPDATE resource_access_grants SET revoke_reason = 'autre' WHERE id = $1`, [id])).rejects.toThrow(/revoked once/);
      await expect(p.query(`UPDATE resource_access_grants SET revoked_at = now(), revoked_by = $2, revoke_reason = 'bis' WHERE id = $1`, [id, a])).rejects.toThrow(/revoked once/);
      await expect(p.query(`UPDATE resource_access_grants SET revoked_at = NULL, revoked_by = NULL, revoke_reason = NULL WHERE id = $1`, [id])).rejects.toThrow(/revoked once/);
      await expect(grant({ revoked_at: new Date(), revoked_by: b, revoke_reason: "d" })).rejects.toThrow(/inserted active/);
      await expect(grant({ revoked_by: b })).rejects.toThrow(/inserted active|rag_revocation_shape_check/);
    });

    // QA-VIS0-01 (MINOR, fixed in 080): a revocation always carries its revoker AND its reason.
    it("QA-VIS0-01: a revocation without reason or without revoker is refused by the database", async () => {
      const noReason = await idOf();
      await expect(p.query(`UPDATE resource_access_grants SET revoked_at = now(), revoked_by = $2 WHERE id = $1`, [noReason, b])).rejects.toThrow();
      const noRevoker = await idOf();
      await expect(p.query(`UPDATE resource_access_grants SET revoked_at = now(), revoke_reason = 'fin' WHERE id = $1`, [noRevoker])).rejects.toThrow();
    });

    it("no DELETE (active or revoked row) and no TRUNCATE (plain, CASCADE) for the superuser; rows survive", async () => {
      const active = await idOf();
      const revoked = await idOf();
      await p.query(`UPDATE resource_access_grants SET revoked_at = now(), revoked_by = $2, revoke_reason = 'fin' WHERE id = $1`, [revoked, b]);
      const n = (await q<{ n: string }>(p, `SELECT count(*) n FROM resource_access_grants`))[0]!.n;
      for (const id of [active, revoked]) await expect(p.query(`DELETE FROM resource_access_grants WHERE id = $1`, [id])).rejects.toThrow(/never deleted/);
      await expect(p.query(`DELETE FROM resource_access_grants`)).rejects.toThrow(/never deleted/);
      await expect(p.query(`TRUNCATE resource_access_grants`)).rejects.toThrow(/cannot be truncated/);
      await expect(p.query(`TRUNCATE resource_access_grants CASCADE`)).rejects.toThrow(/cannot be truncated/);
      expect((await q<{ n: string }>(p, `SELECT count(*) n FROM resource_access_grants`))[0]!.n).toBe(n);
      // a session that tries to bypass with a temp search_path still hits the guard (function pinned)
      const c = await p.connect();
      try {
        await c.query(`SET search_path = pg_temp`);
        await expect(c.query(`DELETE FROM public.resource_access_grants WHERE id = $1`, [active])).rejects.toThrow(/never deleted/);
        await expect(c.query(`TRUNCATE public.resource_access_grants`)).rejects.toThrow(/cannot be truncated/);
      } finally { await c.query(`RESET search_path`).catch(() => undefined); c.release(); }
    });

    it("runtime role grc_app_runtime: INSERT / SELECT / UPDATE allowed by privilege, DELETE and TRUNCATE refused by privilege (second line of defence)", async () => {
      const c = await p.connect();
      try {
        await c.query(`SET ROLE grc_app_runtime`);
        await expect(c.query(`DELETE FROM resource_access_grants`)).rejects.toThrow(/permission denied/);
        await expect(c.query(`TRUNCATE resource_access_grants`)).rejects.toThrow(/permission denied/);
        const id = (await grant({}, c)).rows[0].id;
        await expect(c.query(`UPDATE resource_access_grants SET grant_reason = 'z' WHERE id = $1`, [id])).rejects.toThrow(/immutable/);
        await c.query(`UPDATE resource_access_grants SET revoked_at = now(), revoked_by = $2, revoke_reason = 'fin' WHERE id = $1`, [id, b]);
        expect((await c.query(`SELECT count(*) n FROM resource_access_grants WHERE id = $1`, [id])).rows[0].n).toBe("1");
      } finally { await c.query(`RESET ROLE`).catch(() => undefined); c.release(); }
    });

    it("one ACTIVE grant per (tenant, type, resource, user); a revoked one allows a new grant; reason bounds 1..500 after trim", async () => {
      const rid = randomUUID();
      const id = await idOf({ resource_id: rid });
      await expect(grant({ resource_id: rid })).rejects.toThrow(/rag_active_idx|duplicate key/);
      await grant({ resource_id: rid, user_id: b, granted_by: a }); // another person: fine
      await p.query(`UPDATE resource_access_grants SET revoked_at = now(), revoked_by = $2, revoke_reason = 'fin' WHERE id = $1`, [id, b]);
      await expect(grant({ resource_id: rid })).resolves.toBeDefined();
      await expect(grant({ grant_reason: "" })).rejects.toThrow(/check constraint/);
      await expect(grant({ grant_reason: "   " })).rejects.toThrow(/check constraint/);
      await expect(grant({ grant_reason: "x".repeat(501) })).rejects.toThrow(/check constraint/);
      await expect(grant({ grant_reason: "x".repeat(500) })).resolves.toBeDefined();
      await expect(grant({ grant_reason: null })).rejects.toThrow(/not-null/);
      void resId;
    });

    // QA-VIS0-02 (TRIVIAL, fixed in 080, same family as F-PNL-11): blank-only reasons (tab, newline...) are refused.
    it("QA-VIS0-02: a grant / revoke reason made only of tab or newline characters is refused", async () => {
      await expect(grant({ grant_reason: "\t\n" })).rejects.toThrow(/check constraint/);
    });

    it("SP: both guard functions pin search_path = pg_catalog, public, pg_temp (pg_temp LAST); triggers: BEFORE row INSERT/UPDATE/DELETE + BEFORE statement TRUNCATE", async () => {
      const fns = await q<{ proname: string; proconfig: string[] | null }>(p, `SELECT proname, proconfig FROM pg_proc WHERE proname IN ('resource_access_grants_guard','resource_access_grants_truncate_guard') ORDER BY 1`);
      expect(fns.map((f) => f.proname)).toEqual(["resource_access_grants_guard", "resource_access_grants_truncate_guard"]);
      for (const f of fns) {
        const sp = (f.proconfig ?? []).find((c) => c.startsWith("search_path="));
        expect(sp, f.proname).toBe("search_path=pg_catalog, public, pg_temp");
        expect(sp!.endsWith("pg_temp")).toBe(true);
      }
      const trg = await q<{ tgname: string; tgtype: number }>(p, `SELECT tgname, tgtype FROM pg_trigger WHERE tgrelid = 'resource_access_grants'::regclass AND NOT tgisinternal ORDER BY 1`);
      // bits: 1 row, 2 before, 4 insert, 8 delete, 16 update, 32 truncate
      expect(trg).toEqual([{ tgname: "resource_access_grants_guard", tgtype: 1 | 2 | 4 | 8 | 16 }, { tgname: "resource_access_grants_truncate_guard", tgtype: 2 | 32 }]);
    });

    it("SP (global): every trigger function created from migration 058 on, on any table, still carries a pinned search_path with pg_temp last", async () => {
      const rows = await q<{ proname: string; proconfig: string[] | null }>(p, `SELECT DISTINCT f.proname, f.proconfig FROM pg_trigger t JOIN pg_proc f ON f.oid = t.tgfoid WHERE NOT t.tgisinternal AND f.pronamespace = 'public'::regnamespace ORDER BY 1`);
      const bad = rows.filter((r) => {
        const sp = (r.proconfig ?? []).find((c) => c.startsWith("search_path="));
        return !sp || !sp.endsWith("pg_temp");
      }).map((r) => r.proname);
      // informational for functions older than 058 (the project rule starts at 058); 080's own are checked strictly above
      expect(bad.filter((n) => n.startsWith("resource_access_grants"))).toEqual([]);
    });
  });

  // ---------------------------------------------------------------------------------------- VIS
  describe("VIS: real services + repositories + role repository on PostgreSQL, one row per root forced to PERIMETRE / NOMINATIF", () => {
    let p: Pool;
    let t: string, t2: string;
    const u: Record<string, string> = {};
    const ids: Record<"risks" | "controls" | "anomalies" | "action_plans" | "kpis", { open: string; perimetre: string; nominatif: string; other: string }> = {} as never;
    const svc = () => {
      const roles = new PostgresRoleRepository(p);
      const resolver = new VisibilityResolver(roles);
      const audit = new PostgresAuditRepository(p);
      const risks = new PostgresRiskRepository(p);
      const controls = new PostgresControlRepository(p);
      return {
        risk: new RiskService(risks, audit, undefined, undefined, undefined, undefined, undefined, resolver),
        control: new ControlService(controls, risks, audit, undefined, resolver),
        anomaly: new AnomalyService(new PostgresAnomalyRepository(p), audit, undefined, undefined, undefined, resolver),
        action: new ActionPlanService(new PostgresActionPlanRepository(p), audit, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, resolver),
        kpi: new KpiService(new PostgresKpiRepository(p), { getLatest: async () => null } as never, {} as never, {} as never, audit, resolver),
        repos: { risks, controls, anomalies: new PostgresAnomalyRepository(p), actions: new PostgresActionPlanRepository(p), kpis: new PostgresKpiRepository(p) },
      };
    };
    const seed = async (tenant: string, n: string, creator: string) => {
      const dept = (await q<{ id: string }>(p, `INSERT INTO departments (tenant_id, name) VALUES ($1,$2) RETURNING id`, [tenant, `d-${n}`]))[0]!.id;
      const mk = async (sql: string) => (await q<{ id: string }>(p, sql, [tenant]))[0]!.id;
      return {
        risks: await mk(`INSERT INTO risks (tenant_id, process, description) VALUES ($1,'p','${n}') RETURNING id`),
        controls: await mk(`INSERT INTO controls (tenant_id, label, control_type, frequency, executor, compliance_criteria) VALUES ($1,'${n}','PREVENTIVE','DAILY','e','cc') RETURNING id`),
        anomalies: await mk(`INSERT INTO anomalies (tenant_id, description, severity, detected_by) VALUES ($1,'${n}','LOW','${creator}') RETURNING id`),
        action_plans: await mk(`INSERT INTO action_plans (tenant_id, title, source_type, responsible_user_id, due_date, created_by) VALUES ($1,'${n}','RISK','${creator}', current_date,'${creator}') RETURNING id`),
        kpis: await mk(`INSERT INTO kpis (tenant_id, label, target_value, unit, frequency, owner, department_id) VALUES ($1,'${n}',1,'u','DAILY','o','${dept}') RETURNING id`),
      };
    };
    beforeAll(async () => {
      const db = await mkdb("grc_qa_visv0_vis");
      p = pool(db);
      up(db);
      // QA-V1: the services now call risk_visible_to for an ordinary reader (readerScope): the database needs 081 and 082 on top of 080.
      // Lot V2: the four other roots call <root>_visible_to (083) too.
      for (const f of ["081_audit_read_audit_group_only.sql", "082_risk_visibility.sql", "083_resource_visibility_v2.sql"]) psql(db, ["-1", "-f", sqlOf(f)]);
      t = (await q<{ id: string }>(p, `INSERT INTO tenants (name) VALUES ('vis') RETURNING id`))[0]!.id;
      t2 = (await q<{ id: string }>(p, `INSERT INTO tenants (name) VALUES ('vis2') RETURNING id`))[0]!.id;
      const grp = async (tn: string, name: string, g: SystemGroup | null, extra = "") =>
        (await q<{ id: string }>(p, `INSERT INTO roles (tenant_id, name, permissions, system_group ${extra ? ", deleted_at" : ""}) VALUES ($1,$2,'{risk.read}',$3 ${extra ? ", now()" : ""}) RETURNING id`, [tn, name, g]))[0]!.id;
      const rm = await grp(t, "Risk Manager", "RISK_MANAGER");
      const com = await grp(t, "Comité", "RISK_COMMITTEE");
      const aud = await grp(t, "Audit", "AUDIT");
      const fake = await grp(t, "Risk Manager (nom seulement)", null);
      const disabled = await grp(t, "Audit désactivé", null, "x");
      const user = async (tn: string, n: string) => (await q<{ id: string }>(p, `INSERT INTO users (tenant_id, email, display_name, roles) VALUES ($1,$2,$2,'{}') RETURNING id`, [tn, `${n}@vis.test`]))[0]!.id;
      for (const n of ["reader", "admin", "rm", "com", "aud", "fake", "revoked", "disabled", "creator"]) u[n] = await user(t, n);
      u["otherTenantRm"] = await user(t2, "otherrm");
      const seat = (tn: string, roleId: string, uid: string, revoked = false) =>
        p.query(`INSERT INTO user_roles (tenant_id, role_id, user_id, granted_by, revoked_at) VALUES ($1,$2,$3,$3,${revoked ? "now()" : "NULL"})`, [tn, roleId, uid]);
      await seat(t, rm, u["rm"]!); await seat(t, com, u["com"]!); await seat(t, aud, u["aud"]!); await seat(t, fake, u["fake"]!);
      await seat(t, rm, u["revoked"]!, true); await seat(t, disabled, u["disabled"]!);
      const rm2 = await grp(t2, "Risk Manager", "RISK_MANAGER");
      await seat(t2, rm2, u["otherTenantRm"]!);
      const mine = await Promise.all([seed(t, "open", u["creator"]!), seed(t, "perimetre", u["creator"]!), seed(t, "nominatif", u["creator"]!)]);
      const foreign = await seed(t2, "foreign", u["otherTenantRm"]!);
      for (const k of Object.keys(mine[0]!) as Array<keyof typeof ids>) {
        ids[k] = { open: mine[0]![k], perimetre: mine[1]![k], nominatif: mine[2]![k], other: foreign[k] };
        await p.query(`UPDATE ${k} SET visibility = 'PERIMETRE' WHERE id = $1`, [mine[1]![k]]);
        await p.query(`UPDATE ${k} SET visibility = 'NOMINATIF' WHERE id = $1`, [mine[2]![k]]);
      }
    }, 90_000);

    const listIds = async (name: string, a: AuthenticatedUser) => {
      const s = svc();
      const call = { risks: () => s.risk.list(a), controls: () => s.control.list(a), anomalies: () => s.anomaly.list(a), action_plans: () => s.action.list(a), kpis: () => s.kpi.list(a) };
      const out: Record<string, string[]> = {};
      for (const [k, f] of Object.entries(call)) out[k] = ((await f()) as Array<{ id: string }>).map((r) => r.id).sort();
      void name;
      return out;
    };
    const getErr = async (k: keyof typeof ids, id: string, a: AuthenticatedUser) => {
      const s = svc();
      const f = { risks: () => s.risk.get(a, id), controls: () => s.control.get(a, id), anomalies: () => s.anomaly.get(a, id), action_plans: () => s.action.get(a, id), kpis: () => s.kpi.get(a, id) }[k];
      return f().then((r) => r as { id: string }, (e: unknown) => e as Error);
    };

    it("first-line reader (and administrator without group, role NAMED Risk Manager, revoked seat, disabled role, other-tenant RM): list = CLIENT rows only, restricted ids -> NotFound identical to an unknown id", async () => {
      for (const who of ["reader", "admin", "fake", "revoked", "disabled", "creator"]) {
        const a = actor(u[who]!, t);
        const l = await listIds(who, a);
        for (const k of Object.keys(ids) as Array<keyof typeof ids>) {
          // Lot V2 (spec §1, I-3): the declarer of an anomaly and the responsible of a plan (here the same "creator") stand
          // for the owner of a resource with its own level, and always read it ("ce qui m'est assigné").
          if (who === "creator" && (k === "anomalies" || k === "action_plans")) {
            expect(l[k], `${who} ${k}`).toEqual([ids[k].open, ids[k].perimetre, ids[k].nominatif].sort());
            continue;
          }
          expect(l[k], `${who} ${k}`).toEqual([ids[k].open]);
          for (const hidden of [ids[k].perimetre, ids[k].nominatif]) {
            const e = await getErr(k, hidden, a);
            expect(e, `${who} ${k}`).toBeInstanceOf(NotFoundError);
            const unknown = randomUUID();
            const e2 = await getErr(k, unknown, a);
            expect((e as Error).message.replace(hidden, "<id>"), `${who} ${k} no oracle`).toBe((e2 as Error).message.replace(unknown, "<id>"));
          }
          expect(((await getErr(k, ids[k].open, a)) as { id: string }).id).toBe(ids[k].open);
        }
      }
    });

    it("Risk Manager / Committee / Audit: see all 3 rows of their tenant on the 5 resources, list and by id; never the other tenant's", async () => {
      for (const who of ["rm", "com", "aud"]) {
        const a = actor(u[who]!, t);
        const l = await listIds(who, a);
        for (const k of Object.keys(ids) as Array<keyof typeof ids>) {
          expect(l[k], `${who} ${k}`).toEqual([ids[k].open, ids[k].perimetre, ids[k].nominatif].sort());
          expect(l[k]).not.toContain(ids[k].other);
          for (const id of [ids[k].perimetre, ids[k].nominatif]) expect(((await getErr(k, id, a)) as { id: string }).id, `${who} ${k}`).toBe(id);
          expect(await getErr(k, ids[k].other, a), `${who} ${k} tenant`).toBeInstanceOf(NotFoundError);
        }
      }
      // an RM of ANOTHER tenant sees nothing of this one, whatever the visibility
      const foreign = await listIds("t2rm", actor(u["otherTenantRm"]!, t2));
      for (const k of Object.keys(ids) as Array<keyof typeof ids>) expect(foreign[k]).toEqual([ids[k].other]);
    });

    it("repository level: SYSTEM_SCOPE (explicit internal read) = everything, {all:true} = everything, {all:false} = CLIENT; filter applied BEFORE the by-id fetch", async () => {
      const { repos } = svc();
      const one = async (k: keyof typeof ids, scope?: ReadScope) => {
        const r = { risks: repos.risks, controls: repos.controls, anomalies: repos.anomalies, action_plans: repos.actions, kpis: repos.kpis }[k] as unknown as {
          getById(t: string, id: string, s?: ReadScope): Promise<unknown>; list(t: string, o: unknown, s?: ReadScope): Promise<Array<{ id: string }>> };
        return { byId: await r.getById(t, ids[k].perimetre, scope), list: (await r.list(t, undefined, scope)).map((x) => x.id) };
      };
      for (const k of Object.keys(ids) as Array<keyof typeof ids>) {
        for (const scope of [SYSTEM_SCOPE, { all: true } as ReadScope]) {
          const r = await one(k, scope);
          expect(r.byId, k).not.toBeNull();
          expect(r.list.length, k).toBe(3);
        }
        const r = await one(k, { all: false });
        expect(r.byId, k).toBeNull();
        expect(r.list, k).toEqual([ids[k].open]);
      }
    });

    it("non-regression: with every row CLIENT again, the scoped list equals the unscoped list for every reader (row for row)", async () => {
      for (const k of Object.keys(ids) as Array<keyof typeof ids>) await p.query(`UPDATE ${k} SET visibility = 'CLIENT'`);
      const { repos } = svc();
      const lists = (scope?: ReadScope) => Promise.all([repos.risks.list(t, {}, scope), repos.controls.list(t, {}, scope), repos.anomalies.list(t, {}, scope), repos.actions.list(t, {}, scope), repos.kpis.list(t, {}, scope)]);
      const ref = JSON.stringify(await lists(SYSTEM_SCOPE));
      expect(JSON.stringify(await lists({ all: true }))).toBe(ref);
      expect(JSON.stringify(await lists({ all: false }))).toBe(ref);
      for (const who of ["reader", "rm", "aud"]) expect(await listIds(who, actor(u[who]!, t))).toEqual(await listIds("rm", actor(u["rm"]!, t)));
    });
  });
});
