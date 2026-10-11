import { describe, expect, it, afterEach } from "vitest";
import express from "express";
import type { Server } from "node:http";
import { createHash, randomUUID } from "node:crypto";
import { EvidenceService } from "../src/services/EvidenceService.js";
import { evidencesRouter } from "../src/api/v1/evidences.routes.js";
import { errorHandler } from "../src/api/middleware/errorHandler.js";
import type { EvidenceRepository } from "../src/domain/repositories/EvidenceRepository.js";
import type { AuditRepository } from "../src/domain/repositories/AuditRepository.js";
import type { ControlExecutionRepository } from "../src/domain/repositories/ControlExecutionRepository.js";
import type { DocumentStorage } from "../src/infrastructure/storage/DocumentStorage.js";
import type { Evidence } from "../src/domain/entities/Evidence.js";
import type { AuditEvent } from "../src/domain/entities/AuditEvent.js";
import type { AuthenticatedUser } from "../src/infrastructure/identity/IdentityProvider.js";
import { ConflictError, ForbiddenError, ValidationError } from "../src/domain/errors/DomainErrors.js";

const XLSX = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
const xlsxBytes = (tag = "a") => Buffer.concat([Buffer.from([0x50, 0x4b, 0x03, 0x04]), Buffer.from(tag)]);
const sha = (b: Buffer) => createHash("sha256").update(b).digest("hex");

function setup(opts: { auditFails?: boolean; knownExecutions?: Array<[string, string]> } = {}) {
  const store = new Map<string, Evidence>();
  const audits: Partial<AuditEvent>[] = [];
  const created: Array<Record<string, unknown>> = [];
  const repo: EvidenceRepository = {
    async getById(t, id) { const e = store.get(id); return e && e.tenantId === t ? e : null; },
    async listForControlExecution(t, x) {
      return [...store.values()].filter((e) => e.tenantId === t && e.controlExecutionId === x);
    },
    async findBySha256(t, h) {
      return [...store.values()].find((e) => e.tenantId === t && e.sha256 === h && e.status === "ACTIVE") ?? null;
    },
    async create(input) {
      created.push(input as unknown as Record<string, unknown>);
      const e: Evidence = { ...input, id: randomUUID(), uploadedAt: new Date(), version: 1, status: "ACTIVE" };
      store.set(e.id, e);
      return e;
    },
    async markDeleted(t, id) { const e = store.get(id)!; store.set(id, { ...e, status: "DELETED" }); },
    async restoreActive(t, id) { const e = store.get(id)!; store.set(id, { ...e, status: "ACTIVE" }); },
  };
  const storage: DocumentStorage = {
    async upload(p) { return { storageFileId: randomUUID(), url: `https://drive.example/${p.fileName}`, fileName: p.fileName }; },
    async getUrl(id) { return `https://drive.example/file/${id}`; },
    async getContent() { return Buffer.alloc(0); },
    async delete() {},
  };
  const audit: AuditRepository = {
    async record(e) { if (opts.auditFails) throw new Error("audit down"); audits.push(e); },
    async listForEntity() { return []; },
    async listRecent() { return []; },
  };
  const executions = {
    async getById(t: string, id: string) {
      return (opts.knownExecutions ?? [["tenant-a", "exec-1"], ["tenant-b", "exec-b"]]).some(([tt, i]) => tt === t && i === id)
        ? ({ id } as never) : null;
    },
  } as unknown as ControlExecutionRepository;
  return { store, audits, created, service: new EvidenceService(repo, storage, audit, executions) };
}

const full = ["evidence.upload", "evidence.read", "evidence.download", "evidence.delete"] as const;
const userA: AuthenticatedUser = { userId: "user-a", tenantId: "tenant-a", email: "a@x", displayName: "A", roles: [...full] };
const userB: AuthenticatedUser = { ...userA, userId: "user-b", tenantId: "tenant-b" };
const upXlsx = (content = xlsxBytes(), extra: Record<string, unknown> = {}) => ({
  fileName: "f.xlsx", mimeType: XLSX, content, documentType: "CONTROL_EVIDENCE", controlExecutionId: "exec-1" as string | null, ...extra,
});

describe("QA-EVD1 service edge cases", () => {
  it("duplicate hash in another tenant is ignored (no 409)", async () => {
    const { service } = setup();
    const content = xlsxBytes("same");
    await service.upload(userB, upXlsx(content, { controlExecutionId: "exec-b" }), "R1");
    const e = await service.upload(userA, upXlsx(content), "R2");
    expect(e.tenantId).toBe("tenant-a");
  });

  it("same-tenant duplicate -> ConflictError carrying existingId; allowDuplicate=true registers a new one", async () => {
    const { service } = setup();
    const content = xlsxBytes("dup");
    const first = await service.upload(userA, upXlsx(content), "R1");
    const err = await service.upload(userA, upXlsx(content), "R2").catch((e) => e);
    expect(err).toBeInstanceOf(ConflictError);
    expect(err.existingId).toBe(first.id);
    const second = await service.upload(userA, upXlsx(content, { allowDuplicate: true }), "R3");
    expect(second.id).not.toBe(first.id);
  });

  it("duplicate of a DELETED evidence is accepted", async () => {
    const { service } = setup();
    const content = xlsxBytes("del");
    const first = await service.upload(userA, upXlsx(content), "R1");
    await service.delete(userA, first.id, "R2");
    await expect(service.upload(userA, upXlsx(content), "R3")).resolves.toBeDefined();
  });

  it("hash, size and mime are computed server-side (client-supplied values ignored)", async () => {
    const { service, created } = setup();
    const content = xlsxBytes("srv");
    await service.upload(
      userA,
      upXlsx(content, { sha256: "f".repeat(64), fileSize: 1, uploadedBy: "evil", tenantId: "tenant-b" }),
      "R1",
    );
    expect(created[0]).toMatchObject({ sha256: sha(content), fileSize: content.byteLength, mimeType: XLSX, uploadedBy: "user-a", tenantId: "tenant-a" });
  });

  it("mime type is normalised (case/space) and still requires an execution", async () => {
    const { service, created } = setup();
    await service.upload(userA, upXlsx(xlsxBytes("m"), { mimeType: ` ${XLSX.toUpperCase()} ` }), "R1");
    expect(created[0]?.["mimeType"]).toBe(XLSX);
    await expect(
      service.upload(userA, upXlsx(xlsxBytes("n"), { mimeType: ` ${XLSX.toUpperCase()} `, controlExecutionId: null }), "R2"),
    ).rejects.toThrow(ValidationError);
  });

  it("xlsx without ZIP signature, wrong extension, or empty is rejected", async () => {
    const { service } = setup();
    await expect(service.upload(userA, upXlsx(Buffer.from("not a zip")), "R")).rejects.toThrow(ValidationError);
    await expect(service.upload(userA, upXlsx(Buffer.from([0x50, 0x4b, 0x03])), "R")).rejects.toThrow(ValidationError);
    await expect(service.upload(userA, upXlsx(xlsxBytes(), { fileName: "f.xls" }), "R")).rejects.toThrow(ValidationError);
    await expect(service.upload(userA, upXlsx(Buffer.alloc(0)), "R")).rejects.toThrow(ValidationError);
  });

  it("ZIP content declared as pdf/png, and PDF bytes declared as xlsx, are rejected", async () => {
    const { service } = setup();
    await expect(service.upload(userA, upXlsx(xlsxBytes(), { fileName: "f.pdf", mimeType: "application/pdf" }), "R")).rejects.toThrow(ValidationError);
    await expect(service.upload(userA, upXlsx(Buffer.from("%PDF-1.7 x")), "R")).rejects.toThrow(ValidationError);
    await expect(service.upload(userA, upXlsx(xlsxBytes(), { mimeType: "application/zip" }), "R")).rejects.toThrow(ValidationError);
  });

  it("xlsx without execution, or with another tenant's execution, is rejected; nothing stored", async () => {
    const { service, store } = setup();
    await expect(service.upload(userA, upXlsx(xlsxBytes("x"), { controlExecutionId: null }), "R")).rejects.toThrow(ValidationError);
    await expect(service.upload(userA, upXlsx(xlsxBytes("y"), { controlExecutionId: "exec-b" }), "R")).rejects.toThrow(ValidationError);
    expect(store.size).toBe(0);
  });

  it("PDF without execution is still allowed (no regression)", async () => {
    const { service } = setup();
    await expect(service.upload(userA, { fileName: "p.pdf", mimeType: "application/pdf", content: Buffer.from("%PDF-1.7 ok"), documentType: "X", controlExecutionId: null }, "R")).resolves.toBeDefined();
  });

  it("audit failure on download -> error, URL never released", async () => {
    const ok = setup();
    const ev = await ok.service.upload(userA, upXlsx(), "R1");
    const failing = setup({ auditFails: true });
    // Reuse the stored row in a service whose audit fails.
    failing.store.set(ev.id, ev);
    await expect(failing.service.getUrl(userA, ev.id, "R2")).rejects.toThrow("audit down");
  });

  it("download is audited with DOWNLOAD and no file content/URL", async () => {
    const { service, audits } = setup();
    const ev = await service.upload(userA, upXlsx(), "R1");
    const url = await service.getUrl(userA, ev.id, "R2");
    expect(url).toContain("drive.example");
    const dl = audits.find((a) => a.action === "DOWNLOAD")!;
    expect(dl).toMatchObject({ entityType: "Evidence", entityId: ev.id, userId: "user-a", tenantId: "tenant-a" });
    expect(JSON.stringify(dl.newValue)).not.toContain("drive.example");
    expect(Object.keys(dl.newValue as object).sort()).toEqual(["fileName", "sha256"]);
  });

  it("evidence.read alone -> 403 on getUrl, nothing audited; evidence.download alone cannot list", async () => {
    const { service, audits } = setup();
    const ev = await service.upload(userA, upXlsx(), "R1");
    const readOnly = { ...userA, roles: ["evidence.read"] as AuthenticatedUser["roles"] };
    await expect(service.getUrl(readOnly, ev.id, "R2")).rejects.toThrow(ForbiddenError);
    expect(audits.some((a) => a.action === "DOWNLOAD")).toBe(false);
    const dlOnly = { ...userA, roles: ["evidence.download"] as AuthenticatedUser["roles"] };
    await expect(service.listForControlExecution(dlOnly, "exec-1")).rejects.toThrow(ForbiddenError);
  });

  it("actor without evidence.read -> 403 on list; other tenant's list is empty", async () => {
    const { service } = setup();
    await service.upload(userA, upXlsx(), "R1");
    const none = { ...userA, roles: [] as AuthenticatedUser["roles"] };
    await expect(service.listForControlExecution(none, "exec-1")).rejects.toThrow(ForbiddenError);
    expect(await service.listForControlExecution(userB, "exec-1")).toEqual([]);
  });

  it("list hides driveUrl/driveFileId but exposes hash/size/mime", async () => {
    const { service } = setup();
    await service.upload(userA, upXlsx(), "R1");
    const [item] = await service.listForControlExecution(userA, "exec-1");
    expect(item).not.toHaveProperty("driveUrl");
    expect(item).not.toHaveProperty("driveFileId");
    expect(item).toMatchObject({ mimeType: XLSX });
  });

  it("getUrl on another tenant's evidence -> not found, no audit", async () => {
    const { service, audits } = setup();
    const ev = await service.upload(userA, upXlsx(), "R1");
    await expect(service.getUrl(userB, ev.id, "R2")).rejects.toThrow();
    expect(audits.some((a) => a.action === "DOWNLOAD")).toBe(false);
  });
});

describe("QA-EVD1 HTTP layer", () => {
  let server: Server | undefined;
  afterEach(() => new Promise<void>((r) => (server ? server.close(() => r()) : r())));

  async function start(user: AuthenticatedUser) {
    const s = setup();
    const app = express();
    app.use((req, _res, next) => {
      (req as unknown as { user: AuthenticatedUser; requestId: string }).user = user;
      (req as unknown as { requestId: string }).requestId = "REQ";
      next();
    });
    app.use("/evidences", evidencesRouter(s.service));
    app.use(errorHandler);
    await new Promise<void>((r) => { server = app.listen(0, () => r()); });
    const port = (server!.address() as { port: number }).port;
    return { ...s, base: `http://127.0.0.1:${port}/evidences` };
  }

  function form(content: Buffer, fields: Record<string, string>, mime = XLSX) {
    const f = new FormData();
    f.set("file", new Blob([new Uint8Array(content)], { type: mime }), "f.xlsx");
    for (const [k, v] of Object.entries(fields)) f.set(k, v);
    return f;
  }

  it("duplicate -> 409 with existingId; allowDuplicate=true -> 201", async () => {
    const { base } = await start(userA);
    const c = xlsxBytes("http");
    const fields = { documentType: "X", controlExecutionId: "exec-1" };
    const r1 = await fetch(base, { method: "POST", body: form(c, fields) });
    expect(r1.status).toBe(201);
    const id = ((await r1.json()) as { data: { id: string } }).data.id;
    const r2 = await fetch(base, { method: "POST", body: form(c, fields) });
    expect(r2.status).toBe(409);
    expect(((await r2.json()) as { existingId: string }).existingId).toBe(id);
    const r3 = await fetch(base, { method: "POST", body: form(c, { ...fields, allowDuplicate: "true" }) });
    expect(r3.status).toBe(201);
  });

  it("client-sent sha256 / uploadedBy / tenantId form fields are ignored", async () => {
    const { base, created } = await start(userA);
    const c = xlsxBytes("inj");
    const r = await fetch(base, {
      method: "POST",
      body: form(c, { documentType: "X", controlExecutionId: "exec-1", sha256: "0".repeat(64), uploadedBy: "evil", tenantId: "tenant-b", fileSize: "1" }),
    });
    expect(r.status).toBe(201);
    expect(created[0]).toMatchObject({ sha256: sha(c), uploadedBy: "user-a", tenantId: "tenant-a", fileSize: c.byteLength });
  });

  // QA-EVD1-1: errorHandler has no ZodError branch (pre-existing, global), so a malformed
  // allowDuplicate (strict z.enum) answers 500 instead of 400. Expected: 400.
  it.fails.each(["TRUE", "1", "yes", ""])("QA-EVD1-1 malformed allowDuplicate=%j answers 4xx (not 500)", async (bad) => {
    const { base } = await start(userA);
    const c = xlsxBytes("bad" + bad);
    const fields = { documentType: "X", controlExecutionId: "exec-1" };
    await fetch(base, { method: "POST", body: form(c, fields) });
    const r = await fetch(base, { method: "POST", body: form(c, { ...fields, allowDuplicate: bad }) });
    expect(r.status).toBeGreaterThanOrEqual(400);
    expect(r.status).toBeLessThan(500);
  });

  it("malformed allowDuplicate never bypasses the duplicate check (nothing stored)", async () => {
    const { base, store } = await start(userA);
    const c = xlsxBytes("nb");
    const fields = { documentType: "X", controlExecutionId: "exec-1" };
    await fetch(base, { method: "POST", body: form(c, fields) });
    await fetch(base, { method: "POST", body: form(c, { ...fields, allowDuplicate: "TRUE" }) });
    expect(store.size).toBe(1);
  });

  // QA-EVD1-2: same root cause as QA-EVD1-1 for GET /evidences without controlExecutionId (500, expected 400).
  it.fails("QA-EVD1-2 list without controlExecutionId answers 4xx (not 500)", async () => {
    const { base } = await start(userA);
    const missing = await fetch(base);
    expect(missing.status).toBeGreaterThanOrEqual(400);
    expect(missing.status).toBeLessThan(500);
  });

  it("list hides drive fields; GET url works with download permission", async () => {
    const { base } = await start(userA);
    const c = xlsxBytes("l");
    const up = await fetch(base, { method: "POST", body: form(c, { documentType: "X", controlExecutionId: "exec-1" }) });
    const id = ((await up.json()) as { data: { id: string } }).data.id;
    const list = await fetch(`${base}?controlExecutionId=exec-1`);
    const body = (await list.json()) as { data: Array<Record<string, unknown>> };
    expect(body.data).toHaveLength(1);
    expect(body.data[0]).not.toHaveProperty("driveUrl");
    expect(body.data[0]).not.toHaveProperty("driveFileId");
    expect((await fetch(`${base}/${id}/url`)).status).toBe(200);
  });

  it("read-only actor gets 403 on GET /:id/url", async () => {
    const { base, service } = await start({ ...userA, roles: ["evidence.read"] as AuthenticatedUser["roles"] });
    // seed with a full-permission actor on the same service instance
    const ev = await service.upload(userA, upXlsx(xlsxBytes("ro")), "R");
    expect((await fetch(`${base}/${ev.id}/url`)).status).toBe(403);
  });
});
