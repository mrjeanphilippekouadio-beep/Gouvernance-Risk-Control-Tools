import { describe, expect, it } from "vitest";
import express from "express";
import { ConfigService } from "../src/services/ConfigService.js";
import { configRouter } from "../src/api/v1/config.routes.js";
import { processesRouter } from "../src/api/v1/processes.routes.js";
import { errorHandler } from "../src/api/middleware/errorHandler.js";
import type { AuthenticatedUser } from "../src/infrastructure/identity/IdentityProvider.js";

// DECISION-054: a methodology setting is written through the Dispositif only. Level 1 guard on the HTTP surface.
const user = {
  userId: "u1",
  tenantId: "t1",
  email: "a@x.test",
  roles: ["config.read", "config.update", "config.committeethreshold.set", "config.committeeenforcement.set", "process.evaluationmode.set"],
} as unknown as AuthenticatedUser;

async function call(mount: (app: express.Express) => void, method: string, path: string, body: unknown) {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    (req as unknown as { user: AuthenticatedUser; requestId: string }).user = user;
    (req as unknown as { requestId: string }).requestId = "req";
    next();
  });
  mount(app);
  app.use(errorHandler);
  const server = app.listen(0);
  try {
    const addr = server.address();
    const port = typeof addr === "object" && addr ? addr.port : 0;
    const res = await fetch(`http://127.0.0.1:${port}${path}`, { method, headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
    return { status: res.status, json: (await res.json().catch(() => null)) as { error?: string } | null };
  } finally {
    server.close();
  }
}

describe("single write path (DECISION-054)", () => {
  const writes: unknown[] = [];
  const configs = { async getByTenant() { return null; }, async upsert(...a: unknown[]) { writes.push(a); return { id: "c" }; } };
  const audit = { async record() { writes.push("audit"); } };
  const wired = { async listFrameworks() { return []; } };
  const configService = new ConfigService(configs as never, audit as never, undefined, wired);
  const mountConfig = (app: express.Express) => app.use("/config", configRouter(configService));

  it("PUT /config and PUT /config/appetite-mode answer 410 and write nothing", async () => {
    for (const [path, body] of [["/config", { scoreFormula: "WEIGHTED_SUM", reason: "r" }], ["/config/appetite-mode", { mode: "MANUEL", reason: "r" }]] as const) {
      const res = await call(mountConfig, "PUT", path, body);
      expect(res.status).toBe(410);
      expect(res.json?.error).toMatch(/Dispositif/);
    }
    expect(writes).toHaveLength(0);
  });

  it("the Committee thresholds, enforcement and default evaluation mode are refused in favour of the Dispositif", async () => {
    for (const [path, body] of [
      ["/config/committee-thresholds", { evaluationMinScore: 5, reason: "r" }],
      ["/config/committee-enforcement", { enforced: false, reason: "r" }],
      ["/config/evaluation-mode", { mode: "PARTICIPATIF", reason: "r" }],
    ] as const) {
      const res = await call(mountConfig, "PUT", path, body);
      expect(res.status).toBeGreaterThanOrEqual(400);
      expect(res.json?.error).toMatch(/Dispositif/);
    }
    expect(writes).toHaveLength(0);
  });

  it("PUT /processes/:id/evaluation-mode answers 410 and never reaches the service (only the request/validation circuit remains)", async () => {
    const service = new Proxy({}, { get: () => { throw new Error("service must not be called"); } });
    const res = await call((app) => app.use("/processes", processesRouter(service as never)), "PUT", "/processes/p1/evaluation-mode", { evaluationMode: "PARTICIPATIF" });
    expect(res.status).toBe(410);
    expect(res.json?.error).toMatch(/process-evaluation-mode-requests/);
  });
});
