import { beforeEach, describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  classifyOrganization,
  computeProfileGaps,
  type ObservedOrganization,
} from "../src/domain/governance/classifyOrganization.js";
import {
  ORGANIZATION_QUESTIONS,
  parseOrganizationAnswers,
  QUESTIONNAIRE_VERSION,
  type OrganizationAnswers,
} from "../src/domain/governance/organizationQuestionnaire.js";
import { ADMIN_PERMISSIONS, FIXED_GROUP_PERMISSIONS, isAdministrator, isAuditGroupPermission } from "../src/domain/fixedGroupPermissions.js";
import { ALL_PERMISSIONS } from "../src/domain/permissions.js";
import type { OrganizationProfile } from "../src/domain/entities/OrganizationProfile.js";
import type { AuditEvent } from "../src/domain/entities/AuditEvent.js";
import type { Role } from "../src/domain/entities/Role.js";
import type {
  InsertOrganizationProfileInput,
  OrganizationProfileChange,
  OrganizationProfileRepository,
} from "../src/domain/repositories/OrganizationProfileRepository.js";
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from "../src/domain/errors/DomainErrors.js";
import { OrganizationProfileService, ADMIN_ALONE_EXCEPTION } from "../src/services/OrganizationProfileService.js";
import type { AuthenticatedUser } from "../src/infrastructure/identity/IdentityProvider.js";

/** Lot D3 (DECISION-074 R-2, DECISION-075/076): questionnaire, classification, versioned profile. */
const here = dirname(fileURLToPath(import.meta.url));

const ans = (over: Partial<OrganizationAnswers> = {}): OrganizationAnswers => ({
  Q1: 40, Q2: 1, Q5: "NO", Q7: "NO", Q8: "NO", Q11: "NO", ...over,
});
const obs = (over: Partial<ObservedOrganization> = {}): ObservedOrganization => ({
  activeAccounts: 3, riskManagers: 1, committeeMembers: 0, auditMembers: 0, ...over,
});
/** S = 3 on declared answers alone: C1 (Q2 >= 2), C3 (Q7), C4 (Q8 formal). */
const S3 = { Q2: 2, Q7: "YES", Q8: "FORMAL" } as const;

describe("classifyOrganization: thresholds (q154: 250 / 100 with 3 of 4 / 20)", () => {
  it("250 or more people: large company whatever the structure", () => {
    expect(classifyOrganization(ans({ Q1: 250 }), obs()).value).toBe("GRANDE_ENTREPRISE");
    expect(classifyOrganization(ans({ Q1: 249 }), obs()).value).toBe("PME");
  });

  it("100 people need S >= 3 of 4 to be a large company", () => {
    expect(classifyOrganization(ans({ Q1: 100, ...S3 }), obs()).value).toBe("GRANDE_ENTREPRISE");
    expect(classifyOrganization(ans({ Q1: 100, Q2: 2, Q7: "YES" }), obs()).value).toBe("PME"); // S = 2
    expect(classifyOrganization(ans({ Q1: 99, ...S3, Q5: "YES" }), obs()).value).toBe("PME"); // S = 4 but under 100
  });

  it("20 people, S <= 1 and not supervised: TPE; 21 people or S = 2 or a supervised activity: PME", () => {
    expect(classifyOrganization(ans({ Q1: 20, Q2: 1 }), obs()).value).toBe("TPE");
    expect(classifyOrganization(ans({ Q1: 20, Q7: "YES" }), obs()).value).toBe("TPE"); // S = 1
    expect(classifyOrganization(ans({ Q1: 21 }), obs({ activeAccounts: 1 })).value).toBe("PME");
    expect(classifyOrganization(ans({ Q1: 20, Q7: "YES", Q8: "FORMAL" }), obs()).value).toBe("PME"); // S = 2
  });

  it("supervision: Q11 = oui is never a TPE, and 'je ne sais pas' blocks TPE until lifted", () => {
    const yes = classifyOrganization(ans({ Q1: 10, Q11: "YES" }), obs());
    expect(yes.value).toBe("PME");
    expect(yes.supervised).toBe("YES");
    expect(yes.toConfirm).toBe(true); // PI-2: small structure under supervision
    const unknown = classifyOrganization(ans({ Q1: 10, Q11: "UNKNOWN" }), obs());
    expect(unknown.value).toBe("PME");
    expect(unknown.toConfirm).toBe(true); // PI-3
    expect(unknown.alternatives).toContain("TPE");
    expect(classifyOrganization(ans({ Q1: 10, Q11: "NO" }), obs()).value).toBe("TPE");
  });

  it("E = max(Q1, active accounts): the most demanding applies (q147)", () => {
    const c = classifyOrganization(ans({ Q1: 12 }), obs({ activeAccounts: 31 }));
    expect(c.effectiveHeadcount).toBe(31);
    expect(c.declaredHeadcount).toBe(12);
    expect(c.observedAccounts).toBe(31);
    expect(c.value).toBe("PME");
    expect(c.toConfirm).toBe(true); // PI-2: Q1 below the accounts
    expect(classifyOrganization(ans({ Q1: 5 }), obs({ activeAccounts: 300 })).value).toBe("GRANDE_ENTREPRISE");
  });

  it("a criterion is met when declared OR observed", () => {
    const base = ans({ Q1: 30, Q2: 0 });
    expect(classifyOrganization(base, obs({ riskManagers: 2 })).criteria.find((c) => c.id === "C1")).toMatchObject({ met: true, declared: false, observed: true });
    expect(classifyOrganization(base, obs({ auditMembers: 1 })).criteria.find((c) => c.id === "C2")?.met).toBe(true);
    expect(classifyOrganization(base, obs({ committeeMembers: 2 })).criteria.find((c) => c.id === "C4")?.met).toBe(true);
    expect(classifyOrganization(base, obs({ committeeMembers: 1 })).criteria.find((c) => c.id === "C4")?.met).toBe(false);
    expect(classifyOrganization(base, obs()).criteria.find((c) => c.id === "C3")?.observed).toBe(false); // not observable
    // observed structure lifts the size: 100 people, nothing declared, but 2 RM + audit + committee seen
    expect(classifyOrganization(ans({ Q1: 100, Q2: 0 }), obs({ activeAccounts: 5, riskManagers: 2, auditMembers: 1, committeeMembers: 2 })).value).toBe("GRANDE_ENTREPRISE");
  });

  it("flags values close to a threshold and names the neighbour size", () => {
    const c = classifyOrganization(ans({ Q1: 95, Q2: 2, Q7: "YES" }), obs());
    expect(c.value).toBe("PME");
    expect(c.nearLimit).toBe(true);
    expect(c.toConfirm).toBe(true);
    expect(c.alternatives).toContain("GRANDE_ENTREPRISE");
    expect(classifyOrganization(ans({ Q1: 50 }), obs()).nearLimit).toBe(false);
  });

  it("an unknown answer that would change the size makes it 'to confirm', one that cannot is ignored", () => {
    const changes = classifyOrganization(ans({ Q1: 100, Q2: 2, Q7: "YES", Q8: "UNKNOWN" }), obs());
    expect(changes.toConfirm).toBe(true);
    expect(changes.alternatives).toContain("GRANDE_ENTREPRISE");
    const harmless = classifyOrganization(ans({ Q1: 60, Q8: "UNKNOWN" }), obs());
    expect(harmless.alternatives).toEqual([]);
    expect(harmless.toConfirm).toBe(false);
  });

  it("returns the rule version and a readable justification", () => {
    const c = classifyOrganization(ans({ Q1: 250 }), obs());
    expect(c.ruleVersion).toBe("0.3");
    expect(c.justification.join(" ")).toMatch(/E = 250/);
  });

  it("matches the illustrative examples of the governance JSON v0.3", () => {
    expect(classifyOrganization(ans({ Q1: 8, Q2: 1 }), obs({ activeAccounts: 3, riskManagers: 1 })).value).toBe("TPE");
    expect(classifyOrganization(ans({ Q1: 40, Q2: 2, Q7: "YES", Q8: "INFORMAL" }), obs({ activeAccounts: 3 })).value).toBe("PME");
    expect(classifyOrganization(ans({ Q1: 130, Q2: 3, Q5: "YES", Q7: "YES", Q8: "FORMAL" }), obs()).value).toBe("GRANDE_ENTREPRISE");
    const small = classifyOrganization(ans({ Q1: 15, Q11: "YES" }), obs());
    expect([small.value, small.toConfirm]).toEqual(["PME", true]);
  });
});

describe("profile gaps E1 to E4 and E7", () => {
  it("lists each declared / observed difference with both values", () => {
    const ids = (a: OrganizationAnswers, o: ObservedOrganization) => computeProfileGaps(a, o).map((g) => g.id);
    expect(ids(ans({ Q2: 3 }), obs({ riskManagers: 1 }))).toEqual(["E1"]);
    expect(ids(ans({ Q2: 1 }), obs({ riskManagers: 3 }))).toEqual(["E2"]);
    expect(ids(ans({ Q5: "YES" }), obs({ auditMembers: 0 }))).toEqual(["E3"]);
    expect(ids(ans({ Q5: "NO" }), obs({ auditMembers: 1 }))).toEqual(["E3"]);
    expect(ids(ans({ Q8: "FORMAL" }), obs({ committeeMembers: 1 }))).toEqual(["E4"]);
    expect(ids(ans({ Q8: "NO" }), obs({ committeeMembers: 2 }))).toEqual(["E4"]);
    expect(ids(ans({ Q1: 10 }), obs({ activeAccounts: 31 }))).toEqual(["E7"]);
    expect(ids(ans({ Q1: 40, Q2: 1 }), obs())).toEqual([]);
    expect(computeProfileGaps(ans({ Q1: 10 }), obs({ activeAccounts: 31 }))[0]).toMatchObject({ declared: 10, observed: 31, questionId: "Q1" });
  });

  it("an unknown answer produces no gap", () => {
    expect(computeProfileGaps(ans({ Q5: "UNKNOWN", Q8: "UNKNOWN" }), obs({ auditMembers: 1, committeeMembers: 2 }))).toEqual([]);
  });
});

describe("questionnaire in code", () => {
  const json = JSON.parse(readFileSync(join(here, "../../docs/governance/principes/principes-gouvernance.json"), "utf8"));

  it("stays in sync with docs/governance/principes/principes-gouvernance.json v0.3", () => {
    expect(String(json.meta.version)).toMatch(/^0\.3/);
    expect(QUESTIONNAIRE_VERSION).toBe("0.3");
    const jsonQuestions = json.questionnaireProfil.questions as { id: string; type: string; options?: string[] }[];
    expect(ORGANIZATION_QUESTIONS.map((q) => q.id)).toEqual(jsonQuestions.map((q) => q.id));
    for (const jq of jsonQuestions) {
      const q = ORGANIZATION_QUESTIONS.find((x) => x.id === jq.id)!;
      expect(q.type).toBe(jq.type === "nombre" ? "number" : "choice");
      if (q.type === "choice") expect(q.options).toHaveLength(jq.options!.length);
    }
    const rule = JSON.stringify(json.questionnaireProfil.regleDeduction.regles);
    for (const t of ["250", "100", "[3]", "20", "S <= [1]"]) expect(rule).toContain(t);
  });

  it("accepts a complete answer set and rejects missing, unknown, out-of-range and wrongly typed values", () => {
    expect(parseOrganizationAnswers("0.3", ans())).toEqual(ans());
    const bad = (over: Record<string, unknown>) => () => parseOrganizationAnswers("0.3", { ...ans(), ...over });
    expect(bad({ Q1: 0 })).toThrow(ValidationError);
    expect(bad({ Q1: 1.5 })).toThrow(ValidationError);
    expect(bad({ Q1: "40" })).toThrow(ValidationError);
    expect(bad({ Q2: -1 })).toThrow(ValidationError);
    expect(bad({ Q5: "MAYBE" })).toThrow(ValidationError);
    expect(bad({ Q8: "YES" })).toThrow(ValidationError);
    expect(bad({ Q99: 1 })).toThrow(ValidationError);
    expect(bad({ Q11: undefined })).toThrow(ValidationError);
    expect(() => parseOrganizationAnswers("0.3", null)).toThrow(ValidationError);
    expect(() => parseOrganizationAnswers("0.2", ans())).toThrow(/Unsupported questionnaire version/);
  });
});

describe("permissions", () => {
  it("orgprofile.* are known; the Audit group only reads and confirms; submit is not a group right but the Risk Manager's", () => {
    for (const p of ["orgprofile.read", "orgprofile.submit", "orgprofile.approve"] as const) expect(ALL_PERMISSIONS).toContain(p);
    expect(FIXED_GROUP_PERMISSIONS.RISK_MANAGER).toEqual(expect.arrayContaining(["orgprofile.read", "orgprofile.submit", "orgprofile.approve"]));
    expect(FIXED_GROUP_PERMISSIONS.RISK_COMMITTEE).toEqual(expect.arrayContaining(["orgprofile.read", "orgprofile.approve"]));
    expect(FIXED_GROUP_PERMISSIONS.RISK_COMMITTEE).not.toContain("orgprofile.submit");
    // q157: Audit reads only, never confirms
    expect(FIXED_GROUP_PERMISSIONS.AUDIT).toContain("orgprofile.read");
    expect(FIXED_GROUP_PERMISSIONS.AUDIT).not.toContain("orgprofile.approve");
    expect(isAuditGroupPermission("orgprofile.approve")).toBe(false);
    expect(FIXED_GROUP_PERMISSIONS.AUDIT.filter((p) => !isAuditGroupPermission(p))).toEqual([]);
    expect(isAuditGroupPermission("orgprofile.submit")).toBe(false);
    // holding the new rights does not make someone an administrator (q63 cumul rules)
    expect(ADMIN_PERMISSIONS.some((p) => p.startsWith("orgprofile."))).toBe(false);
    expect(isAdministrator([{ permissions: ["orgprofile.read", "orgprofile.submit"], systemGroup: null } as unknown as Role])).toBe(false);
  });
});

describe("migration 071 (static)", () => {
  const dir = join(here, "../../database/postgresql/migrations");
  const up = readFileSync(join(dir, "071_organization_profiles.sql"), "utf8");
  const down = readFileSync(join(dir, "071_organization_profiles.down.sql"), "utf8");
  const code = up.replace(/--.*$/gm, "");

  it("is append-only: no DELETE FROM, delete and truncate refused and revoked, search_path pinned on both guards", () => {
    expect(code).not.toMatch(/\bDELETE\s+FROM\b/i);
    expect(code).toMatch(/REVOKE DELETE, TRUNCATE ON organization_profiles/);
    expect(code).toMatch(/BEFORE INSERT OR UPDATE OR DELETE ON organization_profiles/);
    expect(code).toMatch(/BEFORE TRUNCATE ON organization_profiles/);
    const pins = [...code.matchAll(/SET search_path = pg_catalog, public, pg_temp/g)];
    expect(pins.length).toBeGreaterThanOrEqual(4); // inline + ALTER for each of the two functions
  });

  it("keeps tenant_id on the table, one ACTIVE and one PENDING row per tenant, and the maker-checker CHECK", () => {
    expect(code).toMatch(/tenant_id\s+uuid NOT NULL REFERENCES tenants/);
    expect(code).toMatch(/organization_profiles_active_idx[\s\S]*WHERE status = 'ACTIVE'/);
    expect(code).toMatch(/organization_profiles_pending_idx[\s\S]*WHERE status = 'PENDING'/);
    expect(code).toMatch(/decided_by IS NULL OR decided_by <> submitted_by/);
  });

  it("catches existing tenants up with every administrator permission of the code (except the new ones)", () => {
    for (const p of ["role.create", "role.update", "role.delete", "role.assign", "user.create", "user.update", "user.delete",
      "user.reactivate", "rolegroup.audit.update", "config.cumul.set", "config.committeeenforcement.set", "config.manage", "config.selfvalidation.set"]) {
      expect(code).toContain(`'${p}'`);
    }
  });

  it("down removes its own row from schema_migrations inside a transaction", () => {
    expect(down).toMatch(/BEGIN;[\s\S]*DELETE FROM schema_migrations WHERE filename = '071_organization_profiles\.sql';\s*COMMIT;/);
  });
});

// ------------------------------------------------------------------------------------------------------------------
// Service, with an in-memory repository that mimics the real one (one ACTIVE / one PENDING per tenant, versions).
class FakeProfiles implements OrganizationProfileRepository {
  rows: OrganizationProfile[] = [];
  observed: ObservedOrganization = obs();
  others = 0;
  calls: { tenantId: string }[] = [];
  private seq = 0;
  constructor(private readonly auditSink: AuditEvent[]) {}

  async list(tenantId: string, limit: number) { this.calls.push({ tenantId }); return this.rows.filter((r) => r.tenantId === tenantId).sort((a, b) => b.version - a.version).slice(0, limit); }
  async getActive(tenantId: string) { return this.rows.find((r) => r.tenantId === tenantId && r.status === "ACTIVE") ?? null; }
  async getPending(tenantId: string) { return this.rows.find((r) => r.tenantId === tenantId && r.status === "PENDING") ?? null; }
  async getById(tenantId: string, id: string) { this.calls.push({ tenantId }); return this.rows.find((r) => r.tenantId === tenantId && r.id === id) ?? null; }
  async observe() { return this.observed; }
  async countOtherGovernanceMembers() { return this.others; }

  private record(events: Omit<AuditEvent, "id" | "timestamp">[]) { for (const e of events) this.auditSink.push({ ...e, id: String(this.auditSink.length), timestamp: new Date() }); }

  async insertVersion(input: InsertOrganizationProfileInput, audit: (r: OrganizationProfileChange) => Omit<AuditEvent, "id" | "timestamp">[]) {
    let superseded: OrganizationProfile | null = null;
    if (input.status === "ACTIVE") {
      const a = await this.getActive(input.tenantId);
      if (a) { a.status = "SUPERSEDED"; superseded = { ...a }; }
    } else if (await this.getPending(input.tenantId)) throw new ConflictError("pending");
    const profile: OrganizationProfile = {
      id: `p${++this.seq}`, tenantId: input.tenantId, version: this.rows.filter((r) => r.tenantId === input.tenantId).length + 1,
      questionnaireVersion: input.questionnaireVersion, answers: input.answers, reason: input.reason, status: input.status, regime: input.regime,
      submittedBy: input.submittedBy, submittedAt: new Date(), decidedBy: null, decidedAt: null, decisionReason: null,
    };
    this.rows.push(profile);
    const out = { profile, superseded };
    this.record(audit(out));
    return out;
  }
  async approve(tenantId: string, id: string, decidedBy: string, audit: (r: OrganizationProfileChange) => Omit<AuditEvent, "id" | "timestamp">[]) {
    const row = this.rows.find((r) => r.tenantId === tenantId && r.id === id && r.status === "PENDING");
    if (!row) throw new NotFoundError("OrganizationProfile", id);
    const a = await this.getActive(tenantId);
    if (a) a.status = "SUPERSEDED";
    Object.assign(row, { status: "ACTIVE", regime: "CONFIRMED", decidedBy, decidedAt: new Date() });
    const out = { profile: row, superseded: a };
    this.record(audit(out));
    return out;
  }
  async reject(tenantId: string, id: string, decidedBy: string, reason: string, audit: (r: OrganizationProfile) => Omit<AuditEvent, "id" | "timestamp">[]) {
    const row = this.rows.find((r) => r.tenantId === tenantId && r.id === id && r.status === "PENDING");
    if (!row) throw new NotFoundError("OrganizationProfile", id);
    Object.assign(row, { status: "REJECTED", decidedBy, decidedAt: new Date(), decisionReason: reason });
    this.record(audit(row));
    return row;
  }
}

const user = (userId: string, perms: string[], tenantId = "t1"): AuthenticatedUser =>
  ({ userId, tenantId, email: `${userId}@x`, displayName: userId, roles: perms, dashboardScopeMode: "GLOBAL" }) as AuthenticatedUser;
const ADMIN = user("admin", ["orgprofile.read", "orgprofile.submit"]);
const RM = user("rm", ["orgprofile.read", "orgprofile.submit", "orgprofile.approve"]);
const COMMITTEE = user("com", ["orgprofile.read", "orgprofile.approve"]);
const body = (answers: unknown, reason = "mise à jour") => ({ questionnaireVersion: "0.3", answers, reason });

describe("OrganizationProfileService", () => {
  let repo: FakeProfiles; let audit: AuditEvent[]; let svc: OrganizationProfileService;
  beforeEach(() => { audit = []; repo = new FakeProfiles(audit); svc = new OrganizationProfileService(repo, { record: async (e: Omit<AuditEvent, "id" | "timestamp">) => { audit.push({ ...e, id: "x", timestamp: new Date() }); } } as never); });

  it("get: no profile yet means no size, only what is observed", async () => {
    const v = await svc.get(ADMIN);
    expect(v.active).toBeNull();
    expect(v.classification).toBeNull();
    expect(v.profileGaps).toEqual([]);
    expect(v.observed).toEqual(obs());
    expect(v.questionnaire.version).toBe("0.3");
    expect(v.questionnaire.questions).toHaveLength(6);
  });

  it("get/submit/approve/reject need their permission", async () => {
    const nobody = user("n", []);
    await expect(svc.get(nobody)).rejects.toThrow(ForbiddenError);
    await expect(svc.submit(nobody, body(ans()), "r")).rejects.toThrow(ForbiddenError);
    await expect(svc.submit(COMMITTEE, body(ans()), "r")).rejects.toThrow(ForbiddenError);
    await expect(svc.approve(ADMIN, "p1", "r")).rejects.toThrow(ForbiddenError);
    await expect(svc.reject(ADMIN, "p1", "no", "r")).rejects.toThrow(ForbiddenError);
  });

  it("first submission becomes ACTIVE at once; the author is the actor; the size, calculation and gaps come back from the server", async () => {
    repo.observed = obs({ activeAccounts: 31 });
    const p = await svc.submit(ADMIN, body(ans({ Q1: 12 })), "req-1");
    expect(p).toMatchObject({ status: "ACTIVE", submittedBy: "admin", version: 1, regime: null, tenantId: "t1" });
    expect(audit).toHaveLength(1);
    expect(audit[0]).toMatchObject({ action: "SUBMIT", entityType: "OrganizationProfile", userId: "admin", tenantId: "t1", reason: "mise à jour", governanceException: null });
    const v = await svc.get(ADMIN);
    expect(v.classification).toMatchObject({ value: "PME", effectiveHeadcount: 31, declaredHeadcount: 12, toConfirm: true });
    expect(v.profileGaps.map((g) => g.id)).toEqual(["E7"]);
    expect(v.history).toHaveLength(1);
  });

  it("an increase applies at once even when a third party exists, and every version is kept", async () => {
    await svc.submit(ADMIN, body(ans({ Q1: 10 })), "r1");
    repo.others = 2;
    const p = await svc.submit(ADMIN, body(ans({ Q1: 60 })), "r2");
    expect(p.status).toBe("ACTIVE");
    expect(repo.rows.map((r) => [r.version, r.status])).toEqual([[1, "SUPERSEDED"], [2, "ACTIVE"]]);
  });

  it("a reduction with no third party applies at once, marked adminAlone in the journal", async () => {
    await svc.submit(ADMIN, body(ans({ Q1: 300 })), "r1");
    const p = await svc.submit(ADMIN, body(ans({ Q1: 15 })), "r2");
    expect(p).toMatchObject({ status: "ACTIVE", regime: "ALONE" });
    expect(audit[1]).toMatchObject({ governanceException: ADMIN_ALONE_EXCEPTION });
    expect(audit[1]!.newValue).toMatchObject({ sizeBefore: "GRANDE_ENTREPRISE", sizeAfter: "TPE", lowersSize: true, otherGovernanceMembers: 0 });
  });

  it("a reduction with a third party waits for a second confirmation: the active version stays in force", async () => {
    await svc.submit(ADMIN, body(ans({ Q1: 300 })), "r1");
    repo.others = 1;
    const p = await svc.submit(ADMIN, body(ans({ Q1: 15 })), "r2");
    expect(p.status).toBe("PENDING");
    expect(audit[1]!.governanceException).toBeNull();
    const v = await svc.get(RM);
    expect(v.active!.answers.Q1).toBe(300);
    expect(v.classification!.value).toBe("GRANDE_ENTREPRISE");
    expect(v.pending!.id).toBe(p.id);
    expect(v.pendingClassification!.value).toBe("TPE");
    await expect(svc.submit(ADMIN, body(ans({ Q1: 16 })), "r3")).rejects.toThrow(ConflictError);
  });

  it("the author never confirms or rejects their own submission, even holding orgprofile.approve", async () => {
    await svc.submit(RM, body(ans({ Q1: 300 })), "r1");
    repo.others = 1;
    const p = await svc.submit(RM, body(ans({ Q1: 15 })), "r2");
    expect(p.status).toBe("PENDING");
    await expect(svc.approve(RM, p.id, "r3")).rejects.toThrow(/maker-checker/);
    await expect(svc.reject(RM, p.id, "non", "r3")).rejects.toThrow(/maker-checker/);
    expect(repo.rows.find((r) => r.id === p.id)!.status).toBe("PENDING");
  });

  it("another approver confirms: the previous version is superseded and the decision is journalled with the actor", async () => {
    await svc.submit(ADMIN, body(ans({ Q1: 300 })), "r1");
    repo.others = 1;
    const p = await svc.submit(ADMIN, body(ans({ Q1: 15 })), "r2");
    const approved = await svc.approve(COMMITTEE, p.id, "r3");
    expect(approved).toMatchObject({ status: "ACTIVE", regime: "CONFIRMED", decidedBy: "com" });
    expect(repo.rows.map((r) => r.status)).toEqual(["SUPERSEDED", "ACTIVE"]);
    expect(audit.at(-1)).toMatchObject({ action: "APPROVE", userId: "com", entityId: p.id });
    expect(audit.at(-1)!.newValue).toMatchObject({ supersededId: "p1" });
    await expect(svc.approve(COMMITTEE, p.id, "r4")).rejects.toThrow(ValidationError); // already decided
  });

  it("rejecting needs a reason; the active version is untouched and the rejection is kept", async () => {
    await svc.submit(ADMIN, body(ans({ Q1: 300 })), "r1");
    repo.others = 1;
    const p = await svc.submit(ADMIN, body(ans({ Q1: 15 })), "r2");
    await expect(svc.reject(COMMITTEE, p.id, "  ", "r3")).rejects.toThrow(ValidationError);
    const rejected = await svc.reject(COMMITTEE, p.id, "effectif sous-estimé", "r3");
    expect(rejected).toMatchObject({ status: "REJECTED", decisionReason: "effectif sous-estimé", decidedBy: "com" });
    expect(audit.at(-1)).toMatchObject({ action: "REJECT", reason: "effectif sous-estimé", userId: "com" });
    expect((await svc.get(ADMIN)).active!.answers.Q1).toBe(300);
  });

  it("validates the input server-side: a reason, a known questionnaire version and a complete, valid answer set", async () => {
    await expect(svc.submit(ADMIN, body(ans(), "  "), "r")).rejects.toThrow(/reason is required/);
    await expect(svc.submit(ADMIN, body(ans(), "x".repeat(501)), "r")).rejects.toThrow(ValidationError);
    await expect(svc.submit(ADMIN, { questionnaireVersion: "0.2", answers: ans(), reason: "r" }, "r")).rejects.toThrow(/Unsupported/);
    await expect(svc.submit(ADMIN, body({ ...ans(), Q1: -3 }), "r")).rejects.toThrow(ValidationError);
    await expect(svc.submit(ADMIN, body({ ...ans(), submittedBy: "someone-else" }), "r")).rejects.toThrow(ValidationError);
    expect(repo.rows).toHaveLength(0);
  });

  it("is scoped to the actor's tenant: another tenant's version is not found", async () => {
    await svc.submit(ADMIN, body(ans({ Q1: 300 })), "r1");
    repo.others = 1;
    const p = await svc.submit(ADMIN, body(ans({ Q1: 15 })), "r2");
    const stranger = user("com2", ["orgprofile.approve"], "t2");
    await expect(svc.approve(stranger, p.id, "r3")).rejects.toThrow(NotFoundError);
    expect((await svc.get(user("a2", ["orgprofile.read"], "t2"))).active).toBeNull();
  });
});
