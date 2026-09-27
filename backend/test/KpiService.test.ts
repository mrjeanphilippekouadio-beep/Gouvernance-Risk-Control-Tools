import { describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { KpiService } from "../src/services/KpiService.js";
import type { KpiListFilters, KpiRepository } from "../src/domain/repositories/KpiRepository.js";
import type { KpiMeasureRepository } from "../src/domain/repositories/KpiMeasureRepository.js";
import type { DepartmentRepository } from "../src/domain/repositories/DepartmentRepository.js";
import type { ProcessRepository } from "../src/domain/repositories/ProcessRepository.js";
import type { AuditRepository } from "../src/domain/repositories/AuditRepository.js";
import type { Kpi } from "../src/domain/entities/Kpi.js";
import type { KpiMeasure } from "../src/domain/entities/KpiMeasure.js";
import type { Department } from "../src/domain/entities/Department.js";
import type { Process } from "../src/domain/entities/Process.js";
import type { AuthenticatedUser } from "../src/infrastructure/identity/IdentityProvider.js";
import { ForbiddenError, NotFoundError, ValidationError } from "../src/domain/errors/DomainErrors.js";

function inMemoryKpiRepository(): KpiRepository {
  const store = new Map<string, Kpi>();
  return {
    async getById(tenantId, id) {
      const k = store.get(id);
      return k && k.tenantId === tenantId && !k.deletedAt ? k : null;
    },
    async list(tenantId, filters?: KpiListFilters) {
      return [...store.values()].filter((k) => {
        if (k.tenantId !== tenantId || k.deletedAt) return false;
        if (!filters?.includeInactive && !k.active) return false;
        if (filters?.departmentId && k.departmentId !== filters.departmentId) return false;
        if (filters?.processId && k.processId !== filters.processId) return false;
        return true;
      });
    },
    async create(input) {
      const kpi: Kpi = {
        id: randomUUID(),
        tenantId: input.tenantId,
        label: input.label,
        targetValue: input.targetValue,
        unit: input.unit,
        frequency: input.frequency,
        owner: input.owner,
        departmentId: input.departmentId ?? null,
        processId: input.processId ?? null,
        active: input.active ?? true,
        createdAt: new Date(),
        updatedAt: new Date(),
        deletedAt: null,
        deletedBy: null,
        deletionReason: null,
      };
      store.set(kpi.id, kpi);
      return kpi;
    },
    async update(tenantId, id, input) {
      const existing = store.get(id);
      if (!existing || existing.tenantId !== tenantId) throw new Error("not found");
      const updated: Kpi = {
        ...existing,
        ...input,
        departmentId: input.departmentId !== undefined ? input.departmentId : existing.departmentId,
        processId: input.processId !== undefined ? input.processId : existing.processId,
        updatedAt: new Date(),
      };
      store.set(id, updated);
      return updated;
    },
    async softDelete(tenantId, id, deletedBy, reason) {
      const existing = store.get(id);
      if (!existing || existing.tenantId !== tenantId) throw new Error("not found");
      store.set(id, { ...existing, deletedAt: new Date(), deletedBy, deletionReason: reason });
    },
  };
}

function inMemoryKpiMeasureRepository(seed: KpiMeasure[] = []): KpiMeasureRepository {
  const store = new Map<string, KpiMeasure>(seed.map((m) => [m.id, m]));
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

function fakeDepartmentRepository(existingIds: string[]): DepartmentRepository {
  const department = (id: string): Department => ({
    id,
    tenantId: "tenant-1",
    name: "Finance",
    entity: null,
    manager: "alice@djamo.com",
    riskOwner: "alice@djamo.com",
    riskOwnerDesignatedBy: null,
    riskOwnerDesignatedAt: null,
    linkedProcesses: null,
    active: true,
    createdAt: new Date(),
    updatedAt: new Date(),
    deletedAt: null,
    deletedBy: null,
    deletionReason: null,
  });
  return {
    async getById(_tenantId, id) {
      return existingIds.includes(id) ? department(id) : null;
    },
    async list() {
      return existingIds.map(department);
    },
    async create() {
      throw new Error("not used in this test");
    },
    async update() {
      throw new Error("not used in this test");
    },
    async designateRiskOwner() {
      throw new Error("not used in this test");
    },
    async softDelete() {
      throw new Error("not used in this test");
    },
  };
}

function fakeProcessRepository(existingIds: string[]): ProcessRepository {
  const process = (id: string): Process => ({
    id,
    tenantId: "tenant-1",
    parentId: null,
    level: "PROCESS",
    name: "Onboarding",
    description: null,
    documentType: null,
    documentReference: null,
    owner: null,
    active: true,
    createdAt: new Date(),
    updatedAt: new Date(),
    deletedAt: null,
    deletedBy: null,
    deletionReason: null,
  });
  return {
    async getById(_tenantId, id) {
      return existingIds.includes(id) ? process(id) : null;
    },
    async list() {
      return existingIds.map(process);
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
  email: "jp@example.com",
  displayName: "JP",
  roles: ["kpi.read", "kpi.create", "kpi.update", "kpi.delete"],
};

const readOnlyActor: AuthenticatedUser = {
  ...actor,
  userId: "user-readonly",
  roles: ["kpi.read"],
};

function makeService(options?: {
  kpis?: KpiRepository;
  measures?: KpiMeasureRepository;
  departmentIds?: string[];
  processIds?: string[];
}) {
  return new KpiService(
    options?.kpis ?? inMemoryKpiRepository(),
    options?.measures ?? inMemoryKpiMeasureRepository(),
    fakeDepartmentRepository(options?.departmentIds ?? ["dept-1"]),
    fakeProcessRepository(options?.processIds ?? ["process-1"]),
    inMemoryAuditRepository(),
  );
}

describe("KpiService.create (ACT-140)", () => {
  it("creates a KPI linked to a department", async () => {
    const service = makeService();
    const kpi = await service.create(
      actor,
      {
        label: "Taux de disponibilité",
        targetValue: 99.5,
        unit: "%",
        frequency: "MONTHLY",
        owner: "alice@djamo.com",
        departmentId: "dept-1",
      },
      "REQ-1",
    );
    expect(kpi.departmentId).toBe("dept-1");
    expect(kpi.targetValue).toBe(99.5);
  });

  it("rejects a KPI linked to neither a department nor a process", async () => {
    const service = makeService();
    await expect(
      service.create(
        actor,
        { label: "Orphan KPI", targetValue: 10, unit: "count", frequency: "MONTHLY", owner: "alice@djamo.com" },
        "REQ-2",
      ),
    ).rejects.toThrow(ValidationError);
  });

  it("rejects a department that does not exist in this tenant", async () => {
    const service = makeService({ departmentIds: [] });
    await expect(
      service.create(
        actor,
        {
          label: "KPI",
          targetValue: 10,
          unit: "count",
          frequency: "MONTHLY",
          owner: "alice@djamo.com",
          departmentId: "missing-dept",
        },
        "REQ-3",
      ),
    ).rejects.toThrow(ValidationError);
  });

  it("requires a numeric target value", async () => {
    const service = makeService();
    await expect(
      service.create(
        actor,
        {
          label: "KPI",
          targetValue: Number.NaN,
          unit: "count",
          frequency: "MONTHLY",
          owner: "alice@djamo.com",
          processId: "process-1",
        },
        "REQ-4",
      ),
    ).rejects.toThrow(ValidationError);
  });

  it("rejects a caller without kpi.create", async () => {
    const service = makeService();
    await expect(
      service.create(
        readOnlyActor,
        {
          label: "KPI",
          targetValue: 10,
          unit: "count",
          frequency: "MONTHLY",
          owner: "alice@djamo.com",
          processId: "process-1",
        },
        "REQ-5",
      ),
    ).rejects.toThrow(ForbiddenError);
  });
});

describe("KpiService status calculation (ACT-142)", () => {
  it("reports NO_MEASURE when nothing has been recorded yet", async () => {
    const service = makeService();
    const kpi = await service.create(
      actor,
      { label: "KPI", targetValue: 100, unit: "count", frequency: "MONTHLY", owner: "alice@djamo.com", processId: "process-1" },
      "REQ-6",
    );
    const withStatus = await service.get(actor, kpi.id);
    expect(withStatus.status).toBe("NO_MEASURE");
    expect(withStatus.achievementRate).toBeNull();
  });

  it("reports ACHIEVED when the latest measure meets the target", async () => {
    const measures = inMemoryKpiMeasureRepository();
    const service = makeService({ measures });
    const kpi = await service.create(
      actor,
      { label: "KPI", targetValue: 100, unit: "count", frequency: "MONTHLY", owner: "alice@djamo.com", processId: "process-1" },
      "REQ-7",
    );
    await measures.create({ tenantId: "tenant-1", kpiId: kpi.id, period: new Date("2026-01-01"), value: 110, recordedBy: "user-1" });

    const withStatus = await service.get(actor, kpi.id);
    expect(withStatus.status).toBe("ACHIEVED");
    expect(withStatus.achievementRate).toBeCloseTo(1.1);
  });

  it("reports AT_RISK between 80% and 100% of target", async () => {
    const measures = inMemoryKpiMeasureRepository();
    const service = makeService({ measures });
    const kpi = await service.create(
      actor,
      { label: "KPI", targetValue: 100, unit: "count", frequency: "MONTHLY", owner: "alice@djamo.com", processId: "process-1" },
      "REQ-8",
    );
    await measures.create({ tenantId: "tenant-1", kpiId: kpi.id, period: new Date("2026-01-01"), value: 85, recordedBy: "user-1" });

    const withStatus = await service.get(actor, kpi.id);
    expect(withStatus.status).toBe("AT_RISK");
  });

  it("reports NOT_ACHIEVED below 80% of target", async () => {
    const measures = inMemoryKpiMeasureRepository();
    const service = makeService({ measures });
    const kpi = await service.create(
      actor,
      { label: "KPI", targetValue: 100, unit: "count", frequency: "MONTHLY", owner: "alice@djamo.com", processId: "process-1" },
      "REQ-9",
    );
    await measures.create({ tenantId: "tenant-1", kpiId: kpi.id, period: new Date("2026-01-01"), value: 40, recordedBy: "user-1" });

    const withStatus = await service.get(actor, kpi.id);
    expect(withStatus.status).toBe("NOT_ACHIEVED");
  });

  it("uses the most recent period, not the most recently inserted row", async () => {
    const measures = inMemoryKpiMeasureRepository();
    const service = makeService({ measures });
    const kpi = await service.create(
      actor,
      { label: "KPI", targetValue: 100, unit: "count", frequency: "MONTHLY", owner: "alice@djamo.com", processId: "process-1" },
      "REQ-10",
    );
    // Inserted second but represents an earlier period — must not win.
    await measures.create({ tenantId: "tenant-1", kpiId: kpi.id, period: new Date("2026-02-01"), value: 100, recordedBy: "user-1" });
    await measures.create({ tenantId: "tenant-1", kpiId: kpi.id, period: new Date("2026-01-01"), value: 10, recordedBy: "user-1" });

    const withStatus = await service.get(actor, kpi.id);
    expect(withStatus.latestMeasureValue).toBe(100);
    expect(withStatus.status).toBe("ACHIEVED");
  });
});

describe("KpiService.list (ACT-143 dashboard)", () => {
  it("filters by department and process", async () => {
    const service = makeService({ departmentIds: ["dept-1"], processIds: ["process-1"] });
    await service.create(
      actor,
      { label: "Dept KPI", targetValue: 10, unit: "count", frequency: "MONTHLY", owner: "alice@djamo.com", departmentId: "dept-1" },
      "REQ-11",
    );
    await service.create(
      actor,
      { label: "Process KPI", targetValue: 10, unit: "count", frequency: "MONTHLY", owner: "alice@djamo.com", processId: "process-1" },
      "REQ-12",
    );

    const byDept = await service.list(actor, { departmentId: "dept-1" });
    expect(byDept).toHaveLength(1);
    expect(byDept[0]?.label).toBe("Dept KPI");

    const byProcess = await service.list(actor, { processId: "process-1" });
    expect(byProcess).toHaveLength(1);
    expect(byProcess[0]?.label).toBe("Process KPI");
  });
});

describe("KpiService.link (ACT-144)", () => {
  it("relinks a KPI from a department to a process", async () => {
    const service = makeService({ departmentIds: ["dept-1"], processIds: ["process-1"] });
    const kpi = await service.create(
      actor,
      { label: "KPI", targetValue: 10, unit: "count", frequency: "MONTHLY", owner: "alice@djamo.com", departmentId: "dept-1" },
      "REQ-13",
    );

    const relinked = await service.link(actor, kpi.id, { departmentId: null, processId: "process-1" }, "REQ-14");
    expect(relinked.departmentId).toBeNull();
    expect(relinked.processId).toBe("process-1");
  });

  it("rejects clearing both links at once", async () => {
    const service = makeService({ departmentIds: ["dept-1"] });
    const kpi = await service.create(
      actor,
      { label: "KPI", targetValue: 10, unit: "count", frequency: "MONTHLY", owner: "alice@djamo.com", departmentId: "dept-1" },
      "REQ-15",
    );

    await expect(service.link(actor, kpi.id, { departmentId: null, processId: null }, "REQ-16")).rejects.toThrow(
      ValidationError,
    );
  });
});

describe("KpiService.archive", () => {
  it("requires a reason", async () => {
    const service = makeService({ processIds: ["process-1"] });
    const kpi = await service.create(
      actor,
      { label: "KPI", targetValue: 10, unit: "count", frequency: "MONTHLY", owner: "alice@djamo.com", processId: "process-1" },
      "REQ-17",
    );
    await expect(service.archive(actor, kpi.id, "", "REQ-18")).rejects.toThrow(ValidationError);
  });

  it("makes an archived KPI unreachable through get()", async () => {
    const service = makeService({ processIds: ["process-1"] });
    const kpi = await service.create(
      actor,
      { label: "KPI", targetValue: 10, unit: "count", frequency: "MONTHLY", owner: "alice@djamo.com", processId: "process-1" },
      "REQ-19",
    );
    await service.archive(actor, kpi.id, "Métrique retirée du référentiel", "REQ-20");
    await expect(service.get(actor, kpi.id)).rejects.toThrow(NotFoundError);
  });
});
