import { Router } from "express";
import type { DashboardService } from "../../services/DashboardService.js";
import { ValidationError } from "../../domain/errors/DomainErrors.js";

function parseDate(value: unknown): Date | undefined {
  if (typeof value !== "string" || !value) return undefined;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) throw new ValidationError(`Invalid date: ${value}`);
  return parsed;
}

/**
 * ACT-210 to ACT-215 — mounted at `/api/v1/reports`. See
 * DashboardService's class doc comment: `/compliance` and
 * `/department/:id` here call the exact same methods as their
 * `/dashboard/*` counterparts in dashboard.routes.ts — the overlap is
 * intentional (task brief), not a copy-paste mistake.
 */
export function reportsRouter(dashboardService: DashboardService): Router {
  const router = Router();

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

  router.get("/risk-committee", async (req, res, next) => {
    try {
      const topN = typeof req.query["topN"] === "string" ? Number(req.query["topN"]) : undefined;
      res.json({ data: await dashboardService.getRiskCommitteeReport(req.user, { topN }) });
    } catch (err) {
      next(err);
    }
  });

  router.get("/consolidated", async (req, res, next) => {
    try {
      const raw = req.query["entities"];
      const entities = typeof raw === "string" ? raw.split(",").map((e) => e.trim()).filter(Boolean) : undefined;
      res.json({ data: await dashboardService.getConsolidatedReport(req.user, entities) });
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

  router.get("/appetite-vs-residual", async (req, res, next) => {
    try {
      res.json({ data: await dashboardService.getAppetiteVsResidual(req.user) });
    } catch (err) {
      next(err);
    }
  });

  router.get("/kri-consolidated", async (req, res, next) => {
    try {
      const periods = typeof req.query["periods"] === "string" ? Number(req.query["periods"]) : undefined;
      res.json({ data: await dashboardService.getKriConsolidated(req.user, { periods }) });
    } catch (err) {
      next(err);
    }
  });

  return router;
}
