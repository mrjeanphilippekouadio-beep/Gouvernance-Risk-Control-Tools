import { describe, expect, it } from "vitest";
import { RatingScaleService } from "../src/services/RatingScaleService.js";
import { RiskAppetiteService } from "../src/services/RiskAppetiteService.js";
import { ConfigService } from "../src/services/ConfigService.js";
import { defaultCriticalityBands, maxScoreForSize } from "../src/domain/scoring.js";
import { ValidationError } from "../src/domain/errors/DomainErrors.js";
import type { RatingScale, ScaleLevel } from "../src/domain/entities/RatingScale.js";
import type { AuthenticatedUser } from "../src/infrastructure/identity/IdentityProvider.js";

// B-9 bis (q49/q50), level 1: score ceiling = n² of the active scale, default bands scaled
// to n, descriptors mandatory to activate.

const T = "tenant-1";
const lv = (n: number): ScaleLevel[] => Array.from({ length: n }, (_, i) => ({ level: i + 1, label: `N${i + 1}` }));

function scale(n: number, o: Partial<RatingScale> = {}): RatingScale {
  return {
    id: "s1", tenantId: T, name: "N", version: "v", status: "ACTIVE",
    probabilityLevels: n, probabilityLabels: lv(n), impactLevels: n, impactLabels: lv(n),
    criticalityThresholds: null, impactAxes: null, velocityLevels: null, persistenceLevels: null, masteryScale: null,
    activatedAt: null, archivedAt: null, createdAt: new Date(), updatedAt: new Date(),
    deletedAt: null, deletedBy: null, deletionReason: null,
    ...o,
  };
}

const audit = { async record() {}, async listForEntity() { return []; }, async listRecent() { return []; } };
const scaleRepo = (scales: RatingScale[]) =>
  ({
    async list() { return scales; },
    async getById(_t: string, id: string) { return scales.find((s) => s.id === id) ?? null; },
    async updateThresholds(_t: string, id: string, v: never) { return { ...scales.find((s) => s.id === id)!, criticalityThresholds: v }; },
    async activateAndArchivePrevious(_t: string, id: string) { return { ...scales.find((s) => s.id === id)!, status: "ACTIVE" as const }; },
  }) as never;

const actor: AuthenticatedUser = {
  userId: "u1", tenantId: T, email: "a@x", displayName: "A",
  roles: ["riskappetite.read", "riskappetite.update", "ratingscale.read", "ratingscale.update", "ratingscale.delete", "config.read", "config.committeethreshold.set"],
};

describe("scoring helpers", () => {
  it.each([[3, 9], [4, 16], [5, 25], [6, 36]])("n=%i -> max score %i, bands contiguous from 1 to n²", (n, max) => {
    expect(maxScoreForSize(n)).toBe(max);
    const bands = defaultCriticalityBands(n);
    expect(bands[0]!.min).toBe(1);
    expect(bands[bands.length - 1]!.max).toBe(max);
    for (let i = 1; i < bands.length; i++) expect(bands[i]!.min).toBe(bands[i - 1]!.max + 1);
    for (const b of bands) expect(b.max).toBeGreaterThanOrEqual(b.min);
  });

  it("n=5 keeps the historical bands 1-4 / 5-9 / 10-15 / 16-25", () => {
    expect(defaultCriticalityBands(5).map((b) => [b.min, b.max])).toEqual([[1, 4], [5, 9], [10, 15], [16, 25]]);
  });
});

describe("appetite and committee ceilings follow the active scale", () => {
  const input = (threshold: number) => ({ threshold, methodologyVersion: "v1" });

  it("6x6: 36 accepted, 37 refused; 3x3: 10 refused", async () => {
    const six = new RiskAppetiteService({ async getBySubCategory() { return null; }, async upsert(i: never) { return i; } } as never, audit as never, undefined, scaleRepo([scale(6)]));
    await expect(six.setThreshold(actor, "Fraude", input(36), "r")).resolves.toBeTruthy();
    await expect(six.setThreshold(actor, "Fraude", input(37), "r")).rejects.toThrow(ValidationError);
    const three = new RiskAppetiteService({} as never, audit as never, undefined, scaleRepo([scale(3)]));
    await expect(three.setThreshold(actor, "Fraude", input(10), "r")).rejects.toThrow(/between 1 and 9/);
  });

  it("no rating scale wired: historical ceiling 25", async () => {
    const svc = new RiskAppetiteService({} as never, audit as never);
    await expect(svc.setThreshold(actor, "Fraude", input(26), "r")).rejects.toThrow(/between 1 and 25/);
  });

  it("committee threshold: 30 refused on 5x5, accepted on 6x6", async () => {
    const repo = { async getByTenant() { return null; }, async upsert(_t: string, p: object) { return { version: 1, ...p }; } } as never;
    const five = new ConfigService(repo, audit as never, scaleRepo([scale(5)]));
    await expect(five.updateCommitteeThresholds(actor, { evaluationMinScore: 30 }, "why", "r")).rejects.toThrow(ValidationError);
    const six = new ConfigService(repo, audit as never, scaleRepo([scale(6)]));
    await expect(six.updateCommitteeThresholds(actor, { evaluationMinScore: 30 }, "why", "r")).resolves.toBeTruthy();
  });
});

describe("config first write keeps the scale-based Committee default (PR #157 review)", () => {
  const cumulActor = { ...actor, roles: [...actor.roles, "config.cumul.set"] };
  const repo = (existing: object | null) => {
    const writes: Record<string, unknown>[] = [];
    return { writes, repo: { async getByTenant() { return existing; }, async upsert(_t: string, p: Record<string, unknown>) { writes.push(p); return { version: 1, ...p }; } } as never };
  };

  it.each([[3, 5], [6, 21]])("no config row on a %ix%i scale: first save writes threshold %i, not the column default 15", async (n, expected) => {
    const r = repo(null);
    await new ConfigService(r.repo, audit as never, scaleRepo([scale(n)])).setCommitteeAuditCumul(cumulActor, false, "why", "r");
    expect(r.writes[0]).toEqual({ committeeAuditCumulAllowed: false, committeeEvaluationMinScore: expected });
  });

  it("existing config row: the stored threshold is left untouched", async () => {
    const r = repo({ committeeEvaluationMinScore: 12 });
    await new ConfigService(r.repo, audit as never, scaleRepo([scale(3)])).setCommitteeAuditCumul(cumulActor, false, "why", "r");
    expect(r.writes[0]).toEqual({ committeeAuditCumulAllowed: false });
  });
});

describe("rating scale: thresholds ceiling and mandatory descriptors", () => {
  const svc = (s: RatingScale) => new RatingScaleService(scaleRepo([s]), audit as never, { async existsForRatingScale() { return false; } });

  it("thresholds above n² refused, within n² accepted", async () => {
    const s = scale(4, { status: "DRAFT" });
    await expect(svc(s).updateThresholds(actor, "s1", { thresholds: defaultCriticalityBands(5) }, "r")).rejects.toThrow(/maximum score.*16/);
    await expect(svc(s).updateThresholds(actor, "s1", { thresholds: defaultCriticalityBands(4) }, "r")).resolves.toBeTruthy();
  });

  it("activation refused without probability / impact / axis descriptors, accepted when complete", async () => {
    const draft = (o: Partial<RatingScale>) => svc(scale(4, { status: "DRAFT", ...o }));
    await expect(draft({ probabilityLabels: null }).activateVersion(actor, "s1", "r")).rejects.toThrow(/probabilityLabels/);
    await expect(draft({ impactLabels: lv(3) }).activateVersion(actor, "s1", "r")).rejects.toThrow(ValidationError);
    await expect(draft({ impactLabels: [...lv(3), { level: 4, label: " " }] }).activateVersion(actor, "s1", "r")).rejects.toThrow(ValidationError);
    const axes = { axes: [{ code: "A", label: "A", order: 1 }], retainedImpactRule: "MAX" as const };
    await expect(draft({ impactAxes: axes }).activateVersion(actor, "s1", "r")).rejects.toThrow(/levelLabels/);
    const complete = { axes: [{ code: "A", label: "A", order: 1, levelLabels: lv(4) }], retainedImpactRule: "MAX" as const };
    await expect(draft({ impactAxes: complete }).activateVersion(actor, "s1", "r")).resolves.toBeTruthy();
  });

  it("a DRAFT without descriptors can still be created and edited (descriptors optional in draft)", async () => {
    const s = scale(4, { status: "DRAFT", probabilityLabels: null, impactLabels: null });
    await expect(svc(s).updateThresholds(actor, "s1", { thresholds: defaultCriticalityBands(4) }, "r")).resolves.toBeTruthy();
  });
});
