import { describe, expect, it, vi } from "vitest";
import type { Pool } from "pg";
import { ProcessService } from "../src/services/ProcessService.js";
import { PostgresRiskFrameworkRepository } from "../src/infrastructure/database/postgres/PostgresRiskFrameworkRepository.js";
import { readFileSync } from "node:fs";
import { RiskFrameworkService } from "../src/services/RiskFrameworkService.js";
import { resolveApplicableFrameworkId } from "../src/services/riskFrameworkResolution.js";
import { ConflictError, ForbiddenError, ValidationError } from "../src/domain/errors/DomainErrors.js";
import type { Permission } from "../src/domain/permissions.js";
import type { Role, SystemGroup } from "../src/domain/entities/Role.js";
import type {
  AssignmentResult,
  CreateAssignmentRequestInput,
  RecordDecisionInput,
  RiskFramework,
  RiskFrameworkChangeRequest,
  RiskFrameworkVersion,
  TransactionalAudit,
} from "../src/domain/entities/RiskFramework.js";
import type { AuthenticatedUser } from "../src/infrastructure/identity/IdentityProvider.js";

// Level 1 tests for B-6c (spec RM-V1-B6-Dispositif-spec.md section 11.1, q89). Cross-module edge cases are A08's.

const ALL: Permission[] = ["riskframework.read", "riskframework.update", "riskframework.activate", "riskframework.process.assign"];
const actor = (userId: string, perms: Permission[] = ALL): AuthenticatedUser =>
  ({ userId, tenantId: "t1", email: `${userId}@x`, displayName: userId, roles: perms }) as AuthenticatedUser;

const role = (g: SystemGroup): Role => ({
  id: g, tenantId: "t1", name: g, description: null, permissions: [], dashboardScopeMode: "GLOBAL",
  systemGroup: g, departmentId: null, createdAt: new Date(), updatedAt: new Date(), deletedAt: null,
}) as Role;

function setup(opts: { rm?: string[]; targetActive?: boolean } = {}) {
  const rm = opts.rm ?? ["u1", "u2", "u3"];
  const fw = (id: string): RiskFramework => ({ id, tenantId: "t1", name: id, description: null, isDefault: id === "fwDefault", createdBy: "u1",
    createdAt: new Date(), updatedAt: new Date(), archivedAt: null, archivedBy: null, archiveReason: null }) as RiskFramework;
  const frameworks = [fw("fwDefault"), fw("fwB")];
  const active = { id: "vB", frameworkId: "fwB", status: "ACTIVE", changeApprover: "RISK_MANAGER" } as RiskFrameworkVersion;
  /** processes.risk_framework_id, only written by an APPROVED assignment. */
  const attached = new Map<string, string | null>([["p1", null]]);
  const requests: RiskFrameworkChangeRequest[] = [];
  const audit: Array<Record<string, unknown>> = [];

  const repo = {
    auditsInTransaction: true,
    async getFramework(_t: string, id: string) { return frameworks.find((f) => f.id === id) ?? null; },
    async getActiveVersion(_t: string, id: string) { return id === "fwB" && opts.targetActive !== false ? active : null; },
    async getRequest(_t: string, id: string) { return requests.find((r) => r.id === id) ?? null; },
    async getDefaultFramework() { return frameworks[0]!; },
    async getProcessFrameworkId(_t: string, pid: string) { return attached.get(pid) ?? null; },
    async createAssignmentRequest(i: CreateAssignmentRequestInput) {
      const r = { id: `r${requests.length + 1}`, tenantId: i.tenantId, kind: "ASSIGN_PROCESS", frameworkId: i.frameworkId, versionId: null,
        processId: i.processId, previousValue: { frameworkId: attached.get(i.processId) ?? null }, reason: i.reason, status: "PENDING",
        requestedBy: i.requestedBy } as RiskFrameworkChangeRequest;
      requests.push(r);
      for (const e of i.audit?.(r) ?? []) audit.push(e);
      return r;
    },
    async decideAssignment(_t: string, id: string, d: RecordDecisionInput, a?: TransactionalAudit<AssignmentResult>) {
      const req = requests.find((r) => r.id === id)!;
      const request = { ...req, status: d.outcome, decidedBy: d.decidedBy, decisionComment: d.comment, decisionRegime: d.decisionRegime } as RiskFrameworkChangeRequest;
      const previous = attached.get(req.processId!) ?? null;
      if (d.outcome === "APPROVED") attached.set(req.processId!, req.frameworkId);
      const result = { request, processId: req.processId!, previousFrameworkId: previous, frameworkId: d.outcome === "APPROVED" ? req.frameworkId : null };
      Object.assign(req, request);
      for (const e of a?.(result) ?? []) audit.push(e);
      return result;
    },
    async withdrawAssignment(_t: string, id: string, comment: string | null, a?: TransactionalAudit<AssignmentResult>) {
      const req = requests.find((r) => r.id === id)!;
      if (req.status !== "PENDING") throw new Error("already decided");
      Object.assign(req, { status: "WITHDRAWN", decisionComment: comment });
      const result = { request: { ...req }, processId: req.processId!, previousFrameworkId: null, frameworkId: null };
      for (const e of a?.(result) ?? []) audit.push(e);
      return result;
    },
  };
  const roles = {
    async list() { return [role("RISK_MANAGER"), role("AUDIT"), role("RISK_COMMITTEE")]; },
    async listForUser(_t: string, uid: string) { return rm.includes(uid) ? [role("RISK_MANAGER")] : []; },
    async listAssignments(_t: string, roleId: string) { return roleId === "RISK_MANAGER" ? rm.map((userId) => ({ userId, revokedAt: null })) : []; },
    async listActiveGrants() { return []; },
  };
  const users = { async getById(_t: string, id: string) { return { id, deletedAt: null }; }, async listWithPermission() { return []; } };
  const service = new RiskFrameworkService(repo as never, {} as never, roles as never, users as never, { async record() { /* unused */ }, async listForEntity() { return []; } } as never);
  return { service, attached, requests, audit, repo };
}

describe("B-6c request a process assignment (q89)", () => {
  it("happy path: PENDING request, nothing written on the process, SUBMIT audited with the requester forced to the actor", async () => {
    const s = setup();
    const r = await s.service.requestProcessAssignment(actor("u1"), "fwB", { processId: "p1", reason: "Aligner sur la méthode B" }, "req1");
    expect(r.status).toBe("PENDING");
    expect(r.requestedBy).toBe("u1");
    expect(s.attached.get("p1")).toBeNull();
    expect(s.audit).toHaveLength(1);
    expect(s.audit[0]).toMatchObject({ tenantId: "t1", userId: "u1", entityType: "RiskFrameworkChangeRequest", action: "SUBMIT", reason: "Aligner sur la méthode B" });
  });

  it("refuses without riskframework.process.assign", async () => {
    const s = setup();
    await expect(s.service.requestProcessAssignment(actor("u1", ["riskframework.update", "riskframework.read"]), "fwB", { processId: "p1", reason: "x" }, "r"))
      .rejects.toThrow(ForbiddenError);
  });

  it("refuses a non Risk Manager even with the permission (spec section 10)", async () => {
    const s = setup();
    await expect(s.service.requestProcessAssignment(actor("admin"), "fwB", { processId: "p1", reason: "x" }, "r")).rejects.toThrow(ForbiddenError);
  });

  it("refuses an empty or too long reason", async () => {
    const s = setup();
    await expect(s.service.requestProcessAssignment(actor("u1"), "fwB", { processId: "p1", reason: "  " }, "r")).rejects.toThrow(ValidationError);
    await expect(s.service.requestProcessAssignment(actor("u1"), "fwB", { processId: "p1", reason: "a".repeat(501) }, "r")).rejects.toThrow(ValidationError);
    expect(s.requests).toHaveLength(0);
  });

  it("refuses a Dispositif of arrival without ACTIVE version (its approval rule is read there)", async () => {
    const s = setup({ targetActive: false });
    await expect(s.service.requestProcessAssignment(actor("u1"), "fwB", { processId: "p1", reason: "x" }, "r")).rejects.toThrow(/version active/);
    expect(s.requests).toHaveLength(0);
  });
});

describe("B-6c decision of an assignment", () => {
  async function pending(s: ReturnType<typeof setup>) {
    return s.service.requestProcessAssignment(actor("u1"), "fwB", { processId: "p1", reason: "Motif de la demande" }, "req1");
  }

  it("approval by a third Risk Manager writes the Dispositif and audits old -> new on Process, with the request reason", async () => {
    const s = setup();
    const r = await pending(s);
    await s.service.approve(actor("u2"), r.id, undefined, "req2");
    expect(s.attached.get("p1")).toBe("fwB");
    const p = s.audit.find((e) => e["entityType"] === "Process")!;
    expect(p).toMatchObject({ entityId: "p1", action: "UPDATE", userId: "u2", reason: "Motif de la demande", oldValue: { riskFrameworkId: null } });
    expect(p["newValue"]).toMatchObject({ riskFrameworkId: "fwB", effect: "NEXT_EVALUATIONS", decisionRegime: "NORMAL" });
    expect(s.audit.some((e) => e["entityType"] === "RiskFrameworkChangeRequest" && e["action"] === "APPROVE")).toBe(true);
  });

  it("takes effect at the next cycle: the applicable Dispositif is the default until approval, the new one after", async () => {
    const s = setup();
    const procs = { async getById(_t: string, id: string) { return { id, level: "PROCESS", parentId: null }; } };
    const deps = { frameworks: s.repo, processes: procs as never };
    const r = await pending(s);
    expect(await resolveApplicableFrameworkId(deps, "t1", "p1")).toBe("fwDefault");
    await s.service.approve(actor("u2"), r.id, undefined, "req2");
    expect(await resolveApplicableFrameworkId(deps, "t1", "p1")).toBe("fwB");
  });

  it("the requester cannot decide their own request (maker-checker)", async () => {
    const s = setup();
    const r = await pending(s);
    await expect(s.service.approve(actor("u1"), r.id, undefined, "r")).rejects.toThrow(ForbiddenError);
    expect(s.attached.get("p1")).toBeNull();
  });

  it("deciding needs riskframework.activate and Risk Manager membership", async () => {
    const s = setup();
    const r = await pending(s);
    await expect(s.service.approve(actor("u2", ["riskframework.read"]), r.id, undefined, "r")).rejects.toThrow(ForbiddenError);
    await expect(s.service.approve(actor("admin"), r.id, undefined, "r")).rejects.toThrow(ForbiddenError);
  });

  it("a refusal needs a comment, writes nothing on the process and is audited", async () => {
    const s = setup();
    const r = await pending(s);
    await expect(s.service.reject(actor("u2"), r.id, "", "r")).rejects.toThrow(ValidationError);
    await s.service.reject(actor("u2"), r.id, "Pas maintenant", "r");
    expect(s.attached.get("p1")).toBeNull();
    expect(s.audit.some((e) => e["action"] === "REJECT")).toBe(true);
    expect(s.audit.some((e) => e["entityType"] === "Process")).toBe(false);
  });

  it("approval is refused when the target lost its ACTIVE version since the request", async () => {
    const s = setup();
    const r = await pending(s);
    s.repo.getActiveVersion = async () => null;
    await expect(s.service.approve(actor("u2"), r.id, undefined, "r")).rejects.toThrow(/version active/);
    expect(s.attached.get("p1")).toBeNull();
  });
});

describe("B-6c withdrawal of an assignment request by its requester", () => {
  const ask = (s: ReturnType<typeof setup>) => s.service.requestProcessAssignment(actor("u1"), "fwB", { processId: "p1", reason: "Motif" }, "r1");

  it("the requester withdraws a PENDING request: WITHDRAWN, audited, nothing written on the process", async () => {
    const s = setup();
    const r = await ask(s);
    await s.service.withdraw(actor("u1"), r.id, "Plus nécessaire", "r2");
    expect(s.requests[0]!.status).toBe("WITHDRAWN");
    expect(s.attached.get("p1")).toBeNull();
    expect(s.audit.at(-1)).toMatchObject({ entityType: "RiskFrameworkChangeRequest", action: "STATUS_CHANGE", userId: "u1", reason: "Plus nécessaire" });
  });

  it("only the requester can withdraw, a reason is mandatory, a decided request cannot be withdrawn", async () => {
    const s = setup();
    const r = await ask(s);
    await expect(s.service.withdraw(actor("u2"), r.id, "x", "r")).rejects.toThrow(ForbiddenError);
    await expect(s.service.withdraw(actor("u1"), r.id, " ", "r")).rejects.toThrow(ValidationError);
    await s.service.reject(actor("u2"), r.id, "Non", "r");
    await expect(s.service.withdraw(actor("u1"), r.id, "x", "r")).rejects.toThrow(/déjà traitée/);
  });

  it("withdrawing needs riskframework.process.assign", async () => {
    const s = setup();
    const r = await ask(s);
    await expect(s.service.withdraw(actor("u1", ["riskframework.update"]), r.id, "x", "r")).rejects.toThrow(ForbiddenError);
  });
});

describe("B-6c Codex P2 #1: a process with a PENDING assignment cannot be archived", () => {
  const build = (pending: boolean) => {
    const softDelete = vi.fn(async () => undefined);
    const processes = { async getById() { return { id: "p1", tenantId: "t1", level: "PROCESS" }; }, softDelete };
    const frameworks = { async hasPendingAssignment() { return pending; } };
    const svc = new ProcessService(processes as never, { async record() { /* unused */ } } as never, undefined, undefined, undefined, undefined, undefined, undefined, undefined, frameworks);
    return { svc, softDelete };
  };
  const admin = actor("u1", ["process.read", "process.delete"] as never);

  it("refuses with a clear message and deletes nothing", async () => {
    const { svc, softDelete } = build(true);
    await expect(svc.archive(admin, "p1", "obsolète", "r")).rejects.toThrow(/demande de rattachement/);
    expect(softDelete).not.toHaveBeenCalled();
  });

  it("archives when no assignment is pending", async () => {
    const { svc, softDelete } = build(false);
    await svc.archive(admin, "p1", "obsolète", "r");
    expect(softDelete).toHaveBeenCalledOnce();
  });
});

describe("B-6c Codex P2 #2: the approval rule is re-read under lock when an assignment is decided", () => {
  const pool = (liveRule: string) => {
    const log: string[] = [];
    const res = (rows: unknown[]) => ({ rows, rowCount: rows.length });
    const client = {
      async query(sql: string) {
        const s = sql.replace(/\s+/g, " ").trim();
        log.push(s);
        if (/FROM risk_framework_change_requests .*FOR UPDATE/.test(s)) return res([{ id: "r1", status: "PENDING", kind: "ASSIGN_PROCESS", process_id: "p1", framework_id: "fwB", previous_value: { frameworkId: null } }]);
        if (/SELECT change_approver FROM risk_framework_versions/.test(s)) return res([{ change_approver: liveRule }]);
        if (/^UPDATE risk_framework_change_requests/.test(s)) return res([{ id: "r1", status: "REJECTED", kind: "ASSIGN_PROCESS", process_id: "p1", framework_id: "fwB" }]);
        return { rows: [], rowCount: 1 };
      },
      release() { /* noop */ },
    };
    return { pool: { connect: async () => client } as unknown as Pool, log };
  };
  const decision = (approverRule: string) => ({ outcome: "REJECTED" as const, decidedBy: "u2", comment: "non", decisionRegime: "NORMAL" as const, deciderGroup: "RISK_MANAGER" as const, ratificationStatus: null, approverRule: approverRule as never });

  it("a rule that changed since the decider was authorised: ConflictError, rolled back, request untouched", async () => {
    const f = pool("COMMITTEE");
    await expect(new PostgresRiskFrameworkRepository(f.pool).decideAssignment("t1", "r1", decision("RISK_MANAGER"))).rejects.toThrow(ConflictError);
    expect(f.log).toContain("ROLLBACK");
    expect(f.log.some((q) => /^UPDATE risk_framework_change_requests/.test(q))).toBe(false);
  });

  it("the same rule: the decision is recorded and committed; the read takes a share lock", async () => {
    const f = pool("RISK_MANAGER");
    await new PostgresRiskFrameworkRepository(f.pool).decideAssignment("t1", "r1", decision("RISK_MANAGER"));
    expect(f.log.at(-1)).toBe("COMMIT");
    expect(f.log.find((q) => /SELECT change_approver/.test(q))).toMatch(/tenant_id = \$1 .* FOR SHARE/);
  });

  it("the service passes the rule it used to authorise the decider", async () => {
    const s = setup();
    const seen: unknown[] = [];
    const orig = s.repo.decideAssignment;
    s.repo.decideAssignment = async (t: string, id: string, d: RecordDecisionInput, a?: TransactionalAudit<AssignmentResult>) => { seen.push((d as { approverRule?: string }).approverRule); return orig(t, id, d, a); };
    const r = await s.service.requestProcessAssignment(actor("u1"), "fwB", { processId: "p1", reason: "m" }, "r1");
    await s.service.approve(actor("u2"), r.id, undefined, "r2");
    expect(seen).toEqual(["RISK_MANAGER"]);
  });
});

describe("B-6c inter-Dispositif ceiling (I-C1) and wiring", () => {
  it("the F-B6a-10 'smallest ceiling' query is gone from the repository", () => {
    const src = readFileSync("src/infrastructure/database/postgres/PostgresRiskFrameworkRepository.ts", "utf8");
    expect(src).not.toMatch(/min\(probability_levels/);
  });

  it("088 (R-03): the guard also watches tenant_id and refuses a tenant change of an attached process; search_path pinned", () => {
    const sql = readFileSync("../database/postgresql/migrations/088_process_framework_guard.sql", "utf8");
    expect(sql).toMatch(/UPDATE OF risk_framework_id, tenant_id ON processes/);
    expect(sql).toMatch(/NEW\.tenant_id IS DISTINCT FROM OLD\.tenant_id AND NEW\.risk_framework_id IS NOT NULL/);
    expect((sql.match(/SET search_path = pg_catalog, public, pg_temp/g) ?? []).length).toBe(2);
  });

  it("the route body is strict and carries no attribution field", () => {
    const src = readFileSync("src/api/v1/riskFrameworks.routes.ts", "utf8");
    expect(src).toMatch(/AssignBody = z\.object\(\{ processId: Id, reason: Reason \}\)\.strict\(\)/);
    expect(src).toMatch(/\/:id\/process-assignments/);
  });
});
