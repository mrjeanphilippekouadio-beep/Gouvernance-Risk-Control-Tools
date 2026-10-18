import { describe, expect, it } from "vitest";
import express from "express";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { errorHandler } from "../src/api/middleware/errorHandler.js";
import { governanceDesignationsRouter } from "../src/api/v1/governanceDesignations.routes.js";
import { organizationProfileRouter } from "../src/api/v1/organizationProfile.routes.js";
import { configRouter } from "../src/api/v1/config.routes.js";
import { processesRouter } from "../src/api/v1/processes.routes.js";
import { GovernanceDesignationService } from "../src/services/GovernanceDesignationService.js";
import { OrganizationProfileService } from "../src/services/OrganizationProfileService.js";
import { ConfigService } from "../src/services/ConfigService.js";
import { ProcessService } from "../src/services/ProcessService.js";
import type { AuthenticatedUser } from "../src/infrastructure/identity/IdentityProvider.js";

/**
 * QA-panel (e): the new HTTP surfaces of the governance panel lots.
 * Oracle (before running): a caller without the dedicated permission gets 403 on EVERY route (also when the body is
 * invalid? no: validation first -> 400 is acceptable, but never a 2xx and never a write); no attribution or tenant
 * field of the body reaches the service; strict bodies refuse unknown keys; all routers are mounted behind authMiddleware.
 */
const ID = "11111111-1111-4111-8111-111111111111";
const me = (roles: string[]): AuthenticatedUser => ({ userId: "u-1", tenantId: "t-1", email: "u@x", displayName: "u", roles }) as unknown as AuthenticatedUser;

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
      method, headers: { "content-type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body),
    });
    return { status: res.status, json: (await res.json().catch(() => null)) as Record<string, unknown> | null };
  } finally {
    server.close();
  }
}

/** A repository stub that fails the test on any call: a 403 must never reach storage. */
const noCalls = new Proxy({}, { get: (_t, name) => { if (name === "then") return undefined; return () => { throw new Error(`unexpected repository call: ${String(name)}`); }; } }) as never;
const audit = { record: async () => { throw new Error("unexpected audit write"); }, listForEntity: async () => [] } as never;

describe("QA-panel routes / no permission -> 403 and no storage access (every new route)", () => {
  const designations = new GovernanceDesignationService(noCalls, audit, noCalls, noCalls);
  const profiles = new OrganizationProfileService(noCalls, audit);
  const configs = new ConfigService(noCalls, audit);
  const processes = new ProcessService(noCalls, audit, undefined, undefined, undefined, undefined, noCalls);
  const cases: Array<[string, string, string, unknown, (a: express.Express) => void]> = [
    ["GET designations", "GET", "/x", undefined, (a) => a.use("/x", governanceDesignationsRouter(designations))],
    ["POST designations", "POST", "/x", { kind: "MANAGER", userId: ID, reason: "r" }, (a) => a.use("/x", governanceDesignationsRouter(designations))],
    ["POST designations/:id/end", "POST", `/x/${ID}/end`, { reason: "r" }, (a) => a.use("/x", governanceDesignationsRouter(designations))],
    ["GET organization-profile", "GET", "/x", undefined, (a) => a.use("/x", organizationProfileRouter(profiles))],
    ["POST organization-profile/submit", "POST", "/x/submit", { questionnaireVersion: "0.3", answers: { Q1: 5, Q2: 0, Q5: "NO", Q7: "NO", Q8: "NO", Q11: "NO" }, reason: "r" }, (a) => a.use("/x", organizationProfileRouter(profiles))],
    ["POST organization-profile/:id/approve", "POST", `/x/${ID}/approve`, undefined, (a) => a.use("/x", organizationProfileRouter(profiles))],
    ["POST organization-profile/:id/reject", "POST", `/x/${ID}/reject`, { reason: "r" }, (a) => a.use("/x", organizationProfileRouter(profiles))],
    ["PUT config/self-validation-policy", "PUT", "/x/self-validation-policy", { policy: "DOUBLE_CONFIRMATION", reason: "r" }, (a) => a.use("/x", configRouter(configs))],
    ["GET processes/:id/responsibilities", "GET", `/x/${ID}/responsibilities`, undefined, (a) => a.use("/x", processesRouter(processes))],
    ["PUT processes/:id/responsibilities", "PUT", `/x/${ID}/responsibilities`, { ownerUserId: ID }, (a) => a.use("/x", processesRouter(processes))],
  ];
  it.each(cases)("%s", async (_n, method, path, body, mount) => {
    for (const roles of [[], ["config.read", "process.read", "process.update", "role.assign", "orgprofile.read"].filter(() => false)]) {
      const res = await http(mount, me(roles), method, path, body);
      expect(res.status).toBe(403);
    }
  });

  it("a neighbouring permission is not enough: orgprofile.read cannot submit, orgprofile.submit cannot approve, process.update cannot assign responsibilities, config.update cannot set the policy, role.assign cannot designate", async () => {
    const neighbours: Array<[string[], [string, string, unknown, (a: express.Express) => void]]> = [
      [["orgprofile.read"], ["POST", "/x/submit", cases[4]![3], (a) => a.use("/x", organizationProfileRouter(profiles))]],
      [["orgprofile.read", "orgprofile.submit"], ["POST", `/x/${ID}/approve`, undefined, (a) => a.use("/x", organizationProfileRouter(profiles))]],
      [["process.read", "process.update"], ["PUT", `/x/${ID}/responsibilities`, { ownerUserId: ID }, (a) => a.use("/x", processesRouter(processes))]],
      [["config.read", "config.update", "config.manage"], ["PUT", "/x/self-validation-policy", { policy: "DOUBLE_CONFIRMATION", reason: "r" }, (a) => a.use("/x", configRouter(configs))]],
      [["role.assign", "role.update"], ["POST", "/x", { kind: "MANAGER", userId: ID, reason: "r" }, (a) => a.use("/x", governanceDesignationsRouter(designations))]],
    ];
    for (const [roles, [method, path, body, mount]] of neighbours) expect((await http(mount, me(roles), method, path, body)).status, `${roles}`).toBe(403);
  });
});

describe("QA-panel routes / bodies: strictness, no attribution field, no tenant from the client", () => {
  function designationSpy() {
    const calls: Array<{ fn: string; args: unknown[] }> = [];
    const svc = {
      list: async (...a: unknown[]) => { calls.push({ fn: "list", args: a }); return []; },
      designate: async (...a: unknown[]) => { calls.push({ fn: "designate", args: a }); return { id: ID }; },
      end: async (...a: unknown[]) => { calls.push({ fn: "end", args: a }); return { id: ID }; },
    } as unknown as GovernanceDesignationService;
    return { calls, mount: (a: express.Express) => a.use("/x", governanceDesignationsRouter(svc)) };
  }

  it("designations: designatedBy / tenantId / activatedAt in the body never reach the service; the actor does", async () => {
    const s = designationSpy();
    const res = await http(s.mount, me([]), "POST", "/x", {
      kind: "RISK_MANAGER_INTERIM", userId: ID, reason: "intérim", validUntil: "2099-01-01T00:00:00Z",
      designatedBy: "someone-else", tenantId: "t-other", activatedAt: "2020-01-01", endedAt: "2020-01-01",
    });
    expect(res.status).toBe(201);
    const [actor, input] = s.calls[0]!.args as [AuthenticatedUser, Record<string, unknown>];
    expect(actor.tenantId).toBe("t-1");
    expect(Object.keys(input).sort()).toEqual(["kind", "reason", "userId", "validUntil"]);
  });

  it("designations: bad kind / non-uuid user / blank / 501-char reason / garbage date / unknown id format -> 400, service untouched", async () => {
    const s = designationSpy();
    const good = { kind: "MANAGER", userId: ID, reason: "r" };
    const bad: unknown[] = [
      { ...good, kind: "ADMIN" }, { ...good, userId: "not-a-uuid" }, { ...good, userId: undefined }, { ...good, reason: "   " }, { ...good, reason: "x".repeat(501) },
      { ...good, validUntil: "garbage" }, { ...good, validUntil: "" }, {}, [],
    ];
    for (const b of bad) expect((await http(s.mount, me([]), "POST", "/x", b)).status, JSON.stringify(b)).toBe(400);
    expect((await http(s.mount, me([]), "POST", "/x/not-a-uuid/end", { reason: "r" })).status).toBe(400);
    expect((await http(s.mount, me([]), "POST", `/x/${ID}/end`, { reason: "" })).status).toBe(400);
    expect((await http(s.mount, me([]), "GET", "/x?includeEnded=maybe")).status).toBe(400);
    expect(s.calls).toEqual([]);
  });

  it("organization profile: strict at every level; an author or decision field is refused (400), not ignored", async () => {
    const calls: unknown[][] = [];
    const svc = {
      submit: async (...a: unknown[]) => { calls.push(a); return { id: ID }; },
      approve: async (...a: unknown[]) => { calls.push(a); return { id: ID }; },
      reject: async (...a: unknown[]) => { calls.push(a); return { id: ID }; },
    } as unknown as OrganizationProfileService;
    const mount = (a: express.Express) => a.use("/x", organizationProfileRouter(svc));
    const answers = { Q1: 5, Q2: 0, Q5: "NO", Q7: "NO", Q8: "NO", Q11: "NO" };
    const body = { questionnaireVersion: "0.3", answers, reason: "r" };
    expect((await http(mount, me([]), "POST", "/x/submit", body)).status).toBe(201);
    const bad: unknown[] = [
      { ...body, submittedBy: "u-x" }, { ...body, status: "ACTIVE" }, { ...body, regime: "CONFIRMED" },
      { ...body, answers: { ...answers, Q3: 1 } }, { ...body, answers: { ...answers, Q1: 0 } }, { ...body, answers: { ...answers, Q1: 1e9 } },
      { ...body, answers: { ...answers, Q1: "5" } }, { ...body, answers: { ...answers, Q8: "MAYBE" } }, { ...body, answers: { Q1: 5 } }, { ...body, reason: "" },
      { ...body, questionnaireVersion: "" }, { ...body, questionnaireVersion: "x".repeat(41) }, { ...body, answers: [] },
    ];
    for (const b of bad) expect((await http(mount, me([]), "POST", "/x/submit", b)).status, JSON.stringify(b)).toBe(400);
    expect((await http(mount, me([]), "POST", "/x/not-a-uuid/approve")).status).toBe(400);
    expect((await http(mount, me([]), "POST", `/x/${ID}/reject`, { reason: "r", decidedBy: "u-x" })).status).toBe(400);
    expect((await http(mount, me([]), "POST", `/x/${ID}/reject`, { reason: "" })).status).toBe(400);
    expect(calls).toHaveLength(1);
  });

  it("responsibilities: strict, null allowed, no attribution/legacy-owner field accepted", async () => {
    const calls: unknown[][] = [];
    const svc = { setResponsibilities: async (...a: unknown[]) => { calls.push(a); return { id: ID }; }, getResponsibilities: async () => ({}) } as unknown as ProcessService;
    const mount = (a: express.Express) => a.use("/x", processesRouter(svc));
    expect((await http(mount, me([]), "PUT", `/x/${ID}/responsibilities`, { ownerUserId: null, deputyUserId: ID })).status).toBe(200);
    expect((await http(mount, me([]), "PUT", `/x/${ID}/responsibilities`, {})).status).toBe(200);
    for (const b of [{ owner: "Jean" }, { createdBy: ID }, { ownerUserId: "nope" }, { ownerUserId: 1 }, { ownerUserId: ID, tenantId: "t" }, []]) {
      expect((await http(mount, me([]), "PUT", `/x/${ID}/responsibilities`, b)).status, JSON.stringify(b)).toBe(400);
    }
    expect(calls).toHaveLength(2);
    expect(calls[0]![2]).toEqual({ ownerUserId: null, deputyUserId: ID });
  });

  it("self-validation policy: only the two values, a blank reason is a 400 (zod or service), nothing else is writable through this route", async () => {
    const calls: unknown[][] = [];
    const svc = { setSelfValidationPolicy: async (...a: unknown[]) => { calls.push(a); return { id: "c" }; } } as unknown as ConfigService;
    const mount = (a: express.Express) => a.use("/x", configRouter(svc));
    expect((await http(mount, me([]), "PUT", "/x/self-validation-policy", { policy: "DOUBLE_CONFIRMATION", reason: "r", committeeEvaluationEnforced: false })).status).toBe(200);
    expect((calls[0]!.length)).toBe(4); // (actor, policy, reason, requestId): extra keys are dropped
    for (const b of [{ policy: "ALLOW", reason: "r" }, { policy: "REFUSE" }, { policy: "REFUSE", reason: "" }, { policy: "REFUSE", reason: "x".repeat(501) }, { reason: "r" }, {}]) {
      expect((await http(mount, me([]), "PUT", "/x/self-validation-policy", b)).status, JSON.stringify(b)).toBe(400);
    }
    expect(calls).toHaveLength(1);
  });
});

describe("QA-panel routes / server wiring (static)", () => {
  const server = readFileSync(join(__dirname, "..", "src", "server.ts"), "utf8");
  it("every new router is mounted behind authMiddleware", () => {
    for (const path of ["/api/v1/organization-profile", "/api/v1/governance-designations", "/api/v1/processes", "/api/v1/config"]) {
      const m = server.match(new RegExp(`app\\.use\\(\\s*"${path.replace(/\//g, "\\/")}"[^;]*?authMiddleware\\(identityProvider\\)`, "s"));
      expect(m, path).not.toBeNull();
    }
  });
  it("the SelfValidationGate is built once and handed to the 8 services that need it; ConfigService gets the third-party query", () => {
    expect(server.match(/new SelfValidationGate\(/g)).toHaveLength(1);
    const uses = server.match(/\bselfValidationGate\b/g) ?? [];
    expect(uses.length).toBeGreaterThanOrEqual(9); // declaration + 8 services
    expect(server).toMatch(/new ConfigService\([^)]*governanceQueries\)/);
    expect(server).toMatch(/new RoleService\([^;]*governanceDesignationRepository\);/);
  });
  it("services with a tenant-scoped permission gate call requirePermission first in every public method of the new services", () => {
    for (const f of ["GovernanceDesignationService.ts", "OrganizationProfileService.ts"]) {
      const src = readFileSync(join(__dirname, "..", "src", "services", f), "utf8");
      const methods = [...src.matchAll(/^\s{2}async (\w+)\([\s\S]*?\{\n([^\n]*\n)/gm)].filter((m) => !m[1]!.startsWith("_"));
      expect(methods.length, f).toBeGreaterThan(2);
      for (const m of methods) expect(m[2], `${f} ${m[1]}`).toMatch(/requirePermission\(actor,/);
    }
  });
});
