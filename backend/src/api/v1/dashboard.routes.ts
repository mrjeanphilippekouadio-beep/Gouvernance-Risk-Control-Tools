import { Router } from "express";
import type { DashboardService } from "../../services/DashboardService.js";
import type { AnomalyStatus } from "../../domain/entities/Anomaly.js";
import { ValidationError } from "../../domain/errors/DomainErrors.js";

/**
 * "open"/"in_progress" (the backlog's literal query tokens, ACT-081)
 * aren't Anomaly's real status enum — mapped here, at the HTTP edge,
 * into the values DashboardService actually understands.
 */
const ANOMALY_STATUS_TOKENS: Record<string, AnomalyStatus[]> = {
  open: ["NEW", "UNDER_ANALYSIS"],
  in_progress: ["ACTION_IN_PROGRESS"],
  closed: ["CLOSED"],
};

function parseDate(value: unknown): Date | undefined {
  if (typeof value !== "string" || !value) return undefined;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) throw new ValidationError(`Invalid date: ${value}`);
  return parsed;
}

/**
 * ACT-080/081/082/084(branding is separate)/240-243 — mounted at
 * `/api/v1/dashboard` per the backlog's literal paths. Left for the
 * orchestrator to wire into server.ts (see actionPlanDashboard.routes.ts
 * for the established precedent). Every method here is a thin pass-
 * through to DashboardService — the shared aggregation layer also used
 * by reports.routes.ts, see that file and DashboardService's class doc
 * comment for why the compliance/department queries are identical
 * between the two.
 */
export function dashboardRouter(dashboardService: DashboardService): Router {
  const router = Router();

  router.get("/risks", async (req, res, next) => {
    try {
      res.json({ data: await dashboardService.getRisksOverview(req.user) });
    } catch (err) {
      next(err);
    }
  });

  router.get("/anomalies", async (req, res, next) => {
    try {
      const raw = req.query["status"];
      const tokens = typeof raw === "string" ? raw.split(",").map((t) => t.trim()) : [];
      const statuses = [...new Set(tokens.flatMap((t) => ANOMALY_STATUS_TOKENS[t] ?? []))];
      res.json({ data: await dashboardService.getOpenAnomalies(req.user, statuses.length > 0 ? statuses : undefined) });
    } catch (err) {
      next(err);
    }
  });

  router.get("/compliance", async (req, res, next) => {
    try {
      const q = req.query as Record<string, unknown>;
      const report = await dashboardService.getComplianceReport(req.user, {
        framework: typeof q["framework"] === "string" ? q["framework"] : "",
        entity: typeof q["entity"] === "string" ? q["entity"] : undefined,
        from: parseDate(q["from"]),
        to: parseDate(q["to"]),
      });
      res.json({ data: report });
    } catch (err) {
      next(err);
    }
  });

  router.get("/risk-owner", async (req, res, next) => {
    try {
      const userId = req.query["user_id"];
      if (userId !== undefined && userId !== "me") {
        throw new ValidationError("user_id must be 'me' — this view only ever shows the caller's own risks (ACT-240)");
      }
      res.json({ data: await dashboardService.getRiskOwnerView(req.user) });
    } catch (err) {
      next(err);
    }
  });

  router.get("/department/:id", async (req, res, next) => {
    try {
      res.json({ data: await dashboardService.getDepartmentView(req.user, req.params["id"] as string) });
    } catch (err) {
      next(err);
    }
  });

  router.get("/executive", async (req, res, next) => {
    try {
      const topN = typeof req.query["topN"] === "string" ? Number(req.query["topN"]) : undefined;
      res.json({ data: await dashboardService.getExecutiveView(req.user, { topN }) });
    } catch (err) {
      next(err);
    }
  });

  return router;
}
