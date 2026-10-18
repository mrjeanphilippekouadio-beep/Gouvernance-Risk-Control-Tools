import { afterAll, beforeAll, describe, expect, it } from "vitest";
import express from "express";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import { errorHandler } from "../src/api/middleware/errorHandler.js";
import { configRouter } from "../src/api/v1/config.routes.js";
import { processesRouter } from "../src/api/v1/processes.routes.js";
import { processEvaluationModeRequestsRouter } from "../src/api/v1/processEvaluationModeRequests.routes.js";
import { moduleTogglesRouter } from "../src/api/v1/moduleToggles.routes.js";
import { ConfigService } from "../src/services/ConfigService.js";
import { ModuleToggleService } from "../src/services/ModuleToggleService.js";
import { ProcessService } from "../src/services/ProcessService.js";
import { ProcessEvaluationModeRequestService } from "../src/services/ProcessEvaluationModeRequestService.js";
import { RatingScaleService } from "../src/services/RatingScaleService.js";
import { PostgresModuleToggleRepository } from "../src/infrastructure/database/postgres/PostgresModuleToggleRepository.js";
import { PostgresRatingScaleRepository } from "../src/infrastructure/database/postgres/PostgresRatingScaleRepository.js";
import { resolveInheritedEvaluationMode, type Process } from "../src/domain/entities/Process.js";
import type { ModuleToggle } from "../src/domain/entities/ModuleToggle.js";
import type { AuthenticatedUser } from "../src/infrastructure/identity/IdentityProvider.js";

/**
 * QA-SWP: level 2 review of the "single write path" lot (5b35762, DECISION-054/058/062).
 * Oracle written before running: see each test title. PG part is skipped unless QA_SWP_PGHOST starts with "/"
 * (dedicated database grc_qa_a08, never Neon).
 */

const actorOf = (roles: string[], userId = "u-1"): AuthenticatedUser =>
  ({ userId, tenantId: "t-1", email: "a@x.test", roles }) as unknown as AuthenticatedUser;

async function http(mount: (app: express.Express) => void, user: AuthenticatedUser, method: string, path: string, body?: unknown) {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    (req as unknown as { user: AuthenticatedUser }).user = user;
    (req as unknown as { requestId: string }).requestId = "req";
    next();
  });
  mount(app);
  app.use(errorHandler);
  const server = app.listen(0);
  try {
    const addr = server.address();
    const port = typeof addr === "object" && addr ? addr.port : 0;
    const res = await fetch(`http://127.0.0.1:${port}${path}`, {
      method,
      headers: { "content-type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    return { status: res.status, json: (await res.json().catch(() => null)) as Record<string, unknown> | null };
  } finally {
    server.close();
  }
}

function srcFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((f) => {
    const p = join(dir, f);
    return statSync(p).isDirectory() ? srcFiles(p) : p.endsWith(".ts") ? [p] : [];
  });
}
const SRC = join(__dirname, "..", "src");

// ---------------------------------------------------------------------------------------------------------------
describe("QA-SWP A. closed writers answer 410 whatever the input and the caller", () => {
  const writes: unknown[] = [];
  const configs = { async getByTenant() { return null; }, async upsert(...a: unknown[]) { writes.push(a); return { id: "c" }; } };
  const audit = { async record() { writes.push("audit"); }, async listForEntity() { return []; }, async listRecent() { return []; } };
  const svc = new ConfigService(configs as never, audit as never);
  const mount = (app: express.Express) => app.use("/config", configRouter(svc));

  it("PUT /config and /config/appetite-mode: 410 for an empty body, a garbage body, no body and a caller with NO permission; nothing written", async () => {
    const nobody = actorOf([]);
    for (const path of ["/config", "/config/appetite-mode"]) {
      for (const body of [{}, { scoreFormula: 42 }, undefined, { mode: "MANUEL", reason: "" }]) {
        const r = await http(mount, nobody, "PUT", path, body);
        expect(r.status, `${path} ${JSON.stringify(body)}`).toBe(410);
      }
    }
    expect(writes).toHaveLength(0);
  });

  it("GET /config is still readable (read side of the screens is kept) and PATCH/POST /config do not exist (404, not a write)", async () => {
    const reader = actorOf(["config.read"]);
    expect((await http(mount, reader, "GET", "/config")).status).toBe(200);
    expect((await http(mount, reader, "PATCH", "/config", { scoreFormula: "WEIGHTED_SUM" })).status).toBe(404);
    expect((await http(mount, reader, "POST", "/config", {})).status).toBe(404);
    expect(writes).toHaveLength(0);
  });

  it("PUT /processes/:id/evaluation-mode: 410 even with null (the 'back to inherited' body), a bad mode and an unprivileged caller; the service is never touched", async () => {
    const service = new Proxy({}, { get: () => { throw new Error("service must not be called"); } });
    const mountP = (app: express.Express) => app.use("/processes", processesRouter(service as never));
    for (const body of [{ evaluationMode: null }, { evaluationMode: "NOPE" }, {}, undefined]) {
      const r = await http(mountP, actorOf([]), "PUT", "/processes/p1/evaluation-mode", body);
      expect(r.status, JSON.stringify(body)).toBe(410);
    }
  });
});

// ---------------------------------------------------------------------------------------------------------------
describe("QA-SWP B. no other path writes Process.evaluationMode or the Config methodology", () => {
  it("every UPDATE-capable HTTP route of processes drops an evaluationMode key (PATCH + POST) before it reaches the repository", async () => {
    const updates: unknown[] = [];
    const creates: unknown[] = [];
    const proc = { id: "p1", tenantId: "t-1", level: "PROCESS", parentId: null, name: "P", evaluationMode: null, departmentId: "d1", active: true } as unknown as Process;
    const repo = {
      async getById() { return proc; }, async list() { return [proc]; },
      async create(i: unknown) { creates.push(i); return proc; },
      async update(_t: string, _id: string, i: unknown) { updates.push(i); return proc; },
      async softDelete() {},
    };
    const departments = { async getById() { return { id: "d1" }; } };
    const audit = { async record() {} };
    const svc = new ProcessService(repo as never, audit as never, undefined as never, undefined as never, undefined as never, departments as never);
    const mount = (app: express.Express) => app.use("/processes", processesRouter(svc));
    const user = actorOf(["process.read", "process.update", "process.create"]);
    const dept = randomUUID();
    await http(mount, user, "PATCH", "/processes/p1", { name: "renamed", evaluationMode: "PARTICIPATIF" });
    await http(mount, user, "POST", "/processes", { level: "PROCESS", name: "n", departmentId: dept, evaluationMode: "PARTICIPATIF" });
    for (const i of [...updates, ...creates]) expect(i).not.toHaveProperty("evaluationMode");
    expect(updates.length + creates.length).toBeGreaterThan(0);
  });

  it("dead writers are not reachable from any route or any other service (static inventory of callers)", () => {
    const dead = ["updateMethodology", "updateAppetiteMode", "setEvaluationMode", "setMode"];
    const hits: string[] = [];
    for (const f of srcFiles(SRC)) {
      const text = readFileSync(f, "utf8");
      for (const name of dead) {
        // a call site: ".name(" ; the definitions are "async name(" without the dot
        if (new RegExp(`\\.${name}\\(`).test(text)) hits.push(`${f.replace(SRC, "src")}:${name}`);
      }
    }
    expect(hits).toEqual([]);
  });

  it("the Excel import only talks to RiskService (no settings writer in its constructor or imports)", () => {
    const text = readFileSync(join(SRC, "services", "RiskImportService.ts"), "utf8");
    expect(text).not.toMatch(/ConfigService|ConfigRepository|RatingScale|RiskAppetite|ProcessRepository|evaluationMode/);
  });

  it("the remaining HTTP writers of a framework-owned setting are fenced when the Dispositif is wired (appetite upsert/archive, scale activate, committee thresholds/enforcement/evaluation-mode)", async () => {
    const wired = { async listFrameworks() { return []; } };
    const { RiskAppetiteService } = await import("../src/services/RiskAppetiteService.js");
    const cfg = new ConfigService({ async getByTenant() { return null; }, async upsert() { throw new Error("write!"); } } as never, { async record() { throw new Error("audit!"); } } as never, undefined, wired);
    const all = actorOf(["config.update", "config.committeethreshold.set", "config.committeeenforcement.set"]);
    await expect(cfg.updateEvaluationMode(all, "PARTICIPATIF", "r", "q")).rejects.toThrow(/Dispositif/);
    await expect(cfg.updateCommitteeThresholds(all, { evaluationMinScore: 5 }, "r", "q")).rejects.toThrow(/Dispositif/);
    await expect(cfg.setCommitteeEnforcement(all, false, "r", "q")).rejects.toThrow(/Dispositif/);
    const app = new RiskAppetiteService({ async upsert() { throw new Error("write!"); }, async softDelete() { throw new Error("write!"); } } as never, { async record() { throw new Error("audit!"); } } as never, undefined as never, undefined as never, wired as never);
    await expect(app.setThreshold(actorOf(["riskappetite.update"]), "Fraude", { threshold: 5, methodologyVersion: "v", active: true } as never, "q")).rejects.toThrow(/Dispositif/);
    await expect(app.archive(actorOf(["riskappetite.delete"]), "id", "r", "q")).rejects.toThrow(/Dispositif/);
  });

  it("KNOWN residual: PUT /config/committee-audit-cumul is NOT fenced by the Dispositif and stays a one-admin write (DECISION-058: allowed, reason mandatory, before/after audited)", async () => {
    const events: Array<{ oldValue: unknown; newValue: unknown; reason: unknown }> = [];
    let row: Record<string, unknown> | null = null;
    const configs = { async getByTenant() { return row; }, async upsert(_t: string, patch: Record<string, unknown>) { row = { id: "c", ...(row ?? {}), ...patch }; return row; } };
    const audit = { async record(e: never) { events.push(e); } };
    const svc = new ConfigService(configs as never, audit as never, undefined, { async listFrameworks() { return []; } });
    const user = actorOf(["config.cumul.set", "config.read"]);
    const mount = (app: express.Express) => app.use("/config", configRouter(svc));
    expect((await http(mount, user, "PUT", "/config/committee-audit-cumul", { allowed: false, reason: "   " })).status).toBe(400);
    expect((await http(mount, user, "PUT", "/config/committee-audit-cumul", { allowed: false, reason: "durcissement" })).status).toBe(200);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ reason: "durcissement" });
    expect((events[0]!.oldValue as { committeeAuditCumulAllowed: boolean }).committeeAuditCumulAllowed).toBe(true);
    expect((events[0]!.newValue as { committeeAuditCumulAllowed: boolean }).committeeAuditCumulAllowed).toBe(false);
  });
});

// ---------------------------------------------------------------------------------------------------------------
describe("QA-SWP C. what the circuit replaces: orphan permission and lost 'back to inherited'", () => {
  const proc = { id: "p1", tenantId: "t-1", level: "PROCESS", parentId: null, name: "P", evaluationMode: null } as unknown as Process;
  function circuit() {
    const reqs: Array<Record<string, unknown>> = [];
    const processUpdates: unknown[] = [];
    const svc = new ProcessEvaluationModeRequestService(
      {
        async getById(_t: string, id: string) { return reqs.find((r) => r.id === id) ?? null; },
        async list() { return reqs; },
        async create(i: Record<string, unknown>) { const r = { id: randomUUID(), status: "PENDING_VALIDATION", ...i }; reqs.push(r); return r; },
        async validate(_t: string, id: string, by: string) { const r = reqs.find((x) => x.id === id)!; r.status = "VALIDATED"; r.validatedBy = by; return r; },
        async reject() { throw new Error("n/a"); },
      } as never,
      { async getById() { return proc; }, async update(_t: string, _id: string, i: unknown) { processUpdates.push(i); return { ...proc, ...(i as object) }; } } as never,
      { async list() { return []; } } as never,
      { async record() {} } as never,
    );
    return { svc, processUpdates };
  }

  it("the circuit cannot express 'inherited' : requestedMode null is a 400 over HTTP", async () => {
    const { svc } = circuit();
    const mount = (app: express.Express) => app.use("/r", processEvaluationModeRequestsRouter(svc));
    const r = await http(mount, actorOf(["process.evaluationmode.propose"]), "POST", "/r", { processId: "p1", requestedMode: null });
    expect(r.status).toBe(400);
  });

  it("process.evaluationmode.set no longer opens anything: alone it cannot propose, validate or reject (orphan permission)", async () => {
    const { svc } = circuit();
    const holder = actorOf(["process.evaluationmode.set", "process.read"]);
    await expect(svc.propose(holder, "p1", "PARTICIPATIF", "q")).rejects.toThrow(/Missing permission/);
    await expect(svc.validate(holder, "x", "q")).rejects.toThrow(/Missing permission/);
    await expect(svc.reject(holder, "x", "r", "q")).rejects.toThrow(/Missing permission/);
  });

  it("maker-checker holds: the proposer can never validate; a second person can, and the process then carries the explicit mode", async () => {
    const { svc, processUpdates } = circuit();
    const maker = actorOf(["process.evaluationmode.propose", "evaluationmode.validate"], "maker");
    const checker = actorOf(["evaluationmode.validate"], "checker");
    const req = await svc.propose(maker, "p1", "PARTICIPATIF", "q");
    await expect(svc.validate(maker, req.id, "q")).rejects.toThrow();
    expect(processUpdates).toHaveLength(0);
    await svc.validate(checker, req.id, "q");
    expect(processUpdates).toEqual([{ evaluationMode: "PARTICIPATIF" }]);
  });

  it("consequence of the lost capability: an explicit process mode keeps winning over the Dispositif default and nothing can clear it (INFO)", () => {
    const pinned = [{ evaluationMode: "CLASSIQUE" as const }];
    expect(resolveInheritedEvaluationMode(pinned, "PARTICIPATIF")).toBe("CLASSIQUE");
    expect(resolveInheritedEvaluationMode([{ evaluationMode: null }], "PARTICIPATIF")).toBe("PARTICIPATIF");
  });

  it("no frontend screen called the closed route (the capability had no UI)", () => {
    const root = join(__dirname, "..", "..", "frontend", "src");
    const hits = srcFiles(root).filter((f) => /\/processes\/.*evaluation-mode|evaluation-mode/.test(readFileSync(f, "utf8")));
    expect(hits).toEqual([]);
  });
});

// ---------------------------------------------------------------------------------------------------------------
describe("QA-SWP D. PATCH /modules/:name/toggle", () => {
  function setup(opts: { auditFails?: boolean } = {}) {
    const store = new Map<string, ModuleToggle>();
    const events: Array<{ oldValue: any; newValue: any; reason: string | null }> = [];
    const audit = { async record(e: any) { if (opts.auditFails) throw new Error("audit down"); events.push(e); }, async listForEntity() { return []; }, async listRecent() { return []; } };
    // Models the contract of PostgresModuleToggleRepository: state + audit events in one transaction (rolled back if an event cannot be written).
    const repo = {
      auditsInTransaction: true,
      async list() { return [...store.values()]; },
      async getByName(_t: string, m: string) { return store.get(m) ?? null; },
      async upsert(t: string, m: string, enabled: boolean, by: string, build?: (r: { before: ModuleToggle | null; after: ModuleToggle }) => unknown[]) {
        const before = store.get(m) ?? null;
        const row = { id: before?.id ?? randomUUID(), tenantId: t, moduleName: m, enabled, updatedBy: by, createdAt: new Date(), updatedAt: new Date() } as ModuleToggle;
        store.set(m, row);
        try {
          for (const e of build?.({ before, after: row }) ?? []) await audit.record(e);
        } catch (err) {
          if (before) store.set(m, before); else store.delete(m);
          throw err;
        }
        return row;
      },
    };
    const svc = new ModuleToggleService(repo as never, audit as never);
    const mount = (app: express.Express) => app.use("/modules", moduleTogglesRouter(svc));
    return { store, events, mount };
  }
  const admin = actorOf(["config.manage", "config.read"]);
  const patch = (s: ReturnType<typeof setup>, name: string, body: unknown, user = admin) => http(s.mount, user, "PATCH", `/modules/${name}/toggle`, body);

  it("refuses a missing, null, empty, whitespace-only, non-string or >500 reason with 400, writing neither state nor audit", async () => {
    const s = setup();
    for (const reason of [undefined, null, "", "   ", "\t\n ", 42, ["x"], "x".repeat(501), " ".repeat(500)]) {
      const r = await patch(s, "KRI", { enabled: false, reason });
      expect(r.status, JSON.stringify(reason)).toBe(400);
    }
    expect(s.store.size).toBe(0);
    expect(s.events).toHaveLength(0);
  });

  it("accepts exactly 500 characters and stores the trimmed reason; the old body shape without reason is now a 400 (breaking contract, no frontend caller)", async () => {
    const s = setup();
    expect((await patch(s, "KRI", { enabled: false, reason: "r".repeat(500) })).status).toBe(200);
    expect(s.events[0]!.reason).toBe("r".repeat(500));
    expect((await patch(s, "KPI", { enabled: false })).status).toBe(400);
  });

  it("a non-boolean enabled, an unknown module and a caller without config.manage change nothing", async () => {
    const s = setup();
    expect((await patch(s, "KRI", { enabled: "false", reason: "r" })).status).toBe(400);
    expect((await patch(s, "NOPE", { enabled: false, reason: "r" })).status).toBe(400);
    expect((await patch(s, "KRI", { enabled: false, reason: "r" }, actorOf(["config.read"]))).status).toBe(403);
    expect(s.store.size).toBe(0);
    expect(s.events).toHaveLength(0);
  });

  it("is idempotent for state, and each repeat is audited with the same before/after (no silent no-op, no state drift)", async () => {
    const s = setup();
    await patch(s, "KRI", { enabled: false, reason: "un" });
    await patch(s, "KRI", { enabled: false, reason: "deux" });
    expect(s.store.get("KRI")!.enabled).toBe(false);
    expect(s.events).toHaveLength(2);
    expect(s.events[1]!.oldValue.enabled).toBe(false);
    expect(s.events[1]!.newValue.enabled).toBe(false);
    expect(s.events[1]!.reason).toBe("deux");
  });

  it("QA-SWP-02 (MINOR): the FIRST change of a never-persisted module audits the default state oldValue = { enabled: true }, not null", async () => {
    const s = setup();
    await patch(s, "CONTROL", { enabled: false, reason: "r" });
    expect(s.events[0]!.oldValue).toEqual({ enabled: true });
  });

  it("QA-SWP-01 (MAJOR): an audit failure must not leave the toggle changed without a trace (state + audit are not one transaction)", async () => {
    // expected by DECISION-058 / CLAUDE.md ("audit in the same service method"): the module stays enabled when the audit cannot be written
    const s = setup({ auditFails: true });
    await patch(s, "RISK", { enabled: false, reason: "coupure" });
    expect(s.store.get("RISK")?.enabled ?? true).toBe(true);
  });
});

// ---------------------------------------------------------------------------------------------------------------
const PGHOST = process.env.QA_SWP_PGHOST ?? "";
describe.skipIf(!PGHOST.startsWith("/"))("QA-SWP E. real PostgreSQL 16 (grc_qa_a08)", () => {
  let pool: Pool;
  const q = async <T = { id: string }>(sql: string, p: unknown[] = []) => (await pool.query(sql, p)).rows as T[];
  const one = async (sql: string, p: unknown[] = []) => (await q(sql, p))[0]!.id;
  let tenant = "";
  let user = "";

  beforeAll(async () => {
    pool = new Pool({ host: PGHOST, port: Number(process.env.QA_SWP_PGPORT ?? 5531), user: "postgres", database: process.env.QA_SWP_PGDB ?? "grc_qa_a08", max: 2 });
    tenant = await one(`INSERT INTO tenants (name) VALUES ($1) RETURNING id`, [`qaswp-${Date.now()}`]);
    user = await one(`INSERT INTO users (tenant_id, email, display_name) VALUES ($1, $2, 'x') RETURNING id`, [tenant, `qaswp-${Math.random()}@x`]);
  });
  afterAll(async () => { await pool.end(); });

  it("toggle on PG: a failing audit insert rolls the upsert back (QA-SWP-01 fixed on the real repository)", async () => {
    const repo = new PostgresModuleToggleRepository(pool);
    // an event violating NOT NULL on audit_log.entity_type makes the in-transaction insert fail
    const bad = () => [{ tenantId: tenant, userId: user, entityType: null, entityId: "x", action: "STATUS_CHANGE", oldValue: null, newValue: null, reason: "r", requestId: "q" }] as never;
    await expect(repo.upsert(tenant, "KPI", false, user, bad)).rejects.toThrow();
    expect(await q(`SELECT 1 AS id FROM module_toggles WHERE tenant_id = $1 AND module_name = 'KPI'`, [tenant])).toHaveLength(0);
  });

  it("toggle on PG: idempotent upsert keeps a single row per (tenant, module) and a CHECK-less enabled flip is visible to isEnabled", async () => {
    const svc = new ModuleToggleService(new PostgresModuleToggleRepository(pool), { async record() {} } as never);
    const a = { userId: user, tenantId: tenant, email: "a@x", roles: ["config.manage"] } as unknown as AuthenticatedUser;
    await svc.toggle(a, "KRI", false, "r1", "q");
    await svc.toggle(a, "KRI", false, "r2", "q");
    await svc.toggle(a, "KRI", true, "r3", "q");
    expect(await q(`SELECT id FROM module_toggles WHERE tenant_id = $1 AND module_name = 'KRI'`, [tenant])).toHaveLength(1);
    expect(await svc.isEnabled(tenant, "KRI")).toBe(true);
  });

  it("the requests table cannot hold NULL (no 'inherited' request) and keeps one PENDING per process", async () => {
    const dept = await one(`INSERT INTO departments (tenant_id, name) VALUES ($1, 'd') RETURNING id`, [tenant]).catch(() => null);
    const proc = await one(`INSERT INTO processes (tenant_id, level, name${dept ? ", department_id" : ""}) VALUES ($1, 'PROCESS', 'p'${dept ? ", $2" : ""}) RETURNING id`, dept ? [tenant, dept] : [tenant]);
    await expect(q(`INSERT INTO process_evaluation_mode_requests (tenant_id, process_id, requested_mode, requested_by) VALUES ($1,$2,NULL,$3)`, [tenant, proc, user])).rejects.toThrow();
    await q(`INSERT INTO process_evaluation_mode_requests (tenant_id, process_id, requested_mode, requested_by) VALUES ($1,$2,'CLASSIQUE',$3)`, [tenant, proc, user]);
    await expect(q(`INSERT INTO process_evaluation_mode_requests (tenant_id, process_id, requested_mode, requested_by) VALUES ($1,$2,'PARTICIPATIF',$3)`, [tenant, proc, user])).rejects.toThrow();
  });

  it("QA-SWP-03 (MAJOR, cross-module; PATCH /rating-scales/:id/disable, not part of the lot but listed 'a verifier'): a scale referenced by a DRAFT Dispositif version can be soft-deleted, which makes the version unreadable by getById", async () => {
    const scaleRepo = new PostgresRatingScaleRepository(pool);
    const scale = await one(`INSERT INTO rating_scales (tenant_id, name, version, probability_levels, impact_levels) VALUES ($1,'s',$2,5,5) RETURNING id`, [tenant, `v-${Math.random()}`]);
    const fw = await one(`INSERT INTO risk_frameworks (tenant_id, name) VALUES ($1,$2) RETURNING id`, [tenant, `fw-${Math.random()}`]);
    await one(`INSERT INTO risk_framework_versions (tenant_id, framework_id, version_number, rating_scale_id, committee_evaluation_min_score) VALUES ($1,$2,1,$3,15) RETURNING id`, [tenant, fw, scale]);
    const svc = new RatingScaleService(scaleRepo, { async record() {} } as never, { async existsForRatingScale() { return false; } } as never);
    const a = { userId: user, tenantId: tenant, email: "a@x", roles: ["ratingscale.read", "ratingscale.delete"] } as unknown as AuthenticatedUser;
    // Invariant "a version never points at a scale that no longer exists": the disable is refused.
    await expect(svc.disable(a, scale, "nettoyage", "q")).rejects.toThrow(/Dispositif/);
    expect(await scaleRepo.getById(tenant, scale)).not.toBeNull();
  });
});
