import { describe, expect, it, afterEach } from "vitest";
import express from "express";
import type { Server } from "node:http";
import { evidencesRouter } from "../src/api/v1/evidences.routes.js";
import { riskImportRouter } from "../src/api/v1/riskImport.routes.js";
import { errorHandler } from "../src/api/middleware/errorHandler.js";

// Services are never reached: multer rejects the request first.
const unreachable = {} as never;

describe("multer upload limits (Sonar S5693)", () => {
  let server: Server | undefined;
  afterEach(() => new Promise<void>((r) => (server ? server.close(() => r()) : r())));

  async function start() {
    const app = express();
    app.use((req, _res, next) => {
      (req as unknown as { requestId: string }).requestId = "REQ";
      next();
    });
    app.use("/evidences", evidencesRouter(unreachable));
    app.use("/import", riskImportRouter(unreachable));
    app.use(errorHandler);
    await new Promise<void>((r) => { server = app.listen(0, () => r()); });
    return `http://127.0.0.1:${(server!.address() as { port: number }).port}`;
  }

  const file = () => new Blob([new Uint8Array([1, 2, 3])]);

  it("evidence: too many fields -> 400", async () => {
    const base = await start();
    const f = new FormData();
    f.set("file", file(), "f.xlsx");
    for (let i = 0; i < 11; i++) f.set(`x${i}`, "v");
    const r = await fetch(`${base}/evidences`, { method: "POST", body: f });
    expect(r.status).toBe(400);
  });

  it("evidence: too many files -> 400", async () => {
    const base = await start();
    const f = new FormData();
    f.append("file", file(), "a.xlsx");
    f.append("file", file(), "b.xlsx");
    const r = await fetch(`${base}/evidences`, { method: "POST", body: f });
    expect(r.status).toBe(400);
  });

  it("import: any extra field -> 400", async () => {
    const base = await start();
    const f = new FormData();
    f.set("file", file(), "f.xlsx");
    f.set("extra", "v");
    const r = await fetch(`${base}/import/preview`, { method: "POST", body: f });
    expect(r.status).toBe(400);
  });
});
