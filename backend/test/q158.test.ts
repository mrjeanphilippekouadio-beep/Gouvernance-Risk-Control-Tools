import { afterAll, beforeAll, describe, expect, it } from "vitest";
import express from "express";
import { Pool } from "pg";
import { errorHandler } from "../src/api/middleware/errorHandler.js";
import { configRouter } from "../src/api/v1/config.routes.js";
import type { ConfigService } from "../src/services/ConfigService.js";
import { PostgresSelfValidationPolicyRequestRepository } from "../src/infrastructure/database/postgres/PostgresSelfValidationPolicyRequestRepository.js";

const ID = "11111111-1111-4111-8111-111111111111";

async function call(svc: unknown, method: string, path: string, body?: unknown) {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    (req as unknown as { user: unknown }).user = { userId: "u", tenantId: "t" };
    (req as unknown as { requestId: string }).requestId = "req";
    next();
  });
  app.use("/x", configRouter(svc as ConfigService));
  app.use(errorHandler);
  const server = app.listen(0);
  try {
    const { port } = server.address() as { port: number };
    const res = await fetch(`http://127.0.0.1:${port}/x${path}`, { method, headers: { "content-type": "application/json" }, body: body ? JSON.stringify(body) : undefined });
    return { status: res.status, json: (await res.json()) as Record<string, unknown> };
  } finally {
    server.close();
  }
}

describe("q158 routes", () => {
  it("PUT answers 202 with the pending request when the relaxation waits, 200 otherwise", async () => {
    const pending = { id: ID, status: "PENDING" };
    const waiting = await call({ setSelfValidationPolicy: async () => ({ config: { id: "c" }, pendingRequest: pending }) }, "PUT", "/self-validation-policy", { policy: "DOUBLE_CONFIRMATION", reason: "r" });
    expect(waiting.status).toBe(202);
    expect(waiting.json).toMatchObject({ data: { id: "c" }, pendingRequest: pending });
    const direct = await call({ setSelfValidationPolicy: async () => ({ config: { id: "c" }, pendingRequest: null }) }, "PUT", "/self-validation-policy", { policy: "REFUSE", reason: "r" });
    expect(direct.status).toBe(200);
  });

  it("approve / reject reach the service with the actor and the request id; reject needs a reason", async () => {
    const calls: string[] = [];
    const svc = {
      approveSelfValidationPolicy: async (_u: unknown, id: string, _r: string, reason?: string) => { calls.push(`approve:${id}:${reason}`); return { id: "c" }; },
      rejectSelfValidationPolicy: async (_u: unknown, id: string, reason: string) => { calls.push(`reject:${id}:${reason}`); return { id: ID }; },
    };
    expect((await call(svc, "POST", `/self-validation-policy/requests/${ID}/approve`, {})).status).toBe(400); // the approver's own reason is required
    expect((await call(svc, "POST", `/self-validation-policy/requests/${ID}/approve`, { reason: "ok" })).status).toBe(200);
    expect((await call(svc, "POST", "/self-validation-policy/requests/not-a-uuid/approve", { reason: "ok" })).status).toBe(400);
    expect((await call(svc, "POST", `/self-validation-policy/requests/${ID}/reject`, {})).status).toBe(400);
    expect((await call(svc, "POST", `/self-validation-policy/requests/${ID}/reject`, { reason: "non" })).status).toBe(200);
    expect(calls).toEqual([`approve:${ID}:ok`, `reject:${ID}:non`]);
  });
});

const HOST = process.env.QA_SWP_PGHOST ?? "";
describe.skipIf(!HOST.startsWith("/"))("q158 PostgresSelfValidationPolicyRequestRepository (needs 072)", () => {
  let pool: Pool;
  let repo: PostgresSelfValidationPolicyRequestRepository;
  let tenant: string;
  let other: string;
  let a: string;
  let b: string;
  beforeAll(async () => {
    pool = new Pool({ host: HOST, port: Number(process.env.QA_SWP_PGPORT ?? 5531), user: "postgres", database: process.env.QA_SWP_PGDB ?? "grc_qa_a08", max: 2 });
    repo = new PostgresSelfValidationPolicyRequestRepository(pool);
    const id = async (sql: string, p: unknown[]) => (await pool.query(sql, p)).rows[0].id as string;
    tenant = await id(`INSERT INTO tenants (name) VALUES ('q158') RETURNING id`, []);
    other = await id(`INSERT INTO tenants (name) VALUES ('q158b') RETURNING id`, []);
    const user = (t: string, e: string) => id(`INSERT INTO users (tenant_id, email, display_name) VALUES ($1, $2, $2) RETURNING id`, [t, e]);
    a = await user(tenant, `a${Math.random()}@q158`);
    b = await user(tenant, `b${Math.random()}@q158`);
  });
  afterAll(async () => { await pool?.end(); });

  it("one PENDING per tenant, tenant-scoped reads, decision once, author cannot approve (CHECK), never reopened", async () => {
    const r = await repo.create(tenant, "DOUBLE_CONFIRMATION", "motif", a);
    await expect(repo.create(tenant, "DOUBLE_CONFIRMATION", "autre", a)).rejects.toMatchObject({ name: "ConflictError" });
    expect((await repo.getPending(tenant))?.id).toBe(r.id);
    expect(await repo.getById(other, r.id)).toBeNull();
    await expect(repo.decide(tenant, r.id, "APPLIED", a, null)).rejects.toThrow(); // maker-checker in the database
    expect((await repo.decide(tenant, r.id, "APPLIED", b, null))?.status).toBe("APPLIED");
    expect(await repo.decide(tenant, r.id, "REJECTED", b, "x")).toBeNull();
    expect((repo as unknown as { reopen?: unknown }).reopen).toBeUndefined(); // SEC-PNL2-03: no reopen on the production repository
    expect(await repo.getPending(tenant)).toBeNull();
    expect(await repo.decide(tenant, r.id, "WITHDRAWN", a, "remplacée")).toBeNull();
  });
});
