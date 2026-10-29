import { describe, expect, it } from "vitest";
import express from "express";
import { randomUUID } from "node:crypto";
import type { AddressInfo } from "node:net";
import { errorHandler } from "../src/api/middleware/errorHandler.js";
import { krisRouter } from "../src/api/v1/kris.routes.js";

/** F7-S6 corrections: the KRI HTTP contract (zod bodies, uuid ids, dates); the service is a stand-in that succeeds. */
const stub = new Proxy({}, { get: () => async () => ({}) }) as never;
const ID = randomUUID();
const body = { label: "L", formula: "f", thresholdGreen: 1, thresholdOrange: 2, thresholdRed: 3, frequency: "MONTHLY", riskId: randomUUID() };

async function call(method: string, path: string, payload?: unknown): Promise<number> {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    Object.assign(req, { user: { userId: "u", tenantId: "t", email: "a@x.test", roles: [] }, requestId: "r" });
    next();
  });
  app.use("/kris", krisRouter(stub));
  app.use(errorHandler);
  const server = app.listen(0);
  try {
    const res = await fetch(`http://127.0.0.1:${(server.address() as AddressInfo).port}${path}`, {
      method,
      headers: { "content-type": "application/json" },
      body: payload === undefined ? undefined : JSON.stringify(payload),
    });
    return res.status;
  } finally {
    server.close();
  }
}

describe("kris routes (F7-S6 corrections)", () => {
  it("QA-F7S6-02: PUT with `active` is a 400, never a silent 200", async () => {
    expect(await call("PUT", `/kris/${ID}`, { active: false })).toBe(400);
    expect(await call("PUT", `/kris/${ID}`, { label: "x", active: true })).toBe(400);
    expect(await call("PUT", `/kris/${ID}`, { label: "x" })).toBe(200);
  });

  it("F7S6-02: POST with `active` is a 400; without it the KRI is created", async () => {
    expect(await call("POST", "/kris", { ...body, active: false })).toBe(400);
    expect(await call("POST", "/kris", body)).toBe(201);
  });

  it("INFO-04: a non-uuid id or covered risk id is a 400", async () => {
    expect(await call("GET", "/kris/not-a-uuid")).toBe(400);
    expect(await call("PATCH", "/kris/not-a-uuid/disable", { reason: "motif" })).toBe(400);
    expect(await call("POST", `/kris/${ID}/risks`, { riskIds: ["nope"] })).toBe(400);
    expect(await call("POST", `/kris/${ID}/risks`, { riskIds: [randomUUID()] })).toBe(200);
  });

  it("INFO-06: an invalid dashboard date is a 400; a valid one passes", async () => {
    expect(await call("GET", "/kris/dashboard?from=not-a-date")).toBe(400);
    expect(await call("GET", "/kris/dashboard?from=2026-10-01&to=2026-10-28")).toBe(200);
  });
});
