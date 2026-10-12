import { describe, expect, it } from "vitest";
import express from "express";
import ExcelJS from "exceljs";
import JSZip from "jszip";
import { createHash } from "node:crypto";
import { RoleService } from "../src/services/RoleService.js";
import { EvidenceService } from "../src/services/EvidenceService.js";
import { XLSX_MIME } from "../src/services/evidenceFileValidation.js";
import {
  analyzeXlsx, MAX_ANALYSIS_BYTES, MAX_ANALYSIS_COLUMNS, MAX_ANALYSIS_ROWS,
} from "../src/services/xlsxAnalysis.js";
import { evidencesRouter } from "../src/api/v1/evidences.routes.js";
import { errorHandler } from "../src/api/middleware/errorHandler.js";
import { PostgresRoleRepository } from "../src/infrastructure/database/postgres/PostgresRoleRepository.js";
import { PostgresRolePermissionChangeRepository } from "../src/infrastructure/database/postgres/PostgresRolePermissionChangeRepository.js";
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from "../src/domain/errors/DomainErrors.js";
import type { Permission } from "../src/domain/permissions.js";
import type { Role, RolePermissionChange, SystemGroup } from "../src/domain/entities/Role.js";
import type { Evidence } from "../src/domain/entities/Evidence.js";
import type { EvidenceRepository } from "../src/domain/repositories/EvidenceRepository.js";
import type { AuditRepository } from "../src/domain/repositories/AuditRepository.js";
import type { DocumentStorage } from "../src/infrastructure/storage/DocumentStorage.js";
import type { AuthenticatedUser } from "../src/infrastructure/identity/IdentityProvider.js";

// QA level 2 on B-8 sexies (7c29441) and EVD-2 (aed8ec1), plus the static review of the notification
// centre (see the report: no frontend test suite exists). A QA PASS only: not a Security, Privacy,
// Compliance or Risk opinion. Oracle (INPUT/ACTION/EXPECTED) was fixed from the src comments before running.
// `it.fails` = KNOWN GAP: green while the defect exists, red the day it is fixed (then switch to `it`).

// =====================================================================================================
// B-8 sexies
// =====================================================================================================
function fakePool(handler: (sql: string) => { rowCount: number; rows: unknown[] } | Error) {
  const calls: string[] = [];
  const client = {
    async query(sql: string) {
      calls.push(sql.trim().split(/\s+/).slice(0, 3).join(" "));
      const r = handler(sql);
      if (r instanceof Error) throw r;
      return r;
    },
    release() { calls.push("release"); },
  };
  return { pool: { connect: async () => client } as never, calls };
}
const pgError = (code: string, constraint: string) => Object.assign(new Error("pg"), { code, constraint });
const lockOk = (sql: string) => sql.includes("FOR UPDATE");

describe("QA B-8 sexies / PostgresRoleRepository.assignToUser", () => {
  it("any failure path releases the client exactly once and rolls back (insert error, lock error, BEGIN error)", async () => {
    for (const handler of [
      (sql: string) => (lockOk(sql) ? { rowCount: 1, rows: [{}] } : sql.includes("INSERT") ? pgError("08006", "") : { rowCount: 0, rows: [] }),
      (sql: string) => (lockOk(sql) ? new Error("lock timeout") : { rowCount: 0, rows: [] }),
      (sql: string) => (sql.startsWith("BEGIN") ? new Error("begin failed") : { rowCount: 0, rows: [] }),
    ]) {
      const { pool, calls } = fakePool(handler);
      await expect(new PostgresRoleRepository(pool).assignToUser("t", "r", "u", "g")).rejects.toThrow();
      expect(calls.filter((c) => c === "release")).toHaveLength(1);
      expect(calls).toContain("ROLLBACK");
      expect(calls).not.toContain("COMMIT");
    }
  });
  it("the lock is tenant-scoped and ignores soft-deleted roles (SQL text)", async () => {
    let lockSql = "";
    const { pool } = fakePool((sql) => { if (lockOk(sql)) lockSql = sql; return { rowCount: 0, rows: [] }; });
    await expect(new PostgresRoleRepository(pool).assignToUser("t", "r", "u", "g")).rejects.toBeInstanceOf(NotFoundError);
    expect(lockSql).toMatch(/tenant_id = \$1 AND id = \$2 AND deleted_at IS NULL FOR UPDATE/);
  });
  it("the 409 carries the role id and the 23505 translation requires BOTH code and constraint", async () => {
    for (const [code, constraint, translated] of [
      ["23505", "user_roles_active_idx", true], ["23505", undefined, false], ["23503", "user_roles_active_idx", false], ["23505", "user_roles_pkey", false],
    ] as const) {
      const { pool } = fakePool((sql) => (lockOk(sql) ? { rowCount: 1, rows: [{}] } : sql.includes("INSERT") ? pgError(code, constraint as string) : { rowCount: 0, rows: [] }));
      const p = new PostgresRoleRepository(pool).assignToUser("t", "r7", "u", "g");
      if (translated) await expect(p).rejects.toMatchObject({ existingId: "r7" });
      else await expect(p).rejects.not.toBeInstanceOf(ConflictError);
    }
  });
  it("migration 013 really defines user_roles_active_idx as the unique partial index the code relies on", async () => {
    const { readFileSync } = await import("node:fs");
    const sql = readFileSync("../database/postgresql/migrations/013_roles.sql", "utf8");
    expect(sql).toMatch(/CREATE UNIQUE INDEX user_roles_active_idx ON user_roles \(tenant_id, user_id, role_id\) WHERE revoked_at IS NULL/);
  });
  // KNOWN GAP (MINOR): a failing ROLLBACK replaces the original error (here the 409 the caller should get).
  it.fails("KNOWN GAP B8s-QA-01: a failing ROLLBACK must not mask the original ConflictError", async () => {
    const { pool } = fakePool((sql) => sql.startsWith("ROLLBACK") ? new Error("connection terminated")
      : lockOk(sql) ? { rowCount: 1, rows: [{}] } : sql.includes("INSERT") ? pgError("23505", "user_roles_active_idx") : { rowCount: 0, rows: [] });
    await expect(new PostgresRoleRepository(pool).assignToUser("t", "r", "u", "g")).rejects.toBeInstanceOf(ConflictError);
  });
});

describe("QA B-8 sexies / PostgresRolePermissionChangeRepository.reopen", () => {
  it("is tenant-scoped, only reopens APPROVED/REJECTED, and clears the decision", async () => {
    let sqlSeen = ""; let args: unknown[] = [];
    const pool = { query: async (sql: string, a: unknown[]) => { sqlSeen = sql; args = a; return { rowCount: 1, rows: [] }; } } as never;
    await new PostgresRolePermissionChangeRepository(pool).reopen("t9", "c9");
    expect(args).toEqual(["t9", "c9"]);
    expect(sqlSeen).toMatch(/c\.tenant_id = \$1 AND c\.id = \$2 AND c\.status IN \('APPROVED', 'REJECTED'\)/);
    expect(sqlSeen).toMatch(/decided_by = NULL, decided_at = NULL/);
    expect(sqlSeen).toMatch(/o\.tenant_id = c\.tenant_id AND o\.role_id = c\.role_id/);
  });
  it("rowCount null (driver quirk) is read as 'not reopened'", async () => {
    const pool = { query: async () => ({ rowCount: null, rows: [] }) } as never;
    expect(await new PostgresRolePermissionChangeRepository(pool).reopen("t", "c")).toBe(false);
  });
});

function role(id: string, systemGroup: SystemGroup | null, permissions: Permission[] = ["risk.read"]): Role {
  return {
    id, tenantId: "t1", name: id, description: null, permissions, dashboardScopeMode: "GLOBAL",
    systemGroup, departmentId: null, createdAt: new Date(), updatedAt: new Date(), deletedAt: null,
  };
}
const validator = { userId: "val", tenantId: "t1", email: "v@x", roles: ["rolegroup.audit.validate", "role.read"] } as AuthenticatedUser;

function decideWorld(opts: {
  initial?: Permission[]; change?: Permission[]; updateMode?: "ok" | "fail" | "commitThenFail"; getByIdFailsAfterUpdate?: boolean;
  reopenMode?: "ok" | "false" | "throws" | "void";
} = {}) {
  const au = role("au", "AUDIT", opts.initial ?? ["audit.read"]);
  const change = {
    id: "c1", tenantId: "t1", roleId: "au", permissions: opts.change ?? ["audit.read", "risk.read"], requestedBy: "maker",
    status: "PENDING", decidedBy: null, createdAt: new Date(), decidedAt: null,
  } as RolePermissionChange;
  const events: Array<{ action: string; entityType: string }> = [];
  let reopened = 0; let updateTried = false;
  const repo = {
    async getById() {
      if (opts.getByIdFailsAfterUpdate && updateTried) throw new Error("read failed");
      return au;
    },
    async listForUser(_t: string, u: string) { return u === "val" ? [au] : []; },
    async update(_t: string, _id: string, input: { permissions?: Permission[] }) {
      updateTried = true;
      if (opts.updateMode === "fail") throw new Error("db down");
      au.permissions = input.permissions!;
      if (opts.updateMode === "commitThenFail") throw new Error("lost response");
      return au;
    },
  };
  const changeRepo = {
    async getById() { return change; },
    async decide(_t: string, _id: string, status: "APPROVED" | "REJECTED") { change.status = status; return true; },
    async reopen() {
      reopened++;
      if (opts.reopenMode === "throws") throw new Error("reopen boom");
      if (opts.reopenMode === "false") return false;
      change.status = "PENDING";
      return opts.reopenMode === "void" ? undefined : true;
    },
  };
  const audit = { async record(e: { action: string; entityType: string }) { events.push(e); } };
  const service = new RoleService(repo as never, audit as never, {} as never, undefined, changeRepo as never);
  return { service, change, au, events, reopened: () => reopened };
}

describe("QA B-8 sexies / decideAuditPermissionChange: applied-or-reopen", () => {
  it("rights equal to the change in a different ORDER count as applied (no reopen)", async () => {
    const w = decideWorld({ change: ["risk.read", "audit.read"], updateMode: "commitThenFail" });
    await expect(w.service.decideAuditPermissionChange(validator, "c1", true, "r")).resolves.toBeUndefined();
    expect(w.reopened()).toBe(0);
    expect(w.change.status).toBe("APPROVED");
  });
  it("stored rights that are a SUPERSET of the change are NOT applied: reopened, original error kept", async () => {
    const w = decideWorld({ initial: ["audit.read", "risk.read", "kri.read"], change: ["audit.read", "risk.read"], updateMode: "fail" });
    await expect(w.service.decideAuditPermissionChange(validator, "c1", true, "r")).rejects.toThrow("db down");
    expect(w.reopened()).toBe(1);
    expect(w.change.status).toBe("PENDING");
  });
  it("stored rights that are a SUBSET are NOT applied either", async () => {
    const w = decideWorld({ initial: ["audit.read"], change: ["audit.read", "risk.read"], updateMode: "fail" });
    await expect(w.service.decideAuditPermissionChange(validator, "c1", true, "r")).rejects.toThrow("db down");
    expect(w.reopened()).toBe(1);
  });
  it("the verification read itself fails: treated as not applied, reopened, ORIGINAL error returned", async () => {
    const w = decideWorld({ updateMode: "commitThenFail", getByIdFailsAfterUpdate: true });
    await expect(w.service.decideAuditPermissionChange(validator, "c1", true, "r")).rejects.toThrow("lost response");
    expect(w.reopened()).toBe(1);
  });
  it("reopen throwing does not replace the original error", async () => {
    const w = decideWorld({ updateMode: "fail", reopenMode: "throws" });
    await expect(w.service.decideAuditPermissionChange(validator, "c1", true, "r")).rejects.toThrow("db down");
  });
  it("a legacy reopen returning void is treated as reopened (no crash, no log requirement)", async () => {
    const w = decideWorld({ updateMode: "fail", reopenMode: "void" });
    await expect(w.service.decideAuditPermissionChange(validator, "c1", true, "r")).rejects.toThrow("db down");
    expect(w.change.status).toBe("PENDING");
  });
  it("reopen === false logs the stuck state on the console exactly once", async () => {
    const w = decideWorld({ updateMode: "fail", reopenMode: "false" });
    const seen: string[] = [];
    const orig = console.error;
    console.error = (...a: unknown[]) => { seen.push(String(a[0])); };
    try {
      await expect(w.service.decideAuditPermissionChange(validator, "c1", true, "r")).rejects.toThrow("db down");
    } finally { console.error = orig; }
    expect(seen.filter((m) => m.includes("could not be reopened (another change is PENDING)"))).toHaveLength(1);
  });
  it("a REJECTION never runs the application path nor reopen", async () => {
    const w = decideWorld({ updateMode: "fail" });
    await expect(w.service.decideAuditPermissionChange(validator, "c1", false, "r")).resolves.toBeUndefined();
    expect(w.reopened()).toBe(0);
    expect(w.au.permissions).toEqual(["audit.read"]);
  });
  it("the maker cannot decide their own change", async () => {
    const w = decideWorld();
    const maker = { ...validator, userId: "maker" } as AuthenticatedUser;
    await expect(w.service.decideAuditPermissionChange(maker, "c1", true, "r")).rejects.toBeInstanceOf(ForbiddenError);
    expect(w.change.status).toBe("PENDING");
  });
  // KNOWN GAP (MINOR): "applied" is judged on length + inclusion, so a duplicate-bearing change is mistaken for applied.
  it.fails("KNOWN GAP B8s-QA-02: change [audit.read, audit.read] vs stored [audit.read, risk.read] after a REAL failed update must be reopened", async () => {
    const w = decideWorld({ initial: ["audit.read", "risk.read"], change: ["audit.read", "audit.read"], updateMode: "fail" });
    await expect(w.service.decideAuditPermissionChange(validator, "c1", true, "r")).rejects.toThrow("db down");
    // expected: PENDING again (rights NOT applied). actual: stays APPROVED with risk.read still granted.
    expect(w.change.status).toBe("PENDING");
  });
  it("reachability of B8s-QA-02: changeAuditGroupPermissions stores a duplicate-bearing request unmodified", async () => {
    const au = role("au", "AUDIT", ["audit.read", "risk.read"]);
    const rm = role("rm", "RISK_MANAGER");
    const created: RolePermissionChange[] = [];
    const repo = { async list() { return [au]; }, async listForUser() { return [rm]; } };
    const changeRepo = {
      async list() { return []; },
      async create(i: { permissions: Permission[] }) { const c = { id: "n1", ...i } as unknown as RolePermissionChange; created.push(c); return c; },
    };
    const service = new RoleService(repo as never, { async record() {} } as never, {} as never, undefined, changeRepo as never);
    const maker = { userId: "m", tenantId: "t1", email: "m@x", roles: ["rolegroup.audit.update"] } as AuthenticatedUser;
    const r = await service.changeAuditGroupPermissions(maker, ["audit.read", "audit.read"], "req", "why");
    expect(r.status).toBe("PENDING");
    expect(created[0]!.permissions).toEqual(["audit.read", "audit.read"]);
  });
});

// =====================================================================================================
// EVD-2
// =====================================================================================================
const sha = (b: Buffer) => createHash("sha256").update(b).digest("hex");
async function book(build: (wb: ExcelJS.Workbook) => void): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  build(wb);
  return Buffer.from(await wb.xlsx.writeBuffer());
}
const actor: AuthenticatedUser = { userId: "u1", tenantId: "tenant-a", email: "a@x", displayName: "A", roles: ["evidence.import"] } as AuthenticatedUser;

function evWorld(content: Buffer, overrides: Partial<Evidence> = {}) {
  const evidence: Evidence = {
    id: "ev-1", tenantId: "tenant-a", controlExecutionId: "exec-1", fileName: "f.xlsx", driveFileId: "drive-1",
    driveUrl: "u", documentType: "CONTROL_EVIDENCE", uploadedBy: "someone-else", sha256: sha(content), fileSize: content.length,
    mimeType: XLSX_MIME, uploadedAt: new Date(), version: 1, status: "ACTIVE", ...overrides,
  };
  const log: string[] = [];
  const repo = {
    async getById(t: string, id: string) { log.push("lookup"); return t === evidence.tenantId && id === evidence.id ? evidence : null; },
    async create() { log.push("write"); return evidence; },
    async markDeleted() { log.push("write"); },
  } as unknown as EvidenceRepository;
  const storage = {
    async getContent() { log.push("drive"); return content; },
    async upload() { log.push("write"); throw new Error("no"); },
    async delete() { log.push("write"); },
  } as unknown as DocumentStorage;
  const audit = { async record() { log.push("write"); } } as unknown as AuditRepository;
  return { log, evidence, service: new EvidenceService(repo, storage, audit) };
}
const outcome = (p: Promise<unknown>) => p.then(() => "ok", (e: unknown) => (e as Error).constructor.name);

describe("QA EVD-2 / order of checks (permission -> tenant lookup -> Drive)", () => {
  it("no permission: neither the repository nor Drive is touched", async () => {
    const w = evWorld(Buffer.from("x"));
    await expect(w.service.analyze({ ...actor, roles: [] }, "ev-1")).rejects.toBeInstanceOf(ForbiddenError);
    expect(w.log).toEqual([]);
  });
  it("evidence.upload / evidence.download / evidence.read do NOT grant analysis", async () => {
    for (const p of ["evidence.upload", "evidence.download", "evidence.read", "evidence.delete"] as Permission[]) {
      const w = evWorld(Buffer.from("x"));
      await expect(w.service.analyze({ ...actor, roles: [p] }, "ev-1")).rejects.toBeInstanceOf(ForbiddenError);
      expect(w.log).toEqual([]);
    }
  });
  it("unknown id and other-tenant id are indistinguishable (404) and never reach Drive", async () => {
    const w = evWorld(Buffer.from("x"));
    const a = await w.service.analyze(actor, "nope").catch((e: Error) => e);
    const b = await w.service.analyze({ ...actor, tenantId: "tenant-b" }, "ev-1").catch((e: Error) => e);
    expect(a).toBeInstanceOf(NotFoundError);
    expect(b).toBeInstanceOf(NotFoundError);
    expect(w.log).toEqual(["lookup", "lookup"]);
  });
  it("lookup happens BEFORE any content/format refusal; every refusal happens BEFORE Drive; hash check BEFORE parsing", async () => {
    const buf = await book((wb) => wb.addWorksheet("S").addRow(["A", "B"]));
    for (const o of [{ mimeType: "application/pdf" }, { sha256: null }, { fileSize: MAX_ANALYSIS_BYTES + 1 }] as Partial<Evidence>[]) {
      const w = evWorld(buf, o);
      await expect(w.service.analyze(actor, "ev-1")).rejects.toBeInstanceOf(ValidationError);
      expect(w.log).toEqual(["lookup"]);
    }
    // mismatching hash + unparseable bytes: 409 (hash first), never the parser's 400
    const junk = Buffer.from("not a zip at all, but long enough");
    const w = evWorld(junk, { sha256: sha(Buffer.from("other")) });
    await expect(w.service.analyze(actor, "ev-1")).rejects.toBeInstanceOf(ConflictError);
    expect(w.log).toEqual(["lookup", "drive"]);
  });
  it("another user's evidence of the SAME tenant is analyzable (no ownership rule; tenant is the only scope)", async () => {
    const buf = await book((wb) => wb.addWorksheet("S").addRow(["A", "B"]));
    const w = evWorld(buf, { uploadedBy: "other-user" });
    await expect(w.service.analyze(actor, "ev-1")).resolves.toMatchObject({ evidenceId: "ev-1" });
  });
  it("two parallel analyses are independent and read-only", async () => {
    const buf = await book((wb) => { const s = wb.addWorksheet("S"); s.addRow(["A", "B"]); s.addRow(["x", 1]); });
    const w = evWorld(buf);
    const [r1, r2] = await Promise.all([w.service.analyze(actor, "ev-1"), w.service.analyze(actor, "ev-1")]);
    expect(r1).toEqual(r2);
    expect(w.log.filter((l) => l === "write")).toHaveLength(0);
  });
  it("response shape carries evidenceId, fileName, sha256, sheets and NO Drive reference", async () => {
    const buf = await book((wb) => wb.addWorksheet("S").addRow(["A", "B"]));
    const res = await evWorld(buf).service.analyze(actor, "ev-1");
    expect(Object.keys(res).sort()).toEqual(["evidenceId", "fileName", "sha256", "sheets"]);
    expect(JSON.stringify(res)).not.toContain("drive-1");
  });
  // QA_CHALLENGE (observation, not a defect: cadrage says "Aucune ecriture"): analysis returns up to 3 cell values per column
  // with evidence.import only (no evidence.download) and leaves NO audit row, whereas getUrl audits DOWNLOAD fail-closed.
  it("OBSERVATION: example cell values are returned without evidence.download and without any audit write", async () => {
    const buf = await book((wb) => { const s = wb.addWorksheet("S"); s.addRow(["Name", "Iban"]); s.addRow(["Jane Doe", "CI93 0000"]); });
    const w = evWorld(buf);
    const res = await w.service.analyze({ ...actor, roles: ["evidence.import"] }, "ev-1");
    expect(res.sheets[0]!.columns.flatMap((c) => c.examples)).toEqual(["Jane Doe", "CI93 0000"]);
    expect(w.log).not.toContain("write");
  });
});

describe("QA EVD-2 / caps (exact boundary and boundary + 1)", () => {
  it("rows: 20 000 accepted, 20 001 refused with the cap message", async () => {
    const make = (n: number) => book((wb) => { const s = wb.addWorksheet("S"); s.addRow(["A", "B"]); for (let i = 1; i < n; i++) s.addRow([`v${i}`, i]); });
    const ok = await analyzeXlsx(await make(MAX_ANALYSIS_ROWS), false);
    expect(ok[0]!.rowCount).toBe(MAX_ANALYSIS_ROWS - 1);
    await expect(analyzeXlsx(await make(MAX_ANALYSIS_ROWS + 1), false)).rejects.toThrow(/too many rows/);
  }, 60_000);
  it("rows: a SPARSE sheet (one cell on row 20 001) counts by last row number and is refused before any grid is built", async () => {
    const buf = await book((wb) => { const s = wb.addWorksheet("S"); s.addRow(["A", "B"]); s.getCell(MAX_ANALYSIS_ROWS + 1, 1).value = "far"; });
    await expect(analyzeXlsx(buf, true)).rejects.toThrow(/too many rows/);
  });
  it("rows: a cell at row 1 048 576 (Excel maximum) is a 400-class refusal, not a memory blow-up", async () => {
    const buf = await book((wb) => { wb.addWorksheet("S").getCell(1_048_576, 1).value = "x"; });
    const t0 = Date.now();
    await expect(analyzeXlsx(buf, true)).rejects.toBeInstanceOf(ValidationError);
    expect(Date.now() - t0).toBeLessThan(5000);
  });
  it("columns: 50 accepted, 51 refused; a cell at column 16 384 (XFD) is refused", async () => {
    const row = (n: number) => Array.from({ length: n }, (_, i) => `c${i}`);
    const ok = await analyzeXlsx(await book((wb) => wb.addWorksheet("S").addRow(row(MAX_ANALYSIS_COLUMNS))), true);
    expect(ok[0]!.columns).toHaveLength(MAX_ANALYSIS_COLUMNS);
    await expect(analyzeXlsx(await book((wb) => wb.addWorksheet("S").addRow(row(MAX_ANALYSIS_COLUMNS + 1))), true)).rejects.toThrow(/too many columns/);
    await expect(analyzeXlsx(await book((wb) => { wb.addWorksheet("S").getCell(1, 16_384).value = "x"; }), true)).rejects.toBeInstanceOf(ValidationError);
  });
  it("sheets: 50 accepted, 51 refused; one oversized sheet among valid ones refuses the whole workbook", async () => {
    const sheets = (n: number) => book((wb) => { for (let i = 0; i < n; i++) wb.addWorksheet(`S${i}`).addRow(["A", "B"]); });
    expect(await analyzeXlsx(await sheets(50), false)).toHaveLength(50);
    await expect(analyzeXlsx(await sheets(51), false)).rejects.toThrow(/Too many sheets/);
    const mixed = await book((wb) => { wb.addWorksheet("ok").addRow(["A", "B"]); wb.addWorksheet("wide").addRow(Array.from({ length: 51 }, (_, i) => `c${i}`)); });
    await expect(analyzeXlsx(mixed, false)).rejects.toBeInstanceOf(ValidationError);
  });
  it("bytes: declared size == 5 MB passes the pre-check; actual content of 5 MB + 1 is refused even when fileSize lies or is null", async () => {
    const MB5 = MAX_ANALYSIS_BYTES;
    const exact = evWorld(Buffer.alloc(MB5, 1), {}); // junk, hash matches
    const r = await exact.service.analyze(actor, "ev-1").catch((e: Error) => e);
    expect(r).toBeInstanceOf(ValidationError);
    expect((r as Error).message).not.toMatch(/analysis limit/); // refused later by the archive guard, not by the size cap
    for (const fileSize of [null, 10]) {
      const big = Buffer.alloc(MB5 + 1, 1);
      const w = evWorld(big, { fileSize });
      const e = await w.service.analyze(actor, "ev-1").catch((x: Error) => x);
      expect(e).toBeInstanceOf(ValidationError);
      expect((e as Error).message).toMatch(/5MB analysis limit/);
    }
  });
});

describe("QA EVD-2 / malformed files are 400 (ValidationError), never 500", () => {
  it("degenerate buffers", async () => {
    for (const b of [Buffer.alloc(0), Buffer.from("PK"), Buffer.from("hello world, this is text, not a workbook"), Buffer.alloc(100, 0), Buffer.from([0x50, 0x4b, 0x03, 0x04])]) {
      expect(await outcome(analyzeXlsx(b, true))).toBe("ValidationError");
    }
  });
  it("truncated real workbook (every 10th prefix) and single-byte corruption at several offsets", async () => {
    const good = await book((wb) => { const s = wb.addWorksheet("S"); s.addRow(["A", "B"]); s.addRow(["x", 1]); });
    const results = new Set<string>();
    for (let n = 0; n < good.length; n += Math.max(1, Math.floor(good.length / 10))) results.add(await outcome(analyzeXlsx(good.subarray(0, n), true)));
    for (const off of [0, 5, 30, 100, Math.floor(good.length / 2), good.length - 30, good.length - 5]) {
      const c = Buffer.from(good); c[off] = c[off]! ^ 0xff;
      results.add(await outcome(analyzeXlsx(c, true)));
    }
    expect([...results].filter((r) => r !== "ok" && r !== "ValidationError")).toEqual([]);
  });
  it("valid zip but garbage workbook.xml, missing sheet part, or no workbook.xml", async () => {
    const good = await book((wb) => { const s = wb.addWorksheet("S"); s.addRow(["A", "B"]); s.addRow(["x", 1]); });
    const mutate = async (fn: (z: JSZip) => void) => { const z = await JSZip.loadAsync(good); fn(z); return Buffer.from(await z.generateAsync({ type: "nodebuffer", compression: "DEFLATE" })); };
    const garbage = await mutate((z) => { z.file("xl/workbook.xml", "<<<not xml"); });
    const noSheet = await mutate((z) => { z.remove("xl/worksheets/sheet1.xml"); });
    const noWb = await mutate((z) => { z.remove("xl/workbook.xml"); });
    const badSheet = await mutate((z) => { z.file("xl/worksheets/sheet1.xml", "<worksheet><sheetData><row r=\"x\"><c r=\"ZZZZ0\" t=\"n\"><v>abc</v></c></row></sheetData></worksheet>"); });
    for (const b of [garbage, noSheet, noWb, badSheet]) {
      const o = await outcome(analyzeXlsx(b, true));
      expect(["ok", "ValidationError"]).toContain(o);
    }
    expect(await outcome(analyzeXlsx(noWb, true))).toBe("ValidationError");
  });
  it("macro-enabled workbook (vbaProject.bin) and a zip bomb are refused", async () => {
    const good = await book((wb) => wb.addWorksheet("S").addRow(["A", "B"]));
    const z = await JSZip.loadAsync(good);
    z.file("xl/vbaProject.bin", "x");
    const macro = Buffer.from(await z.generateAsync({ type: "nodebuffer" }));
    await expect(analyzeXlsx(macro, true)).rejects.toThrow(/macros/);
    const z2 = await JSZip.loadAsync(good);
    z2.file("xl/bomb.bin", Buffer.alloc(25 * 1024 * 1024, 0));
    const bomb = Buffer.from(await z2.generateAsync({ type: "nodebuffer", compression: "DEFLATE" }));
    expect(bomb.length).toBeLessThan(MAX_ANALYSIS_BYTES);
    await expect(analyzeXlsx(bomb, true)).rejects.toBeInstanceOf(ValidationError);
  });
  // KNOWN GAP (MAJOR for robustness): a date-formatted numeric cell outside the JS Date range gives an Invalid Date,
  // display() calls toISOString() -> RangeError (not a DomainError) -> errorHandler answers 500 for a user-supplied file.
  async function hugeDateBook() {
    return book((wb) => {
      const s = wb.addWorksheet("S"); s.addRow(["A", "B"]); s.addRow(["x", 1e12]); s.getCell("B2").numFmt = "yyyy-mm-dd";
    });
  }
  it.fails("KNOWN GAP EVD2-QA-01: a date-formatted cell with an out-of-range serial must yield 400/OK, not a RangeError", async () => {
    expect(["ok", "ValidationError"]).toContain(await outcome(analyzeXlsx(await hugeDateBook(), true)));
  });
  it("EVD2-QA-01 evidence: the failure is a raw RangeError (-> HTTP 500), also when examples are withheld is NOT the case", async () => {
    expect(await outcome(analyzeXlsx(await hugeDateBook(), true))).toBe("RangeError");
  });
});

describe("QA EVD-2 / structure analysis", () => {
  it("formula without cached result is treated as empty (never evaluated, never leaked as text)", async () => {
    const buf = await book((wb) => { const s = wb.addWorksheet("S"); s.addRow(["A", "B"]); s.addRow([1, { formula: "A2*2" } as never]); });
    const [sheet] = await analyzeXlsx(buf, true);
    expect(sheet!.columns[1]).toMatchObject({ inferredType: "empty", isEmpty: true, examples: [] });
    expect(JSON.stringify(sheet)).not.toContain("A2*2");
  });
  it("formula whose cached result is an error or text, and a formula returning a date", async () => {
    const buf = await book((wb) => {
      const s = wb.addWorksheet("S"); s.addRow(["E", "T", "D"]);
      s.addRow([{ formula: "1/0", result: { error: "#DIV/0!" } } as never, { formula: "\"a\"&\"b\"", result: "ab" } as never, { formula: "DATE(2026,1,2)", result: new Date("2026-01-02T00:00:00Z") } as never]);
    });
    const cols = Object.fromEntries((await analyzeXlsx(buf, true))[0]!.columns.map((c) => [c.name, c]));
    expect(cols["E"]).toMatchObject({ inferredType: "empty" });
    expect(cols["T"]).toMatchObject({ inferredType: "text", examples: ["ab"] });
    expect(cols["D"]).toMatchObject({ inferredType: "date", examples: ["2026-01-02"] });
  });
  it("examples: at most 3, distinct, truncated to 100 chars + ellipsis; withExamples=false returns none", async () => {
    const long = "z".repeat(150);
    const buf = await book((wb) => { const s = wb.addWorksheet("S"); s.addRow(["A", "B"]); for (const v of ["a", "a", "b", "c", "d", long]) s.addRow([v, 1]); });
    const [withEx] = await analyzeXlsx(buf, true);
    expect(withEx!.columns[0]!.examples).toEqual(["a", "b", "c"]);
    const [tail] = await analyzeXlsx(await book((wb) => { const s = wb.addWorksheet("S"); s.addRow(["A", "B"]); s.addRow([long, 1]); }), true);
    expect(tail!.columns[0]!.examples[0]).toBe(`${"z".repeat(100)}…`);
    const [none] = await analyzeXlsx(buf, false);
    expect(none!.columns.every((c) => c.examples.length === 0)).toBe(true);
    expect(none!.columns[0]!.isEmpty).toBe(false);
  });
  it("a whitespace-only cell is empty; an untitled column with data is named column_N; a blank untitled column is skipped", async () => {
    const buf = await book((wb) => {
      const s = wb.addWorksheet("S"); s.addRow(["A", null, "C", null]);
      s.addRow(["x", "data", "   ", null]);
    });
    const [sheet] = await analyzeXlsx(buf, true);
    expect(sheet!.columns.map((c) => [c.index, c.name, c.inferredType])).toEqual([[1, "A", "text"], [2, "column_2", "text"], [3, "C", "empty"]]);
  });
  it("header detection: title lines above are skipped, rows above the header are not counted, no header -> first non-empty row, headerDetected=false", async () => {
    const [a] = await analyzeXlsx(await book((wb) => { const s = wb.addWorksheet("S"); s.addRow(["Report"]); s.addRow(["Name", "Age"]); s.addRow(["x", 1]); }), true);
    expect(a).toMatchObject({ headerRow: 2, headerDetected: true, rowCount: 1 });
    const [b] = await analyzeXlsx(await book((wb) => { const s = wb.addWorksheet("S"); s.addRow([1, 2]); s.addRow([3, 4]); }), true);
    expect(b).toMatchObject({ headerRow: 1, headerDetected: false, rowCount: 1 });
    // header only after the 20-row scan window -> falls back, flagged not detected
    const [c] = await analyzeXlsx(await book((wb) => { const s = wb.addWorksheet("S"); for (let i = 0; i < 25; i++) s.addRow([i, i + 1]); s.addRow(["H1", "H2"]); }), true);
    expect(c).toMatchObject({ headerRow: 1, headerDetected: false });
  });
  it("single-column sheet: a lone text cell is a header", async () => {
    const [s] = await analyzeXlsx(await book((wb) => { const w = wb.addWorksheet("S"); w.addRow(["Only"]); w.addRow(["v"]); }), true);
    expect(s).toMatchObject({ headerRow: 1, headerDetected: true, rowCount: 1 });
  });
  it("types: text-looking numbers stay text, a date column with one text is mixed, booleans, duplicates of a header are both reported", async () => {
    const [s] = await analyzeXlsx(await book((wb) => {
      const w = wb.addWorksheet("S"); w.addRow(["N", "D", "B", "N"]);
      w.addRow(["123", new Date("2026-01-02T00:00:00Z"), true, 1]);
      w.addRow(["456", "n/a", false, 2]);
    }), true);
    expect(s!.columns.map((c) => [c.name, c.inferredType])).toEqual([["N", "text"], ["D", "mixed"], ["B", "boolean"], ["N", "number"]]);
  });
  it("dates are rendered in UTC calendar day (a late-evening UTC instant keeps its UTC day)", async () => {
    const [s] = await analyzeXlsx(await book((wb) => { const w = wb.addWorksheet("S"); w.addRow(["D", "X"]); w.addRow([new Date("2026-03-04T23:59:59Z"), 1]); }), true);
    expect(s!.columns[0]!.examples).toEqual(["2026-03-04"]);
  });
  it("hidden sheets are analysed like visible ones (observation)", async () => {
    const buf = await book((wb) => { const w = wb.addWorksheet("Hidden"); w.state = "hidden"; w.addRow(["A", "B"]); });
    expect((await analyzeXlsx(buf, true)).map((x) => x.name)).toEqual(["Hidden"]);
  });
  // KNOWN GAP (MINOR): a header that carries a number (year columns: "Name", 2024, 2025) is not "all text", so the
  // heuristic skips it and silently elects the next all-text row (a DATA row) as header with headerDetected=true.
  it.fails("KNOWN GAP EVD2-QA-02: header with year columns must stay the header row", async () => {
    const [s] = await analyzeXlsx(await book((wb) => { const w = wb.addWorksheet("S"); w.addRow(["Name", 2024, 2025]); w.addRow(["alice", "ok", "ok"]); w.addRow(["bob", "ko", "ok"]); }), true);
    expect(s!.headerRow).toBe(1);
  });
  // KNOWN GAP (MINOR): a hyperlink cell whose text is rich text is stringified with String(object).
  it.fails("KNOWN GAP EVD2-QA-03: hyperlink with rich-text label must not be reported as [object Object]", async () => {
    const [s] = await analyzeXlsx(await book((wb) => {
      const w = wb.addWorksheet("S"); w.addRow(["A", "B"]);
      w.getCell("A2").value = { text: { richText: [{ text: "lbl" }] }, hyperlink: "http://x" } as never; w.getCell("B2").value = 1;
    }), true);
    expect(JSON.stringify(s)).not.toContain("[object Object]");
  });
});

describe("QA EVD-2 / HTTP route", () => {
  async function serve(svc: EvidenceService, user: AuthenticatedUser) {
    const app = express();
    app.use(express.json());
    app.use((req, _res, next) => { (req as unknown as { user: AuthenticatedUser; requestId: string }).user = user; (req as unknown as { requestId: string }).requestId = "req"; next(); });
    app.use("/evidences", evidencesRouter(svc));
    app.use(errorHandler);
    const server = app.listen(0);
    const addr = server.address();
    const base = `http://127.0.0.1:${typeof addr === "object" && addr ? addr.port : 0}`;
    return { base, close: () => server.close() };
  }
  const call = async (base: string, path: string, method = "POST") => {
    const res = await fetch(`${base}${path}`, { method });
    return { status: res.status, json: (await res.json().catch(() => null)) as { data?: { sheets?: unknown[] }; error?: string } | null };
  };

  it("200 {data}, 403, 404, 409, 400 (malformed), 400 (non-xlsx); GET is not routed; JSON never contains a stack", async () => {
    const good = await book((wb) => { const s = wb.addWorksheet("S"); s.addRow(["A", "B"]); s.addRow(["x", 1]); });
    const ok = await serve(evWorld(good).service, actor);
    try {
      const r = await call(ok.base, "/evidences/ev-1/analysis");
      expect(r.status).toBe(200);
      expect(r.json!.data!.sheets).toHaveLength(1);
      expect((await call(ok.base, "/evidences/nope/analysis")).status).toBe(404);
      expect((await call(ok.base, "/evidences/ev-1/analysis", "GET")).status).toBe(404);
      expect((await call(ok.base, "/evidences/ev%2F..%2Fx/analysis")).status).toBe(404);
    } finally { ok.close(); }
    const denied = await serve(evWorld(good).service, { ...actor, roles: ["evidence.download"] });
    try { expect((await call(denied.base, "/evidences/ev-1/analysis")).status).toBe(403); } finally { denied.close(); }
    const mismatch = await serve(evWorld(good, { sha256: sha(Buffer.from("o")) }).service, actor);
    try { expect((await call(mismatch.base, "/evidences/ev-1/analysis")).status).toBe(409); } finally { mismatch.close(); }
    const junk = Buffer.from("junk junk junk junk junk junk junk");
    const bad = await serve(evWorld(junk).service, actor);
    try {
      const r = await call(bad.base, "/evidences/ev-1/analysis");
      expect(r.status).toBe(400);
      expect(JSON.stringify(r.json)).not.toMatch(/at .*\.ts|node_modules/);
    } finally { bad.close(); }
    const pdf = await serve(evWorld(good, { mimeType: "application/pdf" }).service, actor);
    try { expect((await call(pdf.base, "/evidences/ev-1/analysis")).status).toBe(400); } finally { pdf.close(); }
  });
  it("the out-of-range date workbook answers 500 over HTTP (evidence for EVD2-QA-01)", async () => {
    const buf = await book((wb) => { const s = wb.addWorksheet("S"); s.addRow(["A", "B"]); s.addRow(["x", 1e12]); s.getCell("B2").numFmt = "yyyy-mm-dd"; });
    const srv = await serve(evWorld(buf).service, actor);
    try { expect((await call(srv.base, "/evidences/ev-1/analysis")).status).toBe(500); } finally { srv.close(); }
  });
  it("rate limit: the 31st call from the same client in the window is 429 (shared costly limiter)", async () => {
    const buf = await book((wb) => wb.addWorksheet("S").addRow(["A", "B"]));
    const srv = await serve(evWorld(buf).service, actor);
    try {
      let last = 0;
      for (let i = 0; i < 31; i++) last = (await call(srv.base, "/evidences/ev-1/analysis")).status;
      expect(last).toBe(429);
    } finally { srv.close(); }
  }, 30_000);
});
