import { describe, expect, it } from "vitest";
import express from "express";
import { randomUUID } from "node:crypto";
import { DepartmentService } from "../src/services/DepartmentService.js";
import { RiskCategoryService } from "../src/services/RiskCategoryService.js";
import { ProcessService } from "../src/services/ProcessService.js";
import { RiskFrameworkService } from "../src/services/RiskFrameworkService.js";
import { departmentsRouter } from "../src/api/v1/departments.routes.js";
import { errorHandler } from "../src/api/middleware/errorHandler.js";
import { ValidationError } from "../src/domain/errors/DomainErrors.js";
import type { Department } from "../src/domain/entities/Department.js";
import type { Process } from "../src/domain/entities/Process.js";
import type { RiskCategory } from "../src/domain/entities/RiskCategory.js";
import type { RiskFrameworkVersion } from "../src/domain/entities/RiskFramework.js";
import type { Permission } from "../src/domain/permissions.js";
import type { AuthenticatedUser } from "../src/infrastructure/identity/IdentityProvider.js";

// QA-REF2: level-2 checks on 60560c4 (QA-REF-01/02, QA-B6bF-03). Oracles written before running.
// Fakes mirror the real Postgres repositories: list() hides inactive rows by default, getById() hides archived ones.

const T = "t1";
const actor = (perms: Permission[], userId = "u1", tenantId = T): AuthenticatedUser => ({ userId, tenantId, email: "a@x", roles: perms }) as AuthenticatedUser;
const audit = { async record() {}, async listForEntity() { return []; }, async listRecent() { return []; } } as never;

// ---- fakes --------------------------------------------------------------
function deptRepo() {
  const store = new Map<string, Department>();
  return {
    store,
    async getById(t: string, id: string) { const d = store.get(id); return d && d.tenantId === t && !d.deletedAt ? d : null; },
    async list(t: string, o?: { includeInactive?: boolean }) { return [...store.values()].filter((d) => d.tenantId === t && !d.deletedAt && (o?.includeInactive || d.active)); },
    async create(input: any, by: string) {
      const d = { id: randomUUID(), tenantId: input.tenantId, name: input.name, entity: null, manager: input.manager, riskOwner: input.riskOwner ?? input.manager,
        riskOwnerDesignatedBy: input.riskOwner ? by : "Pilote par défaut (manager, aucune désignation explicite)", riskOwnerDesignatedAt: new Date(),
        linkedProcesses: null, active: input.active ?? true, createdAt: new Date(), updatedAt: new Date(), deletedAt: null, deletedBy: null, deletionReason: null } as Department;
      store.set(d.id, d); return d;
    },
    async update(t: string, id: string, input: any) { const d = { ...store.get(id)!, ...input }; store.set(id, d); return d; },
    async designateRiskOwner() { throw new Error("n/a"); },
    async softDelete(_t: string, id: string, by: string, reason: string) { store.set(id, { ...store.get(id)!, deletedAt: new Date(), deletedBy: by, deletionReason: reason }); },
  };
}
function procRepo() {
  const store = new Map<string, Process>();
  return {
    store,
    async getById(t: string, id: string) { const p = store.get(id); return p && p.tenantId === t && !p.deletedAt ? p : null; },
    async list(t: string, o?: { includeInactive?: boolean }) { return [...store.values()].filter((p) => p.tenantId === t && !p.deletedAt && (o?.includeInactive || p.active)); },
    async create(input: any) {
      const p = { id: randomUUID(), tenantId: input.tenantId, parentId: null, level: "PROCESS", name: input.name, description: null, documentType: null, documentReference: null,
        owner: null, active: input.active ?? true, evaluationMode: null, departmentId: input.departmentId ?? null, createdAt: new Date(), updatedAt: new Date(), deletedAt: null, deletedBy: null, deletionReason: null } as Process;
      store.set(p.id, p); return p;
    },
    async update(_t: string, id: string, input: any) { const p = { ...store.get(id)!, ...input }; store.set(id, p); return p; },
    async softDelete() { throw new Error("n/a"); },
  };
}
const DEPT_PERMS: Permission[] = ["department.read", "department.create", "department.update", "department.delete", "process.create", "process.update", "process.read"];

describe("QA-REF2 DepartmentService.archive vs attached processes (QA-REF-02)", () => {
  async function world() {
    const departments = deptRepo(); const processes = procRepo();
    const svc = new DepartmentService(departments as never, audit, processes as never);
    const a = actor(DEPT_PERMS);
    const d = await svc.create(a, { name: "Fin", manager: "m@x" }, "r1");
    return { departments, processes, svc, a, d };
  }
  it("an ACTIVE process blocks the archive; the department stays live and nothing is written", async () => {
    const { svc, a, d, processes, departments } = await world();
    await processes.create({ tenantId: T, name: "P", departmentId: d.id, active: true });
    await expect(svc.archive(a, d.id, "obsolete", "r")).rejects.toThrow(ValidationError);
    expect(departments.store.get(d.id)!.deletedAt).toBeNull();
  });
  it("after the process moves to another department, the archive succeeds", async () => {
    const { svc, a, d, processes, departments } = await world();
    const other = await svc.create(a, { name: "RH", manager: "m@x" }, "r2");
    const p = await processes.create({ tenantId: T, name: "P", departmentId: d.id, active: true });
    await processes.update(T, p.id, { departmentId: other.id });
    await expect(svc.archive(a, d.id, "obsolete", "r")).resolves.toBeUndefined();
  });
  it("a process of ANOTHER tenant carrying the same departmentId does not block", async () => {
    const { svc, a, d, processes } = await world();
    await processes.create({ tenantId: "t2", name: "P", departmentId: d.id, active: true });
    await expect(svc.archive(a, d.id, "obsolete", "r")).resolves.toBeUndefined();
  });
  it("archive without department.delete is refused before any lookup", async () => {
    const { svc, d } = await world();
    await expect(svc.archive(actor(["department.read"]), d.id, "x", "r")).rejects.toThrow();
  });
  // QA-REF2-01 (fixed): a process may never end up attached to an archived department. An inactive process blocks
  // the archive too, since ProcessService.update({active:true}) does not re-check the department.
  it("QA-REF2-01: a department with only an inactive process attached cannot be archived", async () => {
    const { svc, a, d, processes } = await world();
    await processes.create({ tenantId: T, name: "P", departmentId: d.id, active: false });
    await expect(svc.archive(a, d.id, "obsolete", "r")).rejects.toThrow(ValidationError);
  });
});

describe("QA-REF2 riskOwnerDesignatedBy never client-settable (QA-REF-02 bis)", () => {
  it("HTTP POST /departments with a forged riskOwnerDesignatedBy: stripped, stamped with the caller", async () => {
    const departments = deptRepo();
    const svc = new DepartmentService(departments as never, audit, procRepo() as never);
    const app = express(); app.use(express.json());
    app.use((req, _res, next) => { (req as any).user = actor(DEPT_PERMS, "real-user"); (req as any).requestId = "q"; next(); });
    app.use("/departments", departmentsRouter(svc)); app.use(errorHandler);
    const server = app.listen(0);
    try {
      const port = (server.address() as { port: number }).port;
      const post = (path: string, method: string, body: unknown) => fetch(`http://127.0.0.1:${port}${path}`, { method, headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
      const res = await post("/departments", "POST", { name: "Ops", manager: "m@x", riskOwner: "o@x", riskOwnerDesignatedBy: "ceo@x" });
      expect(res.status).toBe(201);
      const created = ((await res.json()) as { data: Department }).data;
      expect(created.riskOwnerDesignatedBy).toBe("real-user");
      const up = await post(`/departments/${created.id}`, "PATCH", { name: "Ops2", riskOwnerDesignatedBy: "ceo@x", riskOwner: "evil@x" });
      expect(up.status).toBe(200);
      const after = departments.store.get(created.id)!;
      expect(after.riskOwnerDesignatedBy).toBe("real-user");
      expect(after.riskOwner).toBe("o@x");
    } finally { server.close(); }
  });
});

describe("QA-REF2 RiskCategoryService.update parent revalidation (QA-REF-01)", () => {
  function catRepo() {
    const store = new Map<string, RiskCategory>();
    return {
      store,
      async getById(t: string, id: string) { const c = store.get(id); return c && c.tenantId === t ? c : null; },
      async list(t: string, o?: { activeOnly?: boolean }) { return [...store.values()].filter((c) => c.tenantId === t && (!o?.activeOnly || c.active)); },
      async create(i: any) { const c = { id: randomUUID(), tenantId: i.tenantId, name: i.name, parentId: i.parentId ?? null, active: i.active ?? true, createdAt: new Date(), updatedAt: new Date() } as RiskCategory; store.set(c.id, c); return c; },
      async update(_t: string, id: string, i: any) { const c = { ...store.get(id)!, ...i }; store.set(id, c); return c; },
    };
  }
  const mgr = actor(["config.read", "config.manage"]);
  const setup = async () => {
    const repo = catRepo(); const svc = new RiskCategoryService(repo as never, audit);
    const A = await svc.create(mgr, { name: "A" }, "r"); const B = await svc.create(mgr, { name: "B" }, "r");
    const a1 = await svc.create(mgr, { name: "a1", parentId: A.id }, "r");
    return { repo, svc, A, B, a1 };
  };
  it("a category with children cannot become a sub-category (no chain depth 2)", async () => {
    const { svc, A, B, repo } = await setup();
    await expect(svc.update(mgr, A.id, { parentId: B.id }, "r")).rejects.toThrow(ValidationError);
    expect(repo.store.get(A.id)!.parentId).toBeNull();
  });
  it("cycle A<->B is impossible: B under A (A has child) refused, then A under B refused", async () => {
    const { svc, A, B } = await setup();
    await svc.update(mgr, B.id, { parentId: A.id }, "r"); // B (no child) under A: allowed
    await expect(svc.update(mgr, A.id, { parentId: B.id }, "r")).rejects.toThrow(ValidationError); // B is a sub-category
  });
  it("INACTIVE children still count (list activeOnly:false)", async () => {
    const { svc, A, B, a1 } = await setup();
    await svc.update(mgr, a1.id, { active: false }, "r");
    await expect(svc.update(mgr, A.id, { parentId: B.id }, "r")).rejects.toThrow(ValidationError);
  });
  it("detach then re-attach: detach (parentId null) ok, then attach under another top-level ok", async () => {
    const { svc, B, a1, repo } = await setup();
    await svc.update(mgr, a1.id, { parentId: null }, "r");
    expect(repo.store.get(a1.id)!.parentId).toBeNull();
    await svc.update(mgr, a1.id, { parentId: B.id }, "r");
    expect(repo.store.get(a1.id)!.parentId).toBe(B.id);
  });
  it("detach the last child, then the former parent can itself be attached", async () => {
    const { svc, A, B, a1 } = await setup();
    await svc.update(mgr, a1.id, { parentId: null }, "r");
    await expect(svc.update(mgr, A.id, { parentId: B.id }, "r")).resolves.toMatchObject({ parentId: B.id });
  });
  it("unknown parent, sub-category as parent, self-parent: all ValidationError; foreign-tenant parent has the same message as unknown", async () => {
    const { svc, A, a1, repo } = await setup();
    const foreign = await repo.create({ tenantId: "t2", name: "F" });
    const x = await svc.create(mgr, { name: "X" }, "r");
    await expect(svc.update(mgr, x.id, { parentId: randomUUID() }, "r")).rejects.toThrow(ValidationError);
    await expect(svc.update(mgr, x.id, { parentId: a1.id }, "r")).rejects.toThrow(ValidationError);
    await expect(svc.update(mgr, x.id, { parentId: x.id }, "r")).rejects.toThrow(ValidationError);
    const msg = (id: string) => svc.update(mgr, x.id, { parentId: id }, "r").catch((e: Error) => e.message.replace(id, "ID"));
    expect(await msg(foreign.id)).toBe(await msg(randomUUID()));
    expect(A.parentId).toBeNull();
  });
  it("re-saving a sub-category with its current parent, and renaming a parent without parentId, still work", async () => {
    const { svc, A, a1 } = await setup();
    await expect(svc.update(mgr, a1.id, { parentId: A.id, name: "a1b" }, "r")).resolves.toMatchObject({ name: "a1b" });
    await expect(svc.update(mgr, A.id, { name: "A2" }, "r")).resolves.toMatchObject({ name: "A2" });
  });
  it("QA-REF2-02: an INACTIVE top-level category is accepted as parent (current behaviour, not stated by any rule)", async () => {
    const { svc, B, a1 } = await setup();
    await svc.update(mgr, B.id, { active: false }, "r");
    await expect(svc.update(mgr, a1.id, { parentId: B.id }, "r")).resolves.toMatchObject({ parentId: B.id });
  });
});

describe("QA-REF2 QA-B6bF-03 behavioural (draft writers carry reducedMasteryIndependence)", () => {
  const ver = (over: Partial<RiskFrameworkVersion>): RiskFrameworkVersion => ({
    id: "v2", tenantId: T, frameworkId: "fw1", versionNumber: 2, status: "DRAFT", ratingScaleId: "s", defaultEvaluationMode: "CLASSIQUE",
    committeeEvaluationMinScore: 12, committeeEvaluationEnforced: true, committeeTreatmentMinScore: null, appetiteThresholds: [], changeApprover: "RISK_MANAGER",
    selfProposalAllowed: false, lowCriticalityThreshold: null, riskOwnerExecutorCumulAllowed: true, delegateExecutorCumulAllowed: true, delegationMaxDays: null,
    hybridPolicyEnabled: false, masteryAuthoritativeSource: "RISK_TEAM", committeeVoteRule: "DEFAULT", committeeVoteCustom: null, createdBy: "u1", lastEditedBy: "u1",
    createdAt: new Date(), updatedAt: new Date(), activatedAt: null, activationRequestId: null, archivedAt: null, archivedBy: null, archiveReason: null, ...over,
  });
  const active = ver({ id: "v1", versionNumber: 1, status: "ACTIVE", masteryAuthoritativeSource: "FIRST_LINE" });
  function svcWith(draft: RiskFrameworkVersion, existing: RiskFrameworkVersion[]) {
    const repo = {
      async getFramework() { return { id: "fw1", tenantId: T, archivedAt: null } as never; },
      async listVersions() { return existing; },
      async getVersion() { return draft; },
      async createDraftFrom() { return draft; },
      async updateDraft(_t: string, _f: string, _v: string, clean: object) { return { ...draft, ...clean }; },
      async discardDraft() { return { ...draft, status: "ARCHIVED" as const }; },
    };
    const roles = { async listForUser() { return [{ systemGroup: "RISK_MANAGER" }]; } };
    return new RiskFrameworkService(repo as never, { async getById() { return { id: "s" }; } } as never, roles as never, {} as never, audit);
  }
  const rm = actor(["riskframework.update", "riskframework.read"]);
  it("createDraft from a FIRST_LINE active version: mark true; from RISK_TEAM: false", async () => {
    expect((await svcWith(ver({ masteryAuthoritativeSource: "FIRST_LINE" }), [active]).createDraft(rm, "fw1", undefined, "r")).reducedMasteryIndependence).toBe(true);
    expect((await svcWith(ver({}), [{ ...active, masteryAuthoritativeSource: "RISK_TEAM" }]).createDraft(rm, "fw1", undefined, "r")).reducedMasteryIndependence).toBe(false);
  });
  it("updateDraft flips the mark with the stored value (RISK_TEAM -> FIRST_LINE true, FIRST_LINE -> RISK_TEAM false)", async () => {
    const up = await svcWith(ver({}), []).updateDraft(rm, "fw1", "v2", { masteryAuthoritativeSource: "FIRST_LINE" }, "r");
    expect(up.reducedMasteryIndependence).toBe(true);
    const down = await svcWith(ver({ masteryAuthoritativeSource: "FIRST_LINE" }), []).updateDraft(rm, "fw1", "v2", { masteryAuthoritativeSource: "RISK_TEAM" }, "r");
    expect(down.reducedMasteryIndependence).toBe(false);
  });
  it("discardDraft returns the mark too", async () => {
    const r = await svcWith(ver({ masteryAuthoritativeSource: "FIRST_LINE" }), []).discardDraft(actor(["riskframework.archive", "riskframework.read"]), "fw1", "v2", "no longer needed", "r");
    expect(r.reducedMasteryIndependence).toBe(true);
  });
});
