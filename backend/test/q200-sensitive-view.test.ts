import { describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { RoleService } from "../src/services/RoleService.js";
import type { RoleRepository } from "../src/domain/repositories/RoleRepository.js";
import type { UserRepository } from "../src/domain/repositories/UserRepository.js";
import type { SensitiveViewGrant, SensitiveViewGrantRepository } from "../src/domain/repositories/SensitiveViewGrantRepository.js";
import type { Role, RoleAssignment } from "../src/domain/entities/Role.js";
import type { User } from "../src/domain/entities/User.js";
import type { AuditEvent } from "../src/domain/entities/AuditEvent.js";
import type { AuthenticatedUser } from "../src/infrastructure/identity/IdentityProvider.js";
import { ConflictError, ForbiddenError, ValidationError } from "../src/domain/errors/DomainErrors.js";

/** q200 (DECISION-103): role.read.sensitive given to ONE Risk Manager member, confirmed by a Committee/Audit member. */
const T = "tenant-1";
const person = (id: string): User => ({ id, tenantId: T, email: `${id}@example.com`, displayName: id, roles: [], createdAt: new Date(), deletedAt: null });
const actor = (userId: string, roles: string[]): AuthenticatedUser => ({ userId, tenantId: T, email: `${userId}@example.com`, displayName: userId, roles });

function world() {
  const roles: Role[] = [];
  const assignments: RoleAssignment[] = [];
  const grants: SensitiveViewGrant[] = [];
  let revokeLiveCalls = 0;
  let listCalls = 0;
  const audit: Array<Omit<AuditEvent, "id" | "timestamp">> = [];
  const roleRepo = {
    async list(tenantId: string) { return roles.filter((r) => r.tenantId === tenantId); },
    async getById(_t: string, id: string) { return roles.find((r) => r.id === id) ?? null; },
    async listForUser(_t: string, userId: string) {
      return roles.filter((r) => assignments.some((a) => a.roleId === r.id && a.userId === userId && !a.revokedAt));
    },
    async listAssignments(_t: string, roleId: string) { return assignments.filter((a) => a.roleId === roleId); },
  } as unknown as RoleRepository;
  const users = ["rm", "rm2", "auditor", "boss", "staff"].map(person);
  const userRepo = {
    async getById(_t: string, id: string) { return users.find((u) => u.id === id) ?? null; },
    async list() { return users; },
  } as unknown as UserRepository;
  const transactional = <R>(out: R, events: (r: R) => Array<Omit<AuditEvent, "id" | "timestamp">>) => { audit.push(...events(out)); return out; };
  const grantRepo: SensitiveViewGrantRepository = {
    async list() { listCalls += 1; return [...grants]; },
    async getById(_t, id) { return grants.find((g) => g.id === id) ?? null; },
    async isApproved(_t, userId) { return grants.some((g) => g.userId === userId && g.status === "APPROVED"); },
    async create(input, events) {
      if (grants.some((g) => g.userId === input.userId && (g.status === "PENDING" || g.status === "APPROVED"))) throw new ConflictError("live");
      const g: SensitiveViewGrant = { id: randomUUID(), ...input, status: "PENDING", requestedAt: new Date(), decidedBy: null, decidedAt: null,
        decisionReason: null, revokedBy: null, revokedAt: null, revokeReason: null };
      grants.push(g);
      return transactional(g, events);
    },
    async decide(_t, id, change, events) {
      const g = grants.find((x) => x.id === id && x.status === "PENDING");
      if (!g) throw new ConflictError("decided");
      Object.assign(g, { status: change.status, decidedBy: change.by, decidedAt: new Date(), decisionReason: change.reason });
      return transactional({ ...g }, events);
    },
    async revoke(_t, id, change, events) {
      const g = grants.find((x) => x.id === id && (x.status === "PENDING" || x.status === "APPROVED"));
      if (!g) throw new ConflictError("final");
      const before = { ...g };
      Object.assign(g, { status: "REVOKED", revokedBy: change.by, revokedAt: new Date(), revokeReason: change.reason });
      return transactional({ before, after: { ...g } }, events).after;
    },
    async revokeLiveOf(_t, userId, change, events) {
      const g = grants.find((x) => x.userId === userId && (x.status === "PENDING" || x.status === "APPROVED"));
      if (!g) return null;
      revokeLiveCalls += 1;
      const before = { ...g };
      Object.assign(g, { status: "REVOKED", revokedBy: change.by, revokedAt: new Date(), revokeReason: change.reason });
      return transactional({ before, after: { ...g } }, events).after;
    },
  };
  const fixed = (name: string, systemGroup: Role["systemGroup"], permissions: string[], members: string[]) => {
    const r = { id: randomUUID(), tenantId: T, name, permissions, systemGroup } as Role;
    roles.push(r);
    for (const userId of members) assignments.push({ id: randomUUID(), tenantId: T, roleId: r.id, userId, grantedBy: "seed", grantedAt: new Date(), revokedAt: null });
  };
  fixed("Risk Manager", "RISK_MANAGER", ["role.read"], ["rm", "rm2"]);
  fixed("Audit", "AUDIT", ["audit.read", "rolegroup.audit.validate"], ["auditor"]);
  fixed("Administrateurs", null, ["role.assign"], ["boss"]);
  const service = new RoleService(roleRepo, { record: async () => {} } as never, userRepo, undefined, undefined, undefined, undefined, undefined, undefined, grantRepo);
  return { service, audit, counts: () => ({ revokeLiveCalls, listCalls }) };
}

const admin = actor("boss", ["role.read", "role.assign"]);
const validator = actor("auditor", ["rolegroup.audit.validate"]);
const rmReader = actor("rm", ["role.read"]);

describe("q200 (DECISION-103): individual widened view of the rights matrix", () => {
  it("requested by an administrator, confirmed by a Committee/Audit member: the Risk Manager then sees every line", async () => {
    const { service, audit } = world();
    expect((await service.accounts(rmReader)).map((a) => a.id).sort()).toEqual(["rm", "rm2", "staff"]);
    const grant = await service.requestSensitiveView(admin, "rm", "Contrôle des habilitations de l'Audit", "REQ-1");
    expect(grant.status).toBe("PENDING");
    expect((await service.accounts(rmReader))).toHaveLength(3); // pending: nothing changes
    await service.decideSensitiveView(validator, grant.id, true, null, "REQ-2");
    expect((await service.accounts(rmReader))).toHaveLength(5);
    const sources = await service.getEffectivePermissionSources(admin, "rm");
    expect(sources.permissions.find((p) => p.permission === "role.read.sensitive")?.sources).toEqual([{ kind: "GRANT" }]);
    expect(audit.map((e) => e.action)).toEqual(["SUBMIT", "APPROVE"]);
    expect(audit.every((e) => e.entityType === "SensitiveViewGrant" && e.entityId === grant.id)).toBe(true);
  });

  it("maker-checker and scope: never for oneself, never decided by its author or beneficiary, Risk Manager members only", async () => {
    const { service } = world();
    await expect(service.requestSensitiveView(admin, "boss", "Pour moi", "REQ-1")).rejects.toThrow(ForbiddenError);
    await expect(service.requestSensitiveView(admin, "staff", "Hors groupe", "REQ-2")).rejects.toThrow(ValidationError);
    await expect(service.requestSensitiveView(rmReader, "rm2", "Sans droit", "REQ-3")).rejects.toThrow(ForbiddenError);
    const grant = await service.requestSensitiveView(admin, "rm", "Contrôle", "REQ-4");
    await expect(service.requestSensitiveView(admin, "rm", "Doublon", "REQ-5")).rejects.toThrow(ConflictError);
    await expect(service.decideSensitiveView(actor("boss", ["rolegroup.audit.validate"]), grant.id, true, null, "REQ-6")).rejects.toThrow(ForbiddenError);
    await expect(service.decideSensitiveView(actor("rm", ["rolegroup.audit.validate"]), grant.id, true, null, "REQ-7")).rejects.toThrow(ForbiddenError);
    await expect(service.decideSensitiveView(validator, grant.id, false, null, "REQ-8")).rejects.toThrow(ValidationError);
    expect((await service.decideSensitiveView(validator, grant.id, false, "Pas justifié", "REQ-9")).status).toBe("REJECTED");
  });

  it("revocation is the administrator's terminal act, with a reason, and ends the widened view", async () => {
    const { service, audit } = world();
    const grant = await service.requestSensitiveView(admin, "rm", "Contrôle", "REQ-1");
    await service.decideSensitiveView(validator, grant.id, true, null, "REQ-2");
    await expect(service.revokeSensitiveView(validator, grant.id, "Pas mon rôle", "REQ-3")).rejects.toThrow(ForbiddenError);
    expect((await service.revokeSensitiveView(admin, grant.id, "Mission terminée", "REQ-4")).status).toBe("REVOKED");
    expect(await service.accounts(rmReader)).toHaveLength(3);
    expect(audit.at(-1)).toMatchObject({ action: "UNASSIGN", reason: "Mission terminée" });
  });
});

describe("q200 review fixes (QA-RL-04, SEC-RL-05, INFO)", () => {
  it("the beneficiary list is the active Risk Manager members, chosen by the server", async () => {
    const { service } = world();
    expect((await service.sensitiveViewCandidates(admin)).map((c) => c.id)).toEqual(["rm", "rm2"]);
    await expect(service.sensitiveViewCandidates(validator)).rejects.toThrow(ForbiddenError);
  });

  it("leaving the group or a suspension ends the widened view for good: coming back needs a new request", async () => {
    const { service, audit } = world();
    const grant = await service.requestSensitiveView(admin, "rm", "Contrôle", "REQ-1");
    await service.decideSensitiveView(validator, grant.id, true, null, "REQ-2");
    await service.endSensitiveView(admin, "rm", "Fin automatique : le compte a quitté le groupe Risk Manager", "REQ-3");
    expect(await service.accounts(rmReader)).toHaveLength(3);
    expect(audit.at(-1)).toMatchObject({ action: "UNASSIGN", entityId: grant.id });
    expect((await service.requestSensitiveView(admin, "rm", "Nouvelle demande", "REQ-4")).status).toBe("PENDING");
  });

  it("an expired pending request no longer blocks a new one; the self check ignores the case of the id", async () => {
    const { service } = world();
    const old = await service.requestSensitiveView(admin, "rm", "Contrôle", "REQ-1");
    const grants = await service.listSensitiveViewGrants(admin);
    Object.assign(grants.find((g) => g.id === old.id)!, { expiresAt: new Date(Date.now() - 1000) });
    expect((await service.requestSensitiveView(admin, "rm", "Relance", "REQ-2")).status).toBe("PENDING");
    expect((await service.listSensitiveViewGrants(admin)).find((g) => g.id === old.id)?.status).toBe("REVOKED");
    await expect(service.requestSensitiveView(actor("boss", ["role.assign"]), "BOSS", "Pour moi", "REQ-3")).rejects.toThrow(ForbiddenError);
  });
});

describe("Codex PR #207", () => {
  it("ending a widened view looks up the account's live grant directly (never the bounded list)", async () => {
    const { service, counts } = world();
    const grant = await service.requestSensitiveView(admin, "rm", "Contrôle", "REQ-1");
    await service.decideSensitiveView(validator, grant.id, true, null, "REQ-2");
    const before = counts().listCalls;
    await service.endSensitiveView(admin, "rm", "Fin", "REQ-3");
    expect(counts()).toEqual({ revokeLiveCalls: 1, listCalls: before });
    await service.endSensitiveView(admin, "rm", "Fin", "REQ-4"); // nothing live any more: a no-op
    expect(counts().revokeLiveCalls).toBe(1);
  });

  it("confirming needs a real Committee or Audit seat, not rolegroup.audit.validate alone (legacy grant), and never a Risk Manager", async () => {
    const { service } = world();
    const grant = await service.requestSensitiveView(admin, "rm", "Contrôle", "REQ-1");
    await expect(service.decideSensitiveView(actor("staff", ["rolegroup.audit.validate"]), grant.id, true, null, "REQ-2")).rejects.toThrow(ForbiddenError);
    await expect(service.decideSensitiveView(actor("rm2", ["rolegroup.audit.validate"]), grant.id, true, null, "REQ-3")).rejects.toThrow(ForbiddenError);
    expect((await service.decideSensitiveView(validator, grant.id, true, null, "REQ-4")).status).toBe("APPROVED");
  });

  it("the revocation audit carries the locked row (before) and the updated one (after)", async () => {
    const { service, audit } = world();
    const grant = await service.requestSensitiveView(admin, "rm", "Contrôle", "REQ-1");
    await service.decideSensitiveView(validator, grant.id, true, null, "REQ-2");
    await service.revokeSensitiveView(admin, grant.id, "Fin de mission", "REQ-3");
    const last = audit.at(-1)!;
    expect((last.oldValue as { status: string }).status).toBe("APPROVED");
    expect((last.newValue as { status: string }).status).toBe("REVOKED");
  });
});

describe("migration 079 (static)", () => {
  const sql = readFileSync(join(__dirname, "..", "..", "database", "postgresql", "migrations", "079_sensitive_view_grants.sql"), "utf8");
  it("pins the maker-checker in the database and the search_path on every function", () => {
    expect(sql).toMatch(/svg_not_for_self_check CHECK \(requested_by <> user_id\)/);
    expect(sql).toMatch(/decided_by <> requested_by AND decided_by <> user_id/);
    expect(sql.match(/CREATE OR REPLACE FUNCTION/g)).toHaveLength(2);
    expect(sql.match(/ALTER FUNCTION \w+\(\) SET search_path = pg_catalog, public, pg_temp;/g)).toHaveLength(2);
  });
});
