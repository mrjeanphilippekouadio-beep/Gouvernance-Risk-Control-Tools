import { describe, expect, it, afterEach } from "vitest";
import express from "express";
import { MulterError } from "multer";
import type { Server } from "node:http";
import { evidencesRouter } from "../src/api/v1/evidences.routes.js";
import { riskImportRouter } from "../src/api/v1/riskImport.routes.js";
import { errorHandler } from "../src/api/middleware/errorHandler.js";

// QA-S1: edge cases around the S1 multer limits and MulterError mapping.
describe("QA-S1 upload limits edge cases", () => {
  let server: Server | undefined;
  afterEach(() => new Promise<void>((r) => (server ? server.close(() => r()) : r())));

  const uploadCalls: Array<Record<string, unknown>> = [];
  const importCalls: Buffer[] = [];
  const evidenceService = {
    upload: async (_u: unknown, input: Record<string, unknown>) => {
      uploadCalls.push(input);
      return { id: "E1" };
    },
  };
  const importService = {
    preview: async (_u: unknown, buf: Buffer) => { importCalls.push(buf); return { ok: true }; },
    commit: async (_u: unknown, buf: Buffer) => { importCalls.push(buf); return { ok: true }; },
  };

  async function start(extra?: express.RequestHandler) {
    uploadCalls.length = 0;
    importCalls.length = 0;
    const app = express();
    app.use((req, _res, next) => {
      Object.assign(req, { requestId: "REQ", user: { userId: "u", tenantId: "t" } });
      next();
    });
    if (extra) app.use(extra);
    app.use("/evidences", evidencesRouter(evidenceService as never));
    app.use("/import", riskImportRouter(importService as never));
    app.use(errorHandler);
    await new Promise<void>((r) => { server = app.listen(0, () => r()); });
    return `http://127.0.0.1:${(server!.address() as { port: number }).port}`;
  }

  const blob = (n = 3) => new Blob([new Uint8Array(n).fill(1)]);

  it("errorHandler: LIMIT_FILE_SIZE -> 413 with generic message", async () => {
    const base = await start((_req, _res, next) => next(new MulterError("LIMIT_FILE_SIZE", "file")));
    const r = await fetch(`${base}/evidences`, { method: "POST" });
    expect(r.status).toBe(413);
    expect(await r.json()).toEqual({ error: "Téléversement invalide.", requestId: "REQ" });
  });

  it("errorHandler: other MulterError codes -> 400, field name not leaked", async () => {
    const base = await start((_req, _res, next) => next(new MulterError("LIMIT_UNEXPECTED_FILE", "secretField")));
    const r = await fetch(`${base}/evidences`, { method: "POST" });
    const text = await r.text();
    expect(r.status).toBe(400);
    expect(text).not.toContain("secretField");
    expect(text).not.toContain("LIMIT_");
  });

  it("import: real oversize file (10 MiB + 1) -> 413, service not reached", async () => {
    const base = await start();
    const f = new FormData();
    f.set("file", blob(10 * 1024 * 1024 + 1), "big.xlsx");
    const r = await fetch(`${base}/import/preview`, { method: "POST", body: f });
    expect(r.status).toBe(413);
    expect(importCalls).toHaveLength(0);
  });

  it("evidence: legitimate frontend upload (file + documentType) reaches the service -> 201", async () => {
    const base = await start();
    const f = new FormData();
    f.append("file", blob(), "proof.pdf");
    f.append("documentType", "REPORT");
    const r = await fetch(`${base}/evidences`, { method: "POST", body: f });
    expect(r.status).toBe(201);
    expect(uploadCalls).toHaveLength(1);
    expect(uploadCalls[0]).toMatchObject({ fileName: "proof.pdf", documentType: "REPORT", controlExecutionId: null, allowDuplicate: false });
  });

  it("evidence: all 3 documented fields + file -> 201", async () => {
    const base = await start();
    const f = new FormData();
    f.append("file", blob(), "p.pdf");
    f.append("documentType", "REPORT");
    f.append("controlExecutionId", "CE1");
    f.append("allowDuplicate", "true");
    const r = await fetch(`${base}/evidences`, { method: "POST", body: f });
    expect(r.status).toBe(201);
    expect(uploadCalls[0]).toMatchObject({ controlExecutionId: "CE1", allowDuplicate: true });
  });

  it("evidence: exactly 10 fields + file (limit boundary) -> 201; unknown fields ignored", async () => {
    const base = await start();
    const f = new FormData();
    f.append("file", blob(), "p.pdf");
    f.append("documentType", "REPORT");
    for (let i = 0; i < 9; i++) f.append(`x${i}`, "v");
    const r = await fetch(`${base}/evidences`, { method: "POST", body: f });
    expect(r.status).toBe(201);
  });

  it("evidence: no file -> 400 (not a multer error), service not reached", async () => {
    const base = await start();
    const f = new FormData();
    f.append("documentType", "REPORT");
    const r = await fetch(`${base}/evidences`, { method: "POST", body: f });
    expect(r.status).toBe(400);
    expect(uploadCalls).toHaveLength(0);
  });

  it.each(["preview", "commit"])("import/%s: file only reaches the service -> 200", async (op) => {
    const base = await start();
    const f = new FormData();
    f.set("file", blob(), "r.xlsx");
    const r = await fetch(`${base}/import/${op}`, { method: "POST", body: f });
    expect(r.status).toBe(200);
    expect(importCalls).toHaveLength(1);
    expect(importCalls[0]!.length).toBe(3);
  });

  it("import: two files -> 400, service not reached", async () => {
    const base = await start();
    const f = new FormData();
    f.append("file", blob(), "a.xlsx");
    f.append("file", blob(), "b.xlsx");
    const r = await fetch(`${base}/import/commit`, { method: "POST", body: f });
    expect(r.status).toBe(400);
    expect(importCalls).toHaveLength(0);
  });

  it("limit errors keep a generic body (no multer code/field in response)", async () => {
    const base = await start();
    const f = new FormData();
    f.append("file", blob(), "a.xlsx");
    f.append("file", blob(), "b.xlsx");
    const r = await fetch(`${base}/evidences`, { method: "POST", body: f });
    expect(r.status).toBe(400);
    expect(await r.json()).toEqual({ error: "Téléversement invalide.", requestId: "REQ" });
  });
});
