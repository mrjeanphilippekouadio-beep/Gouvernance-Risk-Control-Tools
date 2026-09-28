import express from "express";
import cors from "cors";
import { pinoHttp } from "pino-http";
import { env } from "./config/env.js";
import { BASE_PERMISSIONS, filterKnownPermissions, type Permission } from "./domain/permissions.js";
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
import { PostgresKpiRepository } from "./infrastructure/database/postgres/PostgresKpiRepository.js";
import { PostgresKpiMeasureRepository } from "./infrastructure/database/postgres/PostgresKpiMeasureRepository.js";
import { PostgresRiskAppetiteRepository } from "./infrastructure/database/postgres/PostgresRiskAppetiteRepository.js";
import { PostgresRatingScaleRepository } from "./infrastructure/database/postgres/PostgresRatingScaleRepository.js";
import { PostgresRiskEvaluationRepository } from "./infrastructure/database/postgres/PostgresRiskEvaluationRepository.js";
import { PostgresKriRepository } from "./infrastructure/database/postgres/PostgresKriRepository.js";
import { PostgresKriMeasureRepository } from "./infrastructure/database/postgres/PostgresKriMeasureRepository.js";
import { PostgresUserRepository } from "./infrastructure/database/postgres/PostgresUserRepository.js";
import { PostgresRiskEscalationRepository } from "./infrastructure/database/postgres/PostgresRiskEscalationRepository.js";
import { PostgresActionPlanRepository } from "./infrastructure/database/postgres/PostgresActionPlanRepository.js";
import { PostgresBrandingRepository } from "./infrastructure/database/postgres/PostgresBrandingRepository.js";
import { PostgresConfigRepository } from "./infrastructure/database/postgres/PostgresConfigRepository.js";
import { PostgresModuleToggleRepository } from "./infrastructure/database/postgres/PostgresModuleToggleRepository.js";
import { PostgresRegulatoryFrameworkRepository } from "./infrastructure/database/postgres/PostgresRegulatoryFrameworkRepository.js";
import { PostgresRiskCategoryRepository } from "./infrastructure/database/postgres/PostgresRiskCategoryRepository.js";
import { PostgresNotificationRepository } from "./infrastructure/database/postgres/PostgresNotificationRepository.js";
import { PostgresNotificationSubscriptionRepository } from "./infrastructure/database/postgres/PostgresNotificationSubscriptionRepository.js";
import { PostgresReviewCycleRepository } from "./infrastructure/database/postgres/PostgresReviewCycleRepository.js";
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
import { KpiService } from "./services/KpiService.js";
import { KpiMeasureService } from "./services/KpiMeasureService.js";
import { RiskAppetiteService } from "./services/RiskAppetiteService.js";
import { RatingScaleService } from "./services/RatingScaleService.js";
import { RiskEvaluationService } from "./services/RiskEvaluationService.js";
import { KriService } from "./services/KriService.js";
import { KriMeasureService } from "./services/KriMeasureService.js";
import { UserService } from "./services/UserService.js";
import { RiskOwnershipService } from "./services/RiskOwnershipService.js";
import { ActionPlanService } from "./services/ActionPlanService.js";
import { CartographyService } from "./services/CartographyService.js";
import { DashboardService } from "./services/DashboardService.js";
import { BrandingService } from "./services/BrandingService.js";
import { ConfigService } from "./services/ConfigService.js";
import { ModuleToggleService } from "./services/ModuleToggleService.js";
import { TenantService } from "./services/TenantService.js";
import { RegulatoryFrameworkService } from "./services/RegulatoryFrameworkService.js";
import { RiskCategoryService } from "./services/RiskCategoryService.js";
import { RiskImportService } from "./services/RiskImportService.js";
import { NotificationService } from "./services/NotificationService.js";
import { GovernanceService } from "./services/GovernanceService.js";
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
import { kpisRouter } from "./api/v1/kpis.routes.js";
import { kpiMeasuresRouter } from "./api/v1/kpiMeasures.routes.js";
import { riskAppetiteRouter } from "./api/v1/riskAppetite.routes.js";
import { ratingScalesRouter } from "./api/v1/ratingScales.routes.js";
import { riskEvaluationsRouter } from "./api/v1/riskEvaluations.routes.js";
import { krisRouter } from "./api/v1/kris.routes.js";
import { kriMeasuresRouter } from "./api/v1/kriMeasures.routes.js";
import { usersRouter } from "./api/v1/users.routes.js";
import { riskOwnersRouter } from "./api/v1/riskOwners.routes.js";
import { actionPlansRouter } from "./api/v1/actionPlans.routes.js";
import { actionPlanDashboardRouter } from "./api/v1/actionPlanDashboard.routes.js";
import { cartographyRouter } from "./api/v1/cartography.routes.js";
import { dashboardRouter } from "./api/v1/dashboard.routes.js";
import { reportsRouter } from "./api/v1/reports.routes.js";
import { brandingRouter } from "./api/v1/branding.routes.js";
import { configRouter } from "./api/v1/config.routes.js";
import { moduleTogglesRouter } from "./api/v1/moduleToggles.routes.js";
import { tenantsRouter } from "./api/v1/tenants.routes.js";
import { regulatoryFrameworksRouter } from "./api/v1/regulatoryFrameworks.routes.js";
import { riskCategoriesRouter } from "./api/v1/riskCategories.routes.js";
import { riskImportRouter } from "./api/v1/riskImport.routes.js";
import { notificationsRouter } from "./api/v1/notifications.routes.js";
import { notificationSubscriptionsRouter } from "./api/v1/notificationSubscriptions.routes.js";
import { reviewCyclesRouter } from "./api/v1/reviewCycles.routes.js";
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
const kpiRepository = new PostgresKpiRepository(pool);
const kpiMeasureRepository = new PostgresKpiMeasureRepository(pool);
const riskAppetiteRepository = new PostgresRiskAppetiteRepository(pool);
const ratingScaleRepository = new PostgresRatingScaleRepository(pool);
const riskEvaluationRepository = new PostgresRiskEvaluationRepository(pool);
const kriRepository = new PostgresKriRepository(pool);
const kriMeasureRepository = new PostgresKriMeasureRepository(pool);
const userRepository = new PostgresUserRepository(pool);
const riskEscalationRepository = new PostgresRiskEscalationRepository(pool);
const actionPlanRepository = new PostgresActionPlanRepository(pool);
const brandingRepository = new PostgresBrandingRepository(pool);
const configRepository = new PostgresConfigRepository(pool);
const moduleToggleRepository = new PostgresModuleToggleRepository(pool);
const regulatoryFrameworkRepository = new PostgresRegulatoryFrameworkRepository(pool);
const riskCategoryRepository = new PostgresRiskCategoryRepository(pool);
const notificationRepository = new PostgresNotificationRepository(pool);
const notificationSubscriptionRepository = new PostgresNotificationSubscriptionRepository(pool);
const reviewCycleRepository = new PostgresReviewCycleRepository(pool);
const notifier =
  env.TELEGRAM_BOT_TOKEN && env.TELEGRAM_CHAT_ID
    ? new TelegramNotifier(env.TELEGRAM_BOT_TOKEN, env.TELEGRAM_CHAT_ID)
    : new NoopNotifier();

const riskService = new RiskService(
  riskRepository,
  auditRepository,
  departmentRepository,
  userRepository,
  notifier,
  riskEscalationRepository,
);
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
const anomalyService = new AnomalyService(
  anomalyRepository,
  auditRepository,
  controlRepository,
  executionRepository,
  riskRepository,
);
const roleService = new RoleService(roleRepository, auditRepository, userRepository);
const feedbackService = new FeedbackService(feedbackRepository, auditRepository, notifier);
const kpiService = new KpiService(kpiRepository, kpiMeasureRepository, departmentRepository, processRepository, auditRepository);
const kpiMeasureService = new KpiMeasureService(kpiMeasureRepository, kpiRepository, auditRepository);
const riskAppetiteService = new RiskAppetiteService(riskAppetiteRepository, auditRepository);
const ratingScaleService = new RatingScaleService(ratingScaleRepository, auditRepository);
const riskEvaluationService = new RiskEvaluationService(
  riskEvaluationRepository,
  auditRepository,
  riskRepository,
  ratingScaleRepository,
  riskAppetiteRepository,
);
const kriService = new KriService(kriRepository, kriMeasureRepository, riskRepository, auditRepository);
const kriMeasureService = new KriMeasureService(kriMeasureRepository, kriRepository, auditRepository, notifier);
const userService = new UserService(userRepository, auditRepository, roleService);
const riskOwnershipService = new RiskOwnershipService(riskRepository, userRepository, riskEvaluationRepository);
const actionPlanService = new ActionPlanService(
  actionPlanRepository,
  auditRepository,
  riskRepository,
  controlRepository,
  kriRepository,
  anomalyRepository,
  evidenceRepository,
  notifier,
  userRepository,
  departmentRepository,
);
const cartographyService = new CartographyService(riskRepository, riskEvaluationRepository, ratingScaleRepository);

const documentStorage = new GoogleDriveStorage(
  (tenantId) => tenantRepository.getDriveFolderId(tenantId),
  env.GOOGLE_DRIVE_CREDENTIALS_PATH,
);
const evidenceService = new EvidenceService(evidenceRepository, documentStorage, auditRepository, executionRepository);

const dashboardService = new DashboardService(
  riskRepository,
  riskEvaluationRepository,
  anomalyRepository,
  kriRepository,
  kriMeasureRepository,
  actionPlanRepository,
  riskAppetiteRepository,
  controlRepository,
  executionRepository,
  effectivenessRepository,
  departmentRepository,
  kpiRepository,
  kpiMeasureRepository,
);
const brandingService = new BrandingService(brandingRepository, documentStorage, auditRepository);
const configService = new ConfigService(configRepository, auditRepository);
const moduleToggleService = new ModuleToggleService(moduleToggleRepository, auditRepository);
const tenantService = new TenantService(tenantRepository, auditRepository);
const regulatoryFrameworkService = new RegulatoryFrameworkService(regulatoryFrameworkRepository, auditRepository);
const riskCategoryService = new RiskCategoryService(riskCategoryRepository, auditRepository);
const riskImportService = new RiskImportService(riskService);
const notificationService = new NotificationService(notificationRepository, notificationSubscriptionRepository, auditRepository);
const governanceService = new GovernanceService(reviewCycleRepository, auditRepository, notifier);

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

  // SEC-005: users.roles is hand-edited/seeded, never validated — filter
  // out anything that isn't a real, current permission before trusting
  // it, and log what got dropped (a typo or a stale/renamed permission
  // should be visible, not silently inert forever).
  const legacyPermissions = filterKnownPermissions(row.roles);
  const droppedLegacyPermissions = row.roles.filter((r) => !legacyPermissions.includes(r as Permission));
  if (droppedLegacyPermissions.length > 0) {
    // eslint-disable-next-line no-console
    console.warn(
      `users.roles for ${email} contains unknown permission string(s), ignored: ${droppedLegacyPermissions.join(", ")}`,
    );
  }

  const roles = Array.from(new Set([...BASE_PERMISSIONS, ...legacyPermissions, ...rolePerms.map((r) => r.permission)]));
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
app.use("/api/v1/kpis", authMiddleware(identityProvider), kpisRouter(kpiService));
app.use("/api/v1/kpi-measures", authMiddleware(identityProvider), kpiMeasuresRouter(kpiMeasureService));
app.use("/api/v1/appetite", authMiddleware(identityProvider), riskAppetiteRouter(riskAppetiteService));
app.use("/api/v1/rating-scales", authMiddleware(identityProvider), ratingScalesRouter(ratingScaleService));
app.use("/api/v1/risk-evaluations", authMiddleware(identityProvider), riskEvaluationsRouter(riskEvaluationService));
app.use("/api/v1/kris", authMiddleware(identityProvider), krisRouter(kriService));
app.use("/api/v1/kri-measures", authMiddleware(identityProvider), kriMeasuresRouter(kriMeasureService));
app.use("/api/v1/users", authMiddleware(identityProvider), usersRouter(userService));
app.use("/api/v1/risk-owners", authMiddleware(identityProvider), riskOwnersRouter(riskOwnershipService));
app.use("/api/v1/actions", authMiddleware(identityProvider), actionPlansRouter(actionPlanService));
app.use("/api/v1/dashboard", authMiddleware(identityProvider), actionPlanDashboardRouter(actionPlanService));
app.use("/api/v1/cartography", authMiddleware(identityProvider), cartographyRouter(cartographyService));
app.use("/api/v1/dashboard", authMiddleware(identityProvider), dashboardRouter(dashboardService));
app.use("/api/v1/reports", authMiddleware(identityProvider), reportsRouter(dashboardService));
app.use("/api/v1/branding", authMiddleware(identityProvider), brandingRouter(brandingService));
app.use("/api/v1/config", authMiddleware(identityProvider), configRouter(configService));
app.use("/api/v1/modules", authMiddleware(identityProvider), moduleTogglesRouter(moduleToggleService));
app.use("/api/v1/tenants", authMiddleware(identityProvider), tenantsRouter(tenantService));
app.use(
  "/api/v1/regulatory-frameworks",
  authMiddleware(identityProvider),
  regulatoryFrameworksRouter(regulatoryFrameworkService),
);
app.use("/api/v1/risk-categories", authMiddleware(identityProvider), riskCategoriesRouter(riskCategoryService));
app.use("/api/v1/import/excel", authMiddleware(identityProvider), riskImportRouter(riskImportService));
app.use("/api/v1/notifications", authMiddleware(identityProvider), notificationsRouter(notificationService));
app.use(
  "/api/v1/notification-subscriptions",
  authMiddleware(identityProvider),
  notificationSubscriptionsRouter(notificationService),
);
app.use("/api/v1/review-cycles", authMiddleware(identityProvider), reviewCyclesRouter(governanceService));

app.use(errorHandler);

app.listen(env.PORT, () => {
  // eslint-disable-next-line no-console
  console.log(`GRC Tools backend listening on port ${env.PORT} (${env.NODE_ENV})`);
});
