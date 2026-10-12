import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { DashboardService } from "../src/services/DashboardService.js";
import { RatingScaleService } from "../src/services/RatingScaleService.js";
import { RiskFrameworkService } from "../src/services/RiskFrameworkService.js";
import { PostgresRiskEvaluationRepository } from "../src/infrastructure/database/postgres/PostgresRiskEvaluationRepository.js";
import { ForbiddenError, NotFoundError, ValidationError } from "../src/domain/errors/DomainErrors.js";
import type { Permission } from "../src/domain/permissions.js";
import type { RiskFrameworkVersion } from "../src/domain/entities/RiskFramework.js";
import type { AuthenticatedUser } from "../src/infrastructure/identity/IdentityProvider.js";

// QA pass on the B-6b follow-up batch (A06 fixes + migration 060). Oracles written before running.

const T1 = "t1";
const T2 = "t2";
const actor = (perms: Permission[], tenantId = T1): AuthenticatedUser => ({ userId: "u1", tenantId, email: "a@x", roles: perms }) as AuthenticatedUser;

const version = (id: string, frameworkId: string, thresholds: Array<[string, string | null, number]>, over: Partial<RiskFrameworkVersion> = {}): RiskFrameworkVersion => ({
  id, tenantId: T1, frameworkId, versionNumber: 1, status: "ACTIVE", ratingScaleId: "s5",
  defaultEvaluationMode: "CLASSIQUE", committeeEvaluationMinScore: 12, committeeEvaluationEnforced: true,
  committeeTreatmentMinScore: null,
  appetiteThresholds: thresholds.map(([subCategory, entity, threshold]) => ({ subCategory, subCategoryId: null, entity, threshold, description: null })),
  changeApprover: "RISK_MANAGER", selfProposalAllowed: false, lowCriticalityThreshold: 5, riskOwnerExecutorCumulAllowed: true,
  delegateExecutorCumulAllowed: true, delegationMaxDays: null, hybridPolicyEnabled: false, masteryAuthoritativeSource: "RISK_TEAM",
  committeeVoteRule: "DEFAULT", committeeVoteCustom: null, createdBy: "u9", lastEditedBy: "u9", createdAt: new Date(), updatedAt: new Date(),
  activatedAt: new Date(), activationRequestId: "rq", archivedAt: null, archivedBy: null, archiveReason: null, ...over,
});

interface World {
  /** tenant -> default framework id (absent = none) */
  defaults: Record<string, string | undefined>;
  /** tenant:processId -> framework id */
  processFw: Record<string, string>;
  /** tenant:frameworkId -> ACTIVE version (absent = none) */
  active: Record<string, RiskFrameworkVersion | undefined>;
  /** process id -> {level, parentId} */
  processes: Record<string, { id: string; level: string; parentId: string | null }>;
  scaleGone?: boolean;
}
function dashboard(world: World, scored: unknown[], opts: { wired?: boolean; legacyAppetites?: unknown[]; withScales?: boolean } = {}) {
  const calls = { getActiveVersion: [] as string[], getDefaultFramework: [] as string[], legacyList: 0 };
  const frameworks = {
    async getDefaultFramework(t: string) { calls.getDefaultFramework.push(t); const id = world.defaults[t]; return id ? ({ id } as never) : null; },
    async getProcessFrameworkId(t: string, p: string) { return world.processFw[`${t}:${p}`] ?? null; },
    async getActiveVersion(t: string, f: string) { calls.getActiveVersion.push(`${t}:${f}`); return world.active[`${t}:${f}`] ?? null; },
  };
  const processes = { async getById(t: string, id: string) { return t === T1 ? ((world.processes[id] as never) ?? null) : null; } };
  const ratingScales = { async getById() { return world.scaleGone ? null : ({ id: "s5", probabilityLevels: 5, impactLevels: 5 } as never); } };
  const list = vi.fn(async () => { calls.legacyList++; return (opts.legacyAppetites ?? []) as never; });
  const wired = opts.wired !== false;
  const s = new DashboardService(
    {} as never, {} as never, {} as never, {} as never, {} as never, {} as never, { list } as never, {} as never, {} as never,
    {} as never, {} as never, {} as never, {} as never,
    processes as never, undefined, opts.withScales === false ? undefined : (ratingScales as never), wired ? (frameworks as never) : undefined,
  );
  vi.spyOn(s as never, "getScoredRisks").mockResolvedValue(scored as never);
  return { s, calls, list };
}
const sr = (id: string, processId: string | null, subCategory: string, entity: string | null, score: number) =>
  ({ risk: { id, processId }, evaluation: { subCategory, entity }, score });
const EXEC: Permission[] = ["dashboard.executive"];

describe("QA-B6bF appetite-vs-residual on the Dispositif (F-B6b-01)", () => {
  const base = (): World => ({
    defaults: { [T1]: "fw1" }, processFw: {}, processes: {},
    active: { [`${T1}:fw1`]: version("v1", "fw1", [["Fraude", null, 9]]) },
  });

  it("risk with no process -> default Dispositif; a threshold-only row for an appetite without risk is also listed", async () => {
    const w = base();
    w.active[`${T1}:fw1`] = version("v1", "fw1", [["Fraude", null, 9], ["Conformité", "CI", 4]]);
    const { s } = dashboard(w, [sr("r1", null, "Fraude", null, 10)]);
    const rows = await s.getAppetiteVsResidual(actor(EXEC));
    expect(rows).toHaveLength(2);
    expect(rows.find((r) => r.subCategory === "Fraude")).toMatchObject({ threshold: 9, maxResidualScore: 10, exceeded: true, exceedanceCount: 1, frameworkVersionId: "v1", riskIds: ["r1"] });
    expect(rows.find((r) => r.subCategory === "Conformité")).toMatchObject({ threshold: 4, maxResidualScore: null, exceeded: false, exceedanceCount: 0, frameworkVersionId: "v1", riskIds: [] });
  });

  it("score == threshold is not an exceedance (strict >); entity null and '' are the same key", async () => {
    const { s } = dashboard(base(), [sr("r1", null, "Fraude", "", 9), sr("r2", null, "Fraude", null, 9)]);
    const rows = await s.getAppetiteVsResidual(actor(EXEC));
    const fraude = rows.filter((r) => r.subCategory === "Fraude");
    expect(fraude.every((r) => r.threshold === 9 && r.exceeded === false && r.exceedanceCount === 0)).toBe(true);
  });

  it("no Dispositif at all for the tenant: no throw, no fallback to risk_appetites, risks listed with threshold null / frameworkVersionId null", async () => {
    const w: World = { defaults: {}, processFw: {}, processes: {}, active: {} };
    const { s, list } = dashboard(w, [sr("r1", null, "Fraude", null, 25)], { legacyAppetites: [{ subCategory: "Fraude", entity: null, threshold: 1 }] });
    const rows = await s.getAppetiteVsResidual(actor(EXEC));
    expect(rows).toEqual([expect.objectContaining({ subCategory: "Fraude", threshold: null, exceeded: false, exceedanceCount: 0, maxResidualScore: 25, frameworkVersionId: null })]);
    expect(list).not.toHaveBeenCalled();
  });

  it("Dispositif without ACTIVE version, or whose scale is gone: same degraded answer (not an error)", async () => {
    const noActive = base(); noActive.active = {};
    const a = await dashboard(noActive, [sr("r1", null, "Fraude", null, 25)]).s.getAppetiteVsResidual(actor(EXEC));
    expect(a).toEqual([expect.objectContaining({ threshold: null, exceeded: false, frameworkVersionId: null })]);
    const gone = base(); gone.scaleGone = true;
    const b = await dashboard(gone, [sr("r1", null, "Fraude", null, 25)]).s.getAppetiteVsResidual(actor(EXEC));
    expect(b).toEqual([expect.objectContaining({ threshold: null, exceeded: false, frameworkVersionId: null })]);
  });

  it("a sub-category absent from the version: threshold null and exceeded=false (OBSERVATION QA-B6bF-04: an unmonitored risk looks compliant)", async () => {
    const { s } = dashboard(base(), [sr("r1", null, "Cyber", null, 25)]);
    const rows = await s.getAppetiteVsResidual(actor(EXEC));
    expect(rows.find((r) => r.subCategory === "Cyber")).toMatchObject({ threshold: null, exceeded: false, maxResidualScore: 25, frameworkVersionId: "v1" });
  });

  it("risks of two processes attached to two Dispositifs: one row per version for the same (subCategory, entity), each with its own threshold", async () => {
    const w = base();
    w.processes = { p1: { id: "p1", level: "PROCESS", parentId: null }, c1: { id: "c1", level: "SOUS_PROCESSUS", parentId: "p1" } };
    w.processFw[`${T1}:p1`] = "fw2";
    w.active[`${T1}:fw2`] = version("v2", "fw2", [["Fraude", null, 20]]);
    const { s, calls } = dashboard(w, [sr("r1", "c1", "Fraude", null, 15), sr("r2", null, "Fraude", null, 15), sr("r3", "c1", "Fraude", null, 21)]);
    const rows = (await s.getAppetiteVsResidual(actor(EXEC))).filter((r) => r.subCategory === "Fraude");
    expect(rows).toHaveLength(2);
    expect(rows.find((r) => r.frameworkVersionId === "v2")).toMatchObject({ threshold: 20, maxResidualScore: 21, exceedanceCount: 1, riskIds: ["r1", "r3"] });
    expect(rows.find((r) => r.frameworkVersionId === "v1")).toMatchObject({ threshold: 9, maxResidualScore: 15, exceedanceCount: 1, riskIds: ["r2"] });
    // resolution is cached per process: 2 risks on c1 resolve once (+ default once)
    expect(calls.getActiveVersion.filter((c) => c === `${T1}:fw2`)).toHaveLength(1);
  });

  it("unknown / dangling process id falls back to the tenant default, never throws", async () => {
    const { s } = dashboard(base(), [sr("r1", "ghost", "Fraude", null, 10)]);
    expect((await s.getAppetiteVsResidual(actor(EXEC)))[0]).toMatchObject({ threshold: 9, frameworkVersionId: "v1" });
  });

  it("tenant isolation: every repository lookup uses actor.tenantId; another tenant sees none of T1's thresholds", async () => {
    const w = base();
    const { s, calls } = dashboard(w, [sr("r1", null, "Fraude", null, 10)]);
    const rows = await s.getAppetiteVsResidual(actor(EXEC, T2));
    expect(rows).toEqual([expect.objectContaining({ threshold: null, frameworkVersionId: null })]);
    expect(calls.getDefaultFramework.every((t) => t === T2)).toBe(true);
    expect(calls.getActiveVersion).toEqual([]);
  });

  it("permission is checked before any lookup", async () => {
    const { s, calls, list } = dashboard(base(), []);
    await expect(s.getAppetiteVsResidual(actor(["dashboard.read"]))).rejects.toThrow(ForbiddenError);
    expect(calls.getDefaultFramework).toEqual([]);
    expect(list).not.toHaveBeenCalled();
  });

  it("Dispositif NOT wired: legacy read of risk_appetites, response rows carry no frameworkVersionId key (API contract unchanged)", async () => {
    const { s, list } = dashboard(base(), [sr("r1", null, "Fraude", null, 10)], { wired: false, legacyAppetites: [{ subCategory: "Fraude", entity: null, threshold: 8 }] });
    const rows = await s.getAppetiteVsResidual(actor(EXEC));
    expect(list).toHaveBeenCalledTimes(1);
    expect(rows).toEqual([{ subCategory: "Fraude", entity: null, threshold: 8, maxResidualScore: 10, exceedanceCount: 1, exceeded: true, riskIds: ["r1"] }]);
    expect("frameworkVersionId" in rows[0]!).toBe(false);
  });

  it("Dispositif wired without rating scales: explicit configuration Error (not a silent legacy read)", async () => {
    const { s, list } = dashboard(base(), [sr("r1", null, "Fraude", null, 10)], { withScales: false });
    await expect(s.getAppetiteVsResidual(actor(EXEC))).rejects.toThrow(/RatingScaleRepository is not configured/);
    expect(list).not.toHaveBeenCalled();
  });

  it("no risk at all: still lists the default version's thresholds (threshold-only rows)", async () => {
    const { s } = dashboard(base(), []);
    expect(await s.getAppetiteVsResidual(actor(EXEC))).toEqual([expect.objectContaining({ subCategory: "Fraude", threshold: 9, maxResidualScore: null, riskIds: [] })]);
  });
});

describe("QA-B6bF RatingScaleService.activateVersion closed (B-6b-01): order of refusals", () => {
  function svc(wired: boolean) {
    const audit = { record: vi.fn(async () => {}) };
    const repo = {
      getById: vi.fn(async () => null), list: vi.fn(async () => []), activateAndArchivePrevious: vi.fn(async () => ({}) as never),
    };
    const riskEvals = { listForRisk: vi.fn() };
    const s = new RatingScaleService(repo as never, audit as never, riskEvals as never, undefined, undefined, wired ? ({ async listFrameworks() { return []; } } as never) : undefined);
    return { s, audit, repo };
  }
  it("without ratingscale.delete: Forbidden (permission first), even when the Dispositif is wired; nothing read, nothing audited", async () => {
    const { s, audit, repo } = svc(true);
    for (const perms of [[], ["ratingscale.update"], ["ratingscale.read", "ratingscale.update", "riskframework.update"]] as Permission[][]) {
      await expect(s.activateVersion(actor(perms), "id", "rq")).rejects.toThrow(ForbiddenError);
    }
    expect(repo.getById).not.toHaveBeenCalled();
    expect(audit.record).not.toHaveBeenCalled();
  });
  it("with ratingscale.delete and the Dispositif wired: ValidationError; no lookup (no existence oracle for any id), no audit, no activation", async () => {
    const { s, audit, repo } = svc(true);
    for (const id of ["missing", "also-missing", "00000000-0000-4000-8000-000000000000"]) {
      await expect(s.activateVersion(actor(["ratingscale.delete", "ratingscale.read"]), id, "rq")).rejects.toThrow(ValidationError);
    }
    expect(repo.getById).not.toHaveBeenCalled();
    expect(repo.activateAndArchivePrevious).not.toHaveBeenCalled();
    expect(audit.record).not.toHaveBeenCalled();
  });
  it("not wired: unchanged path (unknown id -> NotFound after a tenant-scoped lookup)", async () => {
    const { s, repo } = svc(false);
    await expect(s.activateVersion(actor(["ratingscale.delete", "ratingscale.read"]), "x", "rq")).rejects.toThrow(NotFoundError);
    expect(repo.getById).toHaveBeenCalledWith(T1, "x");
  });
  it("the only call site of activateAndArchivePrevious outside infrastructure is activateVersion (no second route to ACTIVE)", () => {
    const hits = grepSrc(/activateAndArchivePrevious\(/g).filter((f) => !f.file.startsWith("infrastructure/") && !f.file.startsWith("domain/"));
    expect(hits.map((h) => h.file)).toEqual(["services/RatingScaleService.ts"]);
  });
});

describe("QA-B6bF 42501 -> ValidationError in PostgresRiskEvaluationRepository.recordInherentScoring (mocked pool)", () => {
  const input = { ratingScaleId: "s2", ratingScaleVersion: "1", probability: 2, impacts: [], impactRetained: 3, score: 6 };
  const repoWith = (query: (...a: unknown[]) => Promise<{ rows: unknown[] }>) => new PostgresRiskEvaluationRepository({ query } as never);

  it("SQLSTATE 42501 from the guard trigger becomes a ValidationError (400), not a 500", async () => {
    const r = repoWith(async () => { throw Object.assign(new Error("risk_evaluations: the framework snapshot is frozen once set"), { code: "42501" }); });
    await expect(r.recordInherentScoring(T1, "e1", input)).rejects.toThrow(ValidationError);
    await expect(r.recordInherentScoring(T1, "e1", input)).rejects.toThrow(/frozen/);
  });
  it("any other error is rethrown untouched (same object)", async () => {
    const boom = Object.assign(new Error("deadlock"), { code: "40P01" });
    await expect(repoWith(async () => { throw boom; }).recordInherentScoring(T1, "e1", input)).rejects.toBe(boom);
    const plain = new Error("connection reset");
    await expect(repoWith(async () => { throw plain; }).recordInherentScoring(T1, "e1", input)).rejects.toBe(plain);
  });
  it("no row -> NotFoundError (unchanged); the UPDATE stays tenant-scoped", async () => {
    const q = vi.fn(async () => ({ rows: [] }));
    await expect(repoWith(q).recordInherentScoring(T2, "e1", input)).rejects.toThrow(NotFoundError);
    expect((q.mock.calls[0] as unknown[])[1]).toEqual(expect.arrayContaining([T2, "e1"]));
    expect(String((q.mock.calls[0] as unknown[])[0])).toMatch(/WHERE tenant_id = \$1 AND id = \$2/);
  });
  it("QA-B6bF-02 fixed: a genuine privilege error (also 42501, 'permission denied for table') is rethrown as is, not mapped to 'frozen'", async () => {
    const boom = Object.assign(new Error("permission denied for table risk_evaluations"), { code: "42501" });
    const r = repoWith(async () => { throw boom; });
    await expect(r.recordInherentScoring(T1, "e1", input)).rejects.toBe(boom);
  });
});

describe("QA-B6bF reducedMasteryIndependence on the read paths (B-6b-05)", () => {
  const FR = version("v1", "fw1", [], { masteryAuthoritativeSource: "FIRST_LINE", status: "DRAFT" });
  const RT = version("v2", "fw1", [], { masteryAuthoritativeSource: "RISK_TEAM" });
  const repo = {
    async getDefaultFramework() { return { id: "fw1" } as never; },
    async getProcessFrameworkId() { return null; },
    async getActiveVersion() { return FR; },
    async listFrameworks() { return [{ id: "fw1", tenantId: T1, name: "D" }] as never; },
    async listVersions() { return [FR, RT]; },
    async getVersion(_t: string, _f: string, id: string) { return id === "v1" ? FR : id === "v2" ? RT : null; },
    async getFramework() { return { id: "fw1", name: "D" } as never; },
  };
  const scales = { async getById() { return { id: "s5" } as never; }, async list() { return [] as never; } };
  const s = new RiskFrameworkService(repo as never, scales as never, {} as never, {} as never, {} as never);
  const reader = actor(["riskframework.read", "risk.read"]);

  it("list (activeVersion), get (versions[]), getVersion and getApplicable all carry the mark, true only for FIRST_LINE", async () => {
    expect((await s.list(reader))[0]!.activeVersion?.reducedMasteryIndependence).toBe(true);
    expect((await s.get(reader, "fw1")).versions.map((v) => [v.id, v.reducedMasteryIndependence])).toEqual([["v1", true], ["v2", false]]);
    expect((await s.getVersion(reader, "fw1", "v1")).reducedMasteryIndependence).toBe(true);
    expect((await s.getVersion(reader, "fw1", "v2")).reducedMasteryIndependence).toBe(false);
    expect((await s.getApplicable(reader, {}))?.version.reducedMasteryIndependence).toBe(true);
  });
  it("the mark is derived, never accepted: a stored/forged property cannot flip it", async () => {
    const forged = { ...RT, reducedMasteryIndependence: true } as RiskFrameworkVersion;
    const s2 = new RiskFrameworkService({ ...repo, async getVersion() { return forged; } } as never, scales as never, {} as never, {} as never, {} as never);
    expect((await s2.getVersion(reader, "fw1", "v2")).reducedMasteryIndependence).toBe(false);
  });
  it("OBSERVATION QA-B6bF-03: draft write responses (createDraft/updateDraft/discardDraft) return the raw version WITHOUT the mark", () => {
    const src = readFileSync(join(SRC, "services/RiskFrameworkService.ts"), "utf8");
    const uses = (src.match(/withMasteryIndependence\(|reducedMasteryIndependence/g) ?? []).length;
    // 4 read paths use it; the three draft writers do not. If this count grows, the observation is (partly) fixed: update it.
    expect(uses).toBeGreaterThanOrEqual(4);
    for (const m of ["createDraft", "updateDraft", "discardDraft"]) {
      const body = src.slice(src.indexOf(`async ${m}(`), src.indexOf(`async ${m}(`) + 2500);
      expect(body.slice(0, body.indexOf("\n  }\n"))).not.toMatch(/withMasteryIndependence/);
    }
  });
});

describe("QA-B6bF /applicable?riskId= requires risk.read (F-B6b-03)", () => {
  const fw = {
    async getDefaultFramework() { return { id: "fw1" } as never; }, async getProcessFrameworkId() { return null; },
    async getActiveVersion() { return version("v1", "fw1", []); },
  };
  const scales = { async getById() { return { id: "s5" } as never; } };
  const getById = vi.fn(async (_t: string, id: string) => (id === "r1" ? ({ id: "r1", processId: null } as never) : null));
  const s = new RiskFrameworkService(fw as never, scales as never, {} as never, {} as never, {} as never, undefined, undefined, { getById } as never);

  it("missing risk.read -> 403 BEFORE the risk lookup, for existing and non-existing ids alike (no existence oracle)", async () => {
    for (const id of ["r1", "nope"]) await expect(s.getApplicable(actor(["riskframework.read"]), { riskId: id })).rejects.toThrow(ForbiddenError);
    expect(getById).not.toHaveBeenCalled();
  });
  it("riskframework.read is still required first; risk.read alone is not enough", async () => {
    await expect(s.getApplicable(actor(["risk.read"]), { riskId: "r1" })).rejects.toThrow(ForbiddenError);
  });
  it("with both: existing -> result, unknown -> NotFound (tenant-scoped lookup)", async () => {
    const a = actor(["riskframework.read", "risk.read"], T2);
    await expect(s.getApplicable(a, { riskId: "nope" })).rejects.toThrow(NotFoundError);
    expect(getById).toHaveBeenLastCalledWith(T2, "nope");
  });
  it("the processId / default branches do NOT need risk.read (unchanged contract)", async () => {
    await expect(s.getApplicable(actor(["riskframework.read"]), {})).resolves.toBeTruthy();
  });
});

// -------------------------------------------------------------------------------------------------
// Inventory test hardening: B6bFollowups.test.ts matches by FIELD NAME. A reader injected under another
// name (scales, appetiteRepo, configRepository...) escapes it (mutation-checked, QA-B6bF-01).
// -------------------------------------------------------------------------------------------------
const SRC = join(__dirname, "..", "src");
function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((f) => {
    const p = join(dir, f);
    return statSync(p).isDirectory() ? walk(p) : p.endsWith(".ts") ? [p] : [];
  });
}
function grepSrc(re: RegExp): Array<{ file: string; n: number }> {
  return walk(SRC).map((f) => ({ file: relative(SRC, f), n: (readFileSync(f, "utf8").match(re) ?? []).length })).filter((x) => x.n > 0);
}

describe("QA-B6bF the legacy-reader inventory cannot be dodged by renaming the injected field", () => {
  // Canonical field names the inventory patterns of B6bFollowups.test.ts look for.
  const CANONICAL: Record<string, string[]> = {
    RatingScaleRepository: ["ratingScales"],
    ConfigRepository: ["configs"],
    RiskAppetiteRepository: ["riskAppetites", "appetites"],
  };
  it("every constructor-injected RatingScale/Config/RiskAppetite repository (also via Pick<>) outside infrastructure uses a canonical field name", () => {
    const bad: string[] = [];
    for (const f of walk(SRC)) {
      const rel = relative(SRC, f);
      if (rel.startsWith("infrastructure/") || rel.startsWith("domain/repositories/")) continue;
      const text = readFileSync(f, "utf8");
      for (const [type, names] of Object.entries(CANONICAL)) {
        const re = new RegExp(`(?:private|protected|public)?\\s*readonly\\s+(\\w+)\\??\\s*:\\s*(?:Pick<\\s*)?${type}\\b`, "g");
        for (const m of text.matchAll(re)) if (!names.includes(m[1]!)) bad.push(`${rel}: ${m[1]}: ${type}`);
      }
    }
    expect(bad, "rename the field to the canonical name or extend the inventory patterns").toEqual([]);
  });
});
