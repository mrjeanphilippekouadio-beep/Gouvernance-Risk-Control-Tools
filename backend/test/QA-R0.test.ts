import { afterEach, describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { RiskService } from "../src/services/RiskService.js";
import { EvidenceService } from "../src/services/EvidenceService.js";
import { GoogleDriveStorage } from "../src/infrastructure/storage/GoogleDriveStorage.js";
import { ForbiddenError, NotFoundError, ValidationError } from "../src/domain/errors/DomainErrors.js";
import type { RiskRepository } from "../src/domain/repositories/RiskRepository.js";
import type { AuditRepository } from "../src/domain/repositories/AuditRepository.js";
import type { UserRepository } from "../src/domain/repositories/UserRepository.js";
import type { EvidenceRepository } from "../src/domain/repositories/EvidenceRepository.js";
import type { Risk } from "../src/domain/entities/Risk.js";
import type { User } from "../src/domain/entities/User.js";
import type { Evidence } from "../src/domain/entities/Evidence.js";
import type { AuthenticatedUser } from "../src/infrastructure/identity/IdentityProvider.js";

// ---------------------------------------------------------------- fakes

function riskRepo(): RiskRepository & { store: Map<string, Risk>; writes: number } {
  const store = new Map<string, Risk>();
  const repo = {
    store,
    writes: 0,
    async getById(t: string, id: string) {
      const r = store.get(id);
      return r && r.tenantId === t && !r.deletedAt ? r : null;
    },
    async assignOwner(t: string, id: string, ownerId: string | null) {
      repo.writes++;
      const r = store.get(id)!;
      const u = { ...r, ownerId };
      store.set(id, u);
      return u;
    },
    async assignSuperiorOwner(t: string, id: string, superiorOwnerId: string | null) {
      repo.writes++;
      const r = store.get(id)!;
      const u = { ...r, superiorOwnerId };
      store.set(id, u);
      return u;
    },
  };
  return repo as never;
}

function seedRisk(repo: ReturnType<typeof riskRepo>, tenantId: string, over: Partial<Risk> = {}): Risk {
  const risk = {
    id: randomUUID(), tenantId, process: "P", processId: null, description: "D", ownerDepartmentId: null,
    ownerId: null, superiorOwnerId: null, status: "DRAFT", createdAt: new Date(), updatedAt: new Date(),
    deletedAt: null, deletedBy: null, deletionReason: null, ...over,
  } as Risk;
  repo.store.set(risk.id, risk);
  return risk;
}

function audit(): AuditRepository & { events: Array<Record<string, unknown>> } {
  const events: Array<Record<string, unknown>> = [];
  return { events, async record(e: never) { events.push(e); }, async listForEntity() { return []; } } as never;
}

function user(tenantId: string, id = randomUUID()): User {
  return { id, tenantId, email: `${id}@x.com`, displayName: "U", roles: [], deletedAt: null } as unknown as User;
}

/** Mimics Postgres `uuid` comparison: case-insensitive, ignores braces/hyphens. */
function pgLikeUserRepo(users: User[]): UserRepository {
  const norm = (s: string) => s.toLowerCase().replace(/[{}-]/g, "");
  return { async getById(t: string, id: string) { return users.find((u) => u.tenantId === t && norm(u.id) === norm(id)) ?? null; } } as never;
}

const base = { tenantId: "t1", email: "a@x.com", displayName: "A" };
const manager: AuthenticatedUser = { ...base, userId: randomUUID(), roles: ["risk.read", "risk.update", "risk.owner.assign"] };
const updateOnly: AuthenticatedUser = { ...base, userId: randomUUID(), roles: ["risk.read", "risk.update", "risk.delete"] };

// ---------------------------------------------------------------- B-0

describe("QA-R0 B-0 risk.owner.assign", () => {
  it("QA-R0: risk.update (+risk.delete) alone cannot assign an owner, no write, no audit", async () => {
    const repo = riskRepo(); const a = audit();
    const risk = seedRisk(repo, "t1");
    const svc = new RiskService(repo, a, undefined, pgLikeUserRepo([user("t1")]));
    await expect(svc.assignOwner(updateOnly, risk.id, randomUUID(), "r")).rejects.toThrow(ForbiddenError);
    await expect(svc.assignSuperiorOwner(updateOnly, risk.id, randomUUID(), "r")).rejects.toThrow(ForbiddenError);
    expect(repo.writes).toBe(0);
    expect(a.events).toHaveLength(0);
  });

  it("QA-R0: generic update path (zod body + Postgres buildUpdateSet whitelist) cannot write owner_id / superior_owner_id", () => {
    const repoSrc = readFileSync(resolve(__dirname, "../src/infrastructure/database/postgres/PostgresRiskRepository.ts"), "utf8");
    const upd = repoSrc.slice(repoSrc.indexOf("async update("), repoSrc.indexOf("async assignOwner("));
    expect(upd).not.toMatch(/owner_id|superior_owner_id/);
    const routes = readFileSync(resolve(__dirname, "../src/api/v1/risks.routes.ts"), "utf8");
    const body = routes.slice(routes.indexOf("const UpdateRiskBody"), routes.indexOf("const ArchiveRiskBody"));
    expect(body).not.toMatch(/ownerId|superiorOwnerId/);
  });

  it("QA-R0: self-designation as owner and as superior owner is refused, nothing written", async () => {
    const repo = riskRepo(); const a = audit();
    const risk = seedRisk(repo, "t1");
    const me = user("t1", manager.userId);
    const svc = new RiskService(repo, a, undefined, pgLikeUserRepo([me]));
    await expect(svc.assignOwner(manager, risk.id, manager.userId, "r")).rejects.toThrow(ValidationError);
    await expect(svc.assignSuperiorOwner(manager, risk.id, manager.userId, "r")).rejects.toThrow(ValidationError);
    expect(repo.writes).toBe(0);
  });

  // BUG (non bloquant a moyen): RiskService.ts:170 compares ownerId === actor.userId as raw strings, but
  // Postgres `uuid` matches case-insensitively and accepts braces / no hyphens, and AssignOwnerBody is
  // z.string() (risks.routes.ts:27). Upper-case own UUID bypasses the self-assignment ban (also :229).
  it("QA-R0: self-designation with an upper-cased or braced UUID is refused (SEC-B0-1)", async () => {
    const repo = riskRepo();
    const risk = seedRisk(repo, "t1");
    const svc = new RiskService(repo, audit(), undefined, pgLikeUserRepo([user("t1", manager.userId)]));
    await expect(svc.assignOwner(manager, risk.id, manager.userId.toUpperCase(), "r")).rejects.toThrow(ValidationError);
    await expect(svc.assignOwner(manager, risk.id, `{${manager.userId}}`, "r")).rejects.toThrow(ValidationError);
    await expect(svc.assignSuperiorOwner(manager, risk.id, manager.userId.toUpperCase(), "r")).rejects.toThrow(ValidationError);
  });

  it("QA-R0: clearing the owner (null) is allowed for a holder, even if they are the current owner, and is audited", async () => {
    const repo = riskRepo(); const a = audit();
    const risk = seedRisk(repo, "t1", { ownerId: manager.userId });
    const svc = new RiskService(repo, a, undefined, pgLikeUserRepo([]));
    const out = await svc.assignOwner(manager, risk.id, null, "r");
    expect(out.ownerId).toBeNull();
    expect(a.events).toHaveLength(1);
    expect(a.events[0]).toMatchObject({ action: "ASSIGN", userId: manager.userId, tenantId: "t1" });
  });

  it("QA-R0: owner from another tenant is rejected; risk from another tenant is not found", async () => {
    const repo = riskRepo();
    const risk = seedRisk(repo, "t1");
    const foreign = user("t2");
    const svc = new RiskService(repo, audit(), undefined, pgLikeUserRepo([foreign]));
    await expect(svc.assignOwner(manager, risk.id, foreign.id, "r")).rejects.toThrow(ValidationError);
    const otherTenantRisk = seedRisk(repo, "t2");
    await expect(svc.assignOwner(manager, otherTenantRisk.id, null, "r")).rejects.toThrow(NotFoundError);
    expect(repo.writes).toBe(0);
  });

  it("QA-R0: owner and superior owner can never be the same person (both directions)", async () => {
    const repo = riskRepo();
    const u = user("t1");
    const risk = seedRisk(repo, "t1", { ownerId: u.id });
    const svc = new RiskService(repo, audit(), undefined, pgLikeUserRepo([u]));
    await expect(svc.assignSuperiorOwner(manager, risk.id, u.id, "r")).rejects.toThrow(ValidationError);
    const risk2 = seedRisk(repo, "t1", { superiorOwnerId: u.id });
    await expect(svc.assignOwner(manager, risk2.id, u.id, "r")).rejects.toThrow(ValidationError);
  });

  it("QA-R0: only RiskService.assignOwner/assignSuperiorOwner call the repository owner writers (no other caller bypasses the gate)", () => {
    const srcRoot = resolve(__dirname, "../src");
    const files = ["services", "api/v1"].flatMap((d) =>
      readdirRec(resolve(srcRoot, d)),
    );
    const offenders = files.filter((f) => /\.(assignOwner|assignSuperiorOwner)\(/.test(readFileSync(f, "utf8")) && !/RiskService\.ts$|risks\.routes\.ts$/.test(f));
    expect(offenders).toEqual([]);
  });

  it("QA-R0: migration 047 is idempotent, symmetric and text[] consistent", () => {
    const dir = resolve(__dirname, "../../database/postgresql/migrations");
    const up = readFileSync(resolve(dir, "047_risk_owner_assign_permission.sql"), "utf8");
    const down = readFileSync(resolve(dir, "047_risk_owner_assign_permission.down.sql"), "utf8");
    expect(up).toMatch(/NOT \('risk\.owner\.assign' = ANY \(permissions\)\)/);
    expect(up).toMatch(/NOT \('risk\.owner\.assign' = ANY \(roles\)\)/);
    expect(up).toMatch(/contributeur%/);
    expect(down).toMatch(/array_remove\(permissions, 'risk\.owner\.assign'\)/);
    expect(down).toMatch(/array_remove\(roles, 'risk\.owner\.assign'\)/);
    expect(down).toMatch(/DELETE FROM schema_migrations WHERE filename = '047_risk_owner_assign_permission\.sql'/);
    // roles.permissions and users.roles are text[] NOT NULL (013 / 002) -> array_append never hits NULL
    expect(readFileSync(resolve(dir, "013_roles.sql"), "utf8")).toMatch(/permissions\s+text\[\] NOT NULL DEFAULT '\{\}'/);
    expect(readFileSync(resolve(dir, "002_tenants_and_users.sql"), "utf8")).toMatch(/roles\s+text\[\] NOT NULL/);
  });
});

import { readdirSync, statSync } from "node:fs";
function readdirRec(d: string): string[] {
  return readdirSync(d).flatMap((n) => {
    const p = resolve(d, n);
    return statSync(p).isDirectory() ? readdirRec(p) : [p];
  });
}

// ---------------------------------------------------------------- R0.4 Drive

type Call = { op: string; params: Record<string, unknown> };
class Fake extends GoogleDriveStorage {
  calls: Call[] = [];
  parents: string[] | undefined = ["active"];
  failGet = false;
  failUpdate = false;
  protected override async drive() {
    return {
      files: {
        get: async (p: Record<string, unknown>) => {
          this.calls.push({ op: "get", params: p });
          if (this.failGet) throw new Error("get 500");
          return { data: { parents: this.parents } };
        },
        update: async (p: Record<string, unknown>) => {
          this.calls.push({ op: "update", params: p });
          if (this.failUpdate) throw new Error("update 403");
          return { data: {} };
        },
        create: async (p: Record<string, unknown>) => {
          this.calls.push({ op: "create", params: p });
          return { data: { id: "f1", webViewLink: "u" } };
        },
      },
    } as never;
  }
}
const mk = (o: Partial<ConstructorParameters<typeof GoogleDriveStorage>[0]> = {}) =>
  new Fake({ tenantFolderResolver: async () => "tenant-folder", deletedFolderId: "del", ...o });

describe("QA-R0 R0.4 GoogleDriveStorage", () => {
  it("QA-R0: multi-parent file is detached from every parent and attached to the deleted folder", async () => {
    const s = mk(); s.parents = ["a", "b", "c"];
    await s.delete("f");
    expect(s.calls[1]!.params).toMatchObject({ addParents: "del", removeParents: "a,b,c" });
  });

  it("QA-R0: get failure -> no update issued, error propagates", async () => {
    const s = mk(); s.failGet = true;
    await expect(s.delete("f")).rejects.toThrow("get 500");
    expect(s.calls.map((c) => c.op)).toEqual(["get"]);
  });

  it("QA-R0: update failure after get propagates (no trashed / permanent delete fallback)", async () => {
    const s = mk(); s.failUpdate = true;
    await expect(s.delete("f")).rejects.toThrow("update 403");
    expect(s.calls.map((c) => c.op)).toEqual(["get", "update"]);
    expect(JSON.stringify(s.calls)).not.toMatch(/trashed/);
  });

  it("QA-R0: delete never sends trashed and always supportsAllDrives", async () => {
    const s = mk(); await s.delete("f");
    for (const c of s.calls) expect(c.params["supportsAllDrives"]).toBe(true);
    expect(JSON.stringify(s.calls)).not.toMatch(/trashed/);
  });

  // Observation (non bloquant): re-running delete on an already-moved file sends addParents === removeParents.
  // Drive behaviour for that is unspecified; GoogleDriveStorage.ts delete() should skip the update when the file
  // is already only in deletedFolderId. Test documents the current request so a change is noticed.
  it("QA-R0: idempotence - second delete of an already-moved file is a no-op", async () => {
    const s = mk(); s.parents = ["del"];
    await s.delete("f");
    expect(s.calls).toHaveLength(1);
  });

  it("QA-R0: a file outside the active folder is never moved (SEC-R04-1)", async () => {
    const s = mk({ activeFolderId: "act" }); s.parents = ["other-drive-folder"];
    await expect(s.delete("f")).rejects.toThrow(/not in the active evidence folder/);
    expect(s.calls).toHaveLength(1);
  });

  it("QA-R0: with an active folder, only that folder is removed", async () => {
    const s = mk({ activeFolderId: "act" }); s.parents = ["act", "extra"];
    await s.delete("f");
    expect(s.calls[1]!.params).toMatchObject({ addParents: "del", removeParents: "act" });
  });

  it("QA-R0: file without parents yields an empty removeParents string (documented)", async () => {
    const s = mk(); s.parents = undefined;
    await s.delete("f");
    expect(s.calls[1]!.params["removeParents"]).toBe("");
  });

  it("QA-R0: upload prefers activeFolderId over the tenant resolver and sets supportsAllDrives", async () => {
    const s = mk({ activeFolderId: "act" });
    await s.upload({ tenantId: "t", fileName: "a.pdf", mimeType: "application/pdf", content: Buffer.from("x") });
    const c = s.calls[0]!;
    expect((c.params["requestBody"] as { parents: string[] }).parents).toEqual(["act"]);
    expect(c.params["supportsAllDrives"]).toBe(true);
  });
});

// EvidenceService x storage misconfiguration
describe("QA-R0 R0.4 EvidenceService.delete with misconfigured storage", () => {
  const actor: AuthenticatedUser = { ...base, userId: "u1", roles: ["evidence.delete", "evidence.read"] };
  function setup() {
    const ev: Evidence = {
      id: "e1", tenantId: "t1", controlExecutionId: null, fileName: "f", driveFileId: "drive-1", driveUrl: "u",
      documentType: "X", uploadedBy: "u", uploadedAt: new Date(), version: 1, status: "ACTIVE",
    } as Evidence;
    const repo = {
      ev,
      async getById(t: string, id: string) { return t === ev.tenantId && id === ev.id ? repo.ev : null; },
      async markDeleted() { repo.ev = { ...repo.ev, status: "DELETED" }; },
      async restoreActive() { repo.ev = { ...repo.ev, status: "ACTIVE" }; },
    };
    const a = audit();
    const storage = new Fake({ tenantFolderResolver: async () => "t" }); // no deletedFolderId
    return { repo, a, storage, svc: new EvidenceService(repo as unknown as EvidenceRepository, storage, a) };
  }

  // FINDING (important): DRIVE_DELETED_FOLDER_ID is optional in env.ts, so a misconfigured prod boots fine and
  // evidence.delete soft-deletes + audits the row, THEN fails on Drive: the file stays in the active folder and the
  // API returns 500 for an action whose DB effect is committed. Fail-fast in env.ts is the fix.
  it("QA-R0: missing DRIVE_DELETED_FOLDER_ID -> row IS soft-deleted and audited, Drive file untouched, error says reconciliation", async () => {
    const { repo, a, storage, svc } = setup();
    await expect(svc.delete(actor, "e1", "r")).rejects.toThrow(/reconciliation is required.*DRIVE_DELETED_FOLDER_ID/s);
    expect(repo.ev.status).toBe("DELETED");
    expect(a.events.map((e) => e["action"])).toEqual(["DELETE"]);
    expect(storage.calls).toEqual([]);
  });

  it("QA-R0: tenant isolation - another tenant cannot trigger a Drive move", async () => {
    const { storage, svc } = setup();
    await expect(svc.delete({ ...actor, tenantId: "t2" }, "e1", "r")).rejects.toThrow(NotFoundError);
    expect(storage.calls).toEqual([]);
  });
});

// ---------------------------------------------------------------- env.ts matrix

describe("QA-R0 env.ts Drive configuration at startup", () => {
  afterEach(() => { vi.unstubAllEnvs(); vi.restoreAllMocks(); vi.resetModules(); });

  async function boot(vars: Record<string, string | undefined>): Promise<number | "ok"> {
    vi.resetModules();
    const all: Record<string, string | undefined> = {
      NODE_ENV: "production", APP_ENV: "production", DATABASE_URL: "postgres://x", GOOGLE_OAUTH_CLIENT_ID: "cid",
      AUTH_PROVIDER: "google", GOOGLE_DRIVE_AUTH_MODE: undefined, GOOGLE_DRIVE_CREDENTIALS_PATH: undefined,
      DRIVE_DELETED_FOLDER_ID: "del", DRIVE_ACTIVE_FOLDER_ID: "act", MIGRATION_DATABASE_URL: undefined, ...vars,
    };
    for (const [k, v] of Object.entries(all)) {
      if (v === undefined) vi.stubEnv(k, undefined as never); else vi.stubEnv(k, v);
      if (v === undefined) delete process.env[k];
    }
    const exit = vi.spyOn(process, "exit").mockImplementation(((c?: number) => { throw new Error(`exit:${c}`); }) as never);
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    try { await import("../src/config/env.js"); return "ok"; } catch (e) {
      const m = /exit:(\d+)/.exec((e as Error).message); if (m) return Number(m[1]); throw e;
    } finally { exit.mockRestore(); }
  }

  it("QA-R0: prod adc, no key path -> boots", async () => { expect(await boot({ GOOGLE_DRIVE_AUTH_MODE: "adc" })).toBe("ok"); });
  it("QA-R0: prod default mode (unset) -> adc, boots", async () => { expect(await boot({})).toBe("ok"); });
  it("QA-R0: prod adc + key path -> exit 1", async () => { expect(await boot({ GOOGLE_DRIVE_AUTH_MODE: "adc", GOOGLE_DRIVE_CREDENTIALS_PATH: "/k.json" })).toBe(1); });
  it("QA-R0: prod unset mode + key path -> exit 1 (default is adc, ambiguous)", async () => { expect(await boot({ GOOGLE_DRIVE_CREDENTIALS_PATH: "/k.json" })).toBe(1); });
  it("QA-R0: prod key_file + path -> boots", async () => { expect(await boot({ GOOGLE_DRIVE_AUTH_MODE: "key_file", GOOGLE_DRIVE_CREDENTIALS_PATH: "/k.json" })).toBe("ok"); });
  it("QA-R0: prod key_file without path -> exit 1", async () => { expect(await boot({ GOOGLE_DRIVE_AUTH_MODE: "key_file" })).toBe(1); });
  it("QA-R0: invalid mode -> exit 1", async () => { expect(await boot({ GOOGLE_DRIVE_AUTH_MODE: "oauth" })).toBe(1); });
  it("QA-R0: empty-string folder id -> exit 1 (min(1))", async () => { expect(await boot({ DRIVE_DELETED_FOLDER_ID: "" })).toBe(1); });
  it("QA-R0: prod without DRIVE_DELETED_FOLDER_ID -> exit 1 (SEC-R04-2)", async () => { expect(await boot({ DRIVE_DELETED_FOLDER_ID: undefined })).toBe(1); });
  it("QA-R0: prod without DRIVE_ACTIVE_FOLDER_ID -> exit 1 (SEC-R04-2)", async () => { expect(await boot({ DRIVE_ACTIVE_FOLDER_ID: undefined })).toBe(1); });
});
