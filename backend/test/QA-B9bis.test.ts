import { describe, expect, it, vi } from "vitest";
import express from "express";
import type { Server } from "node:http";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { RatingScaleService } from "../src/services/RatingScaleService.js";
import { RiskAppetiteService } from "../src/services/RiskAppetiteService.js";
import { ConfigService } from "../src/services/ConfigService.js";
import { RiskEvaluationService } from "../src/services/RiskEvaluationService.js";
import { CartographyService } from "../src/services/CartographyService.js";
import { DashboardService } from "../src/services/DashboardService.js";
import { configRouter } from "../src/api/v1/config.routes.js";
import { errorHandler } from "../src/api/middleware/errorHandler.js";
import { defaultCriticalityBands, maxScoreForSize } from "../src/domain/scoring.js";
import { ValidationError, NotFoundError } from "../src/domain/errors/DomainErrors.js";
import type { RatingScale, ScaleLevel, ImpactAxis } from "../src/domain/entities/RatingScale.js";
import type { RiskEvaluation } from "../src/domain/entities/RiskEvaluation.js";
import type { Risk } from "../src/domain/entities/Risk.js";
import type { AuthenticatedUser } from "../src/infrastructure/identity/IdentityProvider.js";

// QA-B9bis (level 2) for commit 300ff8f: score ceiling n^2, default bands by scale size,
// descriptors mandatory to activate, migration 052.
// Oracle fixed from DECISION-040 section 8/9 (q49/q50), not from observed behavior.
// A PASS is a QA verdict only: no Security / Privacy / Compliance / Risk approval is implied.
// it.fails = KNOWN GAP pinned (remove `.fails` when fixed).

const T1 = "tenant-1";
const T2 = "tenant-2";
const lv = (n: number): ScaleLevel[] => Array.from({ length: n }, (_, i) => ({ level: i + 1, label: `N${i + 1}` }));
const axis = (i: number, labels?: ScaleLevel[]): ImpactAxis => ({ code: `A${i}`, label: `Axe ${i}`, order: i, ...(labels ? { levelLabels: labels } : {}) });
const SIZES = [3, 4, 5, 6] as const;

function scale(n: number, o: Partial<RatingScale> = {}): RatingScale {
  return {
    id: "s1", tenantId: T1, name: "N", version: "v", status: "ACTIVE",
    probabilityLevels: n, probabilityLabels: lv(n), impactLevels: n, impactLabels: lv(n),
    criticalityThresholds: null, impactAxes: null, velocityLevels: null, persistenceLevels: null, masteryScale: null,
    activatedAt: null, archivedAt: null, createdAt: new Date(), updatedAt: new Date(),
    deletedAt: null, deletedBy: null, deletionReason: null,
    ...o,
  };
}

/** Faithful double: returns EVERY non-deleted scale of the tenant (any status), records calls. Labels are NOT defaulted (unlike A06's edited doubles). */
function repo(initial: RatingScale[]) {
  const store = new Map(initial.map((s) => [s.id, s]));
  const calls = { list: [] as Array<[string, unknown]>, activate: 0, updateThresholds: 0 };
  const own = (t: string, id: string) => {
    const s = store.get(id);
    if (!s || s.tenantId !== t || s.deletedAt) throw new NotFoundError("RatingScale", id);
    return s;
  };
  const put = (s: RatingScale) => (store.set(s.id, s), s);
  const r = {
    calls, store,
    async list(t: string, o?: unknown) { calls.list.push([t, o]); return [...store.values()].filter((s) => s.tenantId === t && !s.deletedAt); },
    async getById(t: string, id: string) { const s = store.get(id); return s && s.tenantId === t && !s.deletedAt ? s : null; },
    async create(i: { tenantId: string; name: string; version: string; probabilityLevels: number; probabilityLabels?: ScaleLevel[] | null; impactLevels: number; impactLabels?: ScaleLevel[] | null }) {
      return put(scale(i.impactLevels, { id: randomUUID(), tenantId: i.tenantId, status: "DRAFT", name: i.name, version: i.version, probabilityLevels: i.probabilityLevels, probabilityLabels: i.probabilityLabels ?? null, impactLabels: i.impactLabels ?? null }));
    },
    async updateThresholds(t: string, id: string, v: never) { calls.updateThresholds++; return put({ ...own(t, id), criticalityThresholds: v }); },
    async updateImpactAxes(t: string, id: string, v: never) { return put({ ...own(t, id), impactAxes: v }); },
    async activateAndArchivePrevious(t: string, id: string) {
      calls.activate++;
      const target = own(t, id);
      for (const o of store.values()) if (o.tenantId === t && o.status === "ACTIVE" && o.id !== id) put({ ...o, status: "ARCHIVED" });
      return put({ ...target, status: "ACTIVE" });
    },
  };
  return r;
}

function auditSpy() {
  const events: Array<{ action: string; entityType: string }> = [];
  return { events, async record(e: never) { events.push(e); }, async listForEntity() { return []; }, async listRecent() { return []; } };
}

const actor: AuthenticatedUser = {
  userId: "u1", tenantId: T1, email: "a@x", displayName: "A",
  roles: ["riskappetite.read", "riskappetite.update", "ratingscale.read", "ratingscale.create", "ratingscale.update", "ratingscale.delete", "config.read", "config.committeethreshold.set"],
};
const noRef = { async existsForRatingScale() { return false; } };
const rsService = (r: ReturnType<typeof repo>, a = auditSpy()) => ({ svc: new RatingScaleService(r as never, a as never, noRef), audit: a });

// ===================================================================== A. helpers

describe("A. scoring helpers (exact oracle: floor(n^2 * k / 25) for k = 4, 9, 15)", () => {
  it.each([
    [3, [[1, 1], [2, 3], [4, 5], [6, 9]]],
    [4, [[1, 2], [3, 5], [6, 9], [10, 16]]],
    [5, [[1, 4], [5, 9], [10, 15], [16, 25]]],
    [6, [[1, 5], [6, 12], [13, 21], [22, 36]]],
  ])("n=%i default bands %j", (n, expected) => {
    expect(defaultCriticalityBands(n).map((b) => [b.min, b.max])).toEqual(expected);
    expect(defaultCriticalityBands(n).map((b) => b.label)).toEqual(["Faible", "Modéré", "Élevé", "Critique"]);
  });

  it.each(SIZES)("n=%i: every score 1..n² falls in exactly one band, n²+1 and 0 in none", (n) => {
    const bands = defaultCriticalityBands(n);
    for (let s = 1; s <= n * n; s++) expect(bands.filter((b) => s >= b.min && s <= b.max)).toHaveLength(1);
    expect(bands.some((b) => n * n + 1 >= b.min && n * n + 1 <= b.max)).toBe(false);
    expect(bands.some((b) => 0 >= b.min && 0 <= b.max)).toBe(false);
  });

  it("bands are fresh objects (mutating a returned array cannot corrupt the next call)", () => {
    const a = defaultCriticalityBands(5);
    a[0]!.max = 99;
    expect(defaultCriticalityBands(5)[0]!.max).toBe(4);
  });

  it("maxScoreForSize is n*n", () => {
    expect(SIZES.map(maxScoreForSize)).toEqual([9, 16, 25, 36]);
  });
});

// ===================================================================== B. appetite ceiling

describe("B. RiskAppetiteService ceiling = n² of the ACTIVE scale", () => {
  const input = (threshold: number) => ({ threshold, methodologyVersion: "v1" });
  const mk = (scales: RatingScale[] | undefined) => {
    const upsert = vi.fn(async (i: never) => i);
    const a = auditSpy();
    const r = scales ? repo(scales) : undefined;
    const svc = new RiskAppetiteService({ getBySubCategory: async () => null, upsert } as never, a as never, undefined, r as never);
    return { svc, upsert, audit: a, r };
  };

  it.each(SIZES)("n=%i: n² accepted, n²+1 refused with the ceiling in the message, 0 refused; refusal has no side effect", async (n) => {
    const { svc, upsert, audit } = mk([scale(n)]);
    await expect(svc.setThreshold(actor, "Fraude", input(n * n), "r")).resolves.toBeTruthy();
    const before = { u: upsert.mock.calls.length, a: audit.events.length };
    await expect(svc.setThreshold(actor, "Fraude", input(n * n + 1), "r")).rejects.toThrow(new RegExp(`between 1 and ${n * n}$`));
    await expect(svc.setThreshold(actor, "Fraude", input(0), "r")).rejects.toThrow(ValidationError);
    await expect(svc.setThreshold(actor, "Fraude", input(1.5), "r")).rejects.toThrow(ValidationError);
    await expect(svc.setThreshold(actor, "Fraude", input(Number.NaN), "r")).rejects.toThrow(ValidationError);
    expect({ u: upsert.mock.calls.length, a: audit.events.length }).toEqual(before);
  });

  it("fallback 5x5 (25/26) when no scale repository, when no scale exists, and when only DRAFT/ARCHIVED scales exist", async () => {
    for (const scales of [undefined, [], [scale(6, { status: "DRAFT" }), scale(6, { id: "s2", status: "ARCHIVED" })]]) {
      const { svc } = mk(scales);
      await expect(svc.setThreshold(actor, "Fraude", input(25), "r")).resolves.toBeTruthy();
      await expect(svc.setThreshold(actor, "Fraude", input(26), "r")).rejects.toThrow(/between 1 and 25/);
    }
  });

  it("a DRAFT 6x6 next to an ACTIVE 3x3 does not raise the ceiling (9, not 36)", async () => {
    const { svc } = mk([scale(6, { id: "d", status: "DRAFT" }), scale(3, { id: "a" })]);
    await expect(svc.setThreshold(actor, "Fraude", input(10), "r")).rejects.toThrow(/between 1 and 9/);
  });

  it("the scale lookup is tenant-scoped (never another tenant's ACTIVE 6x6)", async () => {
    const { svc, r } = mk([scale(6, { tenantId: T2 })]);
    await expect(svc.setThreshold(actor, "Fraude", input(26), "r")).rejects.toThrow(/between 1 and 25/);
    expect(r!.calls.list.map((c) => c[0])).toEqual([T1]);
  });

  it("lowering the ceiling does NOT revalidate a stored threshold (observation, A06 leftover): a 30 stored under 6x6 is still returned under a later 3x3", async () => {
    const stored = { id: "x", tenantId: T1, subCategory: "Fraude", threshold: 30, active: true, methodologyVersion: "v1" };
    const svc = new RiskAppetiteService({ getBySubCategory: async () => stored } as never, auditSpy() as never, undefined, repo([scale(3)]) as never);
    const got = await svc.getApplicable(actor, "Fraude", null);
    expect(got?.threshold).toBe(30);
  });

  it("route schema ceiling: 36 passes the HTTP schema, 37 -> 400 before the service", async () => {
    const { riskAppetiteRouter } = (await import("../src/api/v1/riskAppetite.routes.js")) as { riskAppetiteRouter: (s: unknown) => express.Router };
    const svc = { setThreshold: vi.fn().mockResolvedValue({ id: "x" }) };
    const url = await startApp((app) => app.use("/ra", riskAppetiteRouter(svc)));
    const put = async (threshold: number) => (await fetch(`${url}/ra/Fraude`, { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ threshold, methodologyVersion: "v1" }) })).status;
    expect([await put(36), await put(37), await put(0)]).toEqual([200, 400, 400]);
    expect(svc.setThreshold).toHaveBeenCalledTimes(1);
    await stopApp();
  });
});

// ===================================================================== C. committee thresholds

describe("C. ConfigService committee thresholds ceiling = n²", () => {
  const mk = (scales: RatingScale[] | undefined) => {
    const upsert = vi.fn(async (_t: string, p: object) => ({ id: "c1", version: 1, ...p }));
    const a = auditSpy();
    const svc = new ConfigService({ getByTenant: async () => null, upsert } as never, a as never, scales ? (repo(scales) as never) : undefined);
    return { svc, upsert, audit: a };
  };

  it.each(SIZES)("n=%i: evaluationMinScore and treatmentMinScore accept n², refuse n²+1 and 0; null clears treatment", async (n) => {
    const { svc, upsert, audit } = mk([scale(n)]);
    await expect(svc.updateCommitteeThresholds(actor, { evaluationMinScore: n * n, treatmentMinScore: n * n }, "why", "r")).resolves.toBeTruthy();
    await expect(svc.updateCommitteeThresholds(actor, { treatmentMinScore: null }, "why", "r")).resolves.toBeTruthy();
    const calls = upsert.mock.calls.length;
    const events = audit.events.length;
    await expect(svc.updateCommitteeThresholds(actor, { evaluationMinScore: n * n + 1 }, "why", "r")).rejects.toThrow(new RegExp(`between 1 and ${n * n}$`));
    await expect(svc.updateCommitteeThresholds(actor, { treatmentMinScore: n * n + 1 }, "why", "r")).rejects.toThrow(ValidationError);
    await expect(svc.updateCommitteeThresholds(actor, { evaluationMinScore: 0 }, "why", "r")).rejects.toThrow(ValidationError);
    await expect(svc.updateCommitteeThresholds(actor, { treatmentMinScore: 0 }, "why", "r")).rejects.toThrow(ValidationError);
    await expect(svc.updateCommitteeThresholds(actor, { evaluationMinScore: 2.5 }, "why", "r")).rejects.toThrow(ValidationError);
    expect(upsert.mock.calls.length).toBe(calls);
    expect(audit.events.length).toBe(events);
  });

  it("fallback 25 without a repository, and with only a DRAFT 6x6", async () => {
    for (const scales of [undefined, [scale(6, { status: "DRAFT" })]]) {
      const { svc } = mk(scales);
      await expect(svc.updateCommitteeThresholds(actor, { evaluationMinScore: 25 }, "why", "r")).resolves.toBeTruthy();
      await expect(svc.updateCommitteeThresholds(actor, { evaluationMinScore: 26 }, "why", "r")).rejects.toThrow(ValidationError);
    }
  });

  it("blank reason is still refused first (ceiling lookup does not weaken the reason rule)", async () => {
    const { svc, upsert } = mk([scale(6)]);
    await expect(svc.updateCommitteeThresholds(actor, { evaluationMinScore: 30 }, "  ", "r")).rejects.toThrow(/reason/);
    expect(upsert).not.toHaveBeenCalled();
  });

  it("route end to end: 30 -> 400 on 5x5, 200 on 6x6 (real service)", async () => {
    for (const [n, status] of [[5, 400], [6, 200]] as const) {
      const { svc } = mk([scale(n)]);
      const url = await startApp((app) => {
        app.use((req, _res, next) => ((req as unknown as { user: unknown; requestId: string }).user = actor, (req as unknown as { requestId: string }).requestId = "rq", next()));
        app.use("/config", configRouter(svc));
      });
      const res = await fetch(`${url}/config/committee-thresholds`, { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ evaluationMinScore: 30, reason: "why" }) });
      expect(res.status).toBe(status);
      await stopApp();
    }
  });
});

// ===================================================================== D. evaluation (override, committee)

describe("D. RiskEvaluationService: appetiteOverride ceiling, suggested threshold, committee bypass", () => {
  const evaluator: AuthenticatedUser = { userId: "ev", tenantId: T1, email: "e@x", displayName: "E", roles: ["riskevaluation.read", "riskevaluation.create", "riskevaluation.update"] };
  const validator: AuthenticatedUser = { userId: "val", tenantId: T1, email: "v@x", displayName: "V", roles: ["riskevaluation.read", "riskevaluation.validate"] };
  const imp = (...v: number[]) => v.map((value, i) => ({ code: `A${i + 1}`, value }));

  async function build(n: number, opts: { suggested?: number } = {}) {
    const scales = repo([scale(n, { impactAxes: { axes: [axis(1, lv(n)), axis(2, lv(n)), axis(3, lv(n))], retainedImpactRule: "MAX" } })]);
    const evals = new Map<string, RiskEvaluation>();
    const evalRepo = {
      async create(i: Record<string, unknown>) { const e = { id: randomUUID(), status: "BROUILLON", ...i } as unknown as RiskEvaluation; evals.set(e.id, e); return e; },
      async getById(t: string, id: string) { const e = evals.get(id); return e && e.tenantId === t ? e : null; },
      async recordInherentScoring(_t: string, id: string, i: { ratingScaleId: string; probability: number; impactRetained: number; score: number }) {
        const e = { ...evals.get(id)!, ratingScaleId: i.ratingScaleId, inherentScore: i.score } as unknown as RiskEvaluation; evals.set(id, e); return e;
      },
      async recordResidualScoring(_t: string, id: string, i: { score: number; appetiteThresholdApplied: number | null; appetiteThresholdSuggested: number | null }) {
        const e = { ...evals.get(id)!, residualScore: i.score, appetiteThresholdApplied: i.appetiteThresholdApplied, appetiteThresholdSuggested: i.appetiteThresholdSuggested } as unknown as RiskEvaluation; evals.set(id, e); return e;
      },
      async recordValidation(_t: string, id: string) { const e = { ...evals.get(id)!, status: "VALIDATED" } as unknown as RiskEvaluation; evals.set(id, e); return e; },
    };
    const risks = { async getById(t: string, id: string) { return t === T1 && id === "risk-1" ? { id, tenantId: t, processId: null } : null; } };
    const appetites = opts.suggested === undefined ? undefined : { async getBySubCategory() { return { threshold: opts.suggested, active: true }; } };
    const svc = new RiskEvaluationService(evalRepo as never, auditSpy() as never, risks as never, scales as never, appetites as never);
    const ev = await svc.create(evaluator, { riskId: "risk-1", evaluationType: "AD_HOC", subCategory: "Fraude" }, "r");
    await svc.recordInherentScoring(evaluator, ev.id, { probability: n, impacts: imp(n, n, n) }, "r");
    return { svc, ev };
  }
  const residual = (svc: RiskEvaluationService, id: string, n: number, extra: object = {}) =>
    svc.recordResidualScoring(evaluator, id, { probability: n, impacts: imp(n, n, n), justification: "j", ...extra } as never, "r");

  it.each(SIZES)("n=%i: appetiteOverride n² accepted, n²+1 / 0 / 1.5 refused", async (n) => {
    const { svc, ev } = await build(n);
    await expect(residual(svc, ev.id, n, { appetiteOverride: n * n })).resolves.toMatchObject({ appetiteThresholdApplied: n * n });
    await expect(residual(svc, ev.id, n, { appetiteOverride: n * n + 1 })).rejects.toThrow(ValidationError);
    await expect(residual(svc, ev.id, n, { appetiteOverride: 0 })).rejects.toThrow(ValidationError);
    await expect(residual(svc, ev.id, n, { appetiteOverride: 1.5 })).rejects.toThrow(ValidationError);
  });

  it("override ceiling follows the scale CAPTURED by the evaluation, not the currently active one (observation: differs from appetite/committee which use the ACTIVE scale)", async () => {
    const { svc, ev } = await build(6);
    await expect(residual(svc, ev.id, 6, { appetiteOverride: 36 })).resolves.toBeTruthy();
  });

  it("a stored suggested appetite above n² is applied as-is (no revalidation, observation)", async () => {
    const { svc, ev } = await build(5, { suggested: 30 });
    const out = await residual(svc, ev.id, 5);
    expect(out.appetiteThresholdApplied).toBe(30);
    expect(out.residualScore).toBe(25);
  });

  // KNOWN GAP (MAJOR, A06 leftover "défaut Comité figé à 15"): the committee default (15) is not scaled to the scale size.
  // Oracle (q49 "seuils s'alignent"; E-1 gap): with enforcement on (default), a maximal residual score (the Critique band top) must go through the committee.
  it.fails("KNOWN GAP (MAJOR): 3x3 max residual score 9 passes plain validate() because the default committee threshold stays 15 (> ceiling 9)", async () => {
    const { svc, ev } = await build(3);
    await residual(svc, ev.id, 3);
    await expect(svc.validate(validator, ev.id, "ok", "r")).rejects.toThrow(/committee/);
  });

  it("5x5 unchanged: score 25 >= 15 must go through the committee, score 9 validates plainly (regression)", async () => {
    const hi = await build(5);
    await residual(hi.svc, hi.ev.id, 5);
    await expect(hi.svc.validate(validator, hi.ev.id, "ok", "r")).rejects.toThrow(/committee/);
  });
});

// ===================================================================== E. thresholds on the scale

describe("E. RatingScaleService.updateThresholds ceiling", () => {
  const band = (max: number) => [{ label: "Faible", min: 1, max: max - 1 }, { label: "Critique", min: max, max }];

  it.each(SIZES)("n=%i: a band ending at n² accepted, n²+1 refused (nothing stored, no audit)", async (n) => {
    const r = repo([scale(n, { status: "DRAFT" })]);
    const { svc, audit } = rsService(r);
    await expect(svc.updateThresholds(actor, "s1", { thresholds: band(n * n) }, "r")).resolves.toBeTruthy();
    expect(audit.events).toHaveLength(1);
    await expect(svc.updateThresholds(actor, "s1", { thresholds: band(n * n + 1) }, "r")).rejects.toThrow(new RegExp(`\\(${n * n}\\)`));
    expect(r.calls.updateThresholds).toBe(1);
    expect(audit.events).toHaveLength(1);
  });

  it("only the max is checked: a mid band above n² is refused even if the last band is within", async () => {
    const r = repo([scale(3, { status: "DRAFT" })]);
    const { svc } = rsService(r);
    await expect(svc.updateThresholds(actor, "s1", { thresholds: [{ label: "A", min: 1, max: 20 }, { label: "B", min: 21, max: 22 }] }, "r")).rejects.toThrow(ValidationError);
  });

  it("bands that do not reach n² are accepted (gaps at the top are not enforced; pins current behavior)", async () => {
    const r = repo([scale(6, { status: "DRAFT" })]);
    const { svc } = rsService(r);
    await expect(svc.updateThresholds(actor, "s1", { thresholds: [{ label: "A", min: 1, max: 10 }] }, "r")).resolves.toBeTruthy();
  });

  it("ACTIVE and ARCHIVED scales stay immutable", async () => {
    for (const status of ["ACTIVE", "ARCHIVED"] as const) {
      const { svc } = rsService(repo([scale(4, { status })]));
      await expect(svc.updateThresholds(actor, "s1", { thresholds: band(16) }, "r")).rejects.toThrow(ValidationError);
    }
  });

  // KNOWN GAP (MINOR, legacy only): unequal legacy sizes (e.g. P=5, I=3, kept readable by B-9) have a real max score P*I = 15,
  // but every ceiling uses impactLevels^2 = 9. Bands up to 15 are refused, as are appetite thresholds and overrides above 9.
  it.fails("KNOWN GAP (MINOR): legacy DRAFT P=5/I=3 refuses a band ending at 15 (real max score P*I)", async () => {
    const { svc } = rsService(repo([scale(3, { status: "DRAFT", probabilityLevels: 5, probabilityLabels: lv(5) })]));
    await expect(svc.updateThresholds(actor, "s1", { thresholds: band(15) }, "r")).resolves.toBeTruthy();
  });

  it.fails("KNOWN GAP (MINOR): legacy ACTIVE P=5/I=3 refuses an appetite threshold of 15 (real max score P*I)", async () => {
    const svc = new RiskAppetiteService({ getBySubCategory: async () => null, upsert: async (i: never) => i } as never, auditSpy() as never, undefined, repo([scale(3, { probabilityLevels: 5 })]) as never);
    await expect(svc.setThreshold(actor, "Fraude", { threshold: 15, methodologyVersion: "v1" }, "r")).resolves.toBeTruthy();
  });
});

// ===================================================================== F. activation descriptors

describe("F. activation requires complete descriptors (q50)", () => {
  const draft = (n: number, o: Partial<RatingScale> = {}) => scale(n, { status: "DRAFT", ...o });
  const full = (n: number) => ({ axes: [axis(1, lv(n)), axis(2, lv(n))], retainedImpactRule: "MAX" as const });
  const expectRefused = async (s: RatingScale, re: RegExp | typeof ValidationError = ValidationError) => {
    const prev = scale(s.impactLevels, { id: "prev", status: "ACTIVE" });
    const r = repo([prev, s]);
    const { svc, audit } = rsService(r);
    await expect(svc.activateVersion(actor, s.id, "r")).rejects.toThrow(re);
    expect(r.calls.activate).toBe(0);
    expect(r.store.get("prev")!.status).toBe("ACTIVE");
    expect(r.store.get(s.id)!.status).toBe("DRAFT");
    expect(audit.events).toHaveLength(0);
  };

  it.each(SIZES)("n=%i: complete descriptors + axes -> activates, previous archived, one STATUS_CHANGE", async (n) => {
    const r = repo([scale(n, { id: "prev" }), draft(n, { impactAxes: full(n) })]);
    const { svc, audit } = rsService(r);
    expect((await svc.activateVersion(actor, "s1", "r")).status).toBe("ACTIVE");
    expect(r.store.get("prev")!.status).toBe("ARCHIVED");
    expect(audit.events.map((e) => e.action)).toEqual(["STATUS_CHANGE"]);
  });

  it.each(SIZES)("n=%i: probability labels null / [] / n-1 / n+1 -> refused, previous ACTIVE untouched", async (n) => {
    await expectRefused(draft(n, { probabilityLabels: null }), /probabilityLabels/);
    await expectRefused(draft(n, { probabilityLabels: [] }));
    await expectRefused(draft(n, { probabilityLabels: lv(n - 1) }));
    await expectRefused(draft(n, { probabilityLabels: lv(n + 1) }));
  });

  it.each(SIZES)("n=%i: impact labels null / [] / n-1 / blank / duplicated level -> refused", async (n) => {
    await expectRefused(draft(n, { impactLabels: null }), /impactLabels/);
    await expectRefused(draft(n, { impactLabels: [] }));
    await expectRefused(draft(n, { impactLabels: lv(n - 1) }));
    await expectRefused(draft(n, { impactLabels: [...lv(n - 1), { level: n, label: "   " }] }));
    await expectRefused(draft(n, { impactLabels: [...lv(n - 1), { level: n - 1, label: "dup" }] }));
  });

  it("axis descriptors: missing / [] / wrong count / blank, on the first or on a later axis -> refused", async () => {
    const n = 4;
    const ax = (...a: ImpactAxis[]) => ({ impactAxes: { axes: a, retainedImpactRule: "MAX" as const } });
    await expectRefused(draft(n, ax(axis(1))), /levelLabels/);
    await expectRefused(draft(n, ax(axis(1, lv(n)), axis(2))), /A2/);
    await expectRefused(draft(n, ax(axis(1, []))));
    await expectRefused(draft(n, ax(axis(1, lv(3)))));
    await expectRefused(draft(n, ax(axis(1, lv(5)))));
    await expectRefused(draft(n, ax(axis(1, [...lv(3), { level: 4, label: "" }]))));
  });

  it("the axes count itself is not required: a scale with impactAxes null or axes [] activates (observation; such a scale then cannot score evaluations)", async () => {
    for (const impactAxes of [null, { axes: [], retainedImpactRule: "MAX" as const }]) {
      const { svc } = rsService(repo([draft(4, { impactAxes })]));
      await expect(svc.activateVersion(actor, "s1", "r")).resolves.toBeTruthy();
    }
  });

  it("ARCHIVED check precedes the descriptor check; cross-tenant id -> NotFound", async () => {
    const { svc } = rsService(repo([scale(4, { status: "ARCHIVED", probabilityLabels: null })]));
    await expect(svc.activateVersion(actor, "s1", "r")).rejects.toThrow(/archived/);
    const { svc: svc2 } = rsService(repo([draft(4, { tenantId: T2 })]));
    await expect(svc2.activateVersion(actor, "s1", "r")).rejects.toThrow(NotFoundError);
  });

  it("a DRAFT created WITHOUT descriptors (real repo behavior: null) cannot be activated; once completed through create-with-labels it can", async () => {
    const r = repo([]);
    const { svc } = rsService(r);
    const s = await svc.create(actor, { name: "E", version: "v", probabilityLevels: 4, impactLevels: 4 }, "r");
    expect(s.probabilityLabels).toBeNull();
    await expect(svc.activateVersion(actor, s.id, "r")).rejects.toThrow(/probabilityLabels/);
    const ok = await svc.create(actor, { name: "E", version: "v2", probabilityLevels: 4, impactLevels: 4, probabilityLabels: lv(4), impactLabels: lv(4) }, "r");
    await expect(svc.activateVersion(actor, ok.id, "r")).resolves.toBeTruthy();
  });

  it("legacy ACTIVE scale without descriptors: re-activating it is now refused (observation, A06 leftover); it stays readable", async () => {
    const r = repo([scale(5, { probabilityLabels: null, impactLabels: null })]);
    const { svc } = rsService(r);
    await expect(svc.activateVersion(actor, "s1", "r")).rejects.toThrow(ValidationError);
    expect((await svc.get(actor, "s1")).status).toBe("ACTIVE");
  });

  it("activation permission still required (ratingscale.update alone is not enough)", async () => {
    const { svc } = rsService(repo([draft(4, { impactAxes: full(4) })]));
    await expect(svc.activateVersion({ ...actor, roles: ["ratingscale.read", "ratingscale.update"] }, "s1", "r")).rejects.toThrow();
  });
});

// ===================================================================== G. Cartography

describe("G. CartographyService default bands follow the captured scale", () => {
  const TENANT = T1;
  const user: AuthenticatedUser = { userId: "u", tenantId: TENANT, email: "u@x", displayName: "U", roles: ["cartography.read"] };
  const risk: Risk = { id: "r1", tenantId: TENANT, process: "P", description: "d", ownerDepartmentId: null, ownerId: null, superiorOwnerId: null, status: "ACTIVE", createdAt: new Date(), updatedAt: new Date(), deletedAt: null, deletedBy: null, deletionReason: null } as Risk;
  const ev = (score: number, ratingScaleId: string | null): RiskEvaluation =>
    ({
      id: "e1", tenantId: TENANT, riskId: "r1", evaluationType: "AD_HOC", status: "VALIDATED", evaluatorId: "x", subCategory: "Fraude", entity: "CI",
      ratingScaleId, ratingScaleVersion: null, inherentProbability: 1, inherentImpacts: [], inherentImpactRetained: 1, inherentScore: score,
      masteryLines: null, masteryGlobal: 1, residualProbability: 2, residualImpacts: [], residualImpactRetained: 3, residualScore: score, residualJustification: "j",
      appetiteThresholdSuggested: null, appetiteThresholdOverride: null, appetiteThresholdApplied: null, appetiteExceeded: null,
      validatedBy: "v", validatedAt: new Date(), comment: null, createdAt: new Date(), updatedAt: new Date(),
    }) as unknown as RiskEvaluation;
  const svcFor = (e: RiskEvaluation, scales: RatingScale[] | undefined) =>
    new CartographyService(
      { async list() { return [risk]; } } as never,
      { async listForRisk() { return [e]; } } as never,
      scales ? (repo(scales) as never) : undefined,
      { async getById() { return null; } } as never,
    );
  const label = async (score: number, scaleId: string | null, scales: RatingScale[] | undefined) =>
    (await svcFor(ev(score, scaleId), scales).getCartography(user, "residual"))[0]!.criticality;

  it.each([[4, "Faible"], [5, "Modéré"], [9, "Modéré"], [10, "Élevé"], [15, "Élevé"], [16, "Critique"], [25, "Critique"]])("5x5 historical: score %i -> %s (with and without scale)", async (s, l) => {
    expect(await label(s, "s1", [scale(5)])).toBe(l);
    expect(await label(s, null, [scale(5)])).toBe(l);
    expect(await label(s, "s1", undefined)).toBe(l);
  });

  it.each([[1, "Faible"], [3, "Modéré"], [5, "Élevé"], [6, "Critique"], [9, "Critique"]])("3x3 without configured bands: score %i -> %s", async (s, l) => {
    expect(await label(s, "s1", [scale(3)])).toBe(l);
  });

  it.each([[5, "Faible"], [12, "Modéré"], [21, "Élevé"], [22, "Critique"], [36, "Critique"]])("6x6 without configured bands: score %i -> %s", async (s, l) => {
    expect(await label(s, "s1", [scale(6)])).toBe(l);
  });

  it("empty criticalityThresholds [] behaves like null (defaults of the scale size); configured bands win over defaults", async () => {
    expect(await label(12, "s1", [scale(6, { criticalityThresholds: [] })])).toBe("Modéré");
    expect(await label(12, "s1", [scale(6, { criticalityThresholds: [{ label: "Tout", min: 1, max: 36 }] })])).toBe("Tout");
  });

  it("unknown / other-tenant scale id degrades to the 5x5 default bands without throwing", async () => {
    expect(await label(12, "ghost", [scale(6)])).toBe("Élevé");
    expect(await label(12, "s1", [scale(6, { tenantId: T2 })])).toBe("Élevé");
  });

  it("a score above the ceiling with no scale clamps to the last band (no crash)", async () => {
    expect(await label(30, null, undefined)).toBe("Critique");
  });

  it("response shape unchanged: same keys as before B-9 bis", async () => {
    const [p] = await svcFor(ev(6, "s1"), [scale(5)]).getCartography(user, "residual");
    expect(Object.keys(p!).sort()).toEqual(
      ["criticality", "departmentId", "entityLabel", "evaluationStatus", "impactRetained", "probability", "process", "processId", "resolvedVia", "riskId", "score", "velocity"].sort(),
    );
    for (const k of ["riskId", "process", "processId", "resolvedVia", "probability", "impactRetained", "score", "criticality"]) expect(p).toHaveProperty(k);
    expect(typeof p!.criticality).toBe("string");
    expect(p!.score).toBe(6);
  });
});

// ===================================================================== H. Dashboard

describe("H. DashboardService keeps 5x5 bands", () => {
  const user: AuthenticatedUser = { userId: "user-1", tenantId: T1, email: "u@x", displayName: "U", roles: ["dashboard.read"], dashboardScopeMode: "GLOBAL" } as AuthenticatedUser;
  const rk = { id: "r1", tenantId: T1, process: "P", description: "d", ownerDepartmentId: null, ownerId: "user-1", superiorOwnerId: null, status: "ACTIVE", createdAt: new Date(), updatedAt: new Date(), deletedAt: null, deletedBy: null, deletionReason: null };
  const anyRepo = (extra: object) => new Proxy(extra, { get: (t, p) => (p in t ? (t as never)[p] : async () => []) }) as never;
  const labelOf = async (score: number, ratingScaleId: string | null) => {
    const e = { id: "e", tenantId: T1, riskId: "r1", status: "VALIDATED", residualScore: score, inherentScore: score, ratingScaleId, subCategory: "F", entity: "CI", appetiteExceeded: null, createdAt: new Date(), updatedAt: new Date() };
    const svc = new DashboardService(
      anyRepo({ list: async () => [rk] }), anyRepo({ listForRisk: async () => [e] }), anyRepo({}), anyRepo({}), anyRepo({}), anyRepo({}),
      anyRepo({}), anyRepo({}), anyRepo({}), anyRepo({}), anyRepo({}), anyRepo({}), anyRepo({}), anyRepo({}),
    );
    const rows = await svc.getRisksOverview(user);
    return rows[0]!.criticality;
  };

  it.each([[4, "Faible"], [5, "Modéré"], [9, "Modéré"], [10, "Élevé"], [15, "Élevé"], [16, "Critique"], [25, "Critique"]])("5x5 band edges: %i -> %s", async (s, l) => {
    expect(await labelOf(s, null)).toBe(l);
  });

  it("score above 25 clamps to Critique, no crash", async () => {
    expect(await labelOf(36, "s6")).toBe("Critique");
  });

  // KNOWN GAP (MAJOR, A06 leftover): the same 6x6 score gets two different labels in Cartography (Modéré, band 6-12) and Dashboard (Élevé, 5x5 band 10-15).
  // q49 "tout s'aligne sur la taille". On 3x3 the dashboard can never say "Critique" below 16 (max score is 9).
  it.fails("KNOWN GAP (MAJOR): Dashboard label for a 6x6 score of 12 should be Modéré like Cartography (is Élevé)", async () => {
    expect(await labelOf(12, "s6")).toBe("Modéré");
  });
  it.fails("KNOWN GAP (MAJOR): Dashboard label for a 3x3 max score of 9 should be Critique (is Modéré)", async () => {
    expect(await labelOf(9, "s3")).toBe("Critique");
  });
});

// ===================================================================== I. Migration 052 (static review, never applied)

describe("I. migration 052 (static review of the SQL text, no database)", () => {
  const dir = resolve(process.cwd(), "../database/postgresql/migrations");
  const up = readFileSync(resolve(dir, "052_score_ceiling_36.sql"), "utf8");
  const down = readFileSync(resolve(dir, "052_score_ceiling_36.down.sql"), "utf8");
  const code = (s: string) => s.split("\n").filter((l) => !l.trim().startsWith("--")).join("\n");

  it("up: targets exactly the three columns that held a 25 CHECK (017, 045) and nothing else", () => {
    const m017 = readFileSync(resolve(dir, "017_risk_appetite.sql"), "utf8");
    const m045 = readFileSync(resolve(dir, "045_committee_thresholds.sql"), "utf8");
    expect(m017).toMatch(/threshold\s+integer NOT NULL CHECK \(threshold BETWEEN 1 AND 25\)/);
    expect((m045.match(/BETWEEN 1 AND 25/g) ?? []).length).toBe(2);
    const body = code(up);
    for (const col of ["'threshold'", "'committee_evaluation_min_score'", "'committee_treatment_min_score'"]) expect(body).toContain(col);
    expect((body.match(/BETWEEN 1 AND 36/g) ?? []).length).toBe(3);
    expect(body).not.toMatch(/BETWEEN 1 AND 25/);
    expect(body).toContain("committee_treatment_min_score IS NULL OR");
  });

  it("up: constraint names are looked up in pg_constraint (single-column CHECKs only), then the canonical one is added; re-runnable", () => {
    const body = code(up);
    expect(body).toContain("pg_constraint");
    expect(body).toContain("con.contype = 'c'");
    expect(body).toContain("con.conkey = ARRAY[a.attnum]");
    expect(body).toContain("NOT a.attisdropped");
    // drop happens before add, inside the same DO block, so a second run drops the canonical one then re-adds it
    expect(body.indexOf("DROP CONSTRAINT")).toBeLessThan(body.indexOf("ADD CONSTRAINT"));
    expect(body).not.toMatch(/\bDELETE\b|\bUPDATE\b|\bDROP TABLE\b|\bDROP COLUMN\b|NOT VALID/);
    // schema qualified (current_schema) like 050
    expect(body).toContain("current_schema()");
  });

  it("up: widening only, so every existing row (<= 25) satisfies the new CHECK (ceiling 36 = ABSOLUTE_MAX_SCORE)", () => {
    expect(code(up)).not.toMatch(/BETWEEN 1 AND (?!36)\d+/);
  });

  it("down: restores 25 on the three columns with the canonical names and un-marks the migration", () => {
    const body = code(down);
    expect((body.match(/BETWEEN 1 AND 25/g) ?? []).length).toBe(3);
    expect(body).not.toMatch(/\b36\b/);
    expect(body).toContain("DELETE FROM schema_migrations WHERE filename = '052_score_ceiling_36.sql'");
    expect(down).toMatch(/Fails \(constraint violation\) if a threshold above 25 exists/);
  });

  it("down: names it drops are the canonical names created by up", () => {
    const names = [...code(up).matchAll(/'(\w+_check)'/g)].map((m) => m[1]);
    expect(names.sort()).toEqual(["configs_committee_evaluation_min_score_check", "configs_committee_treatment_min_score_check", "risk_appetites_threshold_check"]);
    for (const n of names) expect(code(down)).toContain(`DROP CONSTRAINT ${n}`);
  });

  // KNOWN GAP (MAJOR, rollback safety): the README runs down files with `psql -f` (no transaction, no ON_ERROR_STOP).
  // When a value > 25 exists, "ADD CONSTRAINT ... CHECK (... 25)" fails AFTER its DROP already committed: the column is left
  // WITHOUT any CHECK, psql carries on, and the final DELETE FROM schema_migrations still runs, marking 052 as rolled back.
  // The down must be atomic (BEGIN; ... COMMIT;) or the README must mandate `psql -1 -v ON_ERROR_STOP=1`. Same pattern in 050 down.
  it.fails("KNOWN GAP (MAJOR): down file is wrapped in a single transaction (BEGIN ... COMMIT) so a failing ADD CONSTRAINT leaves the DROP rolled back", () => {
    expect(down).toMatch(/^\s*BEGIN;/im);
    expect(down).toMatch(/^\s*COMMIT;/im);
  });
});

// ===================================================================== helpers (HTTP)

let server: Server | undefined;
async function startApp(mount: (app: express.Express) => void): Promise<string> {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    const r = req as unknown as { user?: unknown };
    r.user ??= actor;
    next();
  });
  mount(app);
  app.use(errorHandler);
  const port = await new Promise<number>((res) => {
    server = app.listen(0, () => res((server!.address() as { port: number }).port));
  });
  return `http://127.0.0.1:${port}`;
}
async function stopApp(): Promise<void> {
  await new Promise<void>((r) => (server ? server.close(() => r()) : r()));
  server = undefined;
}
