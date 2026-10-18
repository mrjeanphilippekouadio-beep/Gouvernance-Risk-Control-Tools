import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Pool } from "pg";
import { PostgresProcessEvaluationModeRequestRepository } from "../src/infrastructure/database/postgres/PostgresProcessEvaluationModeRequestRepository.js";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { NotFoundError } from "../src/domain/errors/DomainErrors.js";
import { ModuleToggleService } from "../src/services/ModuleToggleService.js";
import { ProcessEvaluationModeRequestService } from "../src/services/ProcessEvaluationModeRequestService.js";
import { RatingScaleService } from "../src/services/RatingScaleService.js";
import type { AuthenticatedUser } from "../src/infrastructure/identity/IdentityProvider.js";

const actorOf = (roles: string[], userId = "u-1"): AuthenticatedUser =>
  ({ userId, tenantId: "t-1", email: "a@x.test", roles }) as unknown as AuthenticatedUser;

describe("F-SWP-01: validate() flips the request first, then the process, then audits", () => {
  const proc = { id: "p1", tenantId: "t-1", level: "PROCESS", evaluationMode: null };
  function setup(validateFails: boolean) {
    const calls: string[] = [];
    const request = { id: "r1", tenantId: "t-1", processId: "p1", requestedMode: "PARTICIPATIF", status: "PENDING_VALIDATION", requestedBy: "maker" };
    const svc = new ProcessEvaluationModeRequestService(
      {
        async getById() { return request; },
        async validate() {
          calls.push("request.validate");
          if (validateFails) throw new NotFoundError("ProcessEvaluationModeRequest", "r1"); // rejected concurrently: 0 row matched
          return { ...request, status: "VALIDATED" };
        },
      } as never,
      { async getById() { return proc; }, async update(_t: string, _id: string, i: object) { calls.push("process.update"); return { ...proc, ...i }; } } as never,
      { async list() { return []; } } as never,
      { async record(e: { entityType: string }) { calls.push(`audit:${e.entityType}`); } } as never,
    );
    return { svc, calls };
  }

  it("after a concurrent rejection the validation fails and the process mode is never written", async () => {
    const { svc, calls } = setup(true);
    await expect(svc.validate(actorOf(["evaluationmode.validate"], "checker"), "r1", "q")).rejects.toThrow(NotFoundError);
    expect(calls).toEqual(["request.validate"]);
  });

  it("happy path order: request transition, process update, then both audit rows", async () => {
    const { svc, calls } = setup(false);
    const out = await svc.validate(actorOf(["evaluationmode.validate"], "checker"), "r1", "q");
    expect(out).toMatchObject({ evaluationMode: "PARTICIPATIF" });
    expect(calls).toEqual(["request.validate", "process.update", "audit:Process", "audit:ProcessEvaluationModeRequest"]);
  });

  it("uses the transactional repository method when available, and the service writes nothing itself", async () => {
    const writes: string[] = [];
    const request = { id: "r1", tenantId: "t-1", processId: "p1", requestedMode: "CLASSIQUE", status: "PENDING_VALIDATION", requestedBy: "maker" };
    let built: unknown[] = [];
    const svc = new ProcessEvaluationModeRequestService(
      {
        auditsInTransaction: true,
        async getById() { return request; },
        async validateAndApply(_t: string, _id: string, _by: string, audit: (r: unknown) => unknown[]) {
          built = audit({ request: { ...request, status: "VALIDATED" }, process: { ...proc, evaluationMode: "CLASSIQUE" } });
          return { request, process: { ...proc, evaluationMode: "CLASSIQUE" } };
        },
      } as never,
      { async getById() { return proc; }, async update() { writes.push("process.update"); } } as never,
      { async list() { return []; } } as never,
      { async record() { writes.push("audit"); } } as never,
    );
    await svc.validate(actorOf(["evaluationmode.validate"], "checker"), "r1", "q");
    expect(writes).toEqual([]);
    expect(built).toHaveLength(2);
  });
});

describe("QA-SWP-02: module toggle audit", () => {
  it("fallback path (repository without transactional audit): first toggle audits the default state { enabled: true }", async () => {
    const events: Array<{ oldValue: unknown }> = [];
    const svc = new ModuleToggleService(
      { async getByName() { return null; }, async upsert(t: string, m: string, enabled: boolean) { return { id: "i", tenantId: t, moduleName: m, enabled }; } } as never,
      { async record(e: never) { events.push(e); } } as never,
    );
    await svc.toggle(actorOf(["config.manage"]), "KRI", false, "r", "q");
    expect(events[0]!.oldValue).toEqual({ enabled: true });
  });
});

describe("QA-SWP-03: RatingScaleService.disable", () => {
  const scale = { id: "s1", tenantId: "t-1", status: "DRAFT" };
  function svcWith(referenced: boolean) {
    const deleted: string[] = [];
    const repo = {
      async getById() { return scale; },
      async isReferencedByFrameworkVersion() { return referenced; },
      async softDelete(_t: string, id: string) { deleted.push(id); },
    };
    return { svc: new RatingScaleService(repo as never, { async record() {} } as never, { async existsForRatingScale() { return false; } } as never), deleted };
  }
  const a = actorOf(["ratingscale.read", "ratingscale.delete"]);

  it("refuses a scale referenced by any Dispositif version, deleting nothing", async () => {
    const { svc, deleted } = svcWith(true);
    await expect(svc.disable(a, "s1", "nettoyage", "q")).rejects.toThrow(/Dispositif/);
    expect(deleted).toEqual([]);
  });

  it("disables an unreferenced scale", async () => {
    const { svc, deleted } = svcWith(false);
    await svc.disable(a, "s1", "nettoyage", "q");
    expect(deleted).toEqual(["s1"]);
  });
});

describe("F-SWP-05: dead writers have no caller under src/api", () => {
  const files = (dir: string): string[] =>
    readdirSync(dir).flatMap((f) => {
      const p = join(dir, f);
      return statSync(p).isDirectory() ? files(p) : p.endsWith(".ts") ? [p] : [];
    });
  it("setEvaluationMode, updateMethodology and updateAppetiteMode are referenced nowhere in src/api", () => {
    const hits = files(join(__dirname, "..", "src", "api")).filter((f) => /setEvaluationMode|updateMethodology|updateAppetiteMode/.test(readFileSync(f, "utf8")));
    expect(hits).toEqual([]);
  });
});

const PGHOST = process.env.QA_SWP_PGHOST ?? "";
describe.skipIf(!PGHOST.startsWith("/"))("F-SWP-01 on real PostgreSQL (dedicated database, never Neon)", () => {
  let pool: Pool;
  const rows = async (sql: string, p: unknown[] = []) => (await pool.query(sql, p)).rows as Array<Record<string, string | null>>;
  beforeAll(() => { pool = new Pool({ host: PGHOST, port: Number(process.env.QA_SWP_PGPORT ?? 5531), user: "postgres", database: process.env.QA_SWP_PGDB ?? "grc_qa_a08", max: 2 }); });
  afterAll(async () => { await pool.end(); });

  it("a request already rejected: validateAndApply fails and processes.evaluation_mode stays NULL; a pending one is applied with its audit row", async () => {
    const tenant = (await rows(`INSERT INTO tenants (name) VALUES ($1) RETURNING id`, [`swpfix-${Date.now()}`]))[0]!.id;
    const user = (await rows(`INSERT INTO users (tenant_id, email, display_name) VALUES ($1,$2,'x') RETURNING id`, [tenant, `swpfix-${Math.random()}@x`]))[0]!.id;
    const dept = (await rows(`INSERT INTO departments (tenant_id, name) VALUES ($1,'d') RETURNING id`, [tenant]))[0]!.id;
    const proc = (await rows(`INSERT INTO processes (tenant_id, level, name, department_id) VALUES ($1,'PROCESS','p',$2) RETURNING id`, [tenant, dept]))[0]!.id;
    const req = (await rows(`INSERT INTO process_evaluation_mode_requests (tenant_id, process_id, requested_mode, requested_by) VALUES ($1,$2,'PARTICIPATIF',$3) RETURNING id`, [tenant, proc, user]))[0]!.id;
    await pool.query(`UPDATE process_evaluation_mode_requests SET status='REJECTED', validated_by=$2, validated_at=now(), rejection_reason='non' WHERE id=$1`, [req, user]);

    const repo = new PostgresProcessEvaluationModeRequestRepository(pool);
    const ev = () => [{ tenantId: tenant, userId: user, entityType: "Process", entityId: proc!, action: "UPDATE", oldValue: null, newValue: null, reason: null, requestId: "q" }] as never;
    await expect(repo.validateAndApply(tenant!, req!, user!, ev)).rejects.toThrow(NotFoundError);
    expect((await rows(`SELECT evaluation_mode FROM processes WHERE id=$1`, [proc]))[0]!.evaluation_mode).toBeNull();
    expect(await rows(`SELECT 1 FROM audit_log WHERE tenant_id=$1`, [tenant])).toHaveLength(0);

    const req2 = (await rows(`INSERT INTO process_evaluation_mode_requests (tenant_id, process_id, requested_mode, requested_by) VALUES ($1,$2,'CLASSIQUE',$3) RETURNING id`, [tenant, proc, user]))[0]!.id;
    const out = await repo.validateAndApply(tenant!, req2!, user!, ev);
    expect(out.request.status).toBe("VALIDATED");
    expect(out.process.evaluationMode).toBe("CLASSIQUE");
    expect(await rows(`SELECT 1 FROM audit_log WHERE tenant_id=$1`, [tenant])).toHaveLength(1);
  });
});
