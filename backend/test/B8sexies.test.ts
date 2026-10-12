import { describe, expect, it } from "vitest";
import { RoleService } from "../src/services/RoleService.js";
import { PostgresRoleRepository } from "../src/infrastructure/database/postgres/PostgresRoleRepository.js";
import { PostgresRolePermissionChangeRepository } from "../src/infrastructure/database/postgres/PostgresRolePermissionChangeRepository.js";
import { ConflictError, NotFoundError } from "../src/domain/errors/DomainErrors.js";
import type { Permission } from "../src/domain/permissions.js";
import type { Role, RolePermissionChange, SystemGroup } from "../src/domain/entities/Role.js";
import type { AuthenticatedUser } from "../src/infrastructure/identity/IdentityProvider.js";

// Level 1 tests for B-8 sexies (q65-02, F-B8q-01, F-B8q-03). QA level 2 is A08's.

// ---------------------------------------------------------------- repositories (fake pg)
function fakePool(handler: (sql: string) => { rowCount: number; rows: unknown[] } | Error) {
  const calls: string[] = [];
  const client = {
    async query(sql: string) {
      calls.push(sql.trim().split(/\s+/).slice(0, 3).join(" "));
      const r = handler(sql);
      if (r instanceof Error) throw r;
      return r;
    },
    release() { calls.push("release"); },
  };
  return { pool: { connect: async () => client } as never, calls };
}
const pgError = (code: string, constraint: string) => Object.assign(new Error("pg"), { code, constraint });

describe("q65-02 / F-B8q-01 PostgresRoleRepository.assignToUser", () => {
  it("locks the role row before inserting, then commits", async () => {
    const row = { id: "a", tenant_id: "t", role_id: "r", user_id: "u", granted_by: "g", granted_at: new Date(), revoked_at: null };
    const { pool, calls } = fakePool((sql) => sql.includes("FOR UPDATE") ? { rowCount: 1, rows: [{ id: "r" }] } : sql.includes("INSERT") ? { rowCount: 1, rows: [row] } : { rowCount: 0, rows: [] });
    const a = await new PostgresRoleRepository(pool).assignToUser("t", "r", "u", "g");
    expect(a.roleId).toBe("r");
    expect(calls).toEqual(["BEGIN", "SELECT id FROM", "SELECT * FROM", "INSERT INTO user_roles", "COMMIT", "release"]);
  });
  it("23505 on user_roles_active_idx becomes a ConflictError and rolls back", async () => {
    const { pool, calls } = fakePool((sql) => sql.includes("FOR UPDATE") ? { rowCount: 1, rows: [{}] } : sql.includes("INSERT") ? pgError("23505", "user_roles_active_idx") : { rowCount: 0, rows: [] });
    await expect(new PostgresRoleRepository(pool).assignToUser("t", "r", "u", "g")).rejects.toBeInstanceOf(ConflictError);
    expect(calls).toContain("ROLLBACK");
    expect(calls.at(-1)).toBe("release");
  });
  it("another error (or another constraint) is not translated", async () => {
    const { pool } = fakePool((sql) => sql.includes("FOR UPDATE") ? { rowCount: 1, rows: [{}] } : sql.includes("INSERT") ? pgError("23505", "other_idx") : { rowCount: 0, rows: [] });
    await expect(new PostgresRoleRepository(pool).assignToUser("t", "r", "u", "g")).rejects.not.toBeInstanceOf(ConflictError);
  });
  it("a missing or disabled role: NotFoundError, no insert", async () => {
    const { pool, calls } = fakePool(() => ({ rowCount: 0, rows: [] }));
    await expect(new PostgresRoleRepository(pool).assignToUser("t", "r", "u", "g")).rejects.toBeInstanceOf(NotFoundError);
    expect(calls).not.toContain("INSERT INTO user_roles");
  });
});

describe("F-B8q-03(b) PostgresRolePermissionChangeRepository.reopen", () => {
  it("is guarded against another PENDING of the same role and reports whether it reopened", async () => {
    let sqlSeen = "";
    const pool = { query: async (sql: string) => { sqlSeen = sql; return { rowCount: 0, rows: [] }; } } as never;
    expect(await new PostgresRolePermissionChangeRepository(pool).reopen("t", "c")).toBe(false);
    expect(sqlSeen).toMatch(/NOT EXISTS[\s\S]*status = 'PENDING'[\s\S]*o\.id <> c\.id/);
    const ok = { query: async () => ({ rowCount: 1, rows: [] }) } as never;
    expect(await new PostgresRolePermissionChangeRepository(ok).reopen("t", "c")).toBe(true);
  });
});

// ---------------------------------------------------------------- service
function role(id: string, systemGroup: SystemGroup | null, permissions: Permission[] = ["risk.read"]): Role {
  return {
    id, tenantId: "t1", name: id, description: null, permissions, dashboardScopeMode: "GLOBAL",
    systemGroup, departmentId: null, createdAt: new Date(), updatedAt: new Date(), deletedAt: null,
  };
}
const validator = { userId: "val", tenantId: "t1", email: "v@x", roles: ["rolegroup.audit.validate", "role.read"] } as AuthenticatedUser;

function setup(opts: { updateThenFail?: boolean; updateFails?: boolean; reopenResult?: boolean } = {}) {
  const roles = [role("au", "AUDIT", ["audit.read"])];
  const changes: RolePermissionChange[] = [{
    id: "c1", tenantId: "t1", roleId: "au", permissions: ["audit.read", "risk.read"], requestedBy: "maker",
    status: "PENDING", decidedBy: null, createdAt: new Date(), decidedAt: null,
  } as RolePermissionChange];
  const events: Array<{ action: string; entityType: string }> = [];
  let reopened = 0;
  const repo = {
    async getById() { return roles[0]!; },
    async listForUser(_t: string, u: string) { return u === "val" ? roles : []; },
    async update(_t: string, _id: string, input: { permissions?: Permission[] }) {
      if (opts.updateFails) throw new Error("db down");
      roles[0]!.permissions = input.permissions!;
      if (opts.updateThenFail) throw new Error("connection lost after commit");
      return roles[0]!;
    },
  };
  const changeRepo = {
    async getById() { return changes[0]!; },
    async decide(_t: string, _id: string, status: "APPROVED" | "REJECTED") { changes[0]!.status = status; return true; },
    async reopen() {
      reopened++;
      if (opts.reopenResult === false) return false;
      changes[0]!.status = "PENDING";
      return true;
    },
  };
  const audit = { async record(e: { action: string; entityType: string }) { events.push(e); } };
  const service = new RoleService(repo as never, audit as never, {} as never, undefined, changeRepo as never);
  return { service, changes, roles, events, reopened: () => reopened };
}

describe("F-B8q-03(a) lost response after the rights were committed", () => {
  it("rights already equal the change: stays APPROVED, no reopen, audit rows written, no error", async () => {
    const w = setup({ updateThenFail: true });
    await expect(w.service.decideAuditPermissionChange(validator, "c1", true, "r")).resolves.toBeUndefined();
    expect(w.changes[0]!.status).toBe("APPROVED");
    expect(w.reopened()).toBe(0);
    expect(w.events.map((e) => e.action)).toEqual(["PERMISSION_CHANGE", "APPROVE"]);
  });
  it("rights not applied: still reopened, original error kept", async () => {
    const w = setup({ updateFails: true });
    await expect(w.service.decideAuditPermissionChange(validator, "c1", true, "r")).rejects.toThrow("db down");
    expect(w.reopened()).toBe(1);
    expect(w.changes[0]!.status).toBe("PENDING");
  });
});

describe("F-B8q-03(b) a newer PENDING exists", () => {
  it("reopen refused: the original error is still returned, nothing thrown by reopen", async () => {
    const w = setup({ updateFails: true, reopenResult: false });
    await expect(w.service.decideAuditPermissionChange(validator, "c1", true, "r")).rejects.toThrow("db down");
    expect(w.reopened()).toBe(1);
    expect(w.changes[0]!.status).toBe("APPROVED");
  });
});
