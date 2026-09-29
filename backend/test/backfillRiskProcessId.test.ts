import { describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import {
  applyUniqueMatches,
  buildBackfillReport,
  classifyRisksForBackfill,
  normalizeProcessText,
  type ProcessLite,
  type RiskLite,
} from "../src/scripts/backfillRiskProcessId.js";
import type { RiskRepository } from "../src/domain/repositories/RiskRepository.js";
import type { ProcessRepository } from "../src/domain/repositories/ProcessRepository.js";
import type { Risk } from "../src/domain/entities/Risk.js";
import type { Process } from "../src/domain/entities/Process.js";

const TENANT = "tenant-1";
const OTHER_TENANT = "tenant-2";

function makeRisk(overrides: Partial<Risk> = {}): Risk {
  return {
    id: randomUUID(),
    tenantId: TENANT,
    process: "Some process",
    processId: null,
    description: "desc",
    ownerDepartmentId: null,
    ownerId: null,
    superiorOwnerId: null,
    status: "ACTIVE",
    createdAt: new Date(),
    updatedAt: new Date(),
    deletedAt: null,
    deletedBy: null,
    deletionReason: null,
    ...overrides,
  };
}

function makeProcess(overrides: Partial<Process> = {}): Process {
  return {
    id: randomUUID(),
    tenantId: TENANT,
    parentId: null,
    level: "PROCESS",
    name: "Some process",
    description: null,
    documentType: null,
    documentReference: null,
    owner: null,
    active: true,
    evaluationMode: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    deletedAt: null,
    deletedBy: null,
    deletionReason: null,
    ...overrides,
  };
}

function inMemoryRiskRepository(seed: Risk[]): RiskRepository & { store: Map<string, Risk> } {
  const store = new Map(seed.map((r) => [r.id, r]));
  return {
    store,
    async getById(tenantId, id) {
      const r = store.get(id);
      return r && r.tenantId === tenantId && !r.deletedAt ? r : null;
    },
    async listByIds(tenantId, ids) {
      return ids
        .map((id) => store.get(id))
        .filter((r): r is Risk => !!r && r.tenantId === tenantId && !r.deletedAt);
    },
    async list(tenantId, options) {
      return [...store.values()].filter(
        (r) =>
          r.tenantId === tenantId &&
          !r.deletedAt &&
          (options?.includeArchived || r.status !== "ARCHIVED") &&
          (options?.ownerId === undefined || r.ownerId === options.ownerId),
      );
    },
    async create(input) {
      const risk = makeRisk({ tenantId: input.tenantId, process: input.process, processId: input.processId ?? null });
      store.set(risk.id, risk);
      return risk;
    },
    async update(tenantId, id, input) {
      const existing = store.get(id);
      if (!existing || existing.tenantId !== tenantId) throw new Error("not found");
      const updated = { ...existing, ...input, updatedAt: new Date() };
      store.set(id, updated);
      return updated;
    },
    async assignOwner(tenantId, id, ownerId) {
      const existing = store.get(id);
      if (!existing || existing.tenantId !== tenantId) throw new Error("not found");
      const updated = { ...existing, ownerId, updatedAt: new Date() };
      store.set(id, updated);
      return updated;
    },
    async assignSuperiorOwner(tenantId, id, superiorOwnerId) {
      const existing = store.get(id);
      if (!existing || existing.tenantId !== tenantId) throw new Error("not found");
      const updated = { ...existing, superiorOwnerId, updatedAt: new Date() };
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

function inMemoryProcessRepository(seed: Process[]): ProcessRepository {
  const store = new Map(seed.map((p) => [p.id, p]));
  return {
    async getById(tenantId, id) {
      const p = store.get(id);
      return p && p.tenantId === tenantId && !p.deletedAt ? p : null;
    },
    async list(tenantId, options) {
      return [...store.values()].filter(
        (p) => p.tenantId === tenantId && !p.deletedAt && (options?.includeInactive || p.active),
      );
    },
    async create(input) {
      const process = makeProcess({ tenantId: input.tenantId, name: input.name, level: input.level });
      store.set(process.id, process);
      return process;
    },
    async update(tenantId, id, input) {
      const existing = store.get(id);
      if (!existing || existing.tenantId !== tenantId) throw new Error("not found");
      const updated = { ...existing, ...input, updatedAt: new Date() };
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

describe("normalizeProcessText", () => {
  it("trims, lowercases, and collapses internal whitespace", () => {
    expect(normalizeProcessText("  Gestion   des Risques  ")).toBe("gestion des risques");
    expect(normalizeProcessText("Gestion des Risques")).toBe("gestion des risques");
  });

  it("does not perform fuzzy matching — different text stays different", () => {
    expect(normalizeProcessText("Gestion des Risques")).not.toBe(normalizeProcessText("Gestion des Risque"));
  });
});

describe("classifyRisksForBackfill (pure classification)", () => {
  it("classifies as unique when exactly one Process matches, case/whitespace-insensitively", () => {
    const risks: RiskLite[] = [{ id: "r1", process: "  Gestion des Risques  " }];
    const processes: ProcessLite[] = [
      { id: "p1", name: "gestion des risques", level: "PROCESS", parentId: null },
    ];

    const [result] = classifyRisksForBackfill(risks, processes);
    expect(result).toEqual({
      kind: "unique",
      riskId: "r1",
      rawProcessText: "  Gestion des Risques  ",
      processId: "p1",
      processName: "gestion des risques",
    });
  });

  it("classifies as ambiguous when the same name exists under two different parents", () => {
    const risks: RiskLite[] = [{ id: "r1", process: "Recrutement" }];
    const processes: ProcessLite[] = [
      { id: "p1", name: "Recrutement", level: "SUBPROCESS", parentId: "parent-A" },
      { id: "p2", name: "Recrutement", level: "SUBPROCESS", parentId: "parent-B" },
    ];

    const [result] = classifyRisksForBackfill(risks, processes);
    expect(result?.kind).toBe("ambiguous");
    if (result?.kind === "ambiguous") {
      expect(result.candidates.map((c) => c.id).sort()).toEqual(["p1", "p2"]);
    }
  });

  it("classifies as ambiguous when the same name exists at two different levels", () => {
    const risks: RiskLite[] = [{ id: "r1", process: "Conformité" }];
    const processes: ProcessLite[] = [
      { id: "p1", name: "Conformité", level: "PROCESS", parentId: null },
      { id: "p2", name: "Conformité", level: "SUBPROCESS", parentId: "some-parent" },
    ];

    const [result] = classifyRisksForBackfill(risks, processes);
    expect(result?.kind).toBe("ambiguous");
  });

  it("classifies as unmatched when no Process name matches", () => {
    const risks: RiskLite[] = [{ id: "r1", process: "Processus inexistant" }];
    const processes: ProcessLite[] = [{ id: "p1", name: "Autre processus", level: "PROCESS", parentId: null }];

    const [result] = classifyRisksForBackfill(risks, processes);
    expect(result).toEqual({ kind: "unmatched", riskId: "r1", rawProcessText: "Processus inexistant" });
  });

  it("never performs fuzzy matching — a near-miss is unmatched, not a candidate", () => {
    const risks: RiskLite[] = [{ id: "r1", process: "Gestion des Risque" }]; // missing final 's'
    const processes: ProcessLite[] = [{ id: "p1", name: "Gestion des Risques", level: "PROCESS", parentId: null }];

    const [result] = classifyRisksForBackfill(risks, processes);
    expect(result?.kind).toBe("unmatched");
  });

  it("handles a mixed batch producing all three categories independently", () => {
    const risks: RiskLite[] = [
      { id: "r-unique", process: "Paiements" },
      { id: "r-ambiguous", process: "Recrutement" },
      { id: "r-unmatched", process: "Inexistant" },
    ];
    const processes: ProcessLite[] = [
      { id: "p-paiements", name: "Paiements", level: "PROCESS", parentId: null },
      { id: "p-recrutement-a", name: "Recrutement", level: "SUBPROCESS", parentId: "dept-A" },
      { id: "p-recrutement-b", name: "Recrutement", level: "SUBPROCESS", parentId: "dept-B" },
    ];

    const results = classifyRisksForBackfill(risks, processes);
    expect(results.find((r) => r.riskId === "r-unique")?.kind).toBe("unique");
    expect(results.find((r) => r.riskId === "r-ambiguous")?.kind).toBe("ambiguous");
    expect(results.find((r) => r.riskId === "r-unmatched")?.kind).toBe("unmatched");
  });
});

describe("buildBackfillReport (via in-memory repositories)", () => {
  it("only includes risks with processId null and non-empty process text, scoped to the tenant", async () => {
    const alreadyLinked = makeRisk({ process: "Paiements", processId: "already-set" });
    const emptyText = makeRisk({ process: "   ", processId: null });
    const candidate = makeRisk({ process: "Paiements", processId: null });
    const otherTenantRisk = makeRisk({ tenantId: OTHER_TENANT, process: "Paiements", processId: null });

    const process = makeProcess({ tenantId: TENANT, name: "Paiements" });

    const riskRepository = inMemoryRiskRepository([alreadyLinked, emptyText, candidate, otherTenantRisk]);
    const processRepository = inMemoryProcessRepository([process]);

    const report = await buildBackfillReport(riskRepository, processRepository, TENANT);

    expect(report.totalCandidateRisks).toBe(1);
    expect(report.unique).toHaveLength(1);
    expect(report.unique[0]?.riskId).toBe(candidate.id);
    expect(report.unique[0]?.processId).toBe(process.id);
  });

  it("produces the ambiguous bucket end-to-end when the same name exists under two parents", async () => {
    const risk = makeRisk({ process: "Recrutement", processId: null });
    const processA = makeProcess({ name: "Recrutement", level: "SUBPROCESS", parentId: "dept-A" });
    const processB = makeProcess({ name: "Recrutement", level: "SUBPROCESS", parentId: "dept-B" });

    const riskRepository = inMemoryRiskRepository([risk]);
    const processRepository = inMemoryProcessRepository([processA, processB]);

    const report = await buildBackfillReport(riskRepository, processRepository, TENANT);

    expect(report.unique).toHaveLength(0);
    expect(report.ambiguous).toHaveLength(1);
    expect(report.ambiguous[0]?.candidates).toHaveLength(2);
    expect(report.unmatched).toHaveLength(0);
  });

  it("produces the unmatched bucket end-to-end with the raw text preserved", async () => {
    const risk = makeRisk({ process: "Processus disparu", processId: null });
    const riskRepository = inMemoryRiskRepository([risk]);
    const processRepository = inMemoryProcessRepository([makeProcess({ name: "Autre chose" })]);

    const report = await buildBackfillReport(riskRepository, processRepository, TENANT);

    expect(report.unique).toHaveLength(0);
    expect(report.ambiguous).toHaveLength(0);
    expect(report.unmatched).toHaveLength(1);
    expect(report.unmatched[0]?.rawProcessText).toBe("Processus disparu");
  });
});

describe("applyUniqueMatches", () => {
  it("writes processId only for the given unique matches, never touching other risks", async () => {
    const risk = makeRisk({ process: "Paiements", processId: null });
    const untouchedRisk = makeRisk({ process: "Recrutement", processId: null });
    const process = makeProcess({ name: "Paiements" });

    const riskRepository = inMemoryRiskRepository([risk, untouchedRisk]);

    const result = await applyUniqueMatches(riskRepository, TENANT, [
      { kind: "unique", riskId: risk.id, rawProcessText: "Paiements", processId: process.id, processName: "Paiements" },
    ]);

    expect(result.applied).toBe(1);
    expect(result.failed).toHaveLength(0);
    expect(riskRepository.store.get(risk.id)?.processId).toBe(process.id);
    expect(riskRepository.store.get(untouchedRisk.id)?.processId).toBeNull();
  });

  it("dry-run (no call to applyUniqueMatches) leaves every risk's processId untouched", async () => {
    const risk = makeRisk({ process: "Paiements", processId: null });
    const riskRepository = inMemoryRiskRepository([risk]);
    const processRepository = inMemoryProcessRepository([makeProcess({ name: "Paiements" })]);

    await buildBackfillReport(riskRepository, processRepository, TENANT);

    expect(riskRepository.store.get(risk.id)?.processId).toBeNull();
  });
});
