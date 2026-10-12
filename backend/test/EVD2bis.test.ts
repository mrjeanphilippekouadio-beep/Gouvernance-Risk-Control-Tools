import { describe, expect, it } from "vitest";
import ExcelJS from "exceljs";
import JSZip from "jszip";
import { createHash } from "node:crypto";
import { EvidenceService, MAX_CONCURRENT_ANALYSES } from "../src/services/EvidenceService.js";
import { XLSX_MIME } from "../src/services/evidenceFileValidation.js";
import { analyzeXlsx } from "../src/services/xlsxAnalysis.js";
import { RoleService } from "../src/services/RoleService.js";
import { PostgresRoleRepository } from "../src/infrastructure/database/postgres/PostgresRoleRepository.js";
import { ConflictError, ValidationError } from "../src/domain/errors/DomainErrors.js";
import type { Evidence } from "../src/domain/entities/Evidence.js";
import type { Role } from "../src/domain/entities/Role.js";
import type { EvidenceRepository } from "../src/domain/repositories/EvidenceRepository.js";
import type { AuditRepository } from "../src/domain/repositories/AuditRepository.js";
import type { DocumentStorage } from "../src/infrastructure/storage/DocumentStorage.js";
import type { AuthenticatedUser } from "../src/infrastructure/identity/IdentityProvider.js";

// Level 1 for F-B8s-01 and F-EVD2-01/02/03.
const sha = (b: Buffer) => createHash("sha256").update(b).digest("hex");
const importer = { userId: "u1", tenantId: "tenant-a", email: "a@x", roles: ["evidence.import"] } as AuthenticatedUser;
const importerDl = { ...importer, roles: ["evidence.import", "evidence.download"] } as AuthenticatedUser;

async function book(build: (s: ExcelJS.Worksheet) => void): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  build(wb.addWorksheet("S"));
  return Buffer.from(await wb.xlsx.writeBuffer());
}

function world(content: Buffer, opts: { auditFails?: boolean; getContent?: () => Promise<Buffer> } = {}) {
  const evidence: Evidence = {
    id: "ev-1", tenantId: "tenant-a", controlExecutionId: "x", fileName: "f.xlsx", driveFileId: "d1", driveUrl: "u",
    documentType: "CONTROL_EVIDENCE", uploadedBy: "u", sha256: sha(content), fileSize: content.length, mimeType: XLSX_MIME,
    uploadedAt: new Date(), version: 1, status: "ACTIVE",
  };
  const events: Array<Record<string, unknown>> = [];
  const repo = { async getById() { return evidence; } } as unknown as EvidenceRepository;
  const storage = { getContent: opts.getContent ?? (async () => content) } as unknown as DocumentStorage;
  const audit = {
    async record(e: Record<string, unknown>) { if (opts.auditFails) throw new Error("audit down"); events.push(e); },
  } as unknown as AuditRepository;
  return { events, service: new EvidenceService(repo, storage, audit) };
}

describe("F-EVD2-02/03 analyze", () => {
  it("examples only with evidence.download; READ audit holds no cell values", async () => {
    const buf = await book((s) => { s.addRow(["Name", "Iban"]); s.addRow(["Jane Doe", "CI93"]); });
    const w = world(buf);
    const bare = await w.service.analyze(importer, "ev-1", "req-1");
    expect(bare.sheets[0]!.columns.flatMap((c) => c.examples)).toEqual([]);
    const full = await w.service.analyze(importerDl, "ev-1", "req-2");
    expect(full.sheets[0]!.columns.flatMap((c) => c.examples)).toEqual(["Jane Doe", "CI93"]);
    expect(w.events).toHaveLength(2);
    expect(w.events[0]).toMatchObject({ action: "READ", entityType: "Evidence", entityId: "ev-1", tenantId: "tenant-a", requestId: "req-1",
      newValue: { fileName: "f.xlsx", sha256: sha(buf), examplesReturned: false } });
    expect((w.events[1]!["newValue"] as { examplesReturned: boolean }).examplesReturned).toBe(true);
    expect(JSON.stringify(w.events)).not.toContain("Jane");
  });
  it("fail-closed: no audit, no response", async () => {
    const buf = await book((s) => { s.addRow(["A", "B"]); s.addRow(["x", 1]); });
    await expect(world(buf, { auditFails: true }).service.analyze(importerDl, "ev-1", "r")).rejects.toThrow("audit down");
  });
  it("a SHA-256 mismatch is refused before any audit row", async () => {
    const buf = await book((s) => s.addRow(["A", "B"]));
    const w = world(buf, { getContent: async () => Buffer.from("tampered") });
    await expect(w.service.analyze(importer, "ev-1", "r")).rejects.toBeInstanceOf(ConflictError);
    expect(w.events).toHaveLength(0);
  });
});

describe("F-EVD2-01 limits", () => {
  it("a 9 MB-decompressed workbook is refused before exceljs loads it", async () => {
    const good = await book((s) => s.addRow(["A", "B"]));
    const z = await JSZip.loadAsync(good);
    z.file("xl/pad.bin", Buffer.alloc(9 * 1024 * 1024, 7));
    const big = Buffer.from(await z.generateAsync({ type: "nodebuffer", compression: "DEFLATE" }));
    await expect(analyzeXlsx(big, false)).rejects.toThrow(/decompressed size/);
    expect(await analyzeXlsx(good, false)).toHaveLength(1);
  });
  it("at most MAX_CONCURRENT_ANALYSES run at once; the next is a 409 and the slot is released afterwards", async () => {
    const buf = await book((s) => { s.addRow(["A", "B"]); s.addRow(["x", 1]); });
    let release!: () => void;
    const gate = new Promise<void>((r) => { release = r; });
    const w = world(buf, { getContent: async () => { await gate; return buf; } });
    const running = Array.from({ length: MAX_CONCURRENT_ANALYSES }, () => w.service.analyze(importer, "ev-1", "r"));
    await expect(w.service.analyze(importer, "ev-1", "r")).rejects.toBeInstanceOf(ConflictError);
    release();
    await Promise.all(running);
    await expect(w.service.analyze(importer, "ev-1", "r")).resolves.toMatchObject({ evidenceId: "ev-1" });
  });
});

function role(id: string, perms: Role["permissions"] = ["risk.read"], systemGroup: Role["systemGroup"] = null): Role {
  return { id, tenantId: "t", name: id, description: null, permissions: perms, dashboardScopeMode: "GLOBAL", systemGroup, departmentId: null,
    createdAt: new Date(), updatedAt: new Date(), deletedAt: null };
}

describe("F-B8s-01", () => {
  const admin = { userId: "adm", tenantId: "t", email: "a@x", roles: ["role.read", "role.assign"] } as AuthenticatedUser;

  it("service: the repository recheck replays the cumul rule on the locked state (RM vs Audit)", async () => {
    const rm = role("rm", ["risk.read"], "RISK_MANAGER");
    const au = role("au", ["audit.read"], "AUDIT");
    let assigned = false;
    const repo = {
      async getById(_t: string, id: string) { return id === "au" ? au : rm; },
      async listForUser() { return []; }, // stale read: user looks free
      async assignToUser(_t: string, _r: string, _u: string, _g: string, recheck?: (r: Role, held: Role[]) => Promise<void>) {
        await recheck!(au, [rm]); // under the lock the user already holds RM
        assigned = true;
        return {} as never;
      },
    };
    const service = new RoleService(repo as never, { async record() {} } as never);
    await expect(service.assignToUser(admin, "au", "u1", "req", "motif")).rejects.toBeInstanceOf(ValidationError);
    expect(assigned).toBe(false);
  });

  it("repo: locks user then role, reads held roles under the lock, aborts with ROLLBACK when the recheck throws", async () => {
    const calls: string[] = [];
    const client = {
      async query(sql: string) {
        calls.push(sql.trim().split(/\s+/).slice(0, 4).join(" "));
        if (sql.includes("FOR UPDATE")) return { rowCount: 1, rows: [{ id: "x", permissions: [], name: "r", tenant_id: "t" }] };
        return { rowCount: 0, rows: [] };
      },
      release() { calls.push("release"); },
    };
    const repo = new PostgresRoleRepository({ connect: async () => client } as never);
    await expect(repo.assignToUser("t", "r", "u", "g", async () => { throw new ValidationError("cumul"); })).rejects.toBeInstanceOf(ValidationError);
    expect(calls[0]).toBe("BEGIN");
    expect(calls[1]).toContain("FROM users");
    expect(calls[2]).toContain("FROM roles");
    expect(calls[3]).toContain("SELECT r.* FROM");
    expect(calls).toContain("ROLLBACK");
    expect(calls.some((c) => c.startsWith("INSERT"))).toBe(false);
  });
});
