import { describe, expect, it } from "vitest";
import { RoleService } from "../src/services/RoleService.js";
import { ConfigService } from "../src/services/ConfigService.js";
import { CartographyService } from "../src/services/CartographyService.js";
import { ForbiddenError, ValidationError } from "../src/domain/errors/DomainErrors.js";
import type { Permission } from "../src/domain/permissions.js";
import type { Role, SystemGroup } from "../src/domain/entities/Role.js";
import type { Config, ConfigPatch } from "../src/domain/entities/Config.js";
import type { AuthenticatedUser } from "../src/infrastructure/identity/IdentityProvider.js";

// Level 1 tests for B-8 quater (DECISION-042 q58/q63/q65, DECISION-041 bands). QA level 2 is A08's.

function role(id: string, systemGroup: SystemGroup | null, permissions: Permission[] = ["risk.read"]): Role {
  return {
    id, tenantId: "t1", name: id, description: null, permissions, dashboardScopeMode: "GLOBAL",
    systemGroup, departmentId: null, createdAt: new Date(), updatedAt: new Date(), deletedAt: null,
  };
}
const actor = (userId: string, perms: Permission[]): AuthenticatedUser => ({ userId, tenantId: "t1", email: "a@x", roles: perms }) as AuthenticatedUser;
const assigner = actor("admin", ["role.assign", "role.read"]);

function setupRoles(cumulAllowed: boolean | null) {
  const roles = [
    role("rm", "RISK_MANAGER"), role("co", "RISK_COMMITTEE"), role("au", "AUDIT", ["audit.read"]),
    role("adm", null, ["role.assign", "user.update"]), role("plain", null),
  ];
  const held = new Map<string, string[]>();
  const sent: Array<{ recipientUserId: string; eventType: string }> = [];
  const asked: string[] = [];
  const repo = {
    async getById(_t: string, id: string) { return roles.find((r) => r.id === id) ?? null; },
    async listForUser(_t: string, u: string) { return roles.filter((r) => (held.get(u) ?? []).includes(r.id)); },
    async assignToUser(_t: string, roleId: string, userId: string) {
      held.set(userId, [...(held.get(userId) ?? []), roleId]);
      return { id: "a", tenantId: "t1", roleId, userId, grantedBy: "x", grantedAt: new Date(), revokedAt: null };
    },
  };
  const users = {
    async listWithPermission(_t: string, permission: string) {
      asked.push(permission);
      return [{ id: "m1", displayName: "M1" }, { id: "target", displayName: "T" }];
    },
  };
  const notifications = { async record(i: { recipientUserId: string; eventType: string }) { sent.push(i); } };
  const audit = { async record() {} };
  const configs = cumulAllowed === null ? undefined : { async getByTenant() { return { committeeAuditCumulAllowed: cumulAllowed } as Config; } };
  const service = new RoleService(repo as never, audit as never, users as never, undefined, undefined, notifications as never, configs as never);
  return { service, held, sent, asked };
}

describe("q58 Committee + Audit cumul setting", () => {
  it("is allowed by default (no setting wired, or setting true)", async () => {
    for (const flag of [null, true]) {
      const { service } = setupRoles(flag);
      await service.assignToUser(assigner, "co", "u1", "r", "motif");
      await expect(service.assignToUser(assigner, "au", "u1", "r", "motif")).resolves.toBeUndefined();
    }
  });

  it("is refused in both directions when the tenant forbids it", async () => {
    const { service } = setupRoles(false);
    await service.assignToUser(assigner, "co", "u1", "r", "motif");
    await expect(service.assignToUser(assigner, "au", "u1", "r", "motif")).rejects.toThrow(ValidationError);
    await service.assignToUser(assigner, "au", "u2", "r", "motif");
    await expect(service.assignToUser(assigner, "co", "u2", "r", "motif")).rejects.toThrow(ValidationError);
  });

  it("never lifts Risk Manager + Audit, and Risk Manager + Committee stays allowed", async () => {
    const { service } = setupRoles(true);
    await service.assignToUser(assigner, "rm", "u1", "r", "motif");
    await expect(service.assignToUser(assigner, "au", "u1", "r", "motif")).rejects.toThrow(ValidationError);
    const forbidding = setupRoles(false);
    await forbidding.service.assignToUser(assigner, "rm", "u3", "r", "motif");
    await expect(forbidding.service.assignToUser(assigner, "co", "u3", "r", "motif")).resolves.toBeUndefined();
  });

  it("ConfigService.setCommitteeAuditCumul: dedicated permission, reason, audit", async () => {
    const stored: Config[] = [];
    const recorded: Array<{ reason: string | null }> = [];
    const repo = {
      async getByTenant() { return stored[0] ?? null; },
      async upsert(_t: string, patch: ConfigPatch) { stored[0] = { id: "c1", committeeAuditCumulAllowed: true, ...stored[0], ...patch } as Config; return stored[0]; },
    };
    const svc = new ConfigService(repo as never, { async record(e: { reason: string | null }) { recorded.push(e); } } as never);
    await expect(svc.setCommitteeAuditCumul(actor("u", ["config.update"]), false, "x", "r")).rejects.toThrow(ForbiddenError);
    const adminCfg = actor("u", ["config.read", "config.cumul.set"]);
    await expect(svc.setCommitteeAuditCumul(adminCfg, false, "  ", "r")).rejects.toThrow(ValidationError);
    expect((await svc.get(adminCfg)).committeeAuditCumulAllowed).toBe(true);
    const after = await svc.setCommitteeAuditCumul(adminCfg, false, "politique interne", "r");
    expect(after.committeeAuditCumulAllowed).toBe(false);
    expect(recorded).toHaveLength(1);
    expect(recorded[0]!.reason).toBe("politique interne");
  });
});

describe("q63 administrator + Risk Manager cumul", () => {
  it("requires a reason and notifies Audit/Committee members (not the person concerned)", async () => {
    const { service, sent, asked } = setupRoles(null);
    await service.assignToUser(assigner, "adm", "target", "r", undefined); // admin alone: no reason needed
    await expect(service.assignToUser(assigner, "rm", "target", "r", undefined)).rejects.toThrow(ValidationError);
    await service.assignToUser(assigner, "rm", "target", "r", "besoin de continuité");
    expect(asked).toContain("rolegroup.audit.validate");
    expect(sent.map((s) => s.recipientUserId)).toEqual(["m1"]);
    expect(sent[0]!.eventType).toBe("ADMIN_RISK_MANAGER_CUMUL");
    expect(await service.isAdminAndRiskManager("t1", "target")).toBe(true);
  });

  it("works in the other order (Risk Manager first, then an admin role) and ignores non-admin roles", async () => {
    const { service, sent } = setupRoles(null);
    await service.assignToUser(assigner, "rm", "target", "r", "motif");
    await service.assignToUser(assigner, "plain", "target", "r", undefined);
    expect(sent).toHaveLength(0);
    await expect(service.assignToUser(assigner, "adm", "target", "r", undefined)).rejects.toThrow(ValidationError);
    await service.assignToUser(assigner, "adm", "target", "r", "motif");
    expect(sent).toHaveLength(1);
  });
});

describe("q65 Committee entry notifies Audit", () => {
  it("notifies Audit members when a user enters the Committee, not for other groups", async () => {
    const { service, sent, asked } = setupRoles(null);
    await service.assignToUser(assigner, "co", "target", "r", "motif");
    expect(asked).toEqual(["audit.read"]);
    expect(sent.map((s) => [s.recipientUserId, s.eventType])).toEqual([["m1", "COMMITTEE_MEMBER_ADDED"]]);
    await service.assignToUser(assigner, "rm", "u2", "r", "motif");
    expect(sent).toHaveLength(1);
  });

  it("a failing notification does not undo the assignment", async () => {
    const { service, held } = setupRoles(null);
    (service as unknown as { notifications: unknown }).notifications = { async record() { throw new Error("down"); } };
    await service.assignToUser(assigner, "co", "target", "r", "motif");
    expect(held.get("target")).toEqual(["co"]);
  });
});

describe("DECISION-041 active scale with effective bands", () => {
  const scale = (over: Record<string, unknown>) => ({
    id: "s1", tenantId: "t1", name: "Echelle", version: "v1", status: "ACTIVE", probabilityLevels: 4, impactLevels: 4,
    criticalityThresholds: null, ...over,
  });
  const svc = (scales: unknown[]) => new CartographyService({} as never, {} as never, { async list() { return scales; } } as never);
  const reader = actor("u", ["cartography.read"]);

  it("serves the default bands of the scale ceiling when none are configured", async () => {
    const res = await svc([scale({})]).getActiveScale(reader);
    expect(res).toMatchObject({ scaleId: "s1", size: 4, maxScore: 16, bandsSource: "DEFAULT" });
    expect(res!.bands).toEqual([
      { label: "Faible", min: 1, max: 2 }, { label: "Modéré", min: 3, max: 5 },
      { label: "Élevé", min: 6, max: 9 }, { label: "Critique", min: 10, max: 16 },
    ]);
  });

  it("serves the configured bands when present", async () => {
    const bands = [{ label: "Bas", min: 1, max: 8 }, { label: "Haut", min: 9, max: 16 }];
    const res = await svc([scale({ criticalityThresholds: bands })]).getActiveScale(reader);
    expect(res).toMatchObject({ bandsSource: "CONFIGURED", bands });
  });

  it("returns null without an active scale, and refuses without cartography.read", async () => {
    expect(await svc([scale({ status: "DRAFT" })]).getActiveScale(reader)).toBeNull();
    await expect(svc([scale({})]).getActiveScale(actor("u", []))).rejects.toThrow(ForbiddenError);
  });
});
