import { describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import ExcelJS from "exceljs";
import { RiskImportService } from "../src/services/RiskImportService.js";
import { RiskService } from "../src/services/RiskService.js";
import type { RiskRepository } from "../src/domain/repositories/RiskRepository.js";
import type { AuditRepository } from "../src/domain/repositories/AuditRepository.js";
import type { Risk } from "../src/domain/entities/Risk.js";
import type { AuthenticatedUser } from "../src/infrastructure/identity/IdentityProvider.js";
import { ForbiddenError, ValidationError } from "../src/domain/errors/DomainErrors.js";

function inMemoryRiskRepository(): { repo: RiskRepository; all: () => Risk[] } {
  const byId = new Map<string, Risk>();
  return {
    all: () => [...byId.values()],
    repo: {
      async getById(tenantId, id) {
        const r = byId.get(id);
        return r && r.tenantId === tenantId ? r : null;
      },
      async listByIds() {
        return [];
      },
      async list() {
        return [...byId.values()];
      },
      async create(input) {
        const risk: Risk = {
          id: randomUUID(),
          tenantId: input.tenantId,
          process: input.process,
          description: input.description,
          ownerDepartmentId: input.ownerDepartmentId ?? null,
          ownerId: null,
          superiorOwnerId: null,
          status: "DRAFT",
          createdAt: new Date(),
          updatedAt: new Date(),
          deletedAt: null,
          deletedBy: null,
          deletionReason: null,
        };
        byId.set(risk.id, risk);
        return risk;
      },
      async update(_tenantId, id, input) {
        const existing = byId.get(id);
        if (!existing) throw new Error("not found");
        const updated = { ...existing, ...input };
        byId.set(id, updated);
        return updated;
      },
      async assignOwner(_tenantId, id, ownerId) {
        const existing = byId.get(id)!;
        const updated = { ...existing, ownerId };
        byId.set(id, updated);
        return updated;
      },
      async assignSuperiorOwner(_tenantId, id, superiorOwnerId) {
        const existing = byId.get(id)!;
        const updated = { ...existing, superiorOwnerId };
        byId.set(id, updated);
        return updated;
      },
      async softDelete() {},
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
  email: "jp@example.com",
  displayName: "JP",
  roles: ["config.manage", "risk.create"],
};

const noManageActor: AuthenticatedUser = { ...actor, userId: "user-2", roles: ["risk.create"] };
const noRiskCreateActor: AuthenticatedUser = { ...actor, userId: "user-3", roles: ["config.manage"] };

async function buildWorkbook(rows: (string | number)[][], headers = ["processus", "description"]): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet("Risques");
  sheet.addRow(headers);
  for (const row of rows) sheet.addRow(row);
  const arrayBuffer = await workbook.xlsx.writeBuffer();
  return Buffer.from(arrayBuffer);
}

describe("RiskImportService", () => {
  it("dry-run preview reports valid/invalid rows without creating any Risk", async () => {
    const { repo: riskRepo, all } = inMemoryRiskRepository();
    const riskService = new RiskService(riskRepo, inMemoryAuditRepository());
    const importService = new RiskImportService(riskService);

    const buffer = await buildWorkbook([
      ["Paiements", "Fraude sur virement"],
      ["", ""], // blank row, skipped entirely
      ["", "Description sans processus"], // invalid: process missing
    ]);

    const report = await importService.preview(actor, buffer);

    expect(report.totalRows).toBe(2);
    expect(report.validCount).toBe(1);
    expect(report.invalidCount).toBe(1);
    expect(report.rows.find((r) => r.errors.length > 0)?.errors[0]).toMatch(/process/);
    expect(all()).toHaveLength(0);
  });

  it("rejects preview for an actor without config.manage", async () => {
    const { repo: riskRepo } = inMemoryRiskRepository();
    const riskService = new RiskService(riskRepo, inMemoryAuditRepository());
    const importService = new RiskImportService(riskService);
    const buffer = await buildWorkbook([["Paiements", "Fraude"]]);

    await expect(importService.preview(noManageActor, buffer)).rejects.toThrow(ForbiddenError);
  });

  it("commit creates exactly the valid rows via RiskService.create and reports the rest as failed", async () => {
    const { repo: riskRepo, all } = inMemoryRiskRepository();
    const riskService = new RiskService(riskRepo, inMemoryAuditRepository());
    const importService = new RiskImportService(riskService);

    const buffer = await buildWorkbook([
      ["Paiements", "Fraude sur virement"],
      ["Recouvrement", "Impayés clients"],
      ["", "Ligne invalide"],
    ]);

    const report = await importService.commit(actor, buffer, "REQ-1");

    expect(report.createdCount).toBe(2);
    expect(all()).toHaveLength(2);
    expect(all().map((r) => r.process).sort()).toEqual(["Paiements", "Recouvrement"]);
    expect(report.rows.find((r) => r.process === undefined)?.errors.length).toBeGreaterThan(0);
  });

  it("commit re-validates rather than trusting a prior preview — an actor holding config.manage but not risk.create creates nothing and every row fails", async () => {
    const { repo: riskRepo, all } = inMemoryRiskRepository();
    const riskService = new RiskService(riskRepo, inMemoryAuditRepository());
    const importService = new RiskImportService(riskService);
    const buffer = await buildWorkbook([["Paiements", "Fraude sur virement"]]);

    const report = await importService.commit(noRiskCreateActor, buffer, "REQ-1");

    expect(report.createdCount).toBe(0);
    expect(all()).toHaveLength(0);
    expect(report.rows[0]?.errors.some((e) => e.includes("risk.create"))).toBe(true);
  });

  it("recognizes header aliases (process/processus) case-insensitively", async () => {
    const { repo: riskRepo } = inMemoryRiskRepository();
    const riskService = new RiskService(riskRepo, inMemoryAuditRepository());
    const importService = new RiskImportService(riskService);
    const buffer = await buildWorkbook([["Paiements", "Fraude"]], ["Process", "Description"]);

    const report = await importService.preview(actor, buffer);
    expect(report.validCount).toBe(1);
  });

  it("throws a ValidationError when the required columns cannot be found", async () => {
    const { repo: riskRepo } = inMemoryRiskRepository();
    const riskService = new RiskService(riskRepo, inMemoryAuditRepository());
    const importService = new RiskImportService(riskService);
    const buffer = await buildWorkbook([["a", "b"]], ["colonne1", "colonne2"]);

    await expect(importService.preview(actor, buffer)).rejects.toThrow(ValidationError);
  });
});
