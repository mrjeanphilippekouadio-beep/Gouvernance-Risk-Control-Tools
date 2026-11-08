import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { RiskFrameworkService } from "../src/services/RiskFrameworkService.js";
import { resolveApplicableFrameworkId } from "../src/services/riskFrameworkResolution.js";
import { ForbiddenError, ValidationError } from "../src/domain/errors/DomainErrors.js";
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

describe("B-6c inter-Dispositif ceiling (I-C1) and wiring", () => {
  it("the F-B6a-10 'smallest ceiling' query is gone from the repository", () => {
    const src = readFileSync("src/infrastructure/database/postgres/PostgresRiskFrameworkRepository.ts", "utf8");
    expect(src).not.toMatch(/min\(probability_levels/);
  });

  it("the route body is strict and carries no attribution field", () => {
    const src = readFileSync("src/api/v1/riskFrameworks.routes.ts", "utf8");
    expect(src).toMatch(/AssignBody = z\.object\(\{ processId: Id, reason: Reason \}\)\.strict\(\)/);
    expect(src).toMatch(/\/:id\/process-assignments/);
  });
});
