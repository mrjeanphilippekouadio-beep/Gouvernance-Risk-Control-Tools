import { describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { KpiMeasureService } from "../src/services/KpiMeasureService.js";
import type { KpiMeasureRepository } from "../src/domain/repositories/KpiMeasureRepository.js";
import type { KpiRepository, KpiListFilters } from "../src/domain/repositories/KpiRepository.js";
import type { AuditRepository } from "../src/domain/repositories/AuditRepository.js";
import type { KpiMeasure } from "../src/domain/entities/KpiMeasure.js";
import type { Kpi } from "../src/domain/entities/Kpi.js";
import type { AuthenticatedUser } from "../src/infrastructure/identity/IdentityProvider.js";
import { ForbiddenError, ValidationError } from "../src/domain/errors/DomainErrors.js";

function inMemoryKpiMeasureRepository(): KpiMeasureRepository {
  const store = new Map<string, KpiMeasure>();
  const forKpi = (tenantId: string, kpiId: string) =>
    [...store.values()]
      .filter((m) => m.tenantId === tenantId && m.kpiId === kpiId)
      .sort((a, b) => b.period.getTime() - a.period.getTime() || b.createdAt.getTime() - a.createdAt.getTime());
  return {
    async getById(tenantId, id) {
      const m = store.get(id);
      return m && m.tenantId === tenantId ? m : null;
    },
    async listForKpi(tenantId, kpiId) {
      return forKpi(tenantId, kpiId);
    },
    async getLatest(tenantId, kpiId) {
      return forKpi(tenantId, kpiId)[0] ?? null;
    },
    async create(input) {
      const measure: KpiMeasure = {
        id: randomUUID(),
        tenantId: input.tenantId,
        kpiId: input.kpiId,
        period: input.period,
        value: input.value,
        comment: input.comment ?? null,
        recordedBy: input.recordedBy,
        createdAt: new Date(),
      };
      store.set(measure.id, measure);
      return measure;
    },
  };
}

function fakeKpiRepository(existingIds: string[]): KpiRepository {
  const kpi = (id: string): Kpi => ({
    id,
    tenantId: "tenant-1",
    label: "KPI",
    targetValue: 100,
    unit: "count",
    frequency: "MONTHLY",
    owner: "alice@djamo.com",
    departmentId: null,
    processId: "process-1",
    active: true,
    createdAt: new Date(),
    updatedAt: new Date(),
    deletedAt: null,
    deletedBy: null,
    deletionReason: null,
  });
  return {
    async getById(_tenantId, id) {
      return existingIds.includes(id) ? kpi(id) : null;
    },
    async list(_tenantId, _filters?: KpiListFilters) {
      return existingIds.map(kpi);
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
  };
}

const actor: AuthenticatedUser = {
  userId: "user-1",
  tenantId: "tenant-1",
  email: "manager@example.com",
  displayName: "Manager",
  roles: ["kpi.read", "kpi.create"],
};

const readOnlyActor: AuthenticatedUser = { ...actor, userId: "user-2", roles: ["kpi.read"] };

describe("KpiMeasureService.record (ACT-141)", () => {
  it("records a measure for an existing KPI", async () => {
    const service = new KpiMeasureService(inMemoryKpiMeasureRepository(), fakeKpiRepository(["kpi-1"]), inMemoryAuditRepository());
    const measure = await service.record(actor, { kpiId: "kpi-1", period: new Date("2026-01-01"), value: 42 }, "REQ-1");
    expect(measure.value).toBe(42);
    expect(measure.recordedBy).toBe("user-1");
  });

  it("rejects a measure for a KPI that does not exist in this tenant", async () => {
    const service = new KpiMeasureService(inMemoryKpiMeasureRepository(), fakeKpiRepository([]), inMemoryAuditRepository());
    await expect(
      service.record(actor, { kpiId: "missing", period: new Date("2026-01-01"), value: 42 }, "REQ-2"),
    ).rejects.toThrow(ValidationError);
  });

  it("rejects a non-finite value", async () => {
    const service = new KpiMeasureService(inMemoryKpiMeasureRepository(), fakeKpiRepository(["kpi-1"]), inMemoryAuditRepository());
    await expect(
      service.record(actor, { kpiId: "kpi-1", period: new Date("2026-01-01"), value: Number.NaN }, "REQ-3"),
    ).rejects.toThrow(ValidationError);
  });

  it("rejects an invalid period", async () => {
    const service = new KpiMeasureService(inMemoryKpiMeasureRepository(), fakeKpiRepository(["kpi-1"]), inMemoryAuditRepository());
    await expect(
      service.record(actor, { kpiId: "kpi-1", period: new Date("not-a-date"), value: 42 }, "REQ-4"),
    ).rejects.toThrow(ValidationError);
  });

  it("rejects a caller without kpi.create", async () => {
    const service = new KpiMeasureService(inMemoryKpiMeasureRepository(), fakeKpiRepository(["kpi-1"]), inMemoryAuditRepository());
    await expect(
      service.record(readOnlyActor, { kpiId: "kpi-1", period: new Date("2026-01-01"), value: 42 }, "REQ-5"),
    ).rejects.toThrow(ForbiddenError);
  });

  it("appends rather than replacing previous measures", async () => {
    const measures = inMemoryKpiMeasureRepository();
    const service = new KpiMeasureService(measures, fakeKpiRepository(["kpi-1"]), inMemoryAuditRepository());
    await service.record(actor, { kpiId: "kpi-1", period: new Date("2026-01-01"), value: 10 }, "REQ-6");
    await service.record(actor, { kpiId: "kpi-1", period: new Date("2026-02-01"), value: 20 }, "REQ-7");

    const all = await service.listForKpi(actor, "kpi-1");
    expect(all).toHaveLength(2);
  });
});
