import { describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import ExcelJS from "exceljs";
import { z } from "zod";
import { parseSuperAdminEmails, isSuperAdminEmail } from "../src/config/superAdminEmails.js";
import { RiskImportService } from "../src/services/RiskImportService.js";
import type { RiskService } from "../src/services/RiskService.js";
import type { AuditRepository } from "../src/domain/repositories/AuditRepository.js";
import type { AuditEvent } from "../src/domain/entities/AuditEvent.js";
import type { AuthenticatedUser } from "../src/infrastructure/identity/IdentityProvider.js";
import { ConflictError, ValidationError } from "../src/domain/errors/DomainErrors.js";

const Schema = z.string().default("").transform(parseSuperAdminEmails);

describe("q260 SUPER_ADMIN_EMAILS", () => {
  it("empty or absent = nobody (fail closed)", () => {
    expect(Schema.parse("")).toEqual([]);
    expect(Schema.parse(undefined)).toEqual([]);
    expect(Schema.parse(" , ,")).toEqual([]);
    expect(isSuperAdminEmail("a@x.com", [])).toBe(false);
  });

  it("normalizes to lowercase, trims, deduplicates", () => {
    expect(Schema.parse(" Boss@X.com , boss@x.com,two@x.com ")).toEqual(["boss@x.com", "two@x.com"]);
  });

  it("refuses wildcards, patterns, non-emails and more than 20 entries (the server would not start)", () => {
    for (const bad of ["*@x.com", "%@x.com", "a@x.com;b@x.com", "not-an-email", "a b@x.com"]) {
      expect(Schema.safeParse(bad).success, bad).toBe(false);
    }
    const many = Array.from({ length: 21 }, (_, i) => `u${i}@x.com`).join(",");
    expect(Schema.safeParse(many).success).toBe(false);
  });

  it("compares the authenticated e-mail exactly (case-insensitive, no substring, no empty)", () => {
    const list = ["boss@x.com"];
    expect(isSuperAdminEmail("BOSS@x.com", list)).toBe(true);
    expect(isSuperAdminEmail("boss@x.com.evil.io", list)).toBe(false);
    expect(isSuperAdminEmail("xboss@x.com", list)).toBe(false);
    expect(isSuperAdminEmail("", list)).toBe(false);
  });
});

describe("q260/q261 wiring (static guards)", () => {
  const src = (p: string) => readFileSync(join(__dirname, "..", "src", p), "utf8");

  it("every /tenants route sits behind requireSuperAdmin, never behind config.manage", () => {
    const routes = src("api/v1/tenants.routes.ts");
    expect(routes).toMatch(/router\.use\([\s\S]*requireSuperAdmin/);
    expect(routes).not.toMatch(/active:\s*z\.boolean/);
    expect(src("services/TenantService.ts")).not.toMatch(/config\.manage/);
  });

  it("the membership lookup joins tenants and refuses an inactive client (SEC-F8-03)", () => {
    expect(src("server.ts")).toMatch(/JOIN tenants t ON t\.id = u\.tenant_id AND t\.active = true/);
  });

  it("the super-administrator flag is derived from the env list and never from a role or the database", () => {
    const server = src("server.ts");
    expect(server).toMatch(/isSuperAdmin: isSuperAdminIdentity\(email, proof\.attestedDomain, env\.SUPER_ADMIN_EMAILS, env\.SUPER_ADMIN_DOMAINS\)/);
    expect(src("domain/permissions.ts")).not.toMatch(/"platform\./);
  });
});

function recordingAudit(): AuditRepository & { events: AuditEvent[] } {
  const events: AuditEvent[] = [];
  return {
    events,
    async record(e) {
      events.push({ ...e, id: randomUUID(), timestamp: new Date() });
    },
    async listForEntity(tenantId, entityType, entityId) {
      return events.filter((e) => e.tenantId === tenantId && e.entityType === entityType && e.entityId === entityId).reverse();
    },
    async listRecent() {
      return [];
    },
  };
}

const actor: AuthenticatedUser = {
  userId: "user-1",
  tenantId: "tenant-1",
  email: "a@x.com",
  displayName: "A",
  roles: ["config.manage", "risk.create"],
  dashboardScopeMode: "GLOBAL",
};

async function workbook(rows: string[][]): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  const sheet = wb.addWorksheet("R");
  sheet.addRow(["processus", "description"]);
  for (const r of rows) sheet.addRow(r);
  return Buffer.from(await wb.xlsx.writeBuffer());
}

function riskServiceStub(create: () => Promise<unknown>): RiskService {
  return { create } as unknown as RiskService;
}

describe("q263 import fingerprint", () => {
  it("refuses the same file twice (409 ALREADY_IMPORTED), accepts another file", async () => {
    const audit = recordingAudit();
    const create = vi.fn(async () => ({}));
    const service = new RiskImportService(riskServiceStub(create), audit);
    const file = await workbook([["Paiements", "Fraude"]]);

    expect((await service.commit(actor, file, "R1")).createdCount).toBe(1);
    await expect(service.commit(actor, file, "R2")).rejects.toMatchObject({ code: "ALREADY_IMPORTED" });
    expect(create).toHaveBeenCalledTimes(1);
    expect((await service.commit(actor, await workbook([["Autre", "Autre risque"]]), "R3")).createdCount).toBe(1);
    expect((await service.preview(actor, file)).alreadyImported).toBe(true);
  });

  it("is per tenant: another tenant can import the same file", async () => {
    const audit = recordingAudit();
    const service = new RiskImportService(riskServiceStub(async () => ({})), audit);
    const file = await workbook([["P", "D"]]);
    await service.commit(actor, file, "R1");
    expect((await service.commit({ ...actor, tenantId: "tenant-2" }, file, "R2")).createdCount).toBe(1);
  });

  it("re-import needs explicit confirmation AND a valid reason, and is traced with it", async () => {
    const audit = recordingAudit();
    const service = new RiskImportService(riskServiceStub(async () => ({})), audit);
    const file = await workbook([["P", "D"]]);
    await service.commit(actor, file, "R1");

    await expect(service.commit(actor, file, "R2", { confirmReimport: true })).rejects.toThrow(ValidationError);
    await expect(service.commit(actor, file, "R2", { reason: "motif" })).rejects.toThrow(ConflictError);
    const report = await service.commit(actor, file, "R3", { confirmReimport: true, reason: "Correction de la source" });
    expect(report.createdCount).toBe(1);
    const last = audit.events[audit.events.length - 1]!;
    expect(last.entityType).toBe("RiskImport");
    expect(last.reason).toBe("Correction de la source");
    expect(JSON.stringify(last.newValue)).not.toMatch(/Paiements|Fraude/); // fingerprint only, never the content
  });

  it("SEC-F8-06: an internal error message is never echoed in the report", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    const service = new RiskImportService(
      riskServiceStub(async () => {
        throw new Error('insert or update on table "risks" violates foreign key constraint "risks_secret_fk"');
      }),
      recordingAudit(),
    );
    const report = await service.commit(actor, await workbook([["P", "D"]]), "R1");
    const text = JSON.stringify(report);
    expect(text).not.toMatch(/risks_secret_fk|violates/);
    expect(report.createdCount).toBe(0);
    expect(report.rows[0]!.errors[0]).toMatch(/Erreur interne/);
    consoleError.mockRestore();
  });

  it("keeps a domain message (ValidationError) readable for the user", async () => {
    const service = new RiskImportService(
      riskServiceStub(async () => {
        throw new ValidationError("Process is unknown");
      }),
      recordingAudit(),
    );
    const report = await service.commit(actor, await workbook([["P", "D"]]), "R1");
    expect(report.rows[0]!.errors).toEqual(["Process is unknown"]);
  });
});
