import express from "express";
import { pinoHttp } from "pino-http";
import { env } from "./config/env.js";
import { pool } from "./infrastructure/database/pool.js";
import { PostgresRiskRepository } from "./infrastructure/database/postgres/PostgresRiskRepository.js";
import { PostgresAuditRepository } from "./infrastructure/database/postgres/PostgresAuditRepository.js";
import { GoogleIdentityProvider } from "./infrastructure/identity/GoogleIdentityProvider.js";
import { RiskService } from "./services/RiskService.js";
import { risksRouter } from "./api/v1/risks.routes.js";
import { requestIdMiddleware } from "./api/middleware/requestId.js";
import { authMiddleware } from "./api/middleware/auth.js";
import { errorHandler } from "./api/middleware/errorHandler.js";

const app = express();

app.use(pinoHttp());
app.use(express.json());
app.use(requestIdMiddleware);

// --- Wiring: infrastructure implementations behind their interfaces ---
const riskRepository = new PostgresRiskRepository(pool);
const auditRepository = new PostgresAuditRepository(pool);
const riskService = new RiskService(riskRepository, auditRepository);

const identityProvider = new GoogleIdentityProvider(env.GOOGLE_OAUTH_CLIENT_ID, async (email) => {
  // TODO: replace with a real UserRepository lookup once the users/tenants
  // migration lands. Placeholder keeps the auth chain wired end-to-end.
  const { rows } = await pool.query<{ id: string; tenant_id: string; roles: string[] }>(
    `SELECT id, tenant_id, roles FROM users WHERE email = $1 AND deleted_at IS NULL`,
    [email],
  );
  const row = rows[0];
  return row ? { userId: row.id, tenantId: row.tenant_id, roles: row.roles } : null;
});

// --- Health checks (no auth — used by Cloud Run / uptime checks) ---
app.get("/health", (_req, res) => {
  res.json({ status: "ok" });
});

app.get("/ready", async (_req, res) => {
  try {
    await pool.query("SELECT 1");
    res.json({ status: "ready", database: "ok" });
  } catch {
    res.status(503).json({ status: "not ready", database: "error" });
  }
});

// --- Authenticated API ---
app.use("/api/v1/risks", authMiddleware(identityProvider), risksRouter(riskService));

app.use(errorHandler);

app.listen(env.PORT, () => {
  // eslint-disable-next-line no-console
  console.log(`GRC Tools backend listening on port ${env.PORT} (${env.NODE_ENV})`);
});
