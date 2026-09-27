import { Router } from "express";
import { z } from "zod";
import type { ActionPlanService } from "../../services/ActionPlanService.js";
import type { ActionPlanSourceType } from "../../domain/entities/ActionPlan.js";

const SourceType = z.enum(["RISK", "CONTROL", "KRI", "AUDIT", "INCIDENT", "MANAGEMENT"]);
const DashboardStatus = z.enum(["PLANIFIEE", "EN_COURS", "TERMINEE", "EN_RETARD"]);

/**
 * ACT-196: `GET /dashboard/actions`, filtered by statut (incl. computed
 * EN_RETARD)/source/responsable/date/département. Kept as its own tiny
 * route file — separate from actionPlans.routes.ts — because the
 * backlog's literal path is `/dashboard/actions`, not nested under
 * `/actions`; intended to be mounted at `/api/v1/dashboard` (i.e.
 * `app.use("/api/v1/dashboard", authMiddleware(identityProvider),
 * actionPlanDashboardRouter(actionPlanService))`) alongside
 * `actionPlansRouter` mounted at `/api/v1/actions` — left for the
 * orchestrator to wire into server.ts per the task's merge-conflict
 * constraint.
 */
export function actionPlanDashboardRouter(actionPlanService: ActionPlanService): Router {
  const router = Router();

  router.get("/actions", async (req, res, next) => {
    try {
      const query = req.query as Record<string, unknown>;
      const status = typeof query["status"] === "string" ? DashboardStatus.parse(query["status"]) : undefined;
      const sourceType = typeof query["sourceType"] === "string" ? (SourceType.parse(query["sourceType"]) as ActionPlanSourceType) : undefined;
      const responsibleUserId = typeof query["responsibleUserId"] === "string" ? query["responsibleUserId"] : undefined;
      const departmentId = typeof query["departmentId"] === "string" ? query["departmentId"] : undefined;
      const dueFrom = typeof query["dueFrom"] === "string" ? new Date(query["dueFrom"]) : undefined;
      const dueTo = typeof query["dueTo"] === "string" ? new Date(query["dueTo"]) : undefined;

      const rows = await actionPlanService.dashboard(req.user, {
        status,
        sourceType,
        responsibleUserId,
        departmentId,
        dueFrom,
        dueTo,
      });
      res.json({ data: rows });
    } catch (err) {
      next(err);
    }
  });

  return router;
}
