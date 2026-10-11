import { describe, expect, it, afterEach, vi } from "vitest";
import express from "express";
import type { Server } from "node:http";
import { randomUUID } from "node:crypto";
import { RatingScaleService } from "../src/services/RatingScaleService.js";
import { RiskEvaluationService } from "../src/services/RiskEvaluationService.js";
import { errorHandler } from "../src/api/middleware/errorHandler.js";
import { ratingScalesRouter } from "../src/api/v1/ratingScales.routes.js";
import type { RatingScaleRepository } from "../src/domain/repositories/RatingScaleRepository.js";
import type { RiskEvaluationRepository } from "../src/domain/repositories/RiskEvaluationRepository.js";
import type { RiskRepository } from "../src/domain/repositories/RiskRepository.js";
import type { AuditRepository } from "../src/domain/repositories/AuditRepository.js";
import type { RatingScale, ScaleLevel, ImpactAxis } from "../src/domain/entities/RatingScale.js";
import type { RiskEvaluation } from "../src/domain/entities/RiskEvaluation.js";
import type { AuthenticatedUser } from "../src/infrastructure/identity/IdentityProvider.js";
import { NotFoundError, ValidationError } from "../src/domain/errors/DomainErrors.js";

// QA-B9 (level 2): scale 3..6, same size probability/impact, <= 7 axes, one descriptor per
// level and per axis, rules on NEW versions only (ACTIVE/ARCHIVED immutable, legacy 1..5 readable).
// Oracle is fixed from the contract (RM-V1-Contrat-etape2-PROJET.md, point 1 / section 6), not from observed behavior.
// A PASS here is a QA verdict only: no Security / Privacy / Compliance / Risk approval is implied.

// ---------------------------------------------------------------- doubles

const T1 = "tenant-1";
const T2 = "tenant-2";

function baseScale(o: Partial<RatingScale>): RatingScale {
  return {
    id: "s", tenantId: T1, name: "N", version: "v", status: "DRAFT",
    probabilityLevels: 5, probabilityLabels: null, impactLevels: 5, impactLabels: null,
    criticalityThresholds: null, impactAxes: null, velocityLevels: null, persistenceLevels: null, masteryScale: null,
    activatedAt: null, archivedAt: null, createdAt: new Date(), updatedAt: new Date(), deletedAt: null, deletedBy: null, deletionReason: null,
    ...o,
  };
}

function scaleRepo(): RatingScaleRepository & { seed(s: RatingScale): void } {
  const store = new Map<string, RatingScale>();
  const own = (t: string, id: string) => {
    const s = store.get(id);
    if (!s || s.tenantId !== t) throw new NotFoundError("RatingScale", id);
    return s;
  };
  const put = (s: RatingScale) => (store.set(s.id, s), s);
  return {
    seed: (s) => void store.set(s.id, s),
    async getById(t, id) {
      const s = store.get(id);
      return s && s.tenantId === t && !s.deletedAt ? s : null;
    },
    async list(t, o) {
      return [...store.values()].filter((s) => s.tenantId === t && !s.deletedAt && (o?.includeArchived || s.status !== "ARCHIVED"));
    },
    async create(i) {
      return put(baseScale({ id: randomUUID(), tenantId: i.tenantId, name: i.name, version: i.version, probabilityLevels: i.probabilityLevels, probabilityLabels: i.probabilityLabels ?? null, impactLevels: i.impactLevels, impactLabels: i.impactLabels ?? null }));
    },
    async updateThresholds(t, id, v) { return put({ ...own(t, id), criticalityThresholds: v }); },
    async updateImpactAxes(t, id, v) { return put({ ...own(t, id), impactAxes: v }); },
    async updateVelocity(t, id, v) { return put({ ...own(t, id), velocityLevels: v }); },
    async updatePersistence(t, id, v) { return put({ ...own(t, id), persistenceLevels: v }); },
    async updateMastery(t, id, v) { return put({ ...own(t, id), masteryScale: v }); },
    async activateAndArchivePrevious(t, id) {
      const target = own(t, id);
      for (const o of store.values()) if (o.tenantId === t && o.status === "ACTIVE" && o.id !== id) put({ ...o, status: "ARCHIVED", archivedAt: new Date() });
      return put({ ...target, status: "ACTIVE", activatedAt: new Date() });
    },
    async softDelete(t, id, by, reason) { put({ ...own(t, id), deletedAt: new Date(), deletedBy: by, deletionReason: reason }); },
  };
}

interface RecordedAudit { tenantId: string; userId: string; entityType: string; entityId: string; action: string; requestId: string }
function auditRepo(): AuditRepository & { events: RecordedAudit[] } {
  const events: RecordedAudit[] = [];
  return {
    events,
    async record(e) { events.push(e as unknown as RecordedAudit); },
    async listForEntity() { return []; },
    async listRecent() { return []; },
  };
}

const actor: AuthenticatedUser = {
  userId: "u1", tenantId: T1, email: "a@x", displayName: "A",
  roles: ["ratingscale.read", "ratingscale.create", "ratingscale.update", "ratingscale.delete"],
};
const otherTenantActor: AuthenticatedUser = { ...actor, userId: "u2", tenantId: T2 };

function setup(referenced: Set<string> = new Set()) {
  const repo = scaleRepo();
  const audit = auditRepo();
  const service = new RatingScaleService(repo, audit, { async existsForRatingScale(_t, id) { return referenced.has(id); } });
  return { repo, audit, service };
}

const lv = (n: number): ScaleLevel[] => Array.from({ length: n }, (_, i) => ({ level: i + 1, label: `N${i + 1}` }));
const axis = (i: number, labels?: number): ImpactAxis => ({ code: `A${i}`, label: `Axe ${i}`, order: i, ...(labels !== undefined ? { levelLabels: lv(labels) } : {}) });
const axes = (n: number, labels?: number) => Array.from({ length: n }, (_, i) => axis(i + 1, labels));
const mkInput = (n: number, m = n) => ({ name: "Echelle", version: `v${n}-${m}`, probabilityLevels: n, impactLevels: m });

// ---------------------------------------------------------------- create: size bounds

describe("B-9 create: size 3..6, probability = impact", () => {
  it.each([3, 4, 5, 6])("size %i accepted, audited CREATE", async (n) => {
    const { service, audit } = setup();
    const s = await service.create(actor, { ...mkInput(n), probabilityLabels: lv(n), impactLabels: lv(n) }, "r");
    expect(s.status).toBe("DRAFT");
    expect(s.probabilityLevels).toBe(n);
    expect(s.impactLevels).toBe(n);
    expect(audit.events.map((e) => [e.action, e.entityType, e.entityId])).toEqual([["CREATE", "RatingScale", s.id]]);
  });

  it.each([0, 1, 2, 7, 8, -1, 3.5, Number.NaN])("size %s refused for both dimensions, nothing stored nor audited", async (n) => {
    const { service, audit, repo } = setup();
    await expect(service.create(actor, mkInput(n), "r")).rejects.toThrow(ValidationError);
    expect(await repo.list(T1)).toHaveLength(0);
    expect(audit.events).toHaveLength(0);
  });

  it.each([[3, 4], [6, 5], [5, 6], [3, 6]])("unequal sizes P=%i / I=%i refused", async (p, i) => {
    const { service } = setup();
    await expect(service.create(actor, mkInput(p, i), "r")).rejects.toThrow(/must be equal/);
  });

  it("one dimension valid and the other out of range -> refused (6 vs 7, 2 vs 3)", async () => {
    const { service } = setup();
    await expect(service.create(actor, mkInput(6, 7), "r")).rejects.toThrow(ValidationError);
    await expect(service.create(actor, mkInput(2, 3), "r")).rejects.toThrow(ValidationError);
  });

  it("labels: too few, too many, gap, duplicate, blank -> refused; exactly N accepted; null accepted", async () => {
    const { service } = setup();
    const bads = [lv(3), lv(5), [...lv(3), { level: 5, label: "x" }], [...lv(3), { level: 3, label: "dup" }], [...lv(2), { level: 3, label: " " }]];
    for (const bad of bads) {
      await expect(service.create(actor, { ...mkInput(4), probabilityLabels: bad }, "r")).rejects.toThrow(ValidationError);
      await expect(service.create(actor, { ...mkInput(4), impactLabels: bad }, "r")).rejects.toThrow(ValidationError);
    }
    await expect(service.create(actor, { ...mkInput(4), probabilityLabels: lv(4), impactLabels: lv(4) }, "r")).resolves.toBeTruthy();
    await expect(service.create(actor, { ...mkInput(4), version: "n", probabilityLabels: null, impactLabels: null }, "r")).resolves.toBeTruthy();
  });

  it("label count different from the common size is refused on either side", async () => {
    const { service } = setup();
    await expect(service.create(actor, { ...mkInput(6), probabilityLabels: lv(6), impactLabels: lv(5) }, "r")).rejects.toThrow(/exactly one descriptor/);
    await expect(service.create(actor, { ...mkInput(6), probabilityLabels: lv(5), impactLabels: lv(6) }, "r")).rejects.toThrow(/exactly one descriptor/);
  });

  it("blank name / version refused; permission required", async () => {
    const { service } = setup();
    await expect(service.create(actor, { ...mkInput(4), name: " " }, "r")).rejects.toThrow(ValidationError);
    await expect(service.create(actor, { ...mkInput(4), version: "" }, "r")).rejects.toThrow(ValidationError);
    await expect(service.create({ ...actor, roles: ["ratingscale.read"] }, mkInput(4), "r")).rejects.toThrow();
  });
});

// ---------------------------------------------------------------- updateImpactAxes

describe("B-9 updateImpactAxes on a DRAFT", () => {
  async function draft(n = 6) {
    const ctx = setup();
    const s = await ctx.service.create(actor, mkInput(n), "r");
    return { ...ctx, s };
  }

  it.each([1, 6, 7])("%i axes accepted (max = 7), MAX rule by default, audited UPDATE", async (k) => {
    const { service, audit, s } = await draft();
    const out = await service.updateImpactAxes(actor, s.id, { axes: axes(k, 6) }, "r");
    expect(out.impactAxes?.axes).toHaveLength(k);
    expect(out.impactAxes?.retainedImpactRule).toBe("MAX");
    expect(audit.events.map((e) => e.action)).toEqual(["CREATE", "UPDATE"]);
  });

  it("8 axes and 0 axes refused, state and audit unchanged", async () => {
    const { service, audit, repo, s } = await draft();
    await expect(service.updateImpactAxes(actor, s.id, { axes: axes(8) }, "r")).rejects.toThrow(/more than 7/);
    await expect(service.updateImpactAxes(actor, s.id, { axes: [] }, "r")).rejects.toThrow(ValidationError);
    expect((await repo.getById(T1, s.id))?.impactAxes).toBeNull();
    expect(audit.events).toHaveLength(1);
  });

  it.each([5, 7, 0])("axis levelLabels with %i descriptors on a 6-level scale refused (exactly one per level)", async (n) => {
    const { service, s } = await draft(6);
    await expect(service.updateImpactAxes(actor, s.id, { axes: [axis(1, 6), axis(2, n)] }, "r")).rejects.toThrow(ValidationError);
  });

  it("descriptor count follows the scale size (4-level scale: 4 ok, 6 refused)", async () => {
    const { service, s } = await draft(4);
    await expect(service.updateImpactAxes(actor, s.id, { axes: axes(2, 6) }, "r")).rejects.toThrow(ValidationError);
    await expect(service.updateImpactAxes(actor, s.id, { axes: axes(2, 4) }, "r")).resolves.toBeTruthy();
  });

  it("descriptor gap or blank label refused; duplicate axis code / order refused", async () => {
    const { service, s } = await draft(3);
    const gap = { ...axis(1), levelLabels: [{ level: 1, label: "a" }, { level: 2, label: "b" }, { level: 4, label: "c" }] };
    const blank = { ...axis(1), levelLabels: [{ level: 1, label: "a" }, { level: 2, label: "b" }, { level: 3, label: "" }] };
    await expect(service.updateImpactAxes(actor, s.id, { axes: [gap] }, "r")).rejects.toThrow(ValidationError);
    await expect(service.updateImpactAxes(actor, s.id, { axes: [blank] }, "r")).rejects.toThrow(ValidationError);
    await expect(service.updateImpactAxes(actor, s.id, { axes: [axis(1, 3), { ...axis(2, 3), code: "A1" }] }, "r")).rejects.toThrow(/duplicate impact axis code/);
    await expect(service.updateImpactAxes(actor, s.id, { axes: [axis(1, 3), { ...axis(2, 3), order: 1 }] }, "r")).rejects.toThrow(/duplicate impact axis order/);
  });

  it("axes must agree on level count (5 vs 4 descriptors refused)", async () => {
    const { service, s } = await draft(5);
    await expect(service.updateImpactAxes(actor, s.id, { axes: [axis(1, 5), axis(2, 4)] }, "r")).rejects.toThrow(ValidationError);
  });

  it("OBSERVATION (spec gap flagged to PO, not asserted as defect): axes without levelLabels are accepted", async () => {
    // Contract: 'un descriptif par niveau et par axe'. levelLabels is optional (legacy compat), so the rule only
    // binds when descriptors are supplied; an axis with none passes. Pinned so a change is noticed.
    const { service, s } = await draft(6);
    const out = await service.updateImpactAxes(actor, s.id, { axes: axes(7) }, "r");
    expect(out.impactAxes?.axes.every((a) => a.levelLabels === undefined)).toBe(true);
  });
});

// ---------------------------------------------------------------- immutability

describe("B-9 ACTIVE / ARCHIVED versions are immutable", () => {
  it("updateImpactAxes refused on ACTIVE and on ARCHIVED, content and audit unchanged", async () => {
    const { service, audit, repo } = setup();
    const a = await service.create(actor, mkInput(6), "r");
    const b = await service.create(actor, { ...mkInput(6), version: "v2" }, "r");
    await service.activateVersion(actor, a.id, "r");
    await service.activateVersion(actor, b.id, "r");
    expect((await repo.getById(T1, a.id))?.status).toBe("ARCHIVED");
    expect((await repo.getById(T1, b.id))?.status).toBe("ACTIVE");
    const before = audit.events.length;
    await expect(service.updateImpactAxes(actor, b.id, { axes: axes(2, 6) }, "r")).rejects.toThrow(/active rating scale/);
    await expect(service.updateImpactAxes(actor, a.id, { axes: axes(2, 6) }, "r")).rejects.toThrow(/archived rating scale/);
    expect((await repo.getById(T1, a.id))?.impactAxes).toBeNull();
    expect((await repo.getById(T1, b.id))?.impactAxes).toBeNull();
    expect(audit.events).toHaveLength(before);
  });

  it("thresholds also stay closed on ACTIVE", async () => {
    const { service } = setup();
    const a = await service.create(actor, mkInput(6), "r");
    await service.activateVersion(actor, a.id, "r");
    await expect(service.updateThresholds(actor, a.id, { thresholds: [{ label: "x", min: 1, max: 36 }] }, "r")).rejects.toThrow(ValidationError);
  });
});

// ---------------------------------------------------------------- legacy

describe("B-9 legacy versions (1..5, unequal sizes) stay usable", () => {
  const legacy = (o: Partial<RatingScale>) => baseScale({ tenantId: T1, ...o });

  it("readable via get/list, including unequal sizes 5/3 and sizes 2/1", async () => {
    const { service, repo } = setup();
    repo.seed(legacy({ id: "l1", probabilityLevels: 5, impactLevels: 3, status: "ACTIVE" }));
    repo.seed(legacy({ id: "l2", probabilityLevels: 2, impactLevels: 1, status: "ARCHIVED", archivedAt: new Date() }));
    expect((await service.get(actor, "l1")).impactLevels).toBe(3);
    expect((await service.get(actor, "l2")).probabilityLevels).toBe(2);
    expect((await service.list(actor, true)).map((s) => s.id).sort()).toEqual(["l1", "l2"]);
  });

  it("legacy DRAFT 5/3 activates (new rules not re-applied), previous ACTIVE is archived, audited STATUS_CHANGE", async () => {
    const { service, repo, audit } = setup();
    repo.seed(legacy({ id: "old", status: "ACTIVE", probabilityLevels: 5, impactLevels: 5 }));
    repo.seed(legacy({ id: "dr", status: "DRAFT", probabilityLevels: 5, impactLevels: 3 }));
    const out = await service.activateVersion(actor, "dr", "r");
    expect(out.status).toBe("ACTIVE");
    expect((await repo.getById(T1, "old"))?.status).toBe("ARCHIVED");
    expect(audit.events.map((e) => e.action)).toEqual(["STATUS_CHANGE"]);
  });

  it("legacy ACTIVE archived by activating a 6x6 version; archived legacy disable blocked when referenced, allowed otherwise", async () => {
    const referenced = new Set<string>();
    const { service, repo, audit } = setup(referenced);
    repo.seed(legacy({ id: "old", status: "ACTIVE", probabilityLevels: 4, impactLevels: 2 }));
    const n = await service.create(actor, mkInput(6), "r");
    await service.activateVersion(actor, n.id, "r");
    expect((await repo.getById(T1, "old"))?.status).toBe("ARCHIVED");
    referenced.add("old");
    await expect(service.disable(actor, "old", "why", "r")).rejects.toThrow(/referenced/);
    referenced.delete("old");
    await service.disable(actor, "old", "why", "r");
    expect(await repo.getById(T1, "old")).toBeNull();
    expect(audit.events.map((e) => e.action)).toEqual(["CREATE", "STATUS_CHANGE", "DELETE"]);
  });

  it("legacy DRAFT 5/3: axis descriptors checked against ITS impactLevels (3)", async () => {
    const { service, repo } = setup();
    repo.seed(legacy({ id: "dr", status: "DRAFT", probabilityLevels: 5, impactLevels: 3 }));
    await expect(service.updateImpactAxes(actor, "dr", { axes: axes(1, 5) }, "r")).rejects.toThrow(ValidationError);
    await expect(service.updateImpactAxes(actor, "dr", { axes: axes(1, 3) }, "r")).resolves.toBeTruthy();
  });

  it("an archived legacy version cannot be re-activated", async () => {
    const { service, repo } = setup();
    repo.seed(legacy({ id: "ar", status: "ARCHIVED", archivedAt: new Date() }));
    await expect(service.activateVersion(actor, "ar", "r")).rejects.toThrow(/archived/);
  });
});

// ---------------------------------------------------------------- tenant isolation + audit

describe("B-9 tenant isolation and audit", () => {
  it("another tenant cannot read, edit, activate or disable a scale; it is absent from its list", async () => {
    const { service, audit } = setup();
    const s = await service.create(actor, mkInput(6), "r");
    await expect(service.get(otherTenantActor, s.id)).rejects.toThrow(NotFoundError);
    await expect(service.updateImpactAxes(otherTenantActor, s.id, { axes: axes(1, 6) }, "r")).rejects.toThrow(NotFoundError);
    await expect(service.activateVersion(otherTenantActor, s.id, "r")).rejects.toThrow(NotFoundError);
    await expect(service.disable(otherTenantActor, s.id, "why", "r")).rejects.toThrow(NotFoundError);
    expect(await service.list(otherTenantActor, true)).toHaveLength(0);
    expect(audit.events).toHaveLength(1);
  });

  it("activating in tenant 2 never archives the ACTIVE scale of tenant 1", async () => {
    const { service, repo } = setup();
    const a = await service.create(actor, mkInput(6), "r");
    await service.activateVersion(actor, a.id, "r");
    const b = await service.create(otherTenantActor, mkInput(4), "r");
    await service.activateVersion(otherTenantActor, b.id, "r");
    expect((await repo.getById(T1, a.id))?.status).toBe("ACTIVE");
  });

  it("each successful mutation writes exactly one audit event (tenant, actor, request id); refused ones write none", async () => {
    const { service, audit } = setup();
    const s = await service.create(actor, mkInput(6), "req-1");
    await service.updateImpactAxes(actor, s.id, { axes: axes(7, 6) }, "req-2");
    await service.activateVersion(actor, s.id, "req-3");
    await expect(service.updateImpactAxes(actor, s.id, { axes: axes(2, 6) }, "req-4")).rejects.toThrow();
    await expect(service.create(actor, mkInput(7), "req-5")).rejects.toThrow();
    expect(audit.events.map((e) => [e.action, e.requestId])).toEqual([["CREATE", "req-1"], ["UPDATE", "req-2"], ["STATUS_CHANGE", "req-3"]]);
    for (const e of audit.events) {
      expect(e.tenantId).toBe(T1);
      expect(e.userId).toBe(actor.userId);
      expect(e.entityId).toBe(s.id);
    }
  });
});

// ---------------------------------------------------------------- 6x6 evaluation

describe("B-9 evaluation on a 6x6 scale", () => {
  const evaluator: AuthenticatedUser = { userId: "ev", tenantId: T1, email: "e@x", displayName: "E", roles: ["riskevaluation.read", "riskevaluation.create", "riskevaluation.update"] };

  async function build(size: number, axisCount = 3) {
    const repo = scaleRepo();
    const audit = auditRepo();
    const rs = new RatingScaleService(repo, audit, { async existsForRatingScale() { return false; } });
    const s = await rs.create(actor, mkInput(size), "r");
    await rs.updateImpactAxes(actor, s.id, { axes: axes(axisCount, size) }, "r");
    await rs.activateVersion(actor, s.id, "r");

    const evals = new Map<string, RiskEvaluation>();
    const evalRepo = {
      async create(i: Record<string, unknown>) {
        const e = { id: randomUUID(), status: "BROUILLON", ...i } as unknown as RiskEvaluation;
        evals.set(e.id, e);
        return e;
      },
      async getById(t: string, id: string) { const e = evals.get(id); return e && e.tenantId === t ? e : null; },
      async recordInherentScoring(_t: string, id: string, i: { ratingScaleId: string; ratingScaleVersion: string; probability: number; impactRetained: number; score: number }) {
        const e = { ...evals.get(id)!, ratingScaleId: i.ratingScaleId, inherentProbability: i.probability, inherentImpactRetained: i.impactRetained, inherentScore: i.score } as unknown as RiskEvaluation;
        evals.set(id, e);
        return e;
      },
      async recordResidualScoring(_t: string, id: string, i: { score: number; appetiteThresholdApplied: number | null }) {
        const e = { ...evals.get(id)!, residualScore: i.score, appetiteThresholdApplied: i.appetiteThresholdApplied } as unknown as RiskEvaluation;
        evals.set(id, e);
        return e;
      },
    } as unknown as RiskEvaluationRepository;
    const riskRepo = { async getById(t: string, id: string) { return t === T1 && id === "risk-1" ? { id, tenantId: t, processId: null } : null; } } as unknown as RiskRepository;
    const svc = new RiskEvaluationService(evalRepo, audit, riskRepo, repo);
    const ev = await svc.create(evaluator, { riskId: "risk-1", evaluationType: "AD_HOC", subCategory: "Fraude" }, "r");
    return { svc, ev, scale: s };
  }
  const imp = (...v: number[]) => v.map((value, i) => ({ code: `A${i + 1}`, value }));

  it("6 x 6 accepted: probability 6, max impact 6 -> retained 6, score 36, scale id snapshotted", async () => {
    const { svc, ev, scale } = await build(6);
    const out = await svc.recordInherentScoring(evaluator, ev.id, { probability: 6, impacts: imp(2, 6, 3) }, "r");
    expect(out.inherentScore).toBe(36);
    expect(out.inherentImpactRetained).toBe(6);
    expect(out.ratingScaleId).toBe(scale.id);
  });

  it("retained impact is the MAX of the axes", async () => {
    const { svc, ev } = await build(6);
    const out = await svc.recordInherentScoring(evaluator, ev.id, { probability: 3, impacts: imp(1, 5, 2) }, "r");
    expect(out.inherentImpactRetained).toBe(5);
    expect(out.inherentScore).toBe(15);
  });

  it("7 axes on a 6x6 scale: all 7 required, max retained", async () => {
    const { svc, ev } = await build(6, 7);
    await expect(svc.recordInherentScoring(evaluator, ev.id, { probability: 2, impacts: imp(1, 1, 1, 1, 1, 1) }, "r")).rejects.toThrow(ValidationError);
    const out = await svc.recordInherentScoring(evaluator, ev.id, { probability: 2, impacts: imp(1, 1, 1, 6, 1, 1, 1) }, "r");
    expect(out.inherentScore).toBe(12);
  });

  it("7 and 0 refused on a 6x6 scale (probability and axis)", async () => {
    const { svc, ev } = await build(6);
    await expect(svc.recordInherentScoring(evaluator, ev.id, { probability: 7, impacts: imp(1, 1, 1) }, "r")).rejects.toThrow(ValidationError);
    await expect(svc.recordInherentScoring(evaluator, ev.id, { probability: 1, impacts: imp(1, 7, 1) }, "r")).rejects.toThrow(ValidationError);
    await expect(svc.recordInherentScoring(evaluator, ev.id, { probability: 0, impacts: imp(1, 1, 1) }, "r")).rejects.toThrow(ValidationError);
  });

  it("a 3x3 scale refuses 4 (cote ceiling follows the ACTIVE scale), accepts 3 -> 9", async () => {
    const { svc, ev } = await build(3);
    await expect(svc.recordInherentScoring(evaluator, ev.id, { probability: 4, impacts: imp(1, 1, 1) }, "r")).rejects.toThrow(ValidationError);
    const out = await svc.recordInherentScoring(evaluator, ev.id, { probability: 3, impacts: imp(3, 1, 1) }, "r");
    expect(out.inherentScore).toBe(9);
  });

  // KNOWN GAP flagged by A06 in migration 050 / dev-backend memory: score ceilings of 25 were not widened.
  // Oracle: on a 6x6 scale (max score 36) an appetite threshold must be settable up to 36.
  // it.fails keeps the suite green while the defect stays explicit; remove `.fails` when fixed.
  it.fails("KNOWN GAP (MAJOR): appetiteOverride 36 should be accepted on a 6x6 scale, MAX_APPETITE_THRESHOLD is still 25", async () => {
    const { svc, ev } = await build(6);
    await svc.recordInherentScoring(evaluator, ev.id, { probability: 6, impacts: imp(6, 6, 6) }, "r");
    const out = await svc.recordResidualScoring(
      evaluator,
      ev.id,
      { probability: 6, impacts: imp(6, 6, 6), justification: "j", appetiteOverride: 36 } as never,
      "r",
    );
    expect(out.appetiteThresholdApplied).toBe(36);
  });
});

// ---------------------------------------------------------------- HTTP contract

describe("B-9 routes: nested bounds and real service errors", () => {
  let server: Server | undefined;
  afterEach(() => new Promise<void>((r) => (server ? server.close(() => r()) : r())));

  async function start(service: unknown): Promise<string> {
    const app = express();
    app.use(express.json({ limit: "5mb" }));
    app.use((req, _res, next) => {
      (req as unknown as { user: unknown }).user = actor;
      next();
    });
    app.use("/rs", ratingScalesRouter(service as RatingScaleService));
    app.use(errorHandler);
    const port = await new Promise<number>((resolve) => {
      server = app.listen(0, () => resolve((server!.address() as { port: number }).port));
    });
    return `http://127.0.0.1:${port}`;
  }
  const send = async (url: string, method: string, body: unknown) => {
    const res = await fetch(url, { method, headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
    return res.status;
  };

  it("axis.levelLabels: 6 passes the schema, 7 -> 400 before the service; 8 axes -> 400", async () => {
    const svc = { updateImpactAxes: vi.fn().mockResolvedValue({ id: "s1" }) };
    const base = await start(svc);
    expect(await send(`${base}/rs/s1/impact-axes`, "PUT", { axes: axes(7, 6) })).toBe(200);
    expect(await send(`${base}/rs/s1/impact-axes`, "PUT", { axes: [axis(1, 7)] })).toBe(400);
    expect(await send(`${base}/rs/s1/impact-axes`, "PUT", { axes: axes(8) })).toBe(400);
    expect(svc.updateImpactAxes).toHaveBeenCalledTimes(1);
  });

  it("CVE intent preserved: oversize arrays of empty objects rejected on length alone (labels 7, axes 8, nested 7)", async () => {
    const svc = { create: vi.fn(), updateImpactAxes: vi.fn() };
    const base = await start(svc);
    const junk = (n: number) => Array.from({ length: n }, () => ({}));
    expect(await send(`${base}/rs`, "POST", { ...mkInput(4), impactLabels: junk(7) })).toBe(400);
    expect(await send(`${base}/rs/s1/impact-axes`, "PUT", { axes: junk(8) })).toBe(400);
    expect(await send(`${base}/rs/s1/impact-axes`, "PUT", { axes: [{ code: "A", label: "A", order: 1, levelLabels: junk(7) }] })).toBe(400);
    expect(svc.create).not.toHaveBeenCalled();
    expect(svc.updateImpactAxes).not.toHaveBeenCalled();
  });

  it("with the real service: POST size 7 and unequal sizes -> 4xx (never 5xx), 6x6 -> 201", async () => {
    const { service } = setup();
    const base = await start(service);
    for (const body of [mkInput(7), mkInput(3, 4)]) {
      const st = await send(`${base}/rs`, "POST", body);
      expect(st).toBeGreaterThanOrEqual(400);
      expect(st).toBeLessThan(500);
    }
    expect(await send(`${base}/rs`, "POST", { ...mkInput(6), probabilityLabels: lv(6), impactLabels: lv(6) })).toBe(201);
  });
});
