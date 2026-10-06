import { createServer } from "node:http";
import express from "express";
import cors from "cors";
import { pinoHttp } from "pino-http";
import { env, getLocalAuthUsers } from "./config/env.js";
import { BASE_PERMISSIONS, filterKnownPermissions, type Permission } from "./domain/permissions.js";
import { pool } from "./infrastructure/database/pool.js";
import { assertProductionDatabaseRole } from "./infrastructure/database/postgres/databaseRoleSecurity.js";
import { PostgresRiskRepository } from "./infrastructure/database/postgres/PostgresRiskRepository.js";
import { PostgresAuditRepository } from "./infrastructure/database/postgres/PostgresAuditRepository.js";
import { PostgresEvidenceRepository } from "./infrastructure/database/postgres/PostgresEvidenceRepository.js";
import { PostgresTenantRepository } from "./infrastructure/database/postgres/PostgresTenantRepository.js";
import { PostgresControlRepository } from "./infrastructure/database/postgres/PostgresControlRepository.js";
import { PostgresControlExecutionRepository } from "./infrastructure/database/postgres/PostgresControlExecutionRepository.js";
import { PostgresControlEffectivenessRepository } from "./infrastructure/database/postgres/PostgresControlEffectivenessRepository.js";
import { PostgresAnomalyRepository } from "./infrastructure/database/postgres/PostgresAnomalyRepository.js";
import { PostgresAuditMissionRepository } from "./infrastructure/database/postgres/PostgresAuditMissionRepository.js";
import { PostgresFindingRepository } from "./infrastructure/database/postgres/PostgresFindingRepository.js";
import { PostgresDepartmentRepository } from "./infrastructure/database/postgres/PostgresDepartmentRepository.js";
import { PostgresProcessRepository } from "./infrastructure/database/postgres/PostgresProcessRepository.js";
import { PostgresRoleRepository } from "./infrastructure/database/postgres/PostgresRoleRepository.js";
import { PostgresFeedbackRepository } from "./infrastructure/database/postgres/PostgresFeedbackRepository.js";
import { PostgresKpiRepository } from "./infrastructure/database/postgres/PostgresKpiRepository.js";
import { PostgresKpiMeasureRepository } from "./infrastructure/database/postgres/PostgresKpiMeasureRepository.js";
import { PostgresRiskAppetiteRepository } from "./infrastructure/database/postgres/PostgresRiskAppetiteRepository.js";
import { PostgresRatingScaleRepository } from "./infrastructure/database/postgres/PostgresRatingScaleRepository.js";
import { PostgresRiskEvaluationRepository } from "./infrastructure/database/postgres/PostgresRiskEvaluationRepository.js";
import { PostgresTreatmentDecisionRepository } from "./infrastructure/database/postgres/PostgresTreatmentDecisionRepository.js";
import { PostgresKriRepository } from "./infrastructure/database/postgres/PostgresKriRepository.js";
import { PostgresKriMeasureRepository } from "./infrastructure/database/postgres/PostgresKriMeasureRepository.js";
import { PostgresUserRepository } from "./infrastructure/database/postgres/PostgresUserRepository.js";
import { PostgresRiskEscalationRepository } from "./infrastructure/database/postgres/PostgresRiskEscalationRepository.js";
import { PostgresActionPlanRepository } from "./infrastructure/database/postgres/PostgresActionPlanRepository.js";
import { PostgresRaciAssignmentRepository } from "./infrastructure/database/postgres/PostgresRaciAssignmentRepository.js";
import { PostgresBrandingRepository } from "./infrastructure/database/postgres/PostgresBrandingRepository.js";
import { PostgresConfigRepository } from "./infrastructure/database/postgres/PostgresConfigRepository.js";
import { PostgresModuleToggleRepository } from "./infrastructure/database/postgres/PostgresModuleToggleRepository.js";
import { PostgresRegulatoryFrameworkRepository } from "./infrastructure/database/postgres/PostgresRegulatoryFrameworkRepository.js";
import { PostgresRiskCategoryRepository } from "./infrastructure/database/postgres/PostgresRiskCategoryRepository.js";
import { PostgresNotificationRepository } from "./infrastructure/database/postgres/PostgresNotificationRepository.js";
import { PostgresNotificationSubscriptionRepository } from "./infrastructure/database/postgres/PostgresNotificationSubscriptionRepository.js";
import { PostgresReviewCycleRepository } from "./infrastructure/database/postgres/PostgresReviewCycleRepository.js";
import { PostgresProcessEvaluationModeRequestRepository } from "./infrastructure/database/postgres/PostgresProcessEvaluationModeRequestRepository.js";
import { TelegramNotifier } from "./infrastructure/notifications/TelegramNotifier.js";
import { NoopNotifier } from "./infrastructure/notifications/NoopNotifier.js";
import { GoogleIdentityProvider } from "./infrastructure/identity/GoogleIdentityProvider.js";
import { LocalIdentityProvider } from "./infrastructure/identity/LocalIdentityProvider.js";
import { localAuthRouter } from "./api/v1/localAuth.routes.js";
import { GoogleDriveStorage } from "./infrastructure/storage/GoogleDriveStorage.js";
import { RiskService } from "./services/RiskService.js";
import { EvidenceService } from "./services/EvidenceService.js";
import { ControlService } from "./services/ControlService.js";
import { ControlExecutionService } from "./services/ControlExecutionService.js";
import { ControlEffectivenessService } from "./services/ControlEffectivenessService.js";
import { AnomalyService } from "./services/AnomalyService.js";
import { AuditMissionService } from "./services/AuditMissionService.js";
import { FindingService } from "./services/FindingService.js";
import { DepartmentService } from "./services/DepartmentService.js";
import { ProcessService } from "./services/ProcessService.js";
import { ProcessEvaluationModeRequestService } from "./services/ProcessEvaluationModeRequestService.js";
import { AuditLogService } from "./services/AuditLogService.js";
import { RoleService } from "./services/RoleService.js";
import { FeedbackService } from "./services/FeedbackService.js";
import { KpiService } from "./services/KpiService.js";
import { KpiMeasureService } from "./services/KpiMeasureService.js";
import { RiskAppetiteService } from "./services/RiskAppetiteService.js";
import { RatingScaleService } from "./services/RatingScaleService.js";
import { RiskEvaluationService } from "./services/RiskEvaluationService.js";
import { RiskEvaluationViewService } from "./services/RiskEvaluationViewService.js";
import { TreatmentDecisionService } from "./services/TreatmentDecisionService.js";
import { KriService } from "./services/KriService.js";
import { KriMeasureService } from "./services/KriMeasureService.js";
import { UserService } from "./services/UserService.js";
import { RiskOwnershipService } from "./services/RiskOwnershipService.js";
import { ActionPlanService } from "./services/ActionPlanService.js";
import { RaciAssignmentService } from "./services/RaciAssignmentService.js";
import { RaciEnrichmentViewService } from "./services/RaciEnrichmentViewService.js";
import { RiskDeviceViewService } from "./services/RiskDeviceViewService.js";
import { CartographyService } from "./services/CartographyService.js";
import { DashboardService } from "./services/DashboardService.js";
import { DashboardScopeResolver } from "./services/DashboardScopeResolver.js";
import { widestScopeMode, type DashboardScopeMode } from "./domain/entities/DashboardScope.js";
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
import { auditMissionsRouter } from "./api/v1/auditMissions.routes.js";
import { findingsRouter } from "./api/v1/findings.routes.js";
import { departmentsRouter } from "./api/v1/departments.routes.js";
import { processesRouter } from "./api/v1/processes.routes.js";
import { processEvaluationModeRequestsRouter } from "./api/v1/processEvaluationModeRequests.routes.js";
import { auditLogRouter } from "./api/v1/auditLog.routes.js";
import { rolesRouter } from "./api/v1/roles.routes.js";
import { feedbackRouter } from "./api/v1/feedback.routes.js";
import { kpisRouter } from "./api/v1/kpis.routes.js";
import { kpiMeasuresRouter } from "./api/v1/kpiMeasures.routes.js";
import { riskAppetiteRouter } from "./api/v1/riskAppetite.routes.js";
import { ratingScalesRouter } from "./api/v1/ratingScales.routes.js";
import { riskEvaluationsRouter } from "./api/v1/riskEvaluations.routes.js";
import { treatmentDecisionsRouter } from "./api/v1/treatmentDecisions.routes.js";
import { krisRouter } from "./api/v1/kris.routes.js";
import { kriMeasuresRouter } from "./api/v1/kriMeasures.routes.js";
import { usersRouter } from "./api/v1/users.routes.js";
import { riskOwnersRouter } from "./api/v1/riskOwners.routes.js";
import { actionPlansRouter } from "./api/v1/actionPlans.routes.js";
import { raciRouter } from "./api/v1/raci.routes.js";
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
import { moduleGuard } from "./api/middleware/moduleGuard.js";
import { errorHandler } from "./api/middleware/errorHandler.js";
import { authAttemptRateLimiter } from "./api/middleware/rateLimit.js";
import { securityHeadersMiddleware } from "./api/middleware/securityHeaders.js";

const app = express();
app.disable("x-powered-by");

// Baseline security headers for the API.
app.use((_req, res, next) => {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("Referrer-Policy", "no-referrer");
  next();
});

app.use(pinoHttp());
// See securityHeaders.ts doc comment for why CSP/COEP/CORP are tuned down
// from helmet's defaults. Everything else (HSTS, no-sniff, frameguard,
// referrer-policy, etc.) stays at helmet's secure defaults.
app.use(securityHeadersMiddleware());
// Must run before authMiddleware: the browser's CORS preflight (OPTIONS)
// never carries the Authorization header, so if auth ran first it would
// reject the preflight and the real request would never be sent.
app.use(cors({ origin: env.CORS_ALLOWED_ORIGINS, allowedHeaders: ["Authorization", "Content-Type"] }));
app.use(express.json({ limit: "1mb" }));
app.use(requestIdMiddleware);
// See rateLimit.ts doc comment: there is no dedicated /login route, so this
// throttles failed-auth traffic (401s and other errors) across the whole
// authenticated API surface instead. /health and /ready are intentionally
// excluded — they're unauthenticated infra probes, not attacker-reachable
// auth attempts, and Cloud Run/uptime checks must not be throttled.
app.use("/api/v1", authAttemptRateLimiter());

// --- Wiring: infrastructure implementations behind their interfaces ---
const riskRepository = new PostgresRiskRepository(pool);
const auditRepository = new PostgresAuditRepository(pool);
const evidenceRepository = new PostgresEvidenceRepository(pool);
const tenantRepository = new PostgresTenantRepository(pool);
const controlRepository = new PostgresControlRepository(pool);
const executionRepository = new PostgresControlExecutionRepository(pool);
const effectivenessRepository = new PostgresControlEffectivenessRepository(pool);
const anomalyRepository = new PostgresAnomalyRepository(pool);
const auditMissionRepository = new PostgresAuditMissionRepository(pool);
const findingRepository = new PostgresFindingRepository(pool);
const departmentRepository = new PostgresDepartmentRepository(pool);
const processRepository = new PostgresProcessRepository(pool);
const roleRepository = new PostgresRoleRepository(pool);
const feedbackRepository = new PostgresFeedbackRepository(pool);
const kpiRepository = new PostgresKpiRepository(pool);
const kpiMeasureRepository = new PostgresKpiMeasureRepository(pool);
const riskAppetiteRepository = new PostgresRiskAppetiteRepository(pool);
const ratingScaleRepository = new PostgresRatingScaleRepository(pool);
const riskEvaluationRepository = new PostgresRiskEvaluationRepository(pool);
const treatmentDecisionRepository = new PostgresTreatmentDecisionRepository(pool);
const kriRepository = new PostgresKriRepository(pool);
const kriMeasureRepository = new PostgresKriMeasureRepository(pool);
const userRepository = new PostgresUserRepository(pool);
const riskEscalationRepository = new PostgresRiskEscalationRepository(pool);
const actionPlanRepository = new PostgresActionPlanRepository(pool);
const raciAssignmentRepository = new PostgresRaciAssignmentRepository(pool);
const brandingRepository = new PostgresBrandingRepository(pool);
const configRepository = new PostgresConfigRepository(pool);
const moduleToggleRepository = new PostgresModuleToggleRepository(pool);
const regulatoryFrameworkRepository = new PostgresRegulatoryFrameworkRepository(pool);
const riskCategoryRepository = new PostgresRiskCategoryRepository(pool);
const notificationRepository = new PostgresNotificationRepository(pool);
const notificationSubscriptionRepository = new PostgresNotificationSubscriptionRepository(pool);
const reviewCycleRepository = new PostgresReviewCycleRepository(pool);
const processEvaluationModeRequestRepository = new PostgresProcessEvaluationModeRequestRepository(pool);
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
  processRepository,
);
const departmentService = new DepartmentService(departmentRepository, auditRepository);
const processService = new ProcessService(
  processRepository,
  auditRepository,
  riskRepository,
  controlRepository,
  processEvaluationModeRequestRepository,
);
const processEvaluationModeRequestService = new ProcessEvaluationModeRequestService(
  processEvaluationModeRequestRepository,
  processRepository,
  riskRepository,
  auditRepository,
);
const auditLogService = new AuditLogService(auditRepository);
const controlService = new ControlService(controlRepository, riskRepository, auditRepository, processRepository);
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
const auditMissionService = new AuditMissionService(auditMissionRepository, auditRepository, userRepository);
const findingService = new FindingService(
  findingRepository,
  auditMissionRepository,
  auditRepository,
  riskRepository,
  controlRepository,
  anomalyRepository,
);
const roleService = new RoleService(roleRepository, auditRepository, userRepository);
const feedbackService = new FeedbackService(feedbackRepository, auditRepository, notifier);
const kpiService = new KpiService(kpiRepository, kpiMeasureRepository, departmentRepository, processRepository, auditRepository);
const kpiMeasureService = new KpiMeasureService(kpiMeasureRepository, kpiRepository, auditRepository);
const riskAppetiteService = new RiskAppetiteService(riskAppetiteRepository, auditRepository, riskCategoryRepository);
const ratingScaleService = new RatingScaleService(ratingScaleRepository, auditRepository, riskEvaluationRepository);
const riskEvaluationService = new RiskEvaluationService(
  riskEvaluationRepository,
  auditRepository,
  riskRepository,
  ratingScaleRepository,
  riskAppetiteRepository,
  processRepository,
  configRepository,
);
const treatmentDecisionService = new TreatmentDecisionService(
  treatmentDecisionRepository,
  riskEvaluationRepository,
  riskRepository,
  auditRepository,
  configRepository,
);
// DIV-07: read-only companion of riskEvaluationService — composes only, never scores.
const riskEvaluationViewService = new RiskEvaluationViewService(
  riskEvaluationRepository,
  riskRepository,
  controlRepository,
  effectivenessRepository,
);
const kriService = new KriService(kriRepository, kriMeasureRepository, riskRepository, auditRepository);
const kriMeasureService = new KriMeasureService(kriMeasureRepository, kriRepository, auditRepository, notifier);
const userService = new UserService(userRepository, auditRepository, roleService, departmentRepository);
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
  findingRepository,
);
const cartographyService = new CartographyService(riskRepository, riskEvaluationRepository, ratingScaleRepository, processRepository);
const raciAssignmentService = new RaciAssignmentService(raciAssignmentRepository, auditRepository, riskRepository, controlRepository, actionPlanRepository, userRepository);
// RACI read-side wiring (PO-confirmed follow-up to Lot 1, see RaciEnrichmentViewService
// doc comment): composes risk/control/actionPlan services with raciAssignmentService,
// read-only, never a condition for a write.
const raciEnrichmentViewService = new RaciEnrichmentViewService(
  riskService,
  controlService,
  actionPlanService,
  raciAssignmentService,
);

// DECISION-002/DECISION-003: Risk 360 / Dispositif de risque read model —
// composes the repositories/services above, no new table/migration. See
// RiskDeviceViewService's file header for scope.
const riskDeviceViewService = new RiskDeviceViewService(
  riskRepository,
  riskEvaluationRepository,
  controlRepository,
  effectivenessRepository,
  actionPlanService,
  raciEnrichmentViewService,
  riskAppetiteService,
);

const documentStorage = new GoogleDriveStorage(
  (tenantId) => tenantRepository.getDriveFolderId(tenantId),
  env.GOOGLE_DRIVE_CREDENTIALS_PATH,
);
const evidenceService = new EvidenceService(evidenceRepository, documentStorage, auditRepository, executionRepository);

const dashboardScopeResolver = new DashboardScopeResolver(raciAssignmentRepository, riskRepository);

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
  processRepository,
  dashboardScopeResolver,
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

const lookupMembership = async (email: string) => {
  const { rows } = await pool.query<{ id: string; tenant_id: string; roles: string[]; email: string; display_name: string | null }>(
    `SELECT id, tenant_id, roles, email, display_name FROM users WHERE email = $1 AND deleted_at IS NULL`,
    [email],
  );
  const row = rows[0];
  if (!row) return null;

  const { rows: rolePerms } = await pool.query<{ permission: string }>(
    `SELECT DISTINCT unnest(r.permissions) AS permission
     FROM user_roles ur
     JOIN roles r ON r.id = ur.role_id AND r.deleted_at IS NULL
     WHERE ur.tenant_id = $1 AND ur.user_id = $2 AND ur.revoked_at IS NULL`,
    [row.tenant_id, row.id],
  );

  const { rows: roleScopes } = await pool.query<{ dashboard_scope_mode: DashboardScopeMode }>(
    `SELECT DISTINCT r.dashboard_scope_mode
     FROM user_roles ur
     JOIN roles r ON r.id = ur.role_id AND r.deleted_at IS NULL
     WHERE ur.tenant_id = $1 AND ur.user_id = $2 AND ur.revoked_at IS NULL`,
    [row.tenant_id, row.id],
  );

  const legacyPermissions = filterKnownPermissions(row.roles);
  const droppedLegacyPermissions = row.roles.filter((r) => !legacyPermissions.includes(r as Permission));
  if (droppedLegacyPermissions.length > 0) {
    console.warn(
      `users.roles for ${email} contains unknown permission string(s), ignored: ${droppedLegacyPermissions.join(", ")}`,
    );
  }

  let dashboardScopeMode: DashboardScopeMode;
  if (roleScopes.length > 0) {
    dashboardScopeMode = widestScopeMode(roleScopes.map((r) => r.dashboard_scope_mode));
  } else {
    dashboardScopeMode = "GLOBAL";
    if (legacyPermissions.length > 0) {
      console.warn(
        `${email} holds permissions only via legacy users.roles (no real Role assigned) — dashboardScopeMode resolved to GLOBAL`,
      );
    }
  }

  const roles = Array.from(new Set([...BASE_PERMISSIONS, ...legacyPermissions, ...rolePerms.map((r) => r.permission)]));
  return {
    userId: row.id,
    tenantId: row.tenant_id,
    email: row.email,
    displayName: row.display_name ?? row.email,
    roles,
    dashboardScopeMode,
  };
};

const identityProvider =
  env.AUTH_PROVIDER === "google"
    ? new GoogleIdentityProvider(env.GOOGLE_OAUTH_CLIENT_ID!, lookupMembership)
    : new LocalIdentityProvider(
        getLocalAuthUsers(),
        env.LOCAL_AUTH_TOKEN_SECRET!,
        env.LOCAL_AUTH_TOKEN_TTL_SECONDS,
        lookupMembership,
      );

if (env.AUTH_PROVIDER === "local") {
  app.use("/api/v1/auth", localAuthRouter(identityProvider as LocalIdentityProvider));
}

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
// moduleGuard wired per MODULE_NAMES (ACT-221): each togglable module's main
// resource route(s) get the same one-line treatment as /risks.
app.use(
  "/api/v1/risks",
  authMiddleware(identityProvider),
  moduleGuard(moduleToggleService, "RISK"),
  risksRouter(riskService, raciEnrichmentViewService, riskDeviceViewService),
);
app.use(
  "/api/v1/evidences",
  authMiddleware(identityProvider),
  moduleGuard(moduleToggleService, "EVIDENCE"),
  evidencesRouter(evidenceService),
);
app.use(
  "/api/v1/controls",
  authMiddleware(identityProvider),
  moduleGuard(moduleToggleService, "CONTROL"),
  controlsRouter(controlService, raciEnrichmentViewService),
);
app.use("/api/v1/executions", authMiddleware(identityProvider), executionsRouter(executionService));
app.use("/api/v1/effectiveness", authMiddleware(identityProvider), effectivenessRouter(effectivenessService));
app.use(
  "/api/v1/anomalies",
  authMiddleware(identityProvider),
  moduleGuard(moduleToggleService, "ANOMALY"),
  anomaliesRouter(anomalyService),
);
app.use(
  "/api/v1/audit-missions",
  authMiddleware(identityProvider),
  moduleGuard(moduleToggleService, "AUDIT"),
  auditMissionsRouter(auditMissionService),
);
app.use(
  "/api/v1/findings",
  authMiddleware(identityProvider),
  moduleGuard(moduleToggleService, "AUDIT"),
  findingsRouter(findingService),
);
app.use("/api/v1/departments", authMiddleware(identityProvider), departmentsRouter(departmentService));
app.use("/api/v1/processes", authMiddleware(identityProvider), processesRouter(processService));
app.use(
  "/api/v1/process-evaluation-mode-requests",
  authMiddleware(identityProvider),
  processEvaluationModeRequestsRouter(processEvaluationModeRequestService),
);
app.use("/api/v1/audit-log", authMiddleware(identityProvider), auditLogRouter(auditLogService));
app.use("/api/v1/roles", authMiddleware(identityProvider), rolesRouter(roleService));
app.use("/api/v1/feedback", authMiddleware(identityProvider), feedbackRouter(feedbackService));
app.use("/api/v1/permissions", authMiddleware(identityProvider), permissionsRouter());
app.use(
  "/api/v1/kpis",
  authMiddleware(identityProvider),
  moduleGuard(moduleToggleService, "KPI"),
  kpisRouter(kpiService),
);
app.use("/api/v1/kpi-measures", authMiddleware(identityProvider), kpiMeasuresRouter(kpiMeasureService));
app.use("/api/v1/appetite", authMiddleware(identityProvider), riskAppetiteRouter(riskAppetiteService));
app.use("/api/v1/rating-scales", authMiddleware(identityProvider), ratingScalesRouter(ratingScaleService));
app.use(
  "/api/v1/risk-evaluations",
  authMiddleware(identityProvider),
  riskEvaluationsRouter(riskEvaluationService, riskEvaluationViewService, treatmentDecisionService),
);
app.use("/api/v1/treatment-decisions", authMiddleware(identityProvider), treatmentDecisionsRouter(treatmentDecisionService));
app.use(
  "/api/v1/kris",
  authMiddleware(identityProvider),
  moduleGuard(moduleToggleService, "KRI"),
  krisRouter(kriService),
);
app.use("/api/v1/kri-measures", authMiddleware(identityProvider), kriMeasuresRouter(kriMeasureService));
app.use("/api/v1/users", authMiddleware(identityProvider), usersRouter(userService));
app.use("/api/v1/risk-owners", authMiddleware(identityProvider), riskOwnersRouter(riskOwnershipService));
app.use(
  "/api/v1/actions",
  authMiddleware(identityProvider),
  moduleGuard(moduleToggleService, "ACTION_PLAN"),
  actionPlansRouter(actionPlanService, raciEnrichmentViewService),
);
app.use("/api/v1/raci", authMiddleware(identityProvider), raciRouter(raciAssignmentService));
app.use(
  "/api/v1/dashboard",
  authMiddleware(identityProvider),
  moduleGuard(moduleToggleService, "DASHBOARD"),
  actionPlanDashboardRouter(actionPlanService),
);
app.use(
  "/api/v1/cartography",
  authMiddleware(identityProvider),
  moduleGuard(moduleToggleService, "CARTOGRAPHY"),
  cartographyRouter(cartographyService),
);
app.use(
  "/api/v1/dashboard",
  authMiddleware(identityProvider),
  moduleGuard(moduleToggleService, "DASHBOARD"),
  dashboardRouter(dashboardService),
);
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

async function startServer(): Promise<void> {
  await assertProductionDatabaseRole(pool, env.APP_ENV);

  const server = createServer(app);

  server.requestTimeout = 120_000;
  server.headersTimeout = 15_000;
  server.keepAliveTimeout = 5_000;

  server.listen(env.PORT, () => {
    // eslint-disable-next-line no-console
    console.log(`GRC Tools backend listening on port ${env.PORT} (${env.NODE_ENV})`);
  });
}

startServer().catch((err) => {
  // eslint-disable-next-line no-console
  console.error("Fatal startup error:", err);
  process.exit(1);
});
