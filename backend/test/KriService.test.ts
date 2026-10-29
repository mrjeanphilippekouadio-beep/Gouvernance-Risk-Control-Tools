import { describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { KriService } from "../src/services/KriService.js";
import type { KriListFilters, KriRepository } from "../src/domain/repositories/KriRepository.js";
import type { KriMeasureRepository } from "../src/domain/repositories/KriMeasureRepository.js";
import type { RiskRepository } from "../src/domain/repositories/RiskRepository.js";
import type { AuditRepository } from "../src/domain/repositories/AuditRepository.js";
import type { Kri } from "../src/domain/entities/Kri.js";
import type { KriMeasure } from "../src/domain/entities/KriMeasure.js";
import type { Risk } from "../src/domain/entities/Risk.js";
import type { AuthenticatedUser } from "../src/infrastructure/identity/IdentityProvider.js";
import { ForbiddenError, NotFoundError, ValidationError } from "../src/domain/errors/DomainErrors.js";

function inMemoryKriRepository(): KriRepository {
  const store = new Map<string, Kri>();
  const coveredRisks = new Map<string, string[]>();
  return {
    async getById(tenantId, id) {
      const k = store.get(id);
      return k && k.tenantId === tenantId && !k.deletedAt ? k : null;
    },
    async list(tenantId, filters?: KriListFilters) {
      return [...store.values()].filter((k) => {
        if (k.tenantId !== tenantId || k.deletedAt) return false;
        if (!filters?.includeInactive && !k.active) return false;
        if (filters?.riskId && k.riskId !== filters.riskId) return false;
        if (filters?.entity && k.entity !== filters.entity) return false;
        return true;
      });
    },
    async create(input) {
      const kri: Kri = {
        id: randomUUID(),
        tenantId: input.tenantId,
        label: input.label,
        formula: input.formula,
        thresholdGreen: input.thresholdGreen,
        thresholdOrange: input.thresholdOrange,
        thresholdRed: input.thresholdRed,
        frequency: input.frequency,
        riskId: input.riskId,
        entity: input.entity ?? null,
        methodologyVersion: input.methodologyVersion ?? null,
        description: input.description ?? null,
        active: input.active ?? true,
        createdAt: new Date(),
        updatedAt: new Date(),
        deletedAt: null,
        deletedBy: null,
        deletionReason: null,
      };
      store.set(kri.id, kri);
      return kri;
    },
    async update(tenantId, id, input) {
      const existing = store.get(id);
      if (!existing || existing.tenantId !== tenantId) throw new NotFoundError("Kri", id);
      const updated: Kri = { ...existing, ...input, updatedAt: new Date() };
      store.set(id, updated);
      return updated;
    },
    async softDelete(tenantId, id, deletedBy, reason) {
      const existing = store.get(id);
      if (!existing || existing.tenantId !== tenantId) throw new NotFoundError("Kri", id);
      store.set(id, { ...existing, deletedAt: new Date(), deletedBy, deletionReason: reason });
    },
    async listCoveredRiskIds(_tenantId, kriId) {
      return coveredRisks.get(kriId) ?? [];
    },
    async replaceCoveredRisks(_tenantId, kriId, riskIds) {
      coveredRisks.set(kriId, riskIds);
    },
  };
}

function inMemoryKriMeasureRepository(seed: KriMeasure[] = []): KriMeasureRepository {
  const store = new Map<string, KriMeasure>(seed.map((m) => [m.id, m]));
  const forKri = (tenantId: string, kriId: string) =>
    [...store.values()]
      .filter((m) => m.tenantId === tenantId && m.kriId === kriId)
      .sort((a, b) => b.measureDate.getTime() - a.measureDate.getTime() || b.createdAt.getTime() - a.createdAt.getTime());
  return {
    async getById(tenantId, id) {
      const m = store.get(id);
      return m && m.tenantId === tenantId ? m : null;
    },
    async listForKri(tenantId, kriId, filters) {
      const all = forKri(tenantId, kriId);
      const page = filters?.page ?? 1;
      const pageSize = filters?.pageSize ?? 20;
      const start = (page - 1) * pageSize;
      return { items: all.slice(start, start + pageSize), total: all.length, page, pageSize };
    },
    async getLatest(tenantId, kriId) {
      return forKri(tenantId, kriId)[0] ?? null;
    },
    async create(input) {
      const measure: KriMeasure = {
        id: randomUUID(),
        tenantId: input.tenantId,
        kriId: input.kriId,
        measureDate: input.measureDate,
        value: input.value,
        source: input.source,
        comment: input.comment ?? null,
        recordedBy: input.recordedBy,
        createdAt: new Date(),
      };
      store.set(measure.id, measure);
      return measure;
    },
  };
}

function fakeRiskRepository(existingIds: string[]): RiskRepository {
  const risk = (id: string): Risk => ({
    id,
    tenantId: "tenant-1",
    process: "Payments",
    description: "Risk description",
    ownerDepartmentId: "dept-1",
    status: "ACTIVE",
    createdAt: new Date(),
    updatedAt: new Date(),
    deletedAt: null,
    deletedBy: null,
    deletionReason: null,
  });
  return {
    async getById(_tenantId, id) {
      return existingIds.includes(id) ? risk(id) : null;
    },
    async listByIds(_tenantId, ids) {
      return ids.filter((id) => existingIds.includes(id)).map(risk);
    },
    async list() {
      return existingIds.map(risk);
    },
    async create() {
      throw new Error("not used in this test");
    },
    async update() {
      throw new Error("not used in this test");
    },
    async softDelete() {
      throw new Error("not used in this test");
    },
  };
}

function inMemoryAuditRepository(): AuditRepository {
  return {
    async record() {},
    async listForEntity() {
      return [];
    },
    async listRecent() {
      return [];
    },
  };
}

const actor: AuthenticatedUser = {
  userId: "user-1",
  tenantId: "tenant-1",
  email: "manager@example.com",
  displayName: "Manager",
  roles: ["kri.read", "kri.create", "kri.update", "kri.delete"],
};

const updateOnlyActor: AuthenticatedUser = { ...actor, userId: "user-2", roles: ["kri.read", "kri.update"] };
const readOnlyActor: AuthenticatedUser = { ...actor, userId: "user-3", roles: ["kri.read"] };

const validInput = {
  label: "Taux de fraude",
  formula: "nombre de fraudes / nombre de transactions",
  thresholdGreen: 1,
  thresholdOrange: 5,
  thresholdRed: 10,
  frequency: "MONTHLY" as const,
  riskId: "risk-1",
};

describe("KriService.create (ACT-130)", () => {
  it("creates a KRI with a valid threshold order and an existing risk link", async () => {
    const service = new KriService(inMemoryKriRepository(), inMemoryKriMeasureRepository(), fakeRiskRepository(["risk-1"]), inMemoryAuditRepository());
    const kri = await service.create(actor, validInput, "REQ-1");
    expect(kri.riskId).toBe("risk-1");
    expect(kri.thresholdGreen).toBe(1);
  });

  it("rejects thresholds that are not strictly increasing (green < orange < red)", async () => {
    const service = new KriService(inMemoryKriRepository(), inMemoryKriMeasureRepository(), fakeRiskRepository(["risk-1"]), inMemoryAuditRepository());
    await expect(
      service.create(actor, { ...validInput, thresholdOrange: 1 }, "REQ-2"),
    ).rejects.toThrow(ValidationError);
    await expect(
      service.create(actor, { ...validInput, thresholdGreen: 5, thresholdOrange: 5, thresholdRed: 10 }, "REQ-3"),
    ).rejects.toThrow(ValidationError);
  });

  it("rejects a riskId that does not exist in this tenant", async () => {
    const service = new KriService(inMemoryKriRepository(), inMemoryKriMeasureRepository(), fakeRiskRepository([]), inMemoryAuditRepository());
    await expect(service.create(actor, validInput, "REQ-4")).rejects.toThrow(ValidationError);
  });

  it("rejects a caller without kri.create", async () => {
    const service = new KriService(inMemoryKriRepository(), inMemoryKriMeasureRepository(), fakeRiskRepository(["risk-1"]), inMemoryAuditRepository());
    await expect(service.create(readOnlyActor, validInput, "REQ-5")).rejects.toThrow(ForbiddenError);
  });
});

describe("KriService status computation (ACT-134)", () => {
  it("reports NO_MEASURE when no measure has ever been recorded", async () => {
    const kris = inMemoryKriRepository();
    const service = new KriService(kris, inMemoryKriMeasureRepository(), fakeRiskRepository(["risk-1"]), inMemoryAuditRepository());
    const kri = await service.create(actor, validInput, "REQ-6");
    const withStatus = await service.get(actor, kri.id);
    expect(withStatus.status).toBe("NO_MEASURE");
  });

  it("computes VERT/ORANGE/ROUGE from the latest measure against thresholds", async () => {
    const kris = inMemoryKriRepository();
    const measures = inMemoryKriMeasureRepository();
    const service = new KriService(kris, measures, fakeRiskRepository(["risk-1"]), inMemoryAuditRepository());
    const kri = await service.create(actor, validInput, "REQ-7");

    await measures.create({ tenantId: "tenant-1", kriId: kri.id, measureDate: new Date("2026-01-01"), value: 0, source: "manuel", recordedBy: "user-1" });
    expect((await service.get(actor, kri.id)).status).toBe("VERT");

    await measures.create({ tenantId: "tenant-1", kriId: kri.id, measureDate: new Date("2026-02-01"), value: 6, source: "manuel", recordedBy: "user-1" });
    expect((await service.get(actor, kri.id)).status).toBe("ORANGE");

    await measures.create({ tenantId: "tenant-1", kriId: kri.id, measureDate: new Date("2026-03-01"), value: 12, source: "manuel", recordedBy: "user-1" });
    expect((await service.get(actor, kri.id)).status).toBe("ROUGE");
  });
});

describe("KriService.update (ACT-131)", () => {
  it("validates the resulting threshold order when only some thresholds are changed", async () => {
    const kris = inMemoryKriRepository();
    const service = new KriService(kris, inMemoryKriMeasureRepository(), fakeRiskRepository(["risk-1"]), inMemoryAuditRepository());
    const kri = await service.create(actor, validInput, "REQ-8");

    // Lowering thresholdRed below the existing thresholdOrange (5) must fail.
    await expect(service.update(actor, kri.id, { thresholdRed: 3 }, "REQ-9")).rejects.toThrow(ValidationError);

    const updated = await service.update(actor, kri.id, { thresholdRed: 20 }, "REQ-10");
    expect(updated.thresholdRed).toBe(20);
  });

  it("F7S6-01: with a transactional repository, every write hands its audit rows to the repository (none recorded after)", async () => {
    const base = inMemoryKriRepository();
    const handed: string[] = [];
    type Builder = ((r: unknown) => Array<{ action: string }>) | undefined;
    const take = (audit: Builder, result: unknown) => { for (const e of audit?.(result) ?? []) handed.push(e.action); };
    const kris = {
      ...base,
      auditsInTransaction: true,
      async create(i: Parameters<KriRepository["create"]>[0], a?: Builder) { const k = await base.create(i); take(a, k); return k; },
      async update(t: string, id: string, i: Parameters<KriRepository["update"]>[2], a?: Builder) { const k = await base.update(t, id, i); take(a, k); return k; },
      async replaceCoveredRisks(t: string, id: string, ids: string[], a?: Builder) { const old = await base.listCoveredRiskIds(t, id); await base.replaceCoveredRisks(t, id, ids); take(a, old); return old; },
      async softDelete(t: string, id: string, by: string, r: string, a?: Builder) { await base.softDelete(t, id, by, r); take(a, undefined); },
    } as unknown as KriRepository;
    let recorded = 0;
    const audit = { ...inMemoryAuditRepository(), async record() { recorded++; } } as AuditRepository;
    const service = new KriService(kris, inMemoryKriMeasureRepository(), fakeRiskRepository(["risk-1", "risk-2"]), audit);

    const kri = await service.create(actor, validInput, "REQ-30");
    await service.update(actor, kri.id, { label: "Nouveau" }, "REQ-31");
    await service.addCoveredRisks(actor, kri.id, ["risk-2"], "REQ-32");
    await service.disable(actor, kri.id, "motif", "REQ-33");
    expect(handed).toEqual(["CREATE", "UPDATE", "ASSIGN", "DELETE"]);
    expect(recorded).toBe(0);
  });

  it("never changes `active` (false or true): deactivation goes through disable under kri.delete", async () => {
    const kris = inMemoryKriRepository();
    const service = new KriService(kris, inMemoryKriMeasureRepository(), fakeRiskRepository(["risk-1"]), inMemoryAuditRepository());
    const kri = await service.create(actor, validInput, "REQ-11");

    await expect(service.update(updateOnlyActor, kri.id, { active: false }, "REQ-12")).rejects.toThrow(ValidationError);
    await expect(service.update(actor, kri.id, { active: true }, "REQ-13")).rejects.toThrow(ValidationError);
    expect((await service.get(actor, kri.id)).active).toBe(true);
  });
});

describe("KriService.disable (ACT-132, terminal-state permission gating)", () => {
  it("rejects disable for a caller who only has kri.update", async () => {
    const kris = inMemoryKriRepository();
    const service = new KriService(kris, inMemoryKriMeasureRepository(), fakeRiskRepository(["risk-1"]), inMemoryAuditRepository());
    const kri = await service.create(actor, validInput, "REQ-11");
    await expect(service.disable(updateOnlyActor, kri.id, "no longer relevant", "REQ-12")).rejects.toThrow(ForbiddenError);
  });

  it("allows disable for a caller with kri.delete, and requires a reason", async () => {
    const kris = inMemoryKriRepository();
    const service = new KriService(kris, inMemoryKriMeasureRepository(), fakeRiskRepository(["risk-1"]), inMemoryAuditRepository());
    const kri = await service.create(actor, validInput, "REQ-13");

    await expect(service.disable(actor, kri.id, "", "REQ-14")).rejects.toThrow(ValidationError);

    await service.disable(actor, kri.id, "no longer relevant", "REQ-15");
    await expect(service.get(actor, kri.id)).rejects.toThrow(NotFoundError);
  });
});

describe("KriService.addCoveredRisks (ACT-136)", () => {
  it("validates every additional risk exists in this tenant and excludes the primary riskId", async () => {
    const kris = inMemoryKriRepository();
    const service = new KriService(kris, inMemoryKriMeasureRepository(), fakeRiskRepository(["risk-1", "risk-2"]), inMemoryAuditRepository());
    const kri = await service.create(actor, validInput, "REQ-16");

    const result = await service.addCoveredRisks(actor, kri.id, ["risk-2", "risk-1"], "REQ-17");
    expect(result.coveredRiskIds).toEqual(["risk-2"]);
  });

  it("rejects an additional risk that does not exist in this tenant", async () => {
    const kris = inMemoryKriRepository();
    const service = new KriService(kris, inMemoryKriMeasureRepository(), fakeRiskRepository(["risk-1"]), inMemoryAuditRepository());
    const kri = await service.create(actor, validInput, "REQ-18");
    await expect(service.addCoveredRisks(actor, kri.id, ["missing-risk"], "REQ-19")).rejects.toThrow(ValidationError);
  });

  it("F7-S6: get returns the covered risks; replacing them audits the previous set as oldValue", async () => {
    const kris = inMemoryKriRepository();
    const events: Array<{ oldValue: unknown; newValue: unknown }> = [];
    const audit = { ...inMemoryAuditRepository(), async record(e: { oldValue: unknown; newValue: unknown }) { events.push(e); } } as AuditRepository;
    const service = new KriService(kris, inMemoryKriMeasureRepository(), fakeRiskRepository(["risk-1", "risk-2", "risk-3"]), audit);
    const kri = await service.create(actor, validInput, "REQ-20");

    await service.addCoveredRisks(actor, kri.id, ["risk-2"], "REQ-21");
    expect((await service.get(readOnlyActor, kri.id)).coveredRiskIds).toEqual(["risk-2"]);
    await service.addCoveredRisks(actor, kri.id, ["risk-3"], "REQ-22");
    expect((await service.get(readOnlyActor, kri.id)).coveredRiskIds).toEqual(["risk-3"]);
    expect(events.at(-1)).toMatchObject({ oldValue: { coveredRiskIds: ["risk-2"] }, newValue: { coveredRiskIds: ["risk-3"] } });
  });
});

describe("KriService.dashboard (ACT-137)", () => {
  it("filters by status and department resolved from the linked risk", async () => {
    const kris = inMemoryKriRepository();
    const measures = inMemoryKriMeasureRepository();
    const service = new KriService(kris, measures, fakeRiskRepository(["risk-1"]), inMemoryAuditRepository());
    const kri = await service.create(actor, validInput, "REQ-20");
    await measures.create({ tenantId: "tenant-1", kriId: kri.id, measureDate: new Date("2026-01-01"), value: 12, source: "manuel", recordedBy: "user-1" });

    const rouge = await service.dashboard(actor, { status: "ROUGE" });
    expect(rouge).toHaveLength(1);
    expect(rouge[0]?.departmentId).toBe("dept-1");

    const vert = await service.dashboard(actor, { status: "VERT" });
    expect(vert).toHaveLength(0);

    const wrongDept = await service.dashboard(actor, { departmentId: "dept-2" });
    expect(wrongDept).toHaveLength(0);
  });
});
