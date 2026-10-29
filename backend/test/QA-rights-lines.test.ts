import { afterAll, beforeAll, describe, expect, it } from "vitest";
import express from "express";
import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import { errorHandler } from "../src/api/middleware/errorHandler.js";
import { rolesRouter } from "../src/api/v1/roles.routes.js";
import { RoleService } from "../src/services/RoleService.js";
import { NotificationService } from "../src/services/NotificationService.js";
import { PostgresRoleRepository } from "../src/infrastructure/database/postgres/PostgresRoleRepository.js";
import { PostgresUserRepository } from "../src/infrastructure/database/postgres/PostgresUserRepository.js";
import { PostgresAuditRepository } from "../src/infrastructure/database/postgres/PostgresAuditRepository.js";
import { PostgresConfigRepository } from "../src/infrastructure/database/postgres/PostgresConfigRepository.js";
import { PostgresNotificationRepository } from "../src/infrastructure/database/postgres/PostgresNotificationRepository.js";
import { PostgresNotificationSubscriptionRepository } from "../src/infrastructure/database/postgres/PostgresNotificationSubscriptionRepository.js";
import { PostgresSensitiveViewGrantRepository } from "../src/infrastructure/database/postgres/PostgresSensitiveViewGrantRepository.js";
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from "../src/domain/errors/DomainErrors.js";
import type { RoleRepository } from "../src/domain/repositories/RoleRepository.js";
import type { UserRepository } from "../src/domain/repositories/UserRepository.js";
import type { SensitiveViewGrant, SensitiveViewGrantRepository } from "../src/domain/repositories/SensitiveViewGrantRepository.js";
import type { Role, RoleAssignment, SystemGroup } from "../src/domain/entities/Role.js";
import type { User } from "../src/domain/entities/User.js";
import type { AuditEvent } from "../src/domain/entities/AuditEvent.js";
import type { AuthenticatedUser } from "../src/infrastructure/identity/IdentityProvider.js";

/**
 * QA-rights-lines (level 2): DECISION-098/101/103 (q188/q189/q200, migration 079). Oracles written BEFORE running.
 *
 * LEAKS (a restricted reader = role.read, no administration right, not Audit, no role.read.sensitive)
 *  L1  lists: /roles, /roles/matrix, /roles/accounts never carry an Audit or administrator role / account (name, id, permissions).
 *  L2  ids: /roles/:id and /roles/users/:id{,/permissions,/permission-sources} of a hidden role / account answer EXACTLY like an
 *      unknown id (same status, same body once the id is substituted). Suspended hidden accounts too.
 *  L3  cumulation: the most sensitive line wins (ADMIN > AUDIT > LINE_2 > LINE_1) whatever the way the right is held
 *      (several roles, direct users.roles); a revoked Audit seat or a disabled role does not classify.
 *  L4  readers who stay unrestricted: administrator, Audit member, holder of role.read.sensitive.
 * CIRCUIT q200
 *  C1  request: role.assign only, never for oneself, Risk Manager members only, active accounts, same tenant; reason mandatory
 *      (<= 500); strict body (no requestedBy / decidedBy / status taken from the client).
 *  C2  decision: rolegroup.audit.validate, never the author, never the beneficiary; refusal needs a reason; approval re-checks
 *      the Risk Manager membership; a decided / revoked / expired request cannot be decided again; expired = never approvable.
 *  C3  one live (PENDING or APPROVED) request per account; a REJECTED or REVOKED one allows a new request.
 *  C4  the right is effective ONLY while APPROVED AND the person is still in the Risk Manager group.
 *  C5  revoke: role.assign + reason, from PENDING or APPROVED, terminal; the audit event is written in the same transaction.
 *  C6  notification SENSITIVE_VIEW_GRANT_PENDING to the holders of rolegroup.audit.validate, never the author nor the beneficiary.
 *  C7  tenant: a grant / account of another tenant is a 404, never modified, never listed.
 */
const T1 = "00000000-0000-4000-8000-0000000000a1";
const T2 = "00000000-0000-4000-8000-0000000000a2";
const DAY = 86_400_000;
const byText = (a: string, b: string) => a.localeCompare(b);
const actor = (userId: string, roles: string[], tenantId = T1): AuthenticatedUser =>
  ({ userId, tenantId, email: `${userId}@x.io`, displayName: userId, roles }) as unknown as AuthenticatedUser;

type Evt = Omit<AuditEvent, "id" | "timestamp">;
interface Note { recipientUserId: string; eventType: string; resourceId: string; tenantId: string }

/** In-memory world faithful to PostgreSQL where it matters (tenant filters, live-unique index, maker-checker CHECKs, expiry on approve). */
function world(opts: { expiryDays?: number | null; withNotifications?: boolean } = {}) {
  const users: User[] = [];
  const roles: Role[] = [];
  const seats: RoleAssignment[] = [];
  const grants: SensitiveViewGrant[] = [];
  const audit: Evt[] = [];
  const notes: Note[] = [];
  const cfg = { days: opts.expiryDays ?? null };

  const mkUser = (id: string, extra: Partial<User> = {}, tenantId = T1) =>
    users.push({ id, tenantId, email: `${id}@x.io`, displayName: id, roles: [], createdAt: new Date(), deletedAt: null, ...extra } as User);
  const mkRole = (name: string, systemGroup: SystemGroup | null, permissions: string[], extra: Partial<Role> = {}, tenantId = T1) => {
    const r = { id: randomUUID(), tenantId, name, description: null, permissions, systemGroup, departmentId: null, dashboardScopeMode: "GLOBAL",
      createdAt: new Date(), updatedAt: new Date(), deletedAt: null, ...extra } as Role;
    roles.push(r);
    return r;
  };
  const seat = (role: Role, userId: string) =>
    seats.push({ id: randomUUID(), tenantId: role.tenantId, roleId: role.id, userId, grantedBy: "seed", grantedAt: new Date(), revokedAt: null } as RoleAssignment);
  const unseat = (role: Role, userId: string) => { for (const s of seats) if (s.roleId === role.id && s.userId === userId) s.revokedAt = new Date(); };

  const live = (t: string, userId: string) => seats.filter((s) => s.tenantId === t && s.userId === userId && !s.revokedAt)
    .flatMap((s) => roles.filter((r) => r.id === s.roleId && !r.deletedAt));
  const roleRepo = {
    list: async (t: string, o?: { includeDisabled?: boolean }) => roles.filter((r) => r.tenantId === t && (o?.includeDisabled || !r.deletedAt)),
    getById: async (t: string, id: string) => roles.find((r) => r.tenantId === t && r.id === id && !r.deletedAt) ?? null,
    listForUser: async (t: string, u: string) => live(t, u),
    listAssignments: async (t: string, roleId: string) => seats.filter((s) => s.tenantId === t && s.roleId === roleId),
  } as unknown as RoleRepository;
  const userRepo = {
    getById: async (t: string, id: string) => users.find((u) => u.tenantId === t && u.id === id) ?? null,
    list: async (t: string) => users.filter((u) => u.tenantId === t),
    listWithPermission: async (t: string, permission: string, exclude: string) =>
      users.filter((u) => u.tenantId === t && !u.deletedAt && u.id !== exclude && (u.roles.includes(permission) || live(t, u.id).some((r) => r.permissions.includes(permission as never))))
        .map((u) => ({ id: u.id, displayName: u.displayName })),
  } as unknown as UserRepository;

  const push = <R>(out: R, events: (r: R) => Evt[]) => { audit.push(...events(out)); return out; };
  const grantRepo: SensitiveViewGrantRepository = {
    list: async (t) => grants.filter((g) => g.tenantId === t).map((g) => ({ ...g })),
    getById: async (t, id) => { const g = grants.find((x) => x.tenantId === t && x.id === id); return g ? { ...g } : null; },
    isApproved: async (t, u) => grants.some((g) => g.tenantId === t && g.userId === u && g.status === "APPROVED"),
    create: async (i, events) => {
      if (i.requestedBy === i.userId) throw new Error("23514 svg_not_for_self_check");
      if (grants.some((g) => g.tenantId === i.tenantId && g.userId === i.userId && (g.status === "PENDING" || g.status === "APPROVED"))) throw new ConflictError("live");
      const g: SensitiveViewGrant = { id: randomUUID(), ...i, status: "PENDING", requestedAt: new Date(), decidedBy: null, decidedAt: null,
        decisionReason: null, revokedBy: null, revokedAt: null, revokeReason: null };
      grants.push(g);
      return push({ ...g }, events);
    },
    decide: async (t, id, c, events) => {
      const g = grants.find((x) => x.tenantId === t && x.id === id && x.status === "PENDING" && (c.status !== "APPROVED" || !x.expiresAt || x.expiresAt > new Date()));
      if (!g) throw new ConflictError("decided or expired");
      if (c.by === g.requestedBy || c.by === g.userId) throw new Error("23514 svg_maker_checker_check");
      Object.assign(g, { status: c.status, decidedBy: c.by, decidedAt: new Date(), decisionReason: c.reason });
      return push({ ...g }, events);
    },
    revoke: async (t, id, c, events) => {
      const g = grants.find((x) => x.tenantId === t && x.id === id && (x.status === "PENDING" || x.status === "APPROVED"));
      if (!g) throw new ConflictError("final");
      const before = { ...g };
      Object.assign(g, { status: "REVOKED", revokedBy: c.by, revokedAt: new Date(), revokeReason: c.reason });
      return push({ before, after: { ...g } }, events).after;
    },
    revokeLiveOf: async (t, userId, c, events) => {
      const g = grants.find((x) => x.tenantId === t && x.userId === userId && (x.status === "PENDING" || x.status === "APPROVED"));
      if (!g) return null;
      const before = { ...g };
      Object.assign(g, { status: "REVOKED", revokedBy: c.by, revokedAt: new Date(), revokeReason: c.reason });
      return push({ before, after: { ...g } }, events).after;
    },
  };
  const notifications = opts.withNotifications === false ? undefined : ({
    record: async (n: Note) => { notes.push(n); return n; },
  } as unknown as NotificationService);
  const configs = { getByTenant: async () => ({ policyRequestExpiryDays: cfg.days }) } as never;
  const service = new RoleService(roleRepo, { record: async () => {} } as never, userRepo, undefined, undefined, notifications, configs, undefined, undefined, grantRepo);

  // Population: a 1st line agent, two Risk Managers, a Committee member, an Auditor, an administrator by a role, a direct administrator.
  const rmGroup = mkRole("Risk Manager", "RISK_MANAGER", ["role.read", "risk.read"]);
  const comGroup = mkRole("Comité", "RISK_COMMITTEE", ["risk.read", "rolegroup.audit.validate"]);
  const audGroup = mkRole("Audit", "AUDIT", ["audit.read", "rolegroup.audit.validate"]);
  const admRole = mkRole("Administrateurs", null, ["role.update", "role.read"]);
  const agentRole = mkRole("Métier", null, ["risk.read"]);
  for (const id of ["rm1", "rm2", "com", "com2", "aud", "adm", "agent"]) mkUser(id);
  mkUser("legacy", { roles: ["user.update"] }); // direct (legacy users.roles) administration right
  seat(rmGroup, "rm1"); seat(rmGroup, "rm2"); seat(comGroup, "com"); seat(comGroup, "com2"); seat(audGroup, "aud");
  seat(admRole, "adm"); seat(agentRole, "agent");
  const rm1 = actor("rm1", ["role.read", "risk.read"]);
  return { service, users, roles, grants, audit, notes, cfg, mkUser, mkRole, seat, unseat, rmGroup, comGroup, audGroup, admRole, agentRole, rm1,
    admin: actor("adm", ["role.read", "role.assign", "role.update"]),
    committee: actor("com", ["role.read", "rolegroup.audit.validate"]),
    auditor: actor("aud", ["role.read", "audit.read", "rolegroup.audit.validate"]) };
}

/** HTTP surface of the real router, identity injected (as authMiddleware would). */
async function http(service: RoleService, user: AuthenticatedUser, method: string, path: string, body?: unknown) {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    (req as unknown as { user: AuthenticatedUser }).user = user;
    (req as unknown as { requestId: string }).requestId = "req";
    next();
  });
  app.use("/roles", rolesRouter(service));
  app.use(errorHandler);
  const server = app.listen(0);
  try {
    const addr = server.address();
    const port = typeof addr === "object" && addr ? addr.port : 0;
    const res = await fetch(`http://127.0.0.1:${port}/roles${path}`, {
      method, headers: { "content-type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await res.text();
    return { status: res.status, text, json: (text ? JSON.parse(text) : null) as Record<string, unknown> | null };
  } finally {
    server.close();
  }
}
const without = (text: string, id: string) => text.split(id).join("<ID>").replace(/"requestId":"[^"]*"/, "");

// ============================================================================================================ LEAKS
describe("QA-rights-lines / L1 lists never carry the Audit or the administrators to a restricted reader", () => {
  it("service: /roles, /matrix, /accounts == 1st and 2nd lines only", async () => {
    const w = world();
    expect((await w.service.list(w.rm1)).map((r) => r.name).sort(byText)).toEqual(["Comité", "Métier", "Risk Manager"]);
    expect((await w.service.matrix(w.rm1)).map((r) => r.name).sort(byText)).toEqual(["Comité", "Métier", "Risk Manager"]);
    expect((await w.service.accounts(w.rm1)).map((a) => a.id).sort(byText)).toEqual(["agent", "com", "com2", "rm1", "rm2"]);
  });

  it("HTTP: no trace (name, id, permission) of a hidden role or account in the three bodies", async () => {
    const w = world();
    for (const path of ["", "/matrix", "/accounts"]) {
      const r = await http(w.service, w.rm1, "GET", path);
      expect(r.status).toBe(200);
      for (const hidden of ["Audit", "Administrateurs", "audit.read", "role.update", `"aud"`, `"adm"`, `"legacy"`, w.audGroup.id, w.admRole.id]) {
        expect(r.text, `${path} leaks ${hidden}`).not.toContain(hidden);
      }
    }
  });

  it("the unfiltered list differs for an administrator (the cut is real, not an empty fixture)", async () => {
    const w = world();
    expect((await w.service.list(w.admin)).map((r) => r.name)).toEqual(expect.arrayContaining(["Audit", "Administrateurs"]));
    expect((await w.service.accounts(w.admin)).map((a) => a.id)).toEqual(expect.arrayContaining(["aud", "adm", "legacy"]));
  });

  it("matrix badge: every row carries its line, the 4 values are the contract", async () => {
    const w = world();
    const lines = Object.fromEntries((await w.service.matrix(w.admin)).map((r) => [r.name, r.line]));
    expect(lines).toEqual({ "Risk Manager": "LINE_2", "Comité": "LINE_2", Audit: "AUDIT", Administrateurs: "ADMIN", "Métier": "LINE_1" });
  });

  it("a suspended hidden account is not listed", async () => {
    const w = world();
    w.mkUser("aud-gone", { deletedAt: new Date() });
    w.seat(w.audGroup, "aud-gone");
    expect((await w.service.accounts(w.admin)).map((a) => a.id)).not.toContain("aud-gone");
  });

  it("no role.read -> 403 on every read of the family, whatever the line", async () => {
    const w = world();
    const nobody = actor("agent", ["risk.read"]);
    await expect(w.service.list(nobody)).rejects.toThrow(ForbiddenError);
    await expect(w.service.matrix(nobody)).rejects.toThrow(ForbiddenError);
    await expect(w.service.accounts(nobody)).rejects.toThrow(ForbiddenError);
    await expect(w.service.get(nobody, w.agentRole.id)).rejects.toThrow(ForbiddenError);
    await expect(w.service.listForUser(nobody, "agent")).rejects.toThrow(ForbiddenError);
  });
});

describe("QA-rights-lines / L2 a hidden id answers exactly like an unknown id", () => {
  const UNKNOWN = "99999999-9999-4999-8999-999999999999";

  it("HTTP /roles/:id: hidden role (Audit, administrators) == unknown role (404, same body modulo id); a visible role is 200", async () => {
    const w = world();
    const unknown = await http(w.service, w.rm1, "GET", `/${UNKNOWN}`);
    expect(unknown.status).toBe(404);
    for (const hidden of [w.audGroup, w.admRole]) {
      const r = await http(w.service, w.rm1, "GET", `/${hidden.id}`);
      expect(r.status).toBe(404);
      expect(without(r.text, hidden.id)).toBe(without(unknown.text, UNKNOWN));
      expect(r.text).not.toContain(hidden.name);
    }
    expect((await http(w.service, w.rm1, "GET", `/${w.comGroup.id}`)).status).toBe(200);
  });

  it("HTTP /roles/users/:id{,/permissions,/permission-sources}: hidden account (Audit, role-admin, direct admin) == unknown account (404)", async () => {
    const w = world();
    // The ids are not uuids in this fixture: use real guid-shaped ids for the hidden accounts.
    const ids = { aud: randomUUID(), adm: randomUUID(), legacy: randomUUID() };
    w.mkUser(ids.aud); w.seat(w.audGroup, ids.aud);
    w.mkUser(ids.adm); w.seat(w.admRole, ids.adm);
    w.mkUser(ids.legacy, { roles: ["user.update"] });
    for (const suffix of ["/permissions", "/permission-sources"]) {
      const unknown = await http(w.service, w.rm1, "GET", `/users/${UNKNOWN}${suffix}`);
      expect(unknown.status).toBe(404);
      for (const id of Object.values(ids)) {
        const r = await http(w.service, w.rm1, "GET", `/users/${id}${suffix}`);
        expect(r.status, `${id}${suffix}`).toBe(404);
        expect(without(r.text, id)).toBe(without(unknown.text, UNKNOWN));
      }
    }
  });

  // QA-RL-02 (fixed): `/roles/users/:id` (listForUser) answers 404 for an unknown id as for a hidden one, so a 404 never tells
  // "this account exists and is Audit / administrator".
  it("QA-RL-02 HTTP /roles/users/:id: hidden account indistinguishable from an unknown id (both 404)", async () => {
    const w = world();
    const hidden = randomUUID();
    w.mkUser(hidden); w.seat(w.audGroup, hidden);
    const unknown = await http(w.service, w.rm1, "GET", `/users/${UNKNOWN}`);
    const r = await http(w.service, w.rm1, "GET", `/users/${hidden}`);
    expect(r.status).toBe(unknown.status);
  });

  it("a suspended hidden account is still a 404 (never 200 + suspended:true, which would confirm it exists)", async () => {
    const w = world();
    const id = randomUUID();
    w.mkUser(id, { deletedAt: new Date() }); w.seat(w.audGroup, id);
    await expect(w.service.getEffectivePermissionSources(w.rm1, id)).rejects.toThrow(NotFoundError);
    await expect(w.service.getEffectivePermissions(w.rm1, id)).rejects.toThrow(NotFoundError);
  });

  it("a visible account of the 1st / 2nd line stays readable (no over-blocking)", async () => {
    const w = world();
    expect((await w.service.getEffectivePermissionSources(w.rm1, "agent")).suspended).toBe(false);
    expect((await w.service.getEffectivePermissions(w.rm1, "com")).length).toBeGreaterThan(0);
    expect((await w.service.listForUser(w.rm1, "rm2")).map((r) => r.name)).toEqual(["Risk Manager"]);
  });

  it("the reader's own sheet is not hidden from them when they are administrator-free (sanity: self read)", async () => {
    const w = world();
    expect((await w.service.getEffectivePermissionSources(w.rm1, "rm1")).permissions.length).toBeGreaterThan(0);
  });
});

describe("QA-rights-lines / L3 cumulation: the most sensitive line wins", () => {
  it.each<[string, (w: ReturnType<typeof world>) => void, string, string]>([
    ["Risk Manager + administrator role", (w) => { w.seat(w.admRole, "rm2"); }, "rm2", "ADMIN"],
    ["Committee + Audit (cumul allowed by default)", (w) => { w.seat(w.audGroup, "com2"); }, "com2", "AUDIT"],
    ["Risk Manager + direct legacy admin permission", (w) => { w.users.find((u) => u.id === "rm2")!.roles = ["user.create"]; }, "rm2", "ADMIN"],
    ["Audit + administrator role", (w) => { w.seat(w.admRole, "aud"); }, "aud", "ADMIN"],
    ["1st line agent + Committee", (w) => { w.seat(w.comGroup, "agent"); }, "agent", "LINE_2"],
  ])("%s", async (_n, setup, who, line) => {
    const w = world();
    setup(w);
    expect((await w.service.accounts(w.admin)).find((a) => a.id === who)?.line).toBe(line);
  });

  it("the cumulated account disappears for the restricted reader as soon as ONE of its lines is sensitive", async () => {
    const w = world();
    w.seat(w.admRole, "rm2");
    w.seat(w.audGroup, "com2");
    const ids = (await w.service.accounts(w.rm1)).map((a) => a.id);
    expect(ids).not.toContain("rm2");
    expect(ids).not.toContain("com2");
    await expect(w.service.getEffectivePermissions(w.rm1, "rm2")).rejects.toThrow(NotFoundError);
  });

  it("a revoked Audit seat or a disabled administrator role no longer classifies the account", async () => {
    const w = world();
    w.unseat(w.audGroup, "aud");
    w.admRole.deletedAt = new Date();
    const ids = (await w.service.accounts(w.rm1)).map((a) => a.id);
    expect(ids).toEqual(expect.arrayContaining(["aud", "adm"]));
    expect((await w.service.accounts(w.rm1)).find((a) => a.id === "aud")?.line).toBe("LINE_1");
  });

  it("a role that carries an administration right is ADMIN whatever its name or group (also with a single such right)", async () => {
    const w = world();
    const r = w.mkRole("Gestion des comptes", null, ["user.reactivate"]);
    const ids = (await w.service.list(w.rm1)).map((x) => x.id);
    expect(ids).not.toContain(r.id);
    await expect(w.service.get(w.rm1, r.id)).rejects.toThrow(NotFoundError);
  });

  // OBSERVATION QA-RL-OBS-02: the Audit line is the Audit GROUP only (roleLine / lineOf). A custom role carrying audit.read makes its
  // holders auditors "in effect" (isAuditPermission, F-B8b-05) but they are shown as LINE_1 and stay visible to a restricted reader.
  it("OBSERVATION: an ordinary role with audit.read is classified 1st line (group-based Audit line)", async () => {
    const w = world();
    const r = w.mkRole("Lecteur audit", null, ["audit.read"]);
    expect((await w.service.matrix(w.admin)).find((x) => x.id === r.id)?.line).toBe("LINE_1");
  });
});

describe("QA-rights-lines / L4 unrestricted readers", () => {
  it("administrator (by a role right), Audit member, holder of role.read.sensitive see every account", async () => {
    const w = world();
    const widened = actor("rm2", ["role.read", "role.read.sensitive"]);
    for (const reader of [w.admin, actor("legacy", ["role.read", "user.update"]), w.auditor, widened]) {
      expect(await w.service.accounts(reader)).toHaveLength(8);
    }
  });

  it("an Audit member WITHOUT any other right is unrestricted; the same person after leaving Audit is restricted", async () => {
    const w = world();
    const aud = actor("aud", ["role.read"]);
    expect(await w.service.accounts(aud)).toHaveLength(8);
    w.unseat(w.audGroup, "aud");
    expect((await w.service.accounts(aud)).map((a) => a.id)).not.toContain("adm");
  });

  it("role.read.sensitive can never be carried by a role, created or updated (fail closed)", async () => {
    const w = world();
    const editor = actor("adm", ["role.read", "role.create", "role.update"]);
    await expect(w.service.create(editor, { name: "Vue large", permissions: ["role.read.sensitive"] } as never, "R1")).rejects.toThrow(ValidationError);
    await expect(w.service.update(editor, w.agentRole.id, { permissions: ["risk.read", "role.read.sensitive"] } as never, "R2")).rejects.toThrow(ValidationError);
  });
});

// ============================================================================================================ CIRCUIT q200
describe("QA-rights-lines / C1 request", () => {
  it("who may ask: role.assign only; never for oneself; Risk Manager members only; active, same-tenant accounts", async () => {
    const w = world();
    w.mkUser("rm-gone", { deletedAt: new Date() }); w.seat(w.rmGroup, "rm-gone");
    w.mkUser("alien", {}, T2);
    await expect(w.service.requestSensitiveView(w.rm1, "rm2", "Contrôle", "R")).rejects.toThrow(ForbiddenError);
    await expect(w.service.requestSensitiveView(w.committee, "rm2", "Contrôle", "R")).rejects.toThrow(ForbiddenError);
    const selfRm = actor("rm1", ["role.assign"]);
    await expect(w.service.requestSensitiveView(selfRm, "rm1", "Pour moi", "R")).rejects.toThrow(ForbiddenError);
    for (const target of ["agent", "com", "aud", "adm"]) {
      await expect(w.service.requestSensitiveView(actor("boss", ["role.assign"]), target, "Hors groupe", "R"), target).rejects.toThrow(ValidationError);
    }
    await expect(w.service.requestSensitiveView(w.admin, "rm-gone", "Suspendu", "R")).rejects.toThrow(NotFoundError);
    await expect(w.service.requestSensitiveView(w.admin, "alien", "Autre tenant", "R")).rejects.toThrow(NotFoundError);
    await expect(w.service.requestSensitiveView(w.admin, randomUUID(), "Inconnu", "R")).rejects.toThrow(NotFoundError);
    expect(w.grants).toHaveLength(0);
    expect(w.audit).toHaveLength(0);
  });

  it("the author is forced to the caller (requestedBy never read from the client)", async () => {
    const w = world();
    const g = await w.service.requestSensitiveView(w.admin, "rm1", "Contrôle", "R");
    expect(g.requestedBy).toBe("adm");
    expect(g.tenantId).toBe(T1);
    expect(w.audit.at(-1)).toMatchObject({ userId: "adm", action: "SUBMIT", entityType: "SensitiveViewGrant", entityId: g.id, tenantId: T1 });
  });

  it("expiry is fixed at the request from policyRequestExpiryDays (now + N days), null when unset; a later config change does not move it", async () => {
    const w = world({ expiryDays: 3 });
    const before = Date.now();
    const g = await w.service.requestSensitiveView(w.admin, "rm1", "Contrôle", "R");
    expect(g.expiresAt!.getTime()).toBeGreaterThanOrEqual(before + 3 * DAY);
    expect(g.expiresAt!.getTime()).toBeLessThanOrEqual(Date.now() + 3 * DAY);
    w.cfg.days = 30;
    expect(w.grants[0]!.expiresAt!.getTime()).toBe(g.expiresAt!.getTime());
    const w2 = world({ expiryDays: null });
    expect((await w2.service.requestSensitiveView(w2.admin, "rm1", "Contrôle", "R")).expiresAt).toBeNull();
  });
});

describe("QA-rights-lines / C1 HTTP validation of the request body", () => {
  const ID = randomUUID();
  it.each<[string, unknown]>([
    ["missing body", undefined],
    ["empty object", {}],
    ["no reason", { userId: ID }],
    ["blank reason", { userId: ID, reason: "   " }],
    ["reason of 501 characters", { userId: ID, reason: "x".repeat(501) }],
    ["null reason", { userId: ID, reason: null }],
    ["numeric reason", { userId: ID, reason: 42 }],
    ["userId not a uuid", { userId: "not-a-uuid", reason: "r" }],
    ["userId null", { userId: null, reason: "r" }],
    ["userId array", { userId: [ID], reason: "r" }],
    ["client-supplied requestedBy", { userId: ID, reason: "r", requestedBy: ID }],
    ["client-supplied status", { userId: ID, reason: "r", status: "APPROVED" }],
    ["client-supplied tenantId", { userId: ID, reason: "r", tenantId: T2 }],
    ["client-supplied decidedBy", { userId: ID, reason: "r", decidedBy: ID }],
  ])("400 and nothing written: %s", async (_n, body) => {
    const w = world();
    const r = await http(w.service, w.admin, "POST", "/sensitive-view-grants", body);
    expect(r.status).toBe(400);
    expect(w.grants).toHaveLength(0);
    expect(w.audit).toHaveLength(0);
  });

  it("the boundary: a reason of exactly 500 characters is accepted (201) for a Risk Manager member", async () => {
    const w = world();
    w.mkUser(ID); w.seat(w.rmGroup, ID);
    const r = await http(w.service, w.admin, "POST", "/sensitive-view-grants", { userId: ID, reason: "x".repeat(500) });
    expect(r.status).toBe(201);
  });

  it("an unauthenticated-like caller without role.assign gets 403 on the four write routes and the list", async () => {
    const w = world();
    const g = await w.service.requestSensitiveView(w.admin, "rm1", "Contrôle", "R");
    const rm = w.rm1;
    expect((await http(w.service, rm, "GET", "/sensitive-view-grants")).status).toBe(403);
    expect((await http(w.service, rm, "POST", "/sensitive-view-grants", { userId: ID, reason: "r" })).status).toBe(403);
    expect((await http(w.service, rm, "POST", `/sensitive-view-grants/${g.id}/approve`, {})).status).toBe(403);
    expect((await http(w.service, rm, "POST", `/sensitive-view-grants/${g.id}/reject`, { reason: "r" })).status).toBe(403);
    expect((await http(w.service, rm, "POST", `/sensitive-view-grants/${g.id}/revoke`, { reason: "r" })).status).toBe(403);
    expect(w.grants[0]!.status).toBe("PENDING");
  });

  it("non-uuid grant ids -> 400 on approve / reject / revoke, never a 500", async () => {
    const w = world();
    for (const [action, body] of [["approve", {}], ["reject", { reason: "r" }], ["revoke", { reason: "r" }]] as const) {
      for (const bad of ["not-a-uuid", "123", "00000000-0000-0000-0000", "%00", "x".repeat(300)]) {
        const r = await http(w.service, w.committee, "POST", `/sensitive-view-grants/${encodeURIComponent(bad)}/${action}`, body);
        expect(r.status, `${action} ${bad}`).toBe(400);
      }
    }
  });

  it("bodies of decision and revocation are strict and the revoke reason is mandatory", async () => {
    const w = world();
    const g = await w.service.requestSensitiveView(w.admin, "rm1", "Contrôle", "R");
    expect((await http(w.service, w.committee, "POST", `/sensitive-view-grants/${g.id}/approve`, { status: "REJECTED" })).status).toBe(400);
    expect((await http(w.service, w.committee, "POST", `/sensitive-view-grants/${g.id}/approve`, { decidedBy: "adm" })).status).toBe(400);
    expect((await http(w.service, w.admin, "POST", `/sensitive-view-grants/${g.id}/revoke`, {})).status).toBe(400);
    expect((await http(w.service, w.admin, "POST", `/sensitive-view-grants/${g.id}/revoke`, { reason: "  " })).status).toBe(400);
    expect((await http(w.service, w.committee, "POST", `/sensitive-view-grants/${g.id}/reject`, {})).status).toBe(400); // service: reason required
    expect(w.grants[0]!.status).toBe("PENDING");
  });

  it("the GET list is visible to administrators and confirmers only, bounded to their tenant", async () => {
    const w = world();
    await w.service.requestSensitiveView(w.admin, "rm1", "Contrôle", "R");
    w.grants.push({ ...w.grants[0]!, id: randomUUID(), tenantId: T2 });
    expect((await http(w.service, w.admin, "GET", "/sensitive-view-grants")).status).toBe(200);
    const asCommittee = await http(w.service, actor("com", ["rolegroup.audit.validate"]), "GET", "/sensitive-view-grants");
    expect(asCommittee.status).toBe(200);
    expect((asCommittee.json!["data"] as unknown[]).length).toBe(1);
    expect((await http(w.service, actor("agent", ["risk.read"]), "GET", "/sensitive-view-grants")).status).toBe(403);
  });
});

describe("QA-rights-lines / C2 decision: maker-checker, expiry, replays", () => {
  it("the author and the beneficiary never decide, even holding every right; a third confirmer may; no right -> 403", async () => {
    const w = world();
    const g = await w.service.requestSensitiveView(w.admin, "rm1", "Contrôle", "R");
    const authorWithAll = actor("adm", ["role.assign", "rolegroup.audit.validate"]);
    const beneficiaryWithAll = actor("rm1", ["role.read", "rolegroup.audit.validate"]);
    for (const approve of [true, false]) {
      await expect(w.service.decideSensitiveView(authorWithAll, g.id, approve, "raison", "R")).rejects.toThrow(ForbiddenError);
      await expect(w.service.decideSensitiveView(beneficiaryWithAll, g.id, approve, "raison", "R")).rejects.toThrow(ForbiddenError);
      await expect(w.service.decideSensitiveView(w.admin, g.id, approve, "raison", "R")).rejects.toThrow(ForbiddenError);
    }
    expect(w.grants[0]).toMatchObject({ status: "PENDING", decidedBy: null });
    expect(w.audit.map((e) => e.action)).toEqual(["SUBMIT"]);
    expect((await w.service.decideSensitiveView(w.committee, g.id, true, null, "R")).status).toBe("APPROVED");
    expect(w.grants[0]).toMatchObject({ decidedBy: "com" });
  });

  it("an Audit member can confirm too; refusing requires a reason; unknown id -> 404", async () => {
    const w = world();
    const g = await w.service.requestSensitiveView(w.admin, "rm1", "Contrôle", "R");
    await expect(w.service.decideSensitiveView(w.auditor, g.id, false, null, "R")).rejects.toThrow(ValidationError);
    await expect(w.service.decideSensitiveView(w.auditor, randomUUID(), true, null, "R")).rejects.toThrow(NotFoundError);
  });

  it("replays: approve twice, reject after approve, approve after reject, decide after revoke -> Conflict, state frozen", async () => {
    const w = world();
    const a = await w.service.requestSensitiveView(w.admin, "rm1", "Contrôle", "R");
    await w.service.decideSensitiveView(w.committee, a.id, true, null, "R");
    await expect(w.service.decideSensitiveView(w.auditor, a.id, true, null, "R")).rejects.toThrow(ConflictError);
    await expect(w.service.decideSensitiveView(w.auditor, a.id, false, "non", "R")).rejects.toThrow(ConflictError);
    expect(w.grants[0]).toMatchObject({ status: "APPROVED", decidedBy: "com" });
    await w.service.revokeSensitiveView(w.admin, a.id, "Fin", "R");
    await expect(w.service.decideSensitiveView(w.auditor, a.id, true, null, "R")).rejects.toThrow(ConflictError);
    const b = await w.service.requestSensitiveView(w.admin, "rm2", "Contrôle", "R");
    await w.service.decideSensitiveView(w.committee, b.id, false, "Non justifié", "R");
    await expect(w.service.decideSensitiveView(w.auditor, b.id, true, null, "R")).rejects.toThrow(ConflictError);
    expect(w.grants.find((g) => g.id === b.id)!.status).toBe("REJECTED");
  });

  it("an EXPIRED request can no longer be approved (409), stays rejectable and revocable, and grants nothing", async () => {
    const w = world({ expiryDays: 1 });
    const g = await w.service.requestSensitiveView(w.admin, "rm1", "Contrôle", "R");
    w.grants[0]!.expiresAt = new Date(Date.now() - 1000);
    await expect(w.service.decideSensitiveView(w.committee, g.id, true, null, "R")).rejects.toThrow(ConflictError);
    expect(w.grants[0]!.status).toBe("PENDING");
    expect((await w.service.accounts(w.rm1)).map((a) => a.id)).not.toContain("aud");
    expect((await w.service.decideSensitiveView(w.committee, g.id, false, "Expirée", "R")).status).toBe("REJECTED");
  });

  it("the exact boundary: expiresAt one second ahead is approvable, one millisecond behind is not", async () => {
    const w = world({ expiryDays: 1 });
    const ok = await w.service.requestSensitiveView(w.admin, "rm1", "Contrôle", "R");
    w.grants[0]!.expiresAt = new Date(Date.now() + 1000);
    expect((await w.service.decideSensitiveView(w.committee, ok.id, true, null, "R")).status).toBe("APPROVED");
    const late = await w.service.requestSensitiveView(w.admin, "rm2", "Contrôle", "R");
    w.grants.find((g) => g.id === late.id)!.expiresAt = new Date(Date.now() - 1);
    await expect(w.service.decideSensitiveView(w.committee, late.id, true, null, "R")).rejects.toThrow(ConflictError);
  });

  it("approval re-checks the membership: the beneficiary left the Risk Manager group while PENDING -> 400, nothing granted", async () => {
    const w = world();
    const g = await w.service.requestSensitiveView(w.admin, "rm1", "Contrôle", "R");
    w.unseat(w.rmGroup, "rm1");
    await expect(w.service.decideSensitiveView(w.committee, g.id, true, null, "R")).rejects.toThrow(ValidationError);
    expect(w.grants[0]!.status).toBe("PENDING");
  });
});

describe("QA-rights-lines / C3 one live request per account", () => {
  it("a second request while PENDING or APPROVED -> 409; after REJECTED or REVOKED a new one is allowed", async () => {
    const w = world();
    const g1 = await w.service.requestSensitiveView(w.admin, "rm1", "Contrôle", "R");
    await expect(w.service.requestSensitiveView(w.admin, "rm1", "Doublon", "R")).rejects.toThrow(ConflictError);
    await w.service.decideSensitiveView(w.committee, g1.id, true, null, "R");
    await expect(w.service.requestSensitiveView(actor("adm2", ["role.assign"]), "rm1", "Doublon", "R")).rejects.toThrow(ConflictError);
    await w.service.revokeSensitiveView(w.admin, g1.id, "Fin", "R");
    const g2 = await w.service.requestSensitiveView(w.admin, "rm1", "Nouvelle", "R");
    await w.service.decideSensitiveView(w.committee, g2.id, false, "Non", "R");
    expect((await w.service.requestSensitiveView(w.admin, "rm1", "Encore", "R")).status).toBe("PENDING");
    expect(w.grants.filter((g) => g.status === "PENDING" || g.status === "APPROVED")).toHaveLength(1);
  });

  it("two simultaneous requests for the same account: exactly one wins", async () => {
    const w = world();
    const r = await Promise.allSettled([
      w.service.requestSensitiveView(w.admin, "rm1", "A", "R1"),
      w.service.requestSensitiveView(actor("adm2", ["role.assign"]), "rm1", "B", "R2"),
    ]);
    expect(r.filter((x) => x.status === "fulfilled")).toHaveLength(1);
    expect(w.grants).toHaveLength(1);
  });
});

describe("QA-rights-lines / C4 effective only while APPROVED and in the Risk Manager group", () => {
  async function approved(w: ReturnType<typeof world>, who = "rm1") {
    const g = await w.service.requestSensitiveView(w.admin, who, "Contrôle", "R");
    await w.service.decideSensitiveView(w.committee, g.id, true, null, "R");
    return g;
  }
  const idsFor = async (w: ReturnType<typeof world>, who: string) => (await w.service.accounts(actor(who, ["role.read"]))).map((a) => a.id);

  it("PENDING, REJECTED, REVOKED grant nothing; APPROVED widens; the effect is the beneficiary's alone (rm2 stays restricted)", async () => {
    const w = world();
    const g = await w.service.requestSensitiveView(w.admin, "rm1", "Contrôle", "R");
    expect(await idsFor(w, "rm1")).not.toContain("aud");
    await w.service.decideSensitiveView(w.committee, g.id, true, null, "R");
    expect(await idsFor(w, "rm1")).toEqual(expect.arrayContaining(["aud", "adm", "legacy"]));
    expect(await idsFor(w, "rm2")).not.toContain("aud");
    expect(await idsFor(w, "com")).not.toContain("aud");
    await w.service.revokeSensitiveView(w.admin, g.id, "Fin", "R");
    expect(await idsFor(w, "rm1")).not.toContain("aud");
  });

  it("the widened view also opens the ids (roles and accounts) that were 404 before", async () => {
    const w = world();
    const rm1 = actor("rm1", ["role.read"]);
    await expect(w.service.get(rm1, w.audGroup.id)).rejects.toThrow(NotFoundError);
    await approved(w);
    expect((await w.service.get(rm1, w.audGroup.id)).name).toBe("Audit");
    expect((await w.service.getEffectivePermissionSources(rm1, "aud")).permissions.length).toBeGreaterThan(0);
  });

  it("the person LEAVES the Risk Manager group: the view closes immediately (lists, ids, sources) although the grant row stays APPROVED", async () => {
    const w = world();
    await approved(w);
    const rm1 = actor("rm1", ["role.read"]);
    expect(await idsFor(w, "rm1")).toContain("aud");
    w.unseat(w.rmGroup, "rm1");
    expect(await idsFor(w, "rm1")).not.toContain("aud");
    await expect(w.service.get(rm1, w.audGroup.id)).rejects.toThrow(NotFoundError);
    const sources = await w.service.getEffectivePermissionSources(w.admin, "rm1");
    expect(sources.permissions.some((p) => p.permission === "role.read.sensitive")).toBe(false);
    expect(await w.service.getEffectivePermissions(w.admin, "rm1")).not.toContain("role.read.sensitive");
    expect(w.grants[0]!.status).toBe("APPROVED");
  });

  // OBSERVATION QA-RL-OBS-03: nothing closes the row when the person leaves the group; coming back (any later date) silently
  // re-activates the old confirmation, with no new confirmer. Documented current behaviour, PO to confirm it is intended.
  it("OBSERVATION: leaving then re-joining the group re-activates the same APPROVED grant without a new confirmation", async () => {
    const w = world();
    await approved(w);
    w.unseat(w.rmGroup, "rm1");
    expect(await idsFor(w, "rm1")).not.toContain("aud");
    w.seat(w.rmGroup, "rm1");
    expect(await idsFor(w, "rm1")).toContain("aud");
    expect(w.grants).toHaveLength(1);
  });

  it("a grant never makes its holder an administrator: no write right appears, sources show GRANT only for role.read.sensitive", async () => {
    const w = world();
    await approved(w);
    const sources = (await w.service.getEffectivePermissionSources(w.admin, "rm1")).permissions;
    expect(sources.find((p) => p.permission === "role.read.sensitive")?.sources).toEqual([{ kind: "GRANT" }]);
    expect(sources.filter((p) => p.sources.some((s) => s.kind === "GRANT"))).toHaveLength(1);
  });

  it("a grant row of ANOTHER user never widens this reader (isApproved is per account)", async () => {
    const w = world();
    await approved(w, "rm2");
    expect(await idsFor(w, "rm1")).not.toContain("aud");
  });
});

describe("QA-rights-lines / C5 revoke", () => {
  it("role.assign + reason; from PENDING (withdraw) or APPROVED; terminal; audited UNASSIGN with before/after", async () => {
    const w = world();
    const g = await w.service.requestSensitiveView(w.admin, "rm1", "Contrôle", "R");
    await expect(w.service.revokeSensitiveView(w.committee, g.id, "Pas mon rôle", "R")).rejects.toThrow(ForbiddenError);
    await expect(w.service.revokeSensitiveView(actor("rm1", ["role.read"]), g.id, "Je veux garder", "R")).rejects.toThrow(ForbiddenError);
    expect((await w.service.revokeSensitiveView(w.admin, g.id, "Retirée avant décision", "R")).status).toBe("REVOKED");
    await expect(w.service.revokeSensitiveView(w.admin, g.id, "Encore", "R")).rejects.toThrow(ConflictError);
    await expect(w.service.revokeSensitiveView(w.admin, randomUUID(), "Inconnu", "R")).rejects.toThrow(NotFoundError);
    expect(w.audit.at(-1)).toMatchObject({ action: "UNASSIGN", reason: "Retirée avant décision", entityId: g.id });
    expect((w.audit.at(-1)!.oldValue as SensitiveViewGrant).status).toBe("PENDING");
    expect((w.audit.at(-1)!.newValue as SensitiveViewGrant).status).toBe("REVOKED");
  });

  it("a REJECTED request cannot be 'revoked' (409): the refusal stays a refusal", async () => {
    const w = world();
    const g = await w.service.requestSensitiveView(w.admin, "rm1", "Contrôle", "R");
    await w.service.decideSensitiveView(w.committee, g.id, false, "Non", "R");
    await expect(w.service.revokeSensitiveView(w.admin, g.id, "Retrait", "R")).rejects.toThrow(ConflictError);
  });

  it("every state change is audited exactly once with the actor (SUBMIT, APPROVE, UNASSIGN) and the request id", async () => {
    const w = world();
    const g = await w.service.requestSensitiveView(w.admin, "rm1", "Contrôle", "REQ-1");
    await w.service.decideSensitiveView(w.committee, g.id, true, "Conforme", "REQ-2");
    await w.service.revokeSensitiveView(w.admin, g.id, "Fin", "REQ-3");
    expect(w.audit.map((e) => [e.action, e.userId, e.requestId])).toEqual([["SUBMIT", "adm", "REQ-1"], ["APPROVE", "com", "REQ-2"], ["UNASSIGN", "adm", "REQ-3"]]);
  });
});

describe("QA-rights-lines / C6 notification", () => {
  it("SENSITIVE_VIEW_GRANT_PENDING reaches the Committee and Audit members, never the author nor the beneficiary", async () => {
    const w = world();
    w.mkUser("rm-and-com"); w.seat(w.rmGroup, "rm-and-com"); w.seat(w.comGroup, "rm-and-com");
    const g = await w.service.requestSensitiveView(w.admin, "rm-and-com", "Contrôle", "R");
    const to = w.notes.map((n) => n.recipientUserId).sort(byText);
    expect(to).toEqual(["aud", "com", "com2"]);
    expect(w.notes.every((n) => n.eventType === "SENSITIVE_VIEW_GRANT_PENDING" && n.resourceId === g.id && n.tenantId === T1)).toBe(true);
  });

  it("an author who is also a confirmer is not notified of their own request", async () => {
    const w = world();
    const g = await w.service.requestSensitiveView(actor("com", ["role.assign"]), "rm1", "Contrôle", "R");
    expect(w.notes.map((n) => n.recipientUserId)).not.toContain("com");
    expect(g.requestedBy).toBe("com");
  });

  it("no notifier wired: the request still succeeds and is audited", async () => {
    const w = world({ withNotifications: false });
    expect((await w.service.requestSensitiveView(w.admin, "rm1", "Contrôle", "R")).status).toBe("PENDING");
    expect(w.audit).toHaveLength(1);
  });

  it("the event type is a mandatory catalogue entry", async () => {
    const { NOTIFICATION_CATALOG } = await import("../src/domain/notificationCatalog.js");
    expect(NOTIFICATION_CATALOG.find((e) => e.eventType === "SENSITIVE_VIEW_GRANT_PENDING")).toMatchObject({ mandatory: true, resourceType: "MANAGEMENT" });
  });
});

describe("QA-rights-lines / C7 tenant crossing", () => {
  it("a grant of another tenant: decide / revoke -> 404, row untouched, absent from the list", async () => {
    const w = world();
    w.mkUser("rm-t2", {}, T2);
    const rmT2 = w.mkRole("Risk Manager", "RISK_MANAGER", ["role.read"], {}, T2);
    w.seat(rmT2, "rm-t2");
    const foreign = await w.service.requestSensitiveView(actor("adm-t2", ["role.assign"], T2), "rm-t2", "Contrôle", "R");
    expect(foreign.tenantId).toBe(T2);
    await expect(w.service.decideSensitiveView(w.committee, foreign.id, true, null, "R")).rejects.toThrow(NotFoundError);
    await expect(w.service.revokeSensitiveView(w.admin, foreign.id, "Intrusion", "R")).rejects.toThrow(NotFoundError);
    expect(w.grants.find((g) => g.id === foreign.id)!.status).toBe("PENDING");
    expect(await w.service.listSensitiveViewGrants(w.admin)).toHaveLength(0);
    expect((await http(w.service, w.committee, "POST", `/sensitive-view-grants/${foreign.id}/approve`, {})).status).toBe(404);
    expect((await http(w.service, w.admin, "POST", `/sensitive-view-grants/${foreign.id}/revoke`, { reason: "x" })).status).toBe(404);
  });

  it("another tenant's Risk Manager can neither be requested nor appears in the accounts; a T2 grant does not widen a T1 reader of the same id", async () => {
    const w = world();
    w.mkUser("rm-t2", {}, T2);
    await expect(w.service.requestSensitiveView(w.admin, "rm-t2", "Contrôle", "R")).rejects.toThrow(NotFoundError);
    expect((await w.service.accounts(w.rm1)).map((a) => a.id)).not.toContain("rm-t2");
  });
});

// ============================================================================================================ PostgreSQL 16 réel
const PGPORT = process.env["QA_RL_PGPORT"] ?? "";
const PGDB = process.env["QA_RL_PGDB"] ?? "grc_qa_rl";
const live = PGPORT !== "" && /^grc_qa_rl/.test(PGDB);

describe.skipIf(!live)("QA-rights-lines on real PostgreSQL 16 (QA_RL_PGPORT, db grc_qa_rl*, local only)", () => {
  let pool: Pool;
  const q = <R = Record<string, unknown>>(sql: string, params: unknown[] = []) => pool.query(sql, params).then((r) => r.rows as R[]);
  const tenants: string[] = [];
  const id1 = () => randomUUID();

  async function seedTenant() {
    const t = (await q<{ id: string }>("INSERT INTO tenants (name) VALUES ($1) RETURNING id", [`qa-rl-${randomUUID().slice(0, 8)}`]))[0]!.id;
    tenants.push(t);
    const group = async (name: string, g: SystemGroup, perms: string[]) =>
      (await q<{ id: string }>("INSERT INTO roles (tenant_id, name, permissions, system_group) VALUES ($1,$2,$3,$4) RETURNING id", [t, name, perms, g]))[0]!.id;
    const g = {
      rm: await group("Risk Manager", "RISK_MANAGER", ["role.read", "risk.read"]),
      com: await group("Comité", "RISK_COMMITTEE", ["risk.read", "rolegroup.audit.validate"]),
      aud: await group("Audit", "AUDIT", ["audit.read", "rolegroup.audit.validate"]),
    };
    const admRole = (await q<{ id: string }>("INSERT INTO roles (tenant_id, name, permissions) VALUES ($1,'Administrateurs',$2) RETURNING id", [t, ["role.update", "role.read"]]))[0]!.id;
    const user = async (name: string, groupId?: string) => {
      const id = (await q<{ id: string }>("INSERT INTO users (tenant_id, email, display_name, roles) VALUES ($1,$2,$3,'{}') RETURNING id", [t, `${name}-${randomUUID().slice(0, 6)}@qa-rl.test`, name]))[0]!.id;
      if (groupId) await q("INSERT INTO user_roles (tenant_id, role_id, user_id, granted_by) VALUES ($1,$2,$3,$3)", [t, groupId, id]);
      return id;
    };
    const u = { adm: await user("adm", admRole), rm1: await user("rm1", g.rm), rm2: await user("rm2", g.rm), com: await user("com", g.com),
      aud: await user("aud", g.aud), agent: await user("agent") };
    return { t, g, u, admRole };
  }
  function services() {
    const roleRepo = new PostgresRoleRepository(pool);
    const audit = new PostgresAuditRepository(pool);
    const users = new PostgresUserRepository(pool);
    const grants = new PostgresSensitiveViewGrantRepository(pool);
    const notifications = new NotificationService(new PostgresNotificationRepository(pool), new PostgresNotificationSubscriptionRepository(pool), audit);
    const service = new RoleService(roleRepo, audit, users, undefined, undefined, notifications, new PostgresConfigRepository(pool), undefined, undefined, grants);
    return { service, grants, roleRepo };
  }
  const as = (t: string, userId: string, roles: string[]) => actor(userId, roles, t);

  beforeAll(async () => {
    pool = new Pool({ host: "127.0.0.1", port: Number(PGPORT), user: "postgres", database: PGDB, ssl: false });
  });
  afterAll(async () => {
    const c = await pool.connect();
    try {
      await c.query("SET session_replication_role = replica"); // disposable database: the guards forbid deleting the rows
      for (const tbl of ["notifications", "audit_log", "sensitive_view_grants", "user_roles", "users", "roles", "configs"]) {
        await c.query(`DELETE FROM ${tbl} WHERE tenant_id = ANY($1::uuid[])`, [tenants]).catch(() => undefined);
      }
      await c.query("DELETE FROM tenants WHERE id = ANY($1::uuid[])", [tenants]).catch(() => undefined);
    } finally {
      c.release(true);
    }
    await pool.end();
  });

  it("full circuit: request -> notified confirmers only -> confirm -> widened -> revoke -> narrowed; audit rows in the same transaction", async () => {
    const { t, u, g } = await seedTenant();
    const { service } = services();
    const admin = as(t, u.adm, ["role.read", "role.assign"]);
    const rm = as(t, u.rm1, ["role.read"]);
    const idsOf = async () => (await service.accounts(rm)).map((a) => a.id);
    expect(await idsOf()).toEqual(expect.arrayContaining([u.rm2, u.com, u.agent]));
    expect(await idsOf()).not.toContain(u.aud);
    expect(await idsOf()).not.toContain(u.adm);

    const grant = await service.requestSensitiveView(admin, u.rm1, "Contrôle des habilitations", "REQ-1");
    expect((await q<{ recipient_user_id: string }>("SELECT recipient_user_id FROM notifications WHERE tenant_id=$1 AND event_type='SENSITIVE_VIEW_GRANT_PENDING' AND resource_id=$2", [t, grant.id]))
      .map((r) => r.recipient_user_id).sort(byText)).toEqual([u.aud, u.com].sort(byText));
    await expect(service.decideSensitiveView(as(t, u.adm, ["rolegroup.audit.validate"]), grant.id, true, null, "R")).rejects.toThrow(ForbiddenError);
    await expect(service.decideSensitiveView(as(t, u.rm1, ["rolegroup.audit.validate"]), grant.id, true, null, "R")).rejects.toThrow(ForbiddenError);
    expect(await idsOf()).not.toContain(u.aud);

    await service.decideSensitiveView(as(t, u.com, ["rolegroup.audit.validate"]), grant.id, true, null, "REQ-2");
    expect(await idsOf()).toEqual(expect.arrayContaining([u.aud, u.adm]));
    await service.revokeSensitiveView(admin, grant.id, "Mission terminée", "REQ-3");
    expect(await idsOf()).not.toContain(u.aud);

    const rows = await q<{ action: string; user_id: string }>("SELECT action, user_id FROM audit_log WHERE tenant_id=$1 AND entity_type='SensitiveViewGrant' AND entity_id=$2 ORDER BY timestamp, id", [t, grant.id]);
    expect(rows.map((r) => r.action)).toEqual(["SUBMIT", "APPROVE", "UNASSIGN"]);
    expect(rows.map((r) => r.user_id)).toEqual([u.adm, u.com, u.adm]);

    // C4 on PG: re-approve then the person leaves the group -> closed; the group's seat is revoked, the grant row stays APPROVED.
    const g2 = await service.requestSensitiveView(admin, u.rm1, "Nouvelle", "REQ-4");
    await service.decideSensitiveView(as(t, u.aud, ["rolegroup.audit.validate"]), g2.id, true, null, "REQ-5");
    expect(await idsOf()).toContain(u.aud);
    await q("UPDATE user_roles SET revoked_at = now() WHERE tenant_id=$1 AND user_id=$2 AND role_id=$3", [t, u.rm1, g.rm]);
    expect(await idsOf()).not.toContain(u.aud);
    expect((await q<{ status: string }>("SELECT status FROM sensitive_view_grants WHERE id=$1", [g2.id]))[0]!.status).toBe("APPROVED");
  });

  it("double request and simultaneous decisions: the live-unique index and the claim UPDATE give exactly one winner", async () => {
    const { t, u } = await seedTenant();
    const { service } = services();
    const admin = as(t, u.adm, ["role.assign"]);
    const burst = await Promise.allSettled([1, 2, 3].map((n) => service.requestSensitiveView(admin, u.rm1, `R${n}`, `REQ-${n}`)));
    expect(burst.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(burst.filter((r) => r.status === "rejected").every((r) => (r as PromiseRejectedResult).reason instanceof ConflictError)).toBe(true);
    const grant = (burst.find((r) => r.status === "fulfilled") as PromiseFulfilledResult<SensitiveViewGrant>).value;
    const conf = as(t, u.com, ["rolegroup.audit.validate"]);
    const aud = as(t, u.aud, ["rolegroup.audit.validate"]);
    const race = await Promise.allSettled([
      service.decideSensitiveView(conf, grant.id, true, null, "REQ-A"),
      service.decideSensitiveView(aud, grant.id, false, "Non", "REQ-B"),
      service.decideSensitiveView(conf, grant.id, true, null, "REQ-C"),
    ]);
    expect(race.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    const final = (await q<{ status: string }>("SELECT status FROM sensitive_view_grants WHERE id=$1", [grant.id]))[0]!.status;
    const auditActions = (await q<{ action: string }>("SELECT action FROM audit_log WHERE tenant_id=$1 AND entity_id=$2 AND action <> 'SUBMIT'", [t, grant.id])).map((r) => r.action);
    expect(auditActions).toEqual([final === "APPROVED" ? "APPROVE" : "REJECT"]); // one decision, one audit row (no orphan from a losing racer)
  });

  it("expiry on the real table: expired PENDING -> approve 409 (nothing changed, no audit row), reject accepted; expires_at fixed from the config at the request", async () => {
    const { t, u } = await seedTenant();
    const { service } = services();
    await q("INSERT INTO configs (tenant_id, policy_request_expiry_days) VALUES ($1, 2)", [t]);
    const admin = as(t, u.adm, ["role.assign"]);
    const grant = await service.requestSensitiveView(admin, u.rm1, "Contrôle", "R");
    const days = ((grant.expiresAt!.getTime() - grant.requestedAt.getTime()) / DAY);
    expect(days).toBeGreaterThan(1.99);
    expect(days).toBeLessThan(2.01);
    await q("UPDATE configs SET policy_request_expiry_days = 9 WHERE tenant_id=$1", [t]);
    expect((await q<{ expires_at: Date }>("SELECT expires_at FROM sensitive_view_grants WHERE id=$1", [grant.id]))[0]!.expires_at.getTime()).toBe(grant.expiresAt!.getTime());
    const c = await pool.connect();
    try {
      await c.query("SET session_replication_role = replica"); // only way to age a row: expires_at is immutable under the guard
      await c.query("UPDATE sensitive_view_grants SET expires_at = now() - interval '1 minute' WHERE id=$1", [grant.id]);
    } finally {
      c.release(true);
    }
    const conf = as(t, u.com, ["rolegroup.audit.validate"]);
    await expect(service.decideSensitiveView(conf, grant.id, true, null, "R")).rejects.toThrow(ConflictError);
    expect((await q<{ status: string }>("SELECT status FROM sensitive_view_grants WHERE id=$1", [grant.id]))[0]!.status).toBe("PENDING");
    expect(await q("SELECT 1 FROM audit_log WHERE tenant_id=$1 AND entity_id=$2 AND action='APPROVE'", [t, grant.id])).toHaveLength(0);
    expect((await service.decideSensitiveView(conf, grant.id, false, "Expirée", "R")).status).toBe("REJECTED");
    // an expired request leaves the account free for a new one
    expect((await service.requestSensitiveView(admin, u.rm1, "Nouvelle", "R2")).status).toBe("PENDING");
  });

  it("an audit failure rolls the grant back (same transaction): no row, no half state", async () => {
    const { t, u } = await seedTenant();
    const { grants } = services();
    await expect(grants.create({ tenantId: t, userId: u.rm1, reason: "r", requestedBy: u.adm, expiresAt: null }, () => { throw new Error("audit down"); })).rejects.toThrow("audit down");
    expect(await q("SELECT 1 FROM sensitive_view_grants WHERE tenant_id=$1", [t])).toHaveLength(0);
    const ok = await grants.create({ tenantId: t, userId: u.rm1, reason: "r", requestedBy: u.adm, expiresAt: null }, () => []);
    await expect(grants.decide(t, ok.id, { status: "APPROVED", by: u.com, reason: null }, () => { throw new Error("audit down"); })).rejects.toThrow("audit down");
    expect((await q<{ status: string }>("SELECT status FROM sensitive_view_grants WHERE id=$1", [ok.id]))[0]!.status).toBe("PENDING");
    await expect(grants.revoke(t, ok.id, { by: u.adm, reason: "x" }, () => { throw new Error("audit down"); })).rejects.toThrow("audit down");
    expect((await q<{ status: string }>("SELECT status FROM sensitive_view_grants WHERE id=$1", [ok.id]))[0]!.status).toBe("PENDING");
  });

  it("tenant crossing at the repository: another tenant's id is invisible (getById null), decide / revoke 409 with the row untouched", async () => {
    const A = await seedTenant();
    const B = await seedTenant();
    const { grants, service } = services();
    const g = await grants.create({ tenantId: A.t, userId: A.u.rm1, reason: "r", requestedBy: A.u.adm, expiresAt: null }, () => []);
    expect(await grants.getById(B.t, g.id)).toBeNull();
    await expect(grants.decide(B.t, g.id, { status: "APPROVED", by: B.u.com, reason: null }, () => [])).rejects.toThrow(ConflictError);
    await expect(grants.revoke(B.t, g.id, { by: B.u.adm, reason: "x" }, () => [])).rejects.toThrow(ConflictError);
    expect(await grants.isApproved(B.t, A.u.rm1)).toBe(false);
    await expect(service.decideSensitiveView(as(B.t, B.u.com, ["rolegroup.audit.validate"]), g.id, true, null, "R")).rejects.toThrow(NotFoundError);
    // a request that names a user of another tenant is refused before any write
    await expect(service.requestSensitiveView(as(B.t, B.u.adm, ["role.assign"]), A.u.rm1, "Intrusion", "R")).rejects.toThrow(NotFoundError);
    expect((await q<{ status: string }>("SELECT status FROM sensitive_view_grants WHERE id=$1", [g.id]))[0]!.status).toBe("PENDING");
    // the FK (tenant_id, user_id) forbids a cross-tenant row even from raw SQL
    await expect(q("INSERT INTO sensitive_view_grants (tenant_id, user_id, reason, requested_by) VALUES ($1,$2,'r',$3)", [B.t, A.u.rm1, B.u.adm])).rejects.toThrow(/foreign key|violates/i);
  });

  it("database guards: self request, author == decider, delete, content edit, forbidden transitions", async () => {
    const { t, u } = await seedTenant();
    const { grants } = services();
    await expect(q("INSERT INTO sensitive_view_grants (tenant_id, user_id, reason, requested_by) VALUES ($1,$2,'r',$2)", [t, u.rm1])).rejects.toMatchObject({ code: "23514" });
    await expect(q("INSERT INTO sensitive_view_grants (tenant_id, user_id, reason, requested_by) VALUES ($1,$2,'   ',$3)", [t, u.rm1, u.adm])).rejects.toMatchObject({ code: "23514" });
    const g = await grants.create({ tenantId: t, userId: u.rm1, reason: "r", requestedBy: u.adm, expiresAt: null }, () => []);
    await expect(grants.decide(t, g.id, { status: "APPROVED", by: u.adm, reason: null }, () => [])).rejects.toMatchObject({ code: "23514" });
    await expect(grants.decide(t, g.id, { status: "APPROVED", by: u.rm1, reason: null }, () => [])).rejects.toMatchObject({ code: "23514" });
    await expect(grants.decide(t, g.id, { status: "REJECTED", by: u.com, reason: null }, () => [])).rejects.toMatchObject({ code: "23514" }); // reject needs a reason
    await expect(q("DELETE FROM sensitive_view_grants WHERE id=$1", [g.id])).rejects.toMatchObject({ code: "42501" });
    await expect(q("UPDATE sensitive_view_grants SET reason='autre' WHERE id=$1", [g.id])).rejects.toMatchObject({ code: "42501" });
    await expect(q("UPDATE sensitive_view_grants SET user_id=$2 WHERE id=$1", [g.id, u.rm2])).rejects.toMatchObject({ code: "42501" });
    await grants.decide(t, g.id, { status: "APPROVED", by: u.com, reason: null }, () => []);
    await expect(q("UPDATE sensitive_view_grants SET status='PENDING' WHERE id=$1", [g.id])).rejects.toMatchObject({ code: "42501" });
    await expect(q("UPDATE sensitive_view_grants SET status='REJECTED', decision_reason='x' WHERE id=$1", [g.id])).rejects.toMatchObject({ code: "42501" });
    await expect(q("TRUNCATE sensitive_view_grants")).rejects.toMatchObject({ code: "42501" });
  });

  // QA-RL-01 (fixed): ids that are not uuids on the role routes reach PostgreSQL (22P02); the error handler answers 400 on
  // every route, never 500 (same family as QA-F7S3-01).
  const NON_UUID_ROUTES: Array<[string, string, unknown]> = [
    ["GET", "/not-a-uuid", undefined],
    ["PATCH", "/not-a-uuid", { description: "x" }],
    ["POST", "/not-a-uuid/disable", {}],
    ["POST", "/not-a-uuid/assign", { userId: "00000000-0000-4000-8000-000000000000", reason: "r" }],
    ["POST", "/not-a-uuid/revoke", { userId: "00000000-0000-4000-8000-000000000000", reason: "r" }],
  ];
  for (const [method, path, body] of NON_UUID_ROUTES) {
    it(`QA-RL-01 non-uuid role id on ${method} /roles${path} is a 4xx, never a 500`, async () => {
      const { t, u } = await seedTenant();
      const { service } = services();
      const r = await http(service, as(t, u.adm, ["role.read", "role.update", "role.assign", "role.create", "role.delete"]), method, path, body);
      expect(r.status, `${method} ${path}`).toBeLessThan(500);
    });
  }

  it("restricted reader on real data: hidden role / account ids answer 404 like an unknown uuid; non-uuid user id -> 400", async () => {
    const { t, u, g } = await seedTenant();
    const { service } = services();
    const rm = as(t, u.rm1, ["role.read"]);
    const unknownId = id1();
    const unknown = await http(service, rm, "GET", `/${unknownId}`);
    for (const hidden of [g.aud, (await q<{ id: string }>("SELECT id FROM roles WHERE tenant_id=$1 AND name='Administrateurs'", [t]))[0]!.id]) {
      const r = await http(service, rm, "GET", `/${hidden}`);
      expect(r.status).toBe(404);
      expect(without(r.text, hidden)).toBe(without(unknown.text, unknownId));
    }
    for (const hiddenUser of [u.aud, u.adm]) {
      expect((await http(service, rm, "GET", `/users/${hiddenUser}/permission-sources`)).status).toBe(404);
      expect((await http(service, rm, "GET", `/users/${hiddenUser}/permissions`)).status).toBe(404);
    }
    expect((await http(service, rm, "GET", "/users/not-a-uuid/permission-sources")).status).toBe(400);
    expect((await http(service, rm, "GET", `/users/${u.com}/permission-sources`)).status).toBe(200);
  });
});
