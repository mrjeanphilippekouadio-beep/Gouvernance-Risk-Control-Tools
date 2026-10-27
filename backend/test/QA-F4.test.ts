import { describe, expect, it } from "vitest";
import express from "express";
import { errorHandler } from "../src/api/middleware/errorHandler.js";
import { usersRouter } from "../src/api/v1/users.routes.js";
import { processesRouter } from "../src/api/v1/processes.routes.js";
import { UserService } from "../src/services/UserService.js";
import { ProcessService } from "../src/services/ProcessService.js";
import { SelfValidationGate } from "../src/services/SelfValidationGate.js";
import { ConflictError, ForbiddenError, ValidationError } from "../src/domain/errors/DomainErrors.js";
import type { Process } from "../src/domain/entities/Process.js";
import type { User } from "../src/domain/entities/User.js";
import type { AuthenticatedUser } from "../src/infrastructure/identity/IdentityProvider.js";

/**
 * QA-F4 (level 2): lot F4, HTTP + service. Oracles fixed before running:
 * /me/permissions and /directory are NOT parsed as /:id; directory = active accounts of the caller's tenant, {id, displayName} only,
 * 403 without one of the 3 rights; q166 = self as CHAMPION only, policy DOUBLE_CONFIRMATION + nobody else + reasoned confirmation.
 */
const T = "00000000-0000-4000-8000-000000000001";
const T2 = "00000000-0000-4000-8000-000000000002";
const id = (n: number) => `10000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const ME = id(99);
const actor = (roles: string[]): AuthenticatedUser => ({ userId: ME, tenantId: T, email: "a@x.io", displayName: "Me", roles }) as unknown as AuthenticatedUser;
const user = (n: number, displayName: string, over: Partial<User> = {}): User =>
  ({ id: id(n), tenantId: T, email: `u${n}@x.io`, displayName, roles: ["secret.role"], departmentId: null, createdAt: new Date(), deletedAt: null, ...over }) as User;

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
    return { status: res.status, json: (await res.json().catch(() => null)) as any };
  } finally {
    server.close();
  }
}

function userWorld(users: User[]) {
  const repo: any = {
    getById: async (t: string, i: string) => users.find((u) => u.tenantId === t && u.id === i) ?? null,
    // Deliberately ignores includeSuspended: the service must filter suspended accounts itself.
    list: async (t: string) => users.filter((u) => u.tenantId === t),
  };
  const service = new UserService(repo, { record: async () => {} } as any);
  return (app: express.Express) => app.use("/users", usersRouter(service));
}

describe("QA-F4 users: /me/permissions and /directory", () => {
  const mount = userWorld([
    user(99, "Me"), user(1, "Zoé"), user(2, "Aïcha"), user(3, "Gone", { deletedAt: new Date() }),
    user(4, "Other tenant", { tenantId: T2 }),
  ]);

  it("/me/permissions is routed before /:id: no user.read needed, sorted, deduplicated, unknown strings dropped", async () => {
    const r = await http(mount, actor(["process.read", "audit.read", "process.read", "not.a.permission"]), "GET", "/users/me/permissions");
    expect(r.status).toBe(200);
    expect(r.json.data).toEqual(["audit.read", "process.read"]);
  });

  it("/me/permissions without any right returns an empty list (not 403, not 404)", async () => {
    const r = await http(mount, actor([]), "GET", "/users/me/permissions");
    expect([r.status, r.json.data]).toEqual([200, []]);
  });

  it("/me/permissions for a caller with no account row in the tenant is 404", async () => {
    const stranger = { ...actor(["process.read"]), tenantId: T2, userId: id(98) } as AuthenticatedUser;
    expect((await http(mount, stranger, "GET", "/users/me/permissions")).status).toBe(404);
  });

  it("/directory is routed before /:id: 403 without one of the 3 rights, 200 with each of them", async () => {
    expect((await http(mount, actor([]), "GET", "/users/directory")).status).toBe(403);
    expect((await http(mount, actor(["user.update", "process.read"]), "GET", "/users/directory")).status).toBe(403);
    for (const p of ["user.read", "process.responsibility.assign", "designation.manage"]) {
      expect((await http(mount, actor([p]), "GET", "/users/directory")).status).toBe(200);
    }
  });

  it("/directory returns only active accounts of the caller's tenant, id + displayName only, sorted by name", async () => {
    const r = await http(mount, actor(["designation.manage"]), "GET", "/users/directory");
    expect(r.json.data).toEqual([
      { id: id(2), displayName: "Aïcha" },
      { id: id(99), displayName: "Me" },
      { id: id(1), displayName: "Zoé" },
    ]);
    const raw = JSON.stringify(r.json);
    for (const leak of ["@x.io", "secret.role", "Other tenant", "Gone", "tenantId"]) expect(raw).not.toContain(leak);
  });

  it("/directory with a user-supplied tenant query is still scoped to the actor's tenant", async () => {
    const r = await http(mount, actor(["user.read"]), "GET", `/users/directory?tenantId=${T2}`);
    expect(r.json.data.map((u: any) => u.id)).not.toContain(id(4));
  });

  it("an unknown sub-path still reaches /:id (admin) and a malformed id is not a 200", async () => {
    const r = await http(mount, actor([]), "GET", "/users/directory/extra");
    expect(r.status).toBeGreaterThanOrEqual(400);
  });
});

const confirmation = { rule: "noSelfValidation", reason: "Structure à une personne, pas d'autre Risk Manager" };
const gateOf = (policy: string, otherExists: boolean) =>
  new SelfValidationGate({ getByTenant: async () => ({ selfValidationPolicy: policy }) } as any, { existsOther: async () => otherExists } as any);

function processWorld(gate?: SelfValidationGate, over: Partial<Process> = {}) {
  let process = {
    id: id(1), tenantId: T, parentId: null, level: "PROCESS", name: "Achats", description: null, documentType: null,
    documentReference: null, owner: "x", active: true, evaluationMode: null, departmentId: null,
    ownerUserId: null, riskChampionUserId: null, deputyUserId: null,
    createdAt: new Date(), updatedAt: new Date(), deletedAt: null, deletedBy: null, deletionReason: null, ...over,
  } as Process;
  const writes: any[] = [];
  const audits: any[] = [];
  const processes: any = {
    getById: async (t: string, i: string) => (t === process.tenantId && i === process.id ? process : null),
    setResponsibilities: async (_t: string, _i: string, input: any) => { writes.push(input); process = { ...process, ...input }; return process; },
  };
  const users = [user(99, "Me"), user(2, "Awa"), user(3, "Luc")];
  const usersRepo: any = { getById: async (t: string, i: string) => users.find((u) => u.tenantId === t && u.id === i) ?? null, list: async () => users };
  const service = new ProcessService(processes, { record: async (e: unknown) => void audits.push(e) } as any, undefined, undefined, undefined, undefined, usersRepo, gate);
  return { service, writes, audits, mount: (app: express.Express) => app.use("/p", processesRouter(service)) };
}
const assigner = actor(["process.read", "process.responsibility.assign"]);
const path = `/p/${id(1)}/responsibilities`;

describe("QA-F4 q177 routes: suspend / reactivate require a reason", () => {
  const mount = userWorld([user(1, "Target"), user(2, "Gone", { deletedAt: new Date() })]);
  const admin = actor(["user.delete", "user.reactivate"]);

  it("400 without a reason, a blank one or an unknown key, before the service runs", async () => {
    for (const body of [undefined, {}, { reason: "  " }, { reason: "ok", by: ME }]) {
      expect((await http(mount, admin, "PATCH", `/users/${id(1)}/suspend`, body)).status).toBe(400);
      expect((await http(mount, admin, "PATCH", `/users/${id(2)}/reactivate`, body)).status).toBe(400);
    }
  });
});

describe("QA-F4 q166 service", () => {
  it("policy REFUSE (or no config row): refused even with a valid confirmation, nothing written", async () => {
    for (const policy of ["REFUSE", undefined]) {
      const w = processWorld(new SelfValidationGate({ getByTenant: async () => (policy ? { selfValidationPolicy: policy } : null) } as any, { existsOther: async () => false } as any));
      await expect(w.service.setResponsibilities(assigner, id(1), { riskChampionUserId: ME }, "r", confirmation as any)).rejects.toBeInstanceOf(ForbiddenError);
      expect(w.writes).toHaveLength(0);
      expect(w.audits).toHaveLength(0);
    }
  });

  it("confirmation with blank reason or wrong rule is not enough (409, no write)", async () => {
    const w = processWorld(gateOf("DOUBLE_CONFIRMATION", false));
    for (const c of [{ rule: "noSelfValidation", reason: "   " }, { rule: "other", reason: "motif valable" }, undefined]) {
      await expect(w.service.setResponsibilities(assigner, id(1), { riskChampionUserId: ME }, "r", c as any)).rejects.toBeInstanceOf(ConflictError);
    }
    expect(w.writes).toHaveLength(0);
  });

  it("upper-case own id is still recognised as self (needs the gate), and accepted as the canonical id", async () => {
    const w = processWorld(gateOf("DOUBLE_CONFIRMATION", false));
    await expect(w.service.setResponsibilities(assigner, id(1), { riskChampionUserId: ME.toUpperCase() }, "r")).rejects.toBeInstanceOf(ConflictError);
    const p = await w.service.setResponsibilities(assigner, id(1), { riskChampionUserId: ME.toUpperCase() }, "r", confirmation as any);
    expect(p.riskChampionUserId).toBe(ME);
  });

  it("champion = self + owner = another account: the exception covers the champion only, both are written and audited once", async () => {
    const w = processWorld(gateOf("DOUBLE_CONFIRMATION", false));
    const p = await w.service.setResponsibilities(assigner, id(1), { riskChampionUserId: ME, ownerUserId: id(2) }, "r", confirmation as any);
    expect([p.riskChampionUserId, p.ownerUserId]).toEqual([ME, id(2)]);
    expect(w.audits).toHaveLength(1);
    expect(w.audits[0].governanceException).toBe("noSelfValidation");
  });

  it("champion = self + owner = another account that is unknown: whole request refused, no partial write, no audit", async () => {
    const w = processWorld(gateOf("DOUBLE_CONFIRMATION", false));
    await expect(w.service.setResponsibilities(assigner, id(1), { riskChampionUserId: ME, ownerUserId: id(55) }, "r", confirmation as any)).rejects.toBeInstanceOf(ValidationError);
    expect(w.writes).toHaveLength(0);
    expect(w.audits).toHaveLength(0);
  });

  it("champion = self combined with owner = self or N-1 = self is refused (400) whatever the confirmation", async () => {
    for (const extra of [{ ownerUserId: ME }, { deputyUserId: ME }]) {
      const w = processWorld(gateOf("DOUBLE_CONFIRMATION", false));
      await expect(w.service.setResponsibilities(assigner, id(1), { riskChampionUserId: ME, ...extra }, "r", confirmation as any)).rejects.toBeInstanceOf(ValidationError);
      expect(w.writes).toHaveLength(0);
    }
  });

  it("someone else already champion, no change to the champion: no gate involved, no governance marker", async () => {
    const w = processWorld(gateOf("REFUSE", true), { riskChampionUserId: ME } as any);
    await w.service.setResponsibilities(assigner, id(1), { riskChampionUserId: ME, ownerUserId: id(2) }, "r");
    expect(w.audits[0].governanceException).toBeUndefined();
  });

  it("clearing the champion (null) or naming another account never triggers the gate", async () => {
    const w = processWorld(gateOf("REFUSE", true));
    await w.service.setResponsibilities(assigner, id(1), { riskChampionUserId: id(2) }, "r");
    await w.service.setResponsibilities(assigner, id(1), { riskChampionUserId: null }, "r");
    expect(w.audits.every((a) => a.governanceException === undefined)).toBe(true);
  });

  it("a confirmation sent for a non-self change is ignored: no marker, no selfValidation block in the audit", async () => {
    const w = processWorld(gateOf("DOUBLE_CONFIRMATION", false));
    await w.service.setResponsibilities(assigner, id(1), { ownerUserId: id(2) }, "r", confirmation as any);
    expect(w.audits[0].governanceException).toBeUndefined();
    expect(w.audits[0].newValue.selfValidation).toBeUndefined();
  });
});

describe("QA-F4 q166 route", () => {
  it("full flow over HTTP: 409 GOVERNANCE_CONFIRMATION_REQUIRED, then 200 with governanceConfirmation", async () => {
    const w = processWorld(gateOf("DOUBLE_CONFIRMATION", false));
    const first = await http(w.mount, assigner, "PUT", path, { riskChampionUserId: ME });
    expect(first.status).toBe(409);
    expect(JSON.stringify(first.json)).toContain("GOVERNANCE_CONFIRMATION_REQUIRED");
    const second = await http(w.mount, assigner, "PUT", path, { riskChampionUserId: ME, governanceConfirmation: confirmation });
    expect(second.status).toBe(200);
    expect(second.json.data.riskChampionUserId).toBe(ME);
    expect(w.writes[0]).toEqual({ riskChampionUserId: ME });
  });

  it("body is strict: unknown key (also tenantId / attribution) -> 400, nothing written", async () => {
    const w = processWorld(gateOf("DOUBLE_CONFIRMATION", false));
    for (const extra of [{ tenantId: T2 }, { createdBy: id(2) }, { foo: 1 }]) {
      expect((await http(w.mount, assigner, "PUT", path, { ownerUserId: id(2), ...extra })).status).toBe(400);
    }
    expect(w.writes).toHaveLength(0);
  });

  it("malformed governanceConfirmation -> 400 and never reaches the service", async () => {
    const w = processWorld(gateOf("DOUBLE_CONFIRMATION", false));
    const bad: unknown[] = [{ rule: "x", reason: "motif valable" }, { rule: "noSelfValidation" }, { rule: "noSelfValidation", reason: "" }, "yes", null, [], { rule: "noSelfValidation", reason: "a\u0000b" }];
    for (const c of bad) {
      const r = await http(w.mount, assigner, "PUT", path, { riskChampionUserId: ME, governanceConfirmation: c });
      expect(r.status, JSON.stringify(c)).toBe(400);
    }
    expect(w.writes).toHaveLength(0);
  });

  it("governanceConfirmation alone (no responsibility key) is a no-op, not an error and not a write", async () => {
    const w = processWorld(gateOf("DOUBLE_CONFIRMATION", false));
    const r = await http(w.mount, assigner, "PUT", path, { governanceConfirmation: confirmation });
    expect(r.status).toBe(200);
    expect(w.writes).toHaveLength(0);
  });

  it("without process.responsibility.assign: 403 even with a confirmation (process.update is not enough)", async () => {
    const w = processWorld(gateOf("DOUBLE_CONFIRMATION", false));
    const r = await http(w.mount, actor(["process.read", "process.update"]), "PUT", path, { riskChampionUserId: ME, governanceConfirmation: confirmation });
    expect(r.status).toBe(403);
    expect(w.writes).toHaveLength(0);
  });

  it("owner = self over HTTP stays 400 with a valid confirmation", async () => {
    const w = processWorld(gateOf("DOUBLE_CONFIRMATION", false));
    const r = await http(w.mount, assigner, "PUT", path, { ownerUserId: ME, governanceConfirmation: confirmation });
    expect(r.status).toBe(400);
  });
});
