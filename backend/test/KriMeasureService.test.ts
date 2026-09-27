import { describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { KriMeasureService } from "../src/services/KriMeasureService.js";
import type { KriMeasureRepository } from "../src/domain/repositories/KriMeasureRepository.js";
import type { KriListFilters, KriRepository } from "../src/domain/repositories/KriRepository.js";
import type { AuditRepository } from "../src/domain/repositories/AuditRepository.js";
import type { KriMeasure } from "../src/domain/entities/KriMeasure.js";
import type { Kri } from "../src/domain/entities/Kri.js";
import type { AuthenticatedUser } from "../src/infrastructure/identity/IdentityProvider.js";
import type { Notifier } from "../src/infrastructure/notifications/Notifier.js";
import { ForbiddenError, ValidationError } from "../src/domain/errors/DomainErrors.js";

function inMemoryKriMeasureRepository(): KriMeasureRepository {
  const store = new Map<string, KriMeasure>();
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
      const page = filters?.page && filters.page > 0 ? filters.page : 1;
      const pageSize = filters?.pageSize && filters.pageSize > 0 ? filters.pageSize : 20;
      const filtered = all.filter((m) => {
        if (filters?.from && m.measureDate < filters.from) return false;
        if (filters?.to && m.measureDate > filters.to) return false;
        return true;
      });
      const start = (page - 1) * pageSize;
      return { items: filtered.slice(start, start + pageSize), total: filtered.length, page, pageSize };
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

function fakeKriRepository(kris: Kri[]): KriRepository {
  return {
    async getById(tenantId, id) {
      return kris.find((k) => k.id === id && k.tenantId === tenantId) ?? null;
    },
    async list(_tenantId, _filters?: KriListFilters) {
      return kris;
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
    async listCoveredRiskIds() {
      return [];
    },
    async replaceCoveredRisks() {
      // not used in this test
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

function spyNotifier(): Notifier & { messages: string[] } {
  const messages: string[] = [];
  return {
    messages,
    async notify(message: string) {
      messages.push(message);
    },
  };
}

function kri(overrides: Partial<Kri> = {}): Kri {
  return {
    id: "kri-1",
    tenantId: "tenant-1",
    label: "Taux de fraude",
    formula: "fraudes / transactions",
    thresholdGreen: 1,
    thresholdOrange: 5,
    thresholdRed: 10,
    frequency: "MONTHLY",
    riskId: "risk-1",
    entity: null,
    methodologyVersion: null,
    description: null,
    active: true,
    createdAt: new Date(),
    updatedAt: new Date(),
    deletedAt: null,
    deletedBy: null,
    deletionReason: null,
    ...overrides,
  };
}

const actor: AuthenticatedUser = {
  userId: "user-1",
  tenantId: "tenant-1",
  email: "manager@example.com",
  displayName: "Manager",
  roles: ["kri.read", "kri.create"],
};

const readOnlyActor: AuthenticatedUser = { ...actor, userId: "user-2", roles: ["kri.read"] };

describe("KriMeasureService.record (ACT-133)", () => {
  it("records a measure for an existing KRI", async () => {
    const service = new KriMeasureService(inMemoryKriMeasureRepository(), fakeKriRepository([kri()]), inMemoryAuditRepository());
    const measure = await service.record(actor, { kriId: "kri-1", measureDate: new Date("2026-01-01"), value: 0, source: "manuel" }, "REQ-1");
    expect(measure.value).toBe(0);
    expect(measure.recordedBy).toBe("user-1");
  });

  it("rejects a measure for a KRI that does not exist in this tenant", async () => {
    const service = new KriMeasureService(inMemoryKriMeasureRepository(), fakeKriRepository([]), inMemoryAuditRepository());
    await expect(
      service.record(actor, { kriId: "missing", measureDate: new Date("2026-01-01"), value: 1, source: "manuel" }, "REQ-2"),
    ).rejects.toThrow(ValidationError);
  });

  it("rejects a non-finite value", async () => {
    const service = new KriMeasureService(inMemoryKriMeasureRepository(), fakeKriRepository([kri()]), inMemoryAuditRepository());
    await expect(
      service.record(actor, { kriId: "kri-1", measureDate: new Date("2026-01-01"), value: Number.NaN, source: "manuel" }, "REQ-3"),
    ).rejects.toThrow(ValidationError);
  });

  it("rejects an invalid measureDate", async () => {
    const service = new KriMeasureService(inMemoryKriMeasureRepository(), fakeKriRepository([kri()]), inMemoryAuditRepository());
    await expect(
      service.record(actor, { kriId: "kri-1", measureDate: new Date("not-a-date"), value: 1, source: "manuel" }, "REQ-4"),
    ).rejects.toThrow(ValidationError);
  });

  it("rejects an empty source", async () => {
    const service = new KriMeasureService(inMemoryKriMeasureRepository(), fakeKriRepository([kri()]), inMemoryAuditRepository());
    await expect(
      service.record(actor, { kriId: "kri-1", measureDate: new Date("2026-01-01"), value: 1, source: "  " }, "REQ-5"),
    ).rejects.toThrow(ValidationError);
  });

  it("rejects a caller without kri.create", async () => {
    const service = new KriMeasureService(inMemoryKriMeasureRepository(), fakeKriRepository([kri()]), inMemoryAuditRepository());
    await expect(
      service.record(readOnlyActor, { kriId: "kri-1", measureDate: new Date("2026-01-01"), value: 1, source: "manuel" }, "REQ-6"),
    ).rejects.toThrow(ForbiddenError);
  });

  it("appends rather than replacing previous measures", async () => {
    const measures = inMemoryKriMeasureRepository();
    const service = new KriMeasureService(measures, fakeKriRepository([kri()]), inMemoryAuditRepository());
    await service.record(actor, { kriId: "kri-1", measureDate: new Date("2026-01-01"), value: 0, source: "manuel" }, "REQ-7");
    await service.record(actor, { kriId: "kri-1", measureDate: new Date("2026-02-01"), value: 1, source: "manuel" }, "REQ-8");

    const page = await service.listForKri(actor, "kri-1");
    expect(page.items).toHaveLength(2);
    expect(page.total).toBe(2);
  });
});

describe("KriMeasureService.record — ACT-135 alert on threshold breach", () => {
  it("does not notify when the recorded value stays within the VERT zone", async () => {
    const notifier = spyNotifier();
    const service = new KriMeasureService(inMemoryKriMeasureRepository(), fakeKriRepository([kri()]), inMemoryAuditRepository(), notifier);
    await service.record(actor, { kriId: "kri-1", measureDate: new Date("2026-01-01"), value: 0, source: "manuel" }, "REQ-9");
    expect(notifier.messages).toHaveLength(0);
  });

  it("notifies once when the recorded value breaches the ORANGE threshold", async () => {
    const notifier = spyNotifier();
    const service = new KriMeasureService(inMemoryKriMeasureRepository(), fakeKriRepository([kri()]), inMemoryAuditRepository(), notifier);
    await service.record(actor, { kriId: "kri-1", measureDate: new Date("2026-01-01"), value: 6, source: "manuel" }, "REQ-10");
    expect(notifier.messages).toHaveLength(1);
    expect(notifier.messages[0]).toContain("ORANGE");
  });

  it("notifies when the recorded value breaches the ROUGE threshold", async () => {
    const notifier = spyNotifier();
    const service = new KriMeasureService(inMemoryKriMeasureRepository(), fakeKriRepository([kri()]), inMemoryAuditRepository(), notifier);
    await service.record(actor, { kriId: "kri-1", measureDate: new Date("2026-01-01"), value: 15, source: "manuel" }, "REQ-11");
    expect(notifier.messages).toHaveLength(1);
    expect(notifier.messages[0]).toContain("ROUGE");
  });

  it("still records the measure even without a notifier configured (optional dependency)", async () => {
    const service = new KriMeasureService(inMemoryKriMeasureRepository(), fakeKriRepository([kri()]), inMemoryAuditRepository());
    const measure = await service.record(actor, { kriId: "kri-1", measureDate: new Date("2026-01-01"), value: 15, source: "manuel" }, "REQ-12");
    expect(measure.value).toBe(15);
  });
});

describe("KriMeasureService.listForKri (ACT-138)", () => {
  it("paginates and filters history by date range, tenant-scoped", async () => {
    const measures = inMemoryKriMeasureRepository();
    const service = new KriMeasureService(measures, fakeKriRepository([kri()]), inMemoryAuditRepository());
    for (let m = 1; m <= 5; m++) {
      await service.record(actor, { kriId: "kri-1", measureDate: new Date(2026, m - 1, 1), value: m, source: "manuel" }, `REQ-page-${m}`);
    }

    const page1 = await service.listForKri(actor, "kri-1", { page: 1, pageSize: 2 });
    expect(page1.items).toHaveLength(2);
    expect(page1.total).toBe(5);

    const ranged = await service.listForKri(actor, "kri-1", { from: new Date(2026, 1, 1), to: new Date(2026, 2, 1) });
    expect(ranged.total).toBe(2);
  });

  it("rejects listing for a KRI that does not exist in this tenant", async () => {
    const service = new KriMeasureService(inMemoryKriMeasureRepository(), fakeKriRepository([]), inMemoryAuditRepository());
    await expect(service.listForKri(actor, "missing")).rejects.toThrow(ValidationError);
  });

  // QA-BATCH-1-3: no test in this suite previously seeded two tenants'
  // data into the same shared repository instance — every other test
  // above uses a single tenant, so a tenant-scoping regression (e.g. a
  // dropped tenantId filter) would slip through unnoticed.
  it("never mixes another tenant's measures into this tenant's history, even with the same kriId and a shared repository", async () => {
    const measures = inMemoryKriMeasureRepository();
    const kris = fakeKriRepository([kri({ tenantId: "tenant-1" }), kri({ tenantId: "tenant-2" })]);
    const service = new KriMeasureService(measures, kris, inMemoryAuditRepository());

    const tenant2Actor: AuthenticatedUser = { ...actor, tenantId: "tenant-2" };
    await service.record(actor, { kriId: "kri-1", measureDate: new Date("2026-01-01"), value: 1, source: "manuel" }, "REQ-T1");
    await service.record(tenant2Actor, { kriId: "kri-1", measureDate: new Date("2026-01-02"), value: 2, source: "manuel" }, "REQ-T2");

    const tenant1History = await service.listForKri(actor, "kri-1");
    expect(tenant1History.items).toHaveLength(1);
    expect(tenant1History.items[0]?.value).toBe(1);
  });
});
