import { describe, expect, it, vi } from "vitest";
import type { Pool } from "pg";
import { RiskFrameworkService } from "../src/services/RiskFrameworkService.js";
import { PostgresRiskFrameworkRepository } from "../src/infrastructure/database/postgres/PostgresRiskFrameworkRepository.js";
import { ForbiddenError, ValidationError } from "../src/domain/errors/DomainErrors.js";
import type { Permission } from "../src/domain/permissions.js";
import type { RatingScale } from "../src/domain/entities/RatingScale.js";
import type { SystemGroup } from "../src/domain/entities/Role.js";
import type { AuthenticatedUser } from "../src/infrastructure/identity/IdentityProvider.js";

// Level 1 tests for B-6a bis (F-B6a-01..04, F-B6a-07, B6a-QA-01, C-B6a-01/02/04). Author's own tests: QA level 2 is A08's.

const PERMS: Permission[] = [
  "riskframework.read", "riskframework.create", "riskframework.update",
  "riskframework.activate", "riskframework.archive", "riskframework.process.assign",
];
const actor = (userId: string): AuthenticatedUser =>
  ({ userId, tenantId: "t1", email: `${userId}@x`, displayName: userId, roles: PERMS }) as AuthenticatedUser;
const [u1, u2, u3] = [actor("u1"), actor("u2"), actor("u3")];
const admin = actor("admin"); // all permissions, but not a Risk Manager
const R = "req";

const lv = (n: number) => Array.from({ length: n }, (_, i) => ({ level: i + 1, label: `L${i + 1}` }));
function scale(id: string, status: RatingScale["status"] = "ACTIVE", n = 5): RatingScale {
  return {
    id, tenantId: "t1", name: id, version: "1", status, probabilityLevels: n, probabilityLabels: lv(n),
    impactLevels: n, impactLabels: lv(n), criticalityThresholds: null,
    impactAxes: { axes: [{ code: "FIN", label: "Fin", order: 1, levelLabels: lv(n) }], retainedImpactRule: "MAX" },
    velocityLevels: null, persistenceLevels: null, masteryScale: null, activatedAt: null, archivedAt: null,
    createdAt: new Date(), updatedAt: new Date(), deletedAt: null, deletedBy: null, deletionReason: null,
  } as RatingScale;
}

/** A minimal in-memory world: one Dispositif, versions, requests; the repository is a thin fake. */
function world(o: { scales?: RatingScale[]; emit?: boolean } = {}) {
  const scales = o.scales ?? [scale("s1")];
  const versions: Array<Record<string, unknown>> = [];
  const requests: Array<Record<string, unknown>> = [];
  const events: Array<{ userId: string; entityType: string; entityId: string; action: string }> = [];
  const sent: Array<Record<string, unknown>> = [];
  const hooks = { auditFails: (_e: { entityType: string; action: string }) => false, lockedCalls: 0, beforeLock: () => undefined as void, lockedError: null as Error | null };
  const fw = { id: "fw1", tenantId: "t1", name: "D", isDefault: false, archivedAt: null };
  const find = (id: string) => versions.find((v) => v.id === id)!;
  const repo = {
    async getFramework() { return fw; },
    async listVersions() { return versions; },
    async getVersion(_t: string, _f: string, id: string) { return versions.find((v) => v.id === id) ?? null; },
    async getActiveVersion() { return versions.find((v) => v.status === "ACTIVE") ?? null; },
    async createWithDraft(i: { createdBy: string; params: object }) {
      versions.push({ id: "v1", tenantId: "t1", frameworkId: "fw1", versionNumber: 1, status: "DRAFT", ...i.params, createdBy: i.createdBy, lastEditedBy: i.createdBy });
      return { framework: fw, version: versions[0] };
    },
    async updateDraft(_t: string, _f: string, id: string, fields: object, by: string) {
      return Object.assign(find(id), fields, { lastEditedBy: by });
    },
    async discardDraft(_t: string, _f: string, id: string) { return Object.assign(find(id), { status: "ARCHIVED" }); },
    async createActivationRequest(i: { versionId: string; requestedBy: string; validateLocked?: (v: never) => Promise<void> }) {
      hooks.beforeLock(); // a PATCH committing just before the lock
      if (i.validateLocked) { hooks.lockedCalls++; await i.validateLocked(find(i.versionId) as never); }
      find(i.versionId).status = "PENDING_APPROVAL";
      const r = { id: "r1", tenantId: "t1", kind: "ACTIVATE_VERSION", frameworkId: "fw1", versionId: i.versionId, status: "PENDING", requestedBy: i.requestedBy };
      requests.push(r);
      return r;
    },
    async getRequest(_t: string, id: string) { return requests.find((r) => r.id === id) ?? null; },
    async recordDecision(_t: string, id: string, d: { outcome: string; decidedBy: string }) {
      const r = requests.find((x) => x.id === id)!;
      Object.assign(r, { status: d.outcome });
      const v = find(r.versionId as string);
      v.status = d.outcome === "APPROVED" ? "ACTIVE" : "DRAFT";
      return { request: r, version: v, previousActive: null };
    },
    async withdraw(_t: string, id: string) {
      const r = requests.find((x) => x.id === id)!;
      r.status = "WITHDRAWN";
      find(r.versionId as string).status = "DRAFT";
      return { request: r, version: find(r.versionId as string), previousActive: null };
    },
  };
  const groups: Record<SystemGroup, string[]> = { RISK_MANAGER: ["u1", "u2", "u3"], AUDIT: [], RISK_COMMITTEE: [] };
  const role = (g: SystemGroup) => ({ id: g, tenantId: "t1", name: g, permissions: [], systemGroup: g });
  const roles = {
    async list() { return (Object.keys(groups) as SystemGroup[]).map(role); },
    async listForUser(_t: string, u: string) { return (Object.keys(groups) as SystemGroup[]).filter((g) => groups[g].includes(u)).map(role); },
    async listAssignments(_t: string, id: string) { return groups[id as SystemGroup].map((userId) => ({ userId, roleId: id, revokedAt: null })); },
  };
  const users = {
    async getById(_t: string, id: string) { return { id, deletedAt: null }; },
    async listWithPermission(_t: string, p: string, exclude: string) {
      return (p === "riskframework.activate" ? groups.RISK_MANAGER : []).filter((i) => i !== exclude).map((id) => ({ id }));
    },
  };
  const audit = {
    async record(e: (typeof events)[number]) { if (hooks.auditFails(e)) throw new Error("audit down"); events.push(e); },
    async listForEntity(_t: string, type: string, id: string) { return events.filter((e) => e.entityType === type && e.entityId === id); },
  };
  const notifications: Record<string, unknown> = {
    async record(i: Record<string, unknown>) { sent.push({ via: "record", ...i }); },
  };
  if (o.emit) notifications["emit"] = async (i: Record<string, unknown>) => { sent.push({ via: "emit", ...i }); };
  const ratingScales = { async getById(_t: string, id: string) { return scales.find((s) => s.id === id) ?? null; } };
  const service = new RiskFrameworkService(repo as never, ratingScales as never, roles as never, users as never, audit as never, undefined, notifications as never);
  return { service, versions, requests, events, sent, hooks, scales };
}

async function draft(w: ReturnType<typeof world>) {
  const { version } = await w.service.create(u1, { name: "D", ratingScaleId: "s1" }, R);
  return version.id;
}

describe("B-6a bis service rules", () => {
  it("C-B6a-02: a non RISK_MANAGER changeApprover is refused (400) on create and on draft update; RISK_MANAGER stays accepted", async () => {
    const w = world();
    await expect(w.service.create(u1, { name: "D", ratingScaleId: "s1", params: { changeApprover: "COMMITTEE" } }, R))
      .rejects.toThrow(/B-12/);
    const v = await draft(w);
    for (const a of ["AUDIT", "COMMITTEE", "AUDIT_AND_COMMITTEE"] as const) {
      await expect(w.service.updateDraft(u1, "fw1", v, { changeApprover: a }, R)).rejects.toThrow(ValidationError);
    }
    await expect(w.service.updateDraft(u1, "fw1", v, { changeApprover: "RISK_MANAGER" }, R)).resolves.toBeDefined();
  });

  it("C-B6a-04: withdrawing a request needs a reason", async () => {
    const w = world();
    const v = await draft(w);
    const r = await w.service.requestActivation(u1, "fw1", v, "go", R);
    await expect(w.service.withdraw(u1, r.id, undefined, R)).rejects.toThrow(/reason is required/);
    await expect(w.service.withdraw(u1, r.id, "   ", R)).rejects.toThrow(ValidationError);
    expect(w.requests[0]!.status).toBe("PENDING");
    await expect(w.service.withdraw(u1, r.id, "erreur de saisie", R)).resolves.toBeDefined();
  });

  it("F-B6a-03: discardDraft needs Risk Manager membership, not only riskframework.archive", async () => {
    const w = world();
    const v = await draft(w);
    await expect(w.service.discardDraft(admin, "fw1", v, "x", R)).rejects.toThrow(ForbiddenError);
    expect(w.versions[0]!.status).toBe("DRAFT");
    await expect(w.service.discardDraft(u2, "fw1", v, "x", R)).resolves.toBeDefined();
  });

  it("F-B6a-02: the request is validated again on the locked version; approving replays the rules, rejecting does not", async () => {
    const w = world();
    const v = await draft(w);
    const r = await w.service.requestActivation(u1, "fw1", v, "go", R);
    expect(w.hooks.lockedCalls).toBe(1);
    // content that became invalid after the request (scale shrunk): approve refuses, reject still works
    w.versions[0]!.committeeEvaluationMinScore = 36;
    await expect(w.service.approve(u2, r.id, undefined, R)).rejects.toThrow(/exceed the maximum score/);
    expect(w.requests[0]!.status).toBe("PENDING");
    await expect(w.service.reject(u2, r.id, "seuil impossible", R)).resolves.toBeDefined();
  });

  it("F-B6a-02: a PATCH committed just before the lock is caught by the replay (nothing stored)", async () => {
    const w = world();
    const v = await draft(w);
    w.hooks.beforeLock = () => { w.versions[0]!.committeeEvaluationMinScore = 36; };
    await expect(w.service.requestActivation(u1, "fw1", v, "go", R)).rejects.toThrow(/exceed the maximum score/);
    expect(w.requests).toHaveLength(0);
    expect(w.versions[0]!.status).toBe("DRAFT");
  });

  it("C-B6a-01: notifications leave even if the audit write fails; the audit error is still raised", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const w = world();
    const v = await draft(w);
    w.hooks.auditFails = (e) => e.action === "SUBMIT";
    await expect(w.service.requestActivation(u1, "fw1", v, "go", R)).rejects.toThrow(/audit down/);
    expect(w.sent.map((s) => s.eventType)).toEqual(["RISK_FRAMEWORK_CHANGE_PENDING", "RISK_FRAMEWORK_CHANGE_PENDING"]);
    w.sent.length = 0;
    w.hooks.auditFails = (e) => e.action === "APPROVE" || e.entityType === "RiskFrameworkVersion";
    await expect(w.service.approve(u2, "r1", "ok", R)).rejects.toThrow(/audit down/);
    expect(w.sent.map((s) => s.eventType)).toEqual(["RISK_FRAMEWORK_CHANGE_DECIDED"]);
  });

  it("F-B6a-07: CHANGE_PENDING goes through emit with skipIfUnread on the Dispositif id; falls back to record without emit", async () => {
    const w = world({ emit: true });
    const v = await draft(w);
    await w.service.requestActivation(u1, "fw1", v, "go", R);
    expect(w.sent.length).toBeGreaterThan(0);
    expect(w.sent.every((s) => s.via === "emit" && s.skipIfUnread === true && s.resourceId === "fw1")).toBe(true);
    const plain = world();
    await plain.service.requestActivation(u1, "fw1", await draft(plain), "go", R);
    expect(plain.sent.every((s) => s.via === "record")).toBe(true);
  });

  it("B6a-QA-01: the audit line precedes the stored edit (audit down -> nothing stored)", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const w = world();
    const v = await draft(w);
    w.hooks.auditFails = (e) => e.action === "UPDATE";
    await expect(w.service.updateDraft(u3, "fw1", v, { committeeEvaluationEnforced: false }, R)).rejects.toThrow(/audit down/);
    expect(w.versions[0]!.committeeEvaluationEnforced).toBe(true);
    expect(w.versions[0]!.lastEditedBy).toBe("u1");
  });

  it("F-B6a-04: authors of a DRAFT rating scale cannot decide; no exclusion once the scale is ACTIVE (an ARCHIVED scale is refused at request time)", async () => {
    for (const [status, blocked] of [["DRAFT", true], ["ACTIVE", false]] as const) {
      const w = world({ scales: [scale("s1", status)] });
      const v = await draft(w);
      w.events.push({ userId: "u3", entityType: "RatingScale", entityId: "s1", action: "UPDATE" });
      const r = await w.service.requestActivation(u1, "fw1", v, "go", R);
      const attempt = w.service.approve(u3, r.id, undefined, R);
      if (blocked) await expect(attempt).rejects.toThrow(ForbiddenError);
      else await expect(attempt).resolves.toBeDefined();
    }
  });
});

// -- repository (SQL recorded by a fake pool) ----------------------------------------------------------
function fakePool(o: { scaleStatus?: string; cfgEval?: number; appetite?: number; reqStatus?: string } = {}) {
  const log: string[] = [];
  const row = (rows: unknown[]) => ({ rows, rowCount: rows.length });
  const ver = {
    id: "v1", tenant_id: "t1", framework_id: "fw1", version_number: 1, status: "PENDING_APPROVAL", rating_scale_id: "s1",
    default_evaluation_mode: "CLASSIQUE", committee_evaluation_min_score: 15, committee_evaluation_enforced: true,
    committee_treatment_min_score: null, appetite_thresholds: [], change_approver: "RISK_MANAGER", self_proposal_allowed: false,
  };
  const client = {
    async query(sql: string) {
      log.push(sql.replace(/\s+/g, " ").trim());
      if (/FROM risk_framework_change_requests .*FOR UPDATE/.test(log.at(-1)!)) {
        return row([{ id: "r1", status: o.reqStatus ?? "PENDING", kind: "ACTIVATE_VERSION", version_id: "v1", framework_id: "fw1" }]);
      }
      if (/^INSERT INTO risk_framework_change_requests/.test(log.at(-1)!)) return row([{ id: "r1", status: "PENDING" }]);
      if (/^UPDATE risk_framework_change_requests/.test(log.at(-1)!)) return row([{ id: "r1", status: "APPROVED" }]);
      if (/FROM risk_framework_versions .* FOR UPDATE/.test(log.at(-1)!)) {
        return /status = 'ACTIVE' FOR UPDATE/.test(log.at(-1)!) ? row([]) : row([{ ...ver, status: "DRAFT" }]);
      }
      if (/^UPDATE risk_framework_versions .*'ACTIVE'/.test(log.at(-1)!)) return row([{ ...ver, status: "ACTIVE" }]);
      if (/^SELECT status, probability_levels/.test(log.at(-1)!)) {
        return row([{ status: o.scaleStatus ?? "DRAFT", probability_levels: 5, impact_levels: 5 }]);
      }
      if (/^SELECT min\(/.test(log.at(-1)!)) return row([{ ceiling: 25 }]);
      if (/FROM configs/.test(log.at(-1)!)) return row([{ e: o.cfgEval ?? 15, t: null }]);
      if (/FROM risk_appetites/.test(log.at(-1)!)) return row(o.appetite ? [{ sub_category: "Fraude", threshold: o.appetite }] : []);
      return /^UPDATE/.test(log.at(-1)!) ? { rows: [], rowCount: 1 } : row([]);
    },
    release() { /* noop */ },
  };
  return { pool: { connect: async () => client } as unknown as Pool, log };
}
const decision = { outcome: "APPROVED" as const, decidedBy: "u2", comment: null, decisionRegime: "NORMAL" as const, deciderGroup: "RISK_MANAGER" as const, ratificationStatus: null };

describe("B-6a bis repository (F-B6a-01, F-B6a-02)", () => {
  it("F-B6a-01: an approval archives every other ACTIVE scale no ACTIVE version references, in the same transaction", async () => {
    const f = fakePool();
    await new PostgresRiskFrameworkRepository(f.pool).recordDecision("t1", "r1", decision);
    expect(f.log[0]).toBe("BEGIN");
    expect(f.log.at(-1)).toBe("COMMIT");
    const archive = f.log.find((q) => /UPDATE rating_scales SET status = 'ARCHIVED'/.test(q))!;
    expect(archive).toMatch(/id <> \$2 AND status = 'ACTIVE'/);
    expect(archive).toMatch(/NOT EXISTS/);
    expect(f.log.some((q) => /SET status = 'ACTIVE'/.test(q) && /rating_scales/.test(q))).toBe(true);
  });

  it("F-B6a-01: an ARCHIVED scale is refused and the whole decision rolls back", async () => {
    const f = fakePool({ scaleStatus: "ARCHIVED" });
    await expect(new PostgresRiskFrameworkRepository(f.pool).recordDecision("t1", "r1", decision)).rejects.toThrow(/archived rating scale/);
    expect(f.log.at(-1)).toBe("ROLLBACK");
    expect(f.log).not.toContain("COMMIT");
  });

  it.each([
    ["configs Comité threshold above n²", { cfgEval: 30 }, /configs/],
    ["legacy appetite above n²", { appetite: 26 }, /Fraude/],
  ])("F-B6a-01: %s refuses the activation (rollback)", async (_n, o, msg) => {
    const f = fakePool(o);
    await expect(new PostgresRiskFrameworkRepository(f.pool).recordDecision("t1", "r1", decision)).rejects.toThrow(msg);
    expect(f.log.at(-1)).toBe("ROLLBACK");
  });

  it("F-B6a-02: createActivationRequest locks the version FOR UPDATE, replays validateLocked on it, and a throw rolls back", async () => {
    const f = fakePool();
    const seen: string[] = [];
    const input = { tenantId: "t1", frameworkId: "fw1", versionId: "v1", reason: "go", requestedBy: "u1", previousValue: null };
    await new PostgresRiskFrameworkRepository(f.pool).createActivationRequest({ ...input, validateLocked: async (v) => { seen.push(v.status); } });
    expect(seen).toEqual(["DRAFT"]);
    const lockAt = f.log.findIndex((q) => /FROM risk_framework_versions .*FOR UPDATE/.test(q));
    const moveAt = f.log.findIndex((q) => /SET status = 'PENDING_APPROVAL'/.test(q));
    expect(lockAt).toBeGreaterThan(0);
    expect(moveAt).toBeGreaterThan(lockAt);

    const g = fakePool();
    await expect(new PostgresRiskFrameworkRepository(g.pool).createActivationRequest({
      ...input, validateLocked: async () => { throw new ValidationError("nope"); },
    })).rejects.toThrow("nope");
    expect(g.log.at(-1)).toBe("ROLLBACK");
    expect(g.log.some((q) => /PENDING_APPROVAL/.test(q))).toBe(false);
  });
});
