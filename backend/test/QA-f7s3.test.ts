import { describe, expect, it } from "vitest";
import express from "express";
import { errorHandler } from "../src/api/middleware/errorHandler.js";
import { rolesRouter } from "../src/api/v1/roles.routes.js";
import { RoleService } from "../src/services/RoleService.js";
import { ALL_PERMISSIONS, BASE_PERMISSIONS, filterKnownPermissions, requirePermission } from "../src/domain/permissions.js";
import type { Permission } from "../src/domain/permissions.js";
import type { Role } from "../src/domain/entities/Role.js";
import type { User } from "../src/domain/entities/User.js";
import type { AuthenticatedUser } from "../src/infrastructure/identity/IdentityProvider.js";

/**
 * QA-f7s3 (level 2): GET /roles/users/:userId/permission-sources (role.read). Oracles fixed before running:
 *  - 403 without role.read (no body leak), 404 for an unknown account AND for an account of another tenant (same answer, no leak);
 *  - sources: every account has BASE; users.roles (known permissions only) = DIRECT; each held ACTIVE role = ROLE with its name/group;
 *  - a disabled (deleted) role or a revoked assignment contributes nothing; a permission held by several origins lists them all;
 *  - the listed permissions are exactly what the identity resolver (server.ts:467-503) grants, which is what requirePermission accepts.
 */
const T = "00000000-0000-4000-8000-000000000001";
const T2 = "00000000-0000-4000-8000-000000000002";
const id = (n: number) => `10000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const ME = id(90);

const reader = (roles: Permission[] = ["role.read"]): AuthenticatedUser =>
  ({ userId: ME, tenantId: T, email: "a@x.io", displayName: "Me", roles }) as unknown as AuthenticatedUser;
const user = (n: number, roles: string[], over: Partial<User> = {}): User =>
  ({ id: id(n), tenantId: T, email: `u${n}@x.io`, displayName: `U${n}`, roles, departmentId: null, createdAt: new Date(), deletedAt: null, ...over }) as User;
const role = (n: number, name: string, permissions: Permission[], over: Partial<Role> = {}): Role =>
  ({ id: id(100 + n), tenantId: T, name, description: null, permissions, dashboardScopeMode: "GLOBAL", systemGroup: null, departmentId: null,
    createdAt: new Date(), updatedAt: new Date(), deletedAt: null, ...over }) as Role;

interface Grant { tenantId: string; userId: string; roleId: string; revokedAt: Date | null }

function world(users: User[], roles: Role[], grants: Grant[]) {
  // Mirrors PostgresUserRepository.getById (no deleted_at filter) and ROLES_OF_USER_SQL (active grant, non-deleted role).
  const userRepo: any = { getById: async (t: string, i: string) => users.find((u) => u.tenantId === t && u.id === i) ?? null };
  const roleRepo: any = {
    list: async (t: string) => roles.filter((r) => r.tenantId === t && !r.deletedAt),
    listForUser: async (t: string, u: string) =>
      grants.filter((g) => g.tenantId === t && g.userId === u && !g.revokedAt)
        .map((g) => roles.find((r) => r.id === g.roleId && r.tenantId === t && !r.deletedAt)).filter((r): r is Role => !!r),
  };
  const service = new RoleService(roleRepo, { record: async () => {} } as any, userRepo);
  /** Same union as server.ts lookupMembership: BASE + known users.roles + permissions of active grants on live roles. */
  const resolver = async (t: string, u: string) => {
    const row = users.find((x) => x.tenantId === t && x.id === u)!;
    const held = await roleRepo.listForUser(t, u);
    return new Set<string>([...BASE_PERMISSIONS, ...filterKnownPermissions(row.roles), ...held.flatMap((r: Role) => r.permissions)]);
  };
  return { service, resolver };
}

async function http(service: RoleService, actor: AuthenticatedUser, path: string) {
  const app = express();
  app.use((req, _res, next) => { (req as any).user = actor; (req as any).requestId = "req"; next(); });
  app.use("/roles", rolesRouter(service));
  app.use(errorHandler);
  const server = app.listen(0);
  try {
    const addr = server.address();
    const res = await fetch(`http://127.0.0.1:${typeof addr === "object" && addr ? addr.port : 0}${path}`);
    return { status: res.status, text: await res.text() };
  } finally { server.close(); }
}
const body = (r: { text: string }) => JSON.parse(r.text);
const sourcesPath = (u: string) => `/roles/users/${u}/permission-sources`;

describe("QA-f7s3 permission-sources: access", () => {
  const w = world([user(1, ["risk.read"]), user(2, ["risk.read"], { tenantId: T2 })], [], []);

  it("403 without role.read (even with other role.* rights), no data in the body", async () => {
    for (const roles of [[], ["role.update", "user.read", "role.assign"]] as Permission[][]) {
      const r = await http(w.service, reader(roles), sourcesPath(id(1)));
      expect(r.status).toBe(403);
      expect(r.text).not.toContain("risk.read");
    }
  });

  it("200 with role.read", async () => {
    expect((await http(w.service, reader(), sourcesPath(id(1)))).status).toBe(200);
  });

  it("an account of another tenant answers 404, identical to an unknown id, with no field of that account", async () => {
    const cross = await http(w.service, reader(), sourcesPath(id(2)));
    const unknown = await http(w.service, reader(), sourcesPath(id(77)));
    expect(cross.status).toBe(404);
    expect(unknown.status).toBe(404);
    expect(cross.text.replace(id(2), "X")).toBe(unknown.text.replace(id(77), "X"));
    expect(cross.text).not.toContain("risk.read");
    expect(cross.text).not.toContain("u2@x.io");
  });

  it("a tenant id smuggled in the query string changes nothing (the actor's tenant wins)", async () => {
    expect((await http(w.service, reader(), `${sourcesPath(id(2))}?tenantId=${T2}`)).status).toBe(404);
  });

  it("a role of another tenant granted to a local account contributes nothing", async () => {
    const foreign = role(9, "Etranger", ["audit.read"], { tenantId: T2 });
    const ww = world([user(1, [])], [foreign], [{ tenantId: T, userId: id(1), roleId: foreign.id, revokedAt: null }]);
    const out = body(await http(ww.service, reader(), sourcesPath(id(1)))).data.map((s: any) => s.permission);
    expect(out).not.toContain("audit.read");
  });
});

describe("QA-f7s3 permission-sources: origins", () => {
  const analyst = role(1, "Analyste", ["risk.read", "control.read"]);
  const committee = role(2, "Comité", ["governanceprinciple.acceptance.confirm"], { systemGroup: "RISK_COMMITTEE" });
  const disabled = role(3, "Désactivé", ["audit.read"], { deletedAt: new Date() });
  const revoked = role(4, "Révoqué", ["kri.read"]);
  const grants: Grant[] = [
    { tenantId: T, userId: id(1), roleId: analyst.id, revokedAt: null },
    { tenantId: T, userId: id(1), roleId: committee.id, revokedAt: null },
    { tenantId: T, userId: id(1), roleId: disabled.id, revokedAt: null },
    { tenantId: T, userId: id(1), roleId: revoked.id, revokedAt: new Date() },
  ];
  const w = world([user(1, ["risk.read", "not.a.permission", "user.read"]), user(2, [])], [analyst, committee, disabled, revoked], grants);
  const get = async (u: string) => body(await http(w.service, reader(), sourcesPath(u))).data as Array<{ permission: string; sources: any[] }>;
  const of = (d: Array<{ permission: string; sources: any[] }>, p: string) => d.find((x) => x.permission === p)?.sources;

  it("BASE for every account, even one with nothing else", async () => {
    const d = await get(id(2));
    expect(d.map((x) => x.permission).sort()).toEqual([...BASE_PERMISSIONS].sort());
    for (const x of d) expect(x.sources).toEqual([{ kind: "BASE" }]);
  });

  it("DIRECT for users.roles, unknown strings dropped, never invented as a permission", async () => {
    const d = await get(id(1));
    expect(of(d, "user.read")).toEqual([{ kind: "DIRECT" }]);
    expect(d.some((x) => x.permission === "not.a.permission")).toBe(false);
  });

  it("ROLE origin for an ordinary role (name, null group) and for a fixed group (group set)", async () => {
    const d = await get(id(1));
    expect(of(d, "control.read")).toEqual([{ kind: "ROLE", roleId: analyst.id, roleName: "Analyste", systemGroup: null }]);
    expect(of(d, "governanceprinciple.acceptance.confirm")).toEqual([{ kind: "ROLE", roleId: committee.id, roleName: "Comité", systemGroup: "RISK_COMMITTEE" }]);
  });

  it("a permission with two origins lists both (direct + role)", async () => {
    const d = await get(id(1));
    expect(of(d, "risk.read")?.map((s) => s.kind)).toEqual(["DIRECT", "ROLE"]);
  });

  it("a disabled role and a revoked assignment contribute nothing", async () => {
    const d = await get(id(1));
    expect(of(d, "audit.read")).toBeUndefined();
    expect(of(d, "kri.read")).toBeUndefined();
  });

  it("no permission is listed twice and every listed permission exists in the catalogue", async () => {
    const d = await get(id(1));
    expect(new Set(d.map((x) => x.permission)).size).toBe(d.length);
    for (const x of d) expect((ALL_PERMISSIONS as readonly string[]).includes(x.permission)).toBe(true);
  });

  it("response is only { permission, sources } entries (no email, no tenant, no assignment metadata)", async () => {
    const raw = (await http(w.service, reader(), sourcesPath(id(1)))).text;
    for (const leak of ["u1@x.io", T, "grantedBy", "tenantId", "description"]) expect(raw).not.toContain(leak);
  });
});

describe("QA-f7s3 permission-sources: account states", () => {
  it("F7S3-01: a suspended account (users.deleted_at set) holds nothing — 200, empty list, suspended: true (the identity resolver rejects it)", async () => {
    const w = world([user(1, ["risk.read"], { deletedAt: new Date() })], [], []);
    const r = await http(w.service, reader(), sourcesPath(id(1)));
    expect(r.status).toBe(200);
    expect(body(r)).toEqual({ data: [], suspended: true });
    expect(body(await http(w.service, reader(), `/roles/users/${id(1)}/permissions`)).data).toEqual([]);
  });

  it("QA-F7S3-01: a malformed userId is a 400 on the three /roles/users/:userId routes, never a 500", async () => {
    const w = world([user(1, [])], [], []);
    for (const path of ["/roles/users/not-a-uuid", "/roles/users/not-a-uuid/permissions", sourcesPath("not-a-uuid")]) {
      expect((await http(w.service, reader(), path)).status, path).toBe(400);
    }
  });

  it("an account without any role row nor direct right still has exactly the base rights", async () => {
    const w = world([user(1, [])], [], []);
    expect(body(await http(w.service, reader(), sourcesPath(id(1)))).data.map((s: any) => s.permission).sort()).toEqual([...BASE_PERMISSIONS].sort());
  });
});

describe("QA-f7s3 permission-sources: consistency with what requirePermission accepts", () => {
  const rm = role(1, "Risk Manager", ["riskframework.read", "risk.read"], { systemGroup: "RISK_MANAGER" });
  const ordinary = role(2, "Ordinaire", ["control.read", "risk.read"]);
  const dead = role(3, "Mort", ["audit.read", "role.read"], { deletedAt: new Date() });
  const users = [user(1, ["user.read", "bogus"]), user(2, [])];
  const grants: Grant[] = [
    { tenantId: T, userId: id(1), roleId: rm.id, revokedAt: null },
    { tenantId: T, userId: id(1), roleId: ordinary.id, revokedAt: null },
    { tenantId: T, userId: id(1), roleId: dead.id, revokedAt: null },
    { tenantId: T, userId: id(2), roleId: ordinary.id, revokedAt: new Date() },
  ];
  const w = world(users, [rm, ordinary, dead], grants);

  for (const n of [1, 2]) {
    it(`account ${n}: the listed set equals the resolver set, and requirePermission accepts exactly the listed rights`, async () => {
      const listed = new Set(body(await http(w.service, reader(), sourcesPath(id(n)))).data.map((s: any) => s.permission as string));
      const granted = await w.resolver(T, id(n));
      expect([...listed].sort()).toEqual([...granted].sort());
      const actor = { ...reader([...granted] as Permission[]) };
      for (const p of ALL_PERMISSIONS) {
        const accepted = (() => { try { requirePermission(actor, p); return true; } catch { return false; } })();
        expect(accepted, p).toBe(listed.has(p));
      }
    });
  }

  it("agrees with GET /roles/users/:id/permissions (same set)", async () => {
    const a = body(await http(w.service, reader(), sourcesPath(id(1)))).data.map((s: any) => s.permission).sort();
    const b = (body(await http(w.service, reader(), `/roles/users/${id(1)}/permissions`)).data as string[]).slice().sort();
    expect(a).toEqual(b);
  });

  it("route order: 'permission-sources' is not swallowed by /:id and /matrix still works", async () => {
    expect((await http(w.service, reader(), "/roles/matrix")).status).toBe(200);
    expect((await http(w.service, reader(), `/roles/users/${id(1)}/permission-sources/extra`)).status).toBe(404);
  });
});
