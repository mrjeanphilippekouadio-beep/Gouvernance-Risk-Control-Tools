import { describe, expect, it } from "vitest";
import express from "express";
import { auditLogRouter } from "../src/api/v1/auditLog.routes.js";
import { errorHandler } from "../src/api/middleware/errorHandler.js";
import type { AuditLogService } from "../src/services/AuditLogService.js";

async function get(query: string): Promise<{ status: number; seen: unknown }> {
  let seen: unknown;
  const service = {
    listRecent: async (_actor: unknown, limit?: number) => {
      seen = limit;
      return [];
    },
  } as unknown as AuditLogService;
  const app = express();
  app.use((req, _res, next) => {
    (req as unknown as { user: unknown }).user = { tenantId: "t" };
    next();
  });
  app.use("/", auditLogRouter(service));
  app.use(errorHandler);
  const server = app.listen(0);
  try {
    const addr = server.address();
    const port = typeof addr === "object" && addr ? addr.port : 0;
    const res = await fetch(`http://127.0.0.1:${port}/${query}`);
    return { status: res.status, seen };
  } finally {
    server.close();
  }
}

describe("GET /audit-logs limit", () => {
  it("accepts a valid limit and no limit", async () => {
    expect(await get("?limit=50")).toEqual({ status: 200, seen: 50 });
    expect(await get("")).toEqual({ status: 200, seen: undefined });
  });

  it.each(["-5", "0", "501", "abc", "1.5"])("rejects limit=%s with 400", async (v) => {
    expect((await get(`?limit=${v}`)).status).toBe(400);
  });
});
