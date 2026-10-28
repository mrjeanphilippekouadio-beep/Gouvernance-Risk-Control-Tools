import { describe, expect, it } from "vitest";
import { RoleService } from "../src/services/RoleService.js";
import { GovernancePrincipleAcceptanceService } from "../src/services/GovernancePrincipleAcceptanceService.js";
import { GovernanceDesignationService } from "../src/services/GovernanceDesignationService.js";
import { FIXED_GROUP_PERMISSIONS, GOVERNANCE_DECISION_RIGHTS, governanceRightAllowedOn } from "../src/domain/fixedGroupPermissions.js";
import { ForbiddenError, ValidationError } from "../src/domain/errors/DomainErrors.js";
import type { Role, SystemGroup } from "../src/domain/entities/Role.js";
import type { Permission } from "../src/domain/permissions.js";
import type { AuditEvent } from "../src/domain/entities/AuditEvent.js";
import type { GovernancePrincipleAcceptance } from "../src/domain/entities/GovernanceReviews.js";
import type { GovernancePrincipleAcceptanceRepository } from "../src/domain/repositories/GovernanceReviewRepositories.js";
import type { AuthenticatedUser } from "../src/infrastructure/identity/IdentityProvider.js";

/** Lot « suites des arbitrages 2 » (DECISION-095): q179, q181, q178 (level 1). q182 is in D4 / QA-suites. */
const actor = (userId: string, roles: string[]): AuthenticatedUser =>
  ({ userId, tenantId: "t1", email: `${userId}@x.io`, displayName: userId, roles }) as unknown as AuthenticatedUser;
const DAY = 86_400_000;

// -- q179 ------------------------------------------------------------------------------------------------------------
function roleWorld() {
  const role = (id: string, systemGroup: SystemGroup | null, permissions: Permission[]): Role =>
    ({ id, tenantId: "t1", name: id, description: null, permissions: [...permissions], systemGroup, departmentId: null, dashboardScopeMode: "GLOBAL" }) as unknown as Role;
  const roles = [
    role("rm", "RISK_MANAGER", FIXED_GROUP_PERMISSIONS.RISK_MANAGER),
    role("com", "RISK_COMMITTEE", FIXED_GROUP_PERMISSIONS.RISK_COMMITTEE),
    role("aud", "AUDIT", FIXED_GROUP_PERMISSIONS.AUDIT),
    role("ordinary", null, ["risk.read"]),
  ];
  const held = new Map<string, string[]>([["member", ["com"]]]);
  const events: Array<Omit<AuditEvent, "id" | "timestamp">> = [];
  const repo = {
    getById: async (_t: string, id: string) => roles.find((r) => r.id === id) ?? null,
    getByName: async () => null,
    list: async () => roles,
    listForUser: async (_t: string, u: string) => roles.filter((r) => (held.get(u) ?? []).includes(r.id)),
    listAssignments: async () => [],
    create: async (input: { name: string; permissions: Permission[] }) => role(input.name, null, input.permissions),
    update: async (_t: string, id: string, input: { permissions?: Permission[] }) => {
      const r = roles.find((x) => x.id === id)!;
      if (input.permissions) r.permissions = input.permissions;
      return r;
    },
  };
  const service = new RoleService(repo as never, { record: async (e: Omit<AuditEvent, "id" | "timestamp">) => { events.push(e); } } as never);
  return { service, roles, events, group: (id: string) => roles.find((r) => r.id === id)! };
}
const admin = actor("adm", ["role.read", "role.create", "role.update", "rolegroup.audit.update"]);

describe("q179 governance decision rights on fixed groups only", () => {
  it("an ordinary role can carry none of the four rights (create and update); the Audit only the review", async () => {
    const w = roleWorld();
    for (const p of GOVERNANCE_DECISION_RIGHTS) {
      await expect(w.service.create(admin, { name: `r-${p}`, permissions: ["risk.read", p] } as never, "q")).rejects.toThrow(/fixed groups only/);
      await expect(w.service.update(admin, "ordinary", { permissions: ["risk.read", p] }, "q")).rejects.toThrow(/fixed groups only/);
      expect(governanceRightAllowedOn(p, "AUDIT")).toBe(p === "governanceexception.review");
      expect(governanceRightAllowedOn(p, "RISK_COMMITTEE")).toBe(true);
    }
    await expect(w.service.create(admin, { name: "plain", permissions: ["risk.read"] } as never, "q")).resolves.toBeDefined();
    // The shipped fixed-group lists already respect the rule.
    for (const [g, perms] of Object.entries(FIXED_GROUP_PERMISSIONS)) {
      for (const p of perms) expect(governanceRightAllowedOn(p, g as SystemGroup), `${g} ${p}`).toBe(true);
    }
  });

  it("lists, then moves a right between groups: reason, audited through the usual path, contradictions refused", async () => {
    const w = roleWorld();
    const before = await w.service.governanceRights(admin);
    expect(before.find((r) => r.permission === "orgprofile.approve")!.groups.sort()).toEqual(["RISK_COMMITTEE", "RISK_MANAGER"]);
    await expect(w.service.governanceRights(actor("x", []))).rejects.toThrow(ForbiddenError);

    await expect(w.service.setGovernanceRightGroups(actor("x", ["role.read"]), "orgprofile.approve", ["RISK_COMMITTEE"], "r", "q")).rejects.toThrow(ForbiddenError);
    await expect(w.service.setGovernanceRightGroups(admin, "orgprofile.approve", ["RISK_COMMITTEE"], " ", "q")).rejects.toThrow(ValidationError);
    await expect(w.service.setGovernanceRightGroups(admin, "risk.read", ["RISK_COMMITTEE"], "r", "q")).rejects.toThrow(/Not a governance decision right/);
    await expect(w.service.setGovernanceRightGroups(admin, "governanceprinciple.acceptance.confirm", ["AUDIT"], "r", "q")).rejects.toThrow(/q157/);
    await expect(w.service.setGovernanceRightGroups(admin, "orgprofile.approve", [], "r", "q")).rejects.toThrow(/At least one/);
    // A group the administrator belongs to is not theirs to change.
    await expect(w.service.setGovernanceRightGroups(actor("member", admin.roles), "orgprofile.approve", ["RISK_MANAGER"], "r", "q")).rejects.toThrow(ForbiddenError);
    expect(w.events).toHaveLength(0);

    const r = await w.service.setGovernanceRightGroups(admin, "orgprofile.approve", ["RISK_COMMITTEE"], "Le Comité seul confirme", "q");
    expect(r).toMatchObject({ permission: "orgprofile.approve", groups: ["RISK_COMMITTEE"], auditChangePending: false });
    expect(w.group("rm").permissions).not.toContain("orgprofile.approve");
    expect(w.events).toMatchObject([{ entityType: "Role", entityId: "rm", action: "PERMISSION_CHANGE", reason: "Le Comité seul confirme" }]);

    // The review may move to / from the Audit, through the Audit circuit.
    await w.service.setGovernanceRightGroups(admin, "governanceexception.review", ["RISK_COMMITTEE", "RISK_MANAGER"], "Audit hors revue", "q");
    expect(w.group("aud").permissions).not.toContain("governanceexception.review");
  });
});

// -- q181 ------------------------------------------------------------------------------------------------------------
function acceptanceWorld(opts: { previous: { reviewed: boolean; open?: boolean } | null; reviewerExists: boolean }) {
  const audits: Array<Record<string, unknown>> = [];
  const repo: GovernancePrincipleAcceptanceRepository = {
    list: async () => [],
    getById: async () => null,
    latestAloneReview: async () => (opts.previous ? { acceptanceId: "prev", reviewed: opts.previous.reviewed, open: opts.previous.open ?? false } : null),
    create: async (input, audit) => {
      const a = { ...input, id: "new", acceptedAt: new Date(), confirmedBy: null, confirmedAt: null, endedBy: null, endedAt: null, endReason: null } as GovernancePrincipleAcceptance;
      const out = { acceptance: a, expiredClosed: null };
      audits.push(...audit(out));
      return out;
    },
    confirm: async () => { throw new Error("unused"); },
    end: async () => { throw new Error("unused"); },
  };
  const eligible = { existsOther: async (_t: string, _a: string, p: string) => (p === "governanceexception.review" ? opts.reviewerExists : false) };
  return { service: new GovernancePrincipleAcceptanceService(repo, { record: async () => undefined } as never, eligible), audits };
}
const accept = (w: ReturnType<typeof acceptanceWorld>) =>
  w.service.accept(actor("rm", ["governanceprinciple.accept"]), { principleId: "GOV-SOD-01", reason: "Renouvellement", expiresAt: new Date(Date.now() + DAY) }, "q");

describe("q181 renewing alone an acceptance made alone", () => {
  it("the previous one reviewed (or none, or still open: not a renewal, the repository answers its conflict): ordinary alone marker", async () => {
    for (const previous of [null, { reviewed: true }, { reviewed: false, open: true }]) {
      const w = acceptanceWorld({ previous, reviewerExists: true });
      await accept(w);
      expect(w.audits.at(-1)).toMatchObject({ action: "CREATE", governanceException: "principle.acceptance.alone" });
    }
  });
  it("not reviewed while someone else could review: explicit refusal, nothing written", async () => {
    const w = acceptanceWorld({ previous: { reviewed: false }, reviewerExists: true });
    await expect(accept(w)).rejects.toThrow(/faites d'abord revoir l'acceptation précédente/);
    expect(w.audits).toHaveLength(0);
  });
  it("not reviewed and nobody else can review: accepted, marked « renouvelé sans revue »", async () => {
    const w = acceptanceWorld({ previous: { reviewed: false }, reviewerExists: false });
    await accept(w);
    expect(w.audits.at(-1)).toMatchObject({ action: "CREATE", governanceException: "principle.acceptance.renewedWithoutReview" });
  });
});

// -- q178 ------------------------------------------------------------------------------------------------------------
describe("q178 Risk Manager vacancy exposed with the designations", () => {
  const build = (since: Date | null, maxDays?: number | null) =>
    new GovernanceDesignationService(
      {} as never, {} as never, {} as never, {} as never,
      { riskManagerVacancySince: async () => since },
      maxDays === undefined ? undefined : { getByTenant: async () => ({ riskManagerVacancyMaxDays: maxDays }) as never },
    );
  const designator = actor("adm", ["designation.manage"]);
  it("none without a vacancy; needs designation.manage", async () => {
    await expect(build(null).riskManagerVacancy(designator)).resolves.toBeNull();
    await expect(build(new Date()).riskManagerVacancy(actor("x", []))).rejects.toThrow(ForbiddenError);
  });
  it("since / overdue against the tenant setting, 60 days by default (PO), never overdue when cleared", async () => {
    const since = new Date(Date.now() - 70 * DAY);
    await expect(build(since).riskManagerVacancy(designator)).resolves.toEqual({ since, maxDays: 60, overdue: true });
    await expect(build(since, 90).riskManagerVacancy(designator)).resolves.toMatchObject({ maxDays: 90, overdue: false });
    await expect(build(since, null).riskManagerVacancy(designator)).resolves.toMatchObject({ maxDays: null, overdue: false });
  });
});
