import { describe, expect, it } from "vitest";
import ExcelJS from "exceljs";
import { createHash } from "node:crypto";
import { EvidenceService } from "../src/services/EvidenceService.js";
import { XLSX_MIME } from "../src/services/evidenceFileValidation.js";
import type { EvidenceRepository } from "../src/domain/repositories/EvidenceRepository.js";
import type { AuditRepository } from "../src/domain/repositories/AuditRepository.js";
import type { DocumentStorage } from "../src/infrastructure/storage/DocumentStorage.js";
import type { Evidence } from "../src/domain/entities/Evidence.js";
import type { AuthenticatedUser } from "../src/infrastructure/identity/IdentityProvider.js";
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from "../src/domain/errors/DomainErrors.js";

const sha = (b: Buffer) => createHash("sha256").update(b).digest("hex");

async function workbookBuffer(build: (wb: ExcelJS.Workbook) => void): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  build(wb);
  return Buffer.from(await wb.xlsx.writeBuffer());
}

function setup(content: Buffer, overrides: Partial<Evidence> = {}) {
  const evidence: Evidence = {
    id: "ev-1", tenantId: "tenant-a", controlExecutionId: "exec-1", fileName: "f.xlsx", driveFileId: "drive-1",
    driveUrl: "u", documentType: "CONTROL_EVIDENCE", uploadedBy: "u", sha256: sha(content), fileSize: content.length,
    mimeType: XLSX_MIME, uploadedAt: new Date(), version: 1, status: "ACTIVE", ...overrides,
  };
  const calls = { getContent: 0, writes: 0 };
  const repo = {
    async getById(t: string, id: string) { return t === evidence.tenantId && id === evidence.id ? evidence : null; },
    async create() { calls.writes++; return evidence; },
    async markDeleted() { calls.writes++; },
  } as unknown as EvidenceRepository;
  const storage = {
    async getContent() { calls.getContent++; return content; },
    async upload() { calls.writes++; throw new Error("no"); },
    async delete() { calls.writes++; },
  } as unknown as DocumentStorage;
  const audit = { async record() { calls.writes++; } } as unknown as AuditRepository;
  return { calls, service: new EvidenceService(repo, storage, audit) };
}

const actor: AuthenticatedUser = { userId: "u1", tenantId: "tenant-a", email: "a@x", displayName: "A", roles: ["evidence.import"] };

describe("EVD-2 analysis", () => {
  it("returns sheets, detected header, inferred types, examples and empty columns", async () => {
    const content = await workbookBuffer((wb) => {
      const ws = wb.addWorksheet("Data");
      ws.addRow(["Title line only"]);
      ws.addRow([]);
      ws.addRow(["Name", "Amount", "Day", "Ok", "Blank", "Mixed"]);
      ws.addRow(["a", 1, new Date("2026-01-02T00:00:00Z"), true, null, "x"]);
      ws.addRow([]);
      ws.addRow(["b", 2, new Date("2026-02-03T00:00:00Z"), false, null, 5]);
      wb.addWorksheet("Empty");
    });
    const { service } = setup(content);
    const res = await service.analyze(actor, "ev-1");
    expect(res.sha256).toBe(sha(content));
    expect(res.sheets.map((s) => s.name)).toEqual(["Data", "Empty"]);
    const data = res.sheets[0]!;
    expect(data.headerRow).toBe(3);
    expect(data.headerDetected).toBe(true);
    expect(data.rowCount).toBe(2);
    const byName = Object.fromEntries(data.columns.map((c) => [c.name, c]));
    expect(byName["Name"]).toMatchObject({ inferredType: "text", examples: ["a", "b"], isEmpty: false });
    expect(byName["Amount"]!.inferredType).toBe("number");
    expect(byName["Day"]).toMatchObject({ inferredType: "date", examples: ["2026-01-02", "2026-02-03"] });
    expect(byName["Ok"]!.inferredType).toBe("boolean");
    expect(byName["Blank"]).toMatchObject({ inferredType: "empty", isEmpty: true, examples: [] });
    expect(byName["Mixed"]!.inferredType).toBe("mixed");
    expect(res.sheets[1]).toMatchObject({ headerRow: null, rowCount: 0, columns: [] });
  });

  it("uses the cached result of formula cells without evaluating them", async () => {
    const content = await workbookBuffer((wb) => {
      const ws = wb.addWorksheet("S");
      ws.addRow(["A", "B"]);
      ws.addRow([1, { formula: "A2*2", result: 2 }]);
    });
    const { service } = setup(content);
    const res = await service.analyze(actor, "ev-1");
    expect(res.sheets[0]!.columns[1]).toMatchObject({ inferredType: "number", examples: ["2"] });
  });

  it("denies without evidence.import before any lookup or storage read", async () => {
    const { service, calls } = setup(Buffer.from("x"));
    await expect(service.analyze({ ...actor, roles: ["evidence.read", "evidence.download"] }, "ev-1")).rejects.toBeInstanceOf(ForbiddenError);
    expect(calls.getContent).toBe(0);
  });

  it("does not touch storage for another tenant's evidence", async () => {
    const { service, calls } = setup(Buffer.from("x"));
    await expect(service.analyze({ ...actor, tenantId: "tenant-b" }, "ev-1")).rejects.toBeInstanceOf(NotFoundError);
    expect(calls.getContent).toBe(0);
  });

  it("refuses a deleted evidence, a non-xlsx evidence and a legacy one without hash", async () => {
    const buf = await workbookBuffer((wb) => wb.addWorksheet("S").addRow(["A"]));
    await expect(setup(buf, { status: "DELETED" }).service.analyze(actor, "ev-1")).rejects.toBeInstanceOf(NotFoundError);
    await expect(setup(buf, { mimeType: "application/pdf" }).service.analyze(actor, "ev-1")).rejects.toBeInstanceOf(ValidationError);
    const legacy = setup(buf, { sha256: null });
    await expect(legacy.service.analyze(actor, "ev-1")).rejects.toBeInstanceOf(ValidationError);
    expect(legacy.calls.getContent).toBe(0);
  });

  it("refuses when the stored bytes no longer match the recorded SHA-256", async () => {
    const buf = await workbookBuffer((wb) => wb.addWorksheet("S").addRow(["A"]));
    const { service } = setup(buf, { sha256: sha(Buffer.from("other")) });
    await expect(service.analyze(actor, "ev-1")).rejects.toBeInstanceOf(ConflictError);
  });

  it("refuses an oversized declared file before reading it, and a corrupt archive after hash check", async () => {
    const big = setup(Buffer.from("x"), { fileSize: 6 * 1024 * 1024 });
    await expect(big.service.analyze(actor, "ev-1")).rejects.toBeInstanceOf(ValidationError);
    expect(big.calls.getContent).toBe(0);
    const junk = Buffer.concat([Buffer.from([0x50, 0x4b, 0x03, 0x04]), Buffer.from("junk")]);
    await expect(setup(junk).service.analyze(actor, "ev-1")).rejects.toBeInstanceOf(ValidationError);
  });

  it("rejects a sheet over the column cap", async () => {
    const buf = await workbookBuffer((wb) => wb.addWorksheet("S").addRow(Array.from({ length: 51 }, (_, i) => `c${i}`)));
    await expect(setup(buf).service.analyze(actor, "ev-1")).rejects.toBeInstanceOf(ValidationError);
  });

  it("performs no write (db, storage, audit)", async () => {
    const buf = await workbookBuffer((wb) => wb.addWorksheet("S").addRow(["A", "B"]));
    const { service, calls } = setup(buf);
    await service.analyze(actor, "ev-1");
    expect(calls.writes).toBe(0);
  });
});
