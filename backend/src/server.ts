import express from "express";
import cors from "cors";
import { pinoHttp } from "pino-http";
import { env } from "./config/env.js";
import { pool } from "./infrastructure/database/pool.js";
import { PostgresRiskRepository } from "./infrastructure/database/postgres/PostgresRiskRepository.js";
import { PostgresAuditRepository } from "./infrastructure/database/postgres/PostgresAuditRepository.js";
import { PostgresEvidenceRepository } from "./infrastructure/database/postgres/PostgresEvidenceRepository.js";
import { PostgresTenantRepository } from "./infrastructure/database/postgres/PostgresTenantRepository.js";
import { PostgresControlRepository } from "./infrastructure/database/postgres/PostgresControlRepository.js";
import { PostgresControlExecutionRepository } from "./infrastructure/database/postgres/PostgresControlExecutionRepository.js";
import { PostgresControlEffectivenessRepository } from "./infrastructure/database/postgres/PostgresControlEffectivenessRepository.js";
import { PostgresAnomalyRepository } from "./infrastructure/database/postgres/PostgresAnomalyRepository.js";
import { PostgresDepartmentRepository } from "./infrastructure/database/postgres/PostgresDepartmentRepository.js";
import { PostgresProcessRepository } from "./infrastructure/database/postgres/PostgresProcessRepository.js";
import { PostgresRoleRepository } from "./infrastructure/database/postgres/PostgresRoleRepository.js";
import { PostgresFeedbackRepository } from "./infrastructure/database/postgres/PostgresFeedbackRepository.js";
import { TelegramNotifier } from "./infrastructure/notifications/TelegramNotifier.js";
import { NoopNotifier } from "./infrastructure/notifications/NoopNotifier.js";
import { GoogleIdentityProvider } from "./infrastructure/identity/GoogleIdentityProvider.js";
import { GoogleDriveStorage } from "./infrastructure/storage/GoogleDriveStorage.js";
import { RiskService } from "./services/RiskService.js";
import { EvidenceService } from "./services/EvidenceService.js";
import { ControlService } from "./services/ControlService.js";
import { ControlExecutionService } from "./services/ControlExecutionService.js";
import { ControlEffectivenessService } from "./services/ControlEffectivenessService.js";
import { AnomalyService } from "./services/AnomalyService.js";
import { DepartmentService } from "./services/DepartmentService.js";
import { ProcessService } from "./services/ProcessService.js";
import { AuditLogService } from "./services/AuditLogService.js";
import { RoleService } from "./services/RoleService.js";
import { FeedbackService } from "./services/FeedbackService.js";
import { risksRouter } from "./api/v1/risks.routes.js";
import { evidencesRouter } from "./api/v1/evidences.routes.js";
import { controlsRouter } from "./api/v1/controls.routes.js";
import { executionsRouter } from "./api/v1/executions.routes.js";
import { effectivenessRouter } from "./api/v1/effectiveness.routes.js";
import { anomaliesRouter } from "./api/v1/anomalies.routes.js";
import { departmentsRouter } from "./api/v1/departments.routes.js";
import { processesRouter } from "./api/v1/processes.routes.js";
import { auditLogRouter } from "./api/v1/auditLog.routes.js";
import { rolesRouter } from "./api/v1/roles.routes.js";
import { feedbackRouter } from "./api/v1/feedback.routes.js";
import { permissionsRouter } from "./api/v1/permissions.routes.js";
import { requestIdMiddleware } from "./api/middleware/requestId.js";
import { authMiddleware } from "./api/middleware/auth.js";
import { errorHandler } from "./api/middleware/errorHandler.js";

const app = express();

app.use(pinoHttp());
// Must run before authMiddleware: the browser's CORS preflight (OPTIONS)
// never carries the Authorization header, so if auth ran first it would
// reject the preflight and the real request would never be sent.
app.use(cors({ origin: env.CORS_ALLOWED_ORIGINS, allowedHeaders: ["Authorization", "Content-Type"] }));
app.use(express.json());
app.use(requestIdMiddleware);

// --- Wiring: infrastructure implementations behind their interfaces ---
const riskRepository = new PostgresRiskRepository(pool);
const auditRepository = new PostgresAuditRepository(pool);
const evidenceRepository = new PostgresEvidenceRepository(pool);
const tenantRepository = new PostgresTenantRepository(pool);
const controlRepository = new PostgresControlRepository(pool);
const executionRepository = new PostgresControlExecutionRepository(pool);
const effectivenessRepository = new PostgresControlEffectivenessRepository(pool);
const anomalyRepository = new PostgresAnomalyRepository(pool);
const departmentRepository = new PostgresDepartmentRepository(pool);
const processRepository = new PostgresProcessRepository(pool);
const roleRepository = new PostgresRoleRepository(pool);
const feedbackRepository = new PostgresFeedbackRepository(pool);
const notifier =
  env.TELEGRAM_BOT_TOKEN && env.TELEGRAM_CHAT_ID
    ? new TelegramNotifier(env.TELEGRAM_BOT_TOKEN, env.TELEGRAM_CHAT_ID)
    : new NoopNotifier();

const riskService = new RiskService(riskRepository, auditRepository);
const departmentService = new DepartmentService(departmentRepository, auditRepository);
const processService = new ProcessService(processRepository, auditRepository);
const auditLogService = new AuditLogService(auditRepository);
const controlService = new ControlService(controlRepository, riskRepository, auditRepository);
const executionService = new ControlExecutionService(executionRepository, controlRepository, auditRepository);
const effectivenessService = new ControlEffectivenessService(
  effectivenessRepository,
  controlRepository,
  auditRepository,
);
const anomalyService = new AnomalyService(anomalyRepository, auditRepository);
const roleService = new RoleService(roleRepository, auditRepository);
const feedbackService = new FeedbackService(feedbackRepository, auditRepository, notifier);

const documentStorage = new GoogleDriveStorage(
  (tenantId) => tenantRepository.getDriveFolderId(tenantId),
  env.GOOGLE_DRIVE_CREDENTIALS_PATH,
);
const evidenceService = new EvidenceService(evidenceRepository, documentStorage, auditRepository);

// Granted to every authenticated user regardless of role — there's no
// invite/onboarding flow yet (ACT-091) that could assign it per-user,
// and feedback capture is meant to be frictionless, not gated.
const BASE_PERMISSIONS = ["feedback.create"];

const identityProvider = new GoogleIdentityProvider(env.GOOGLE_OAUTH_CLIENT_ID, async (email) => {
  // Real lookup against the `users` table from migration 002 — one user
  // row per (tenant, email); tenant/roles are ours, never trusted from
  // the Google token itself.
  const { rows } = await pool.query<{ id: string; tenant_id: string; roles: string[] }>(
    `SELECT id, tenant_id, roles FROM users WHERE email = $1 AND deleted_at IS NULL`,
    [email],
  );
  const row = rows[0];
  if (!row) return null;

  // `users.roles` stays as a direct/legacy permission list (e.g. for
  // bootstrapping the first admin before any Role exists). Permissions
  // granted through the RBAC module (013_roles.sql) are layered on top
  // by resolving every role currently assigned to this user — this is
  // what makes assigning the "Auditeur" role actually grant audit.read.
  const { rows: rolePerms } = await pool.query<{ permission: string }>(
    `SELECT DISTINCT unnest(r.permissions) AS permission
     FROM user_roles ur
     JOIN roles r ON r.id = ur.role_id AND r.deleted_at IS NULL
     WHERE ur.tenant_id = $1 AND ur.user_id = $2 AND ur.revoked_at IS NULL`,
    [row.tenant_id, row.id],
  );

  const roles = Array.from(new Set([...BASE_PERMISSIONS, ...row.roles, ...rolePerms.map((r) => r.permission)]));
  return { userId: row.id, tenantId: row.tenant_id, roles };
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
app.use("/api/v1/evidences", authMiddleware(identityProvider), evidencesRouter(evidenceService));
app.use("/api/v1/controls", authMiddleware(identityProvider), controlsRouter(controlService));
app.use("/api/v1/executions", authMiddleware(identityProvider), executionsRouter(executionService));
app.use("/api/v1/effectiveness", authMiddleware(identityProvider), effectivenessRouter(effectivenessService));
app.use("/api/v1/anomalies", authMiddleware(identityProvider), anomaliesRouter(anomalyService));
app.use("/api/v1/departments", authMiddleware(identityProvider), departmentsRouter(departmentService));
app.use("/api/v1/processes", authMiddleware(identityProvider), processesRouter(processService));
app.use("/api/v1/audit-log", authMiddleware(identityProvider), auditLogRouter(auditLogService));
app.use("/api/v1/roles", authMiddleware(identityProvider), rolesRouter(roleService));
app.use("/api/v1/feedback", authMiddleware(identityProvider), feedbackRouter(feedbackService));
app.use("/api/v1/permissions", authMiddleware(identityProvider), permissionsRouter());

app.use(errorHandler);

app.listen(env.PORT, () => {
  // eslint-disable-next-line no-console
  console.log(`GRC Tools backend listening on port ${env.PORT} (${env.NODE_ENV})`);
});
