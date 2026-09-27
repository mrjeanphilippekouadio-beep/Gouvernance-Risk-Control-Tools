import { Router } from "express";
import { z } from "zod";
import type { KpiService } from "../../services/KpiService.js";

const Frequency = z.enum(["DAILY", "WEEKLY", "MONTHLY", "QUARTERLY", "ANNUAL"]);

const CreateKpiBody = z.object({
  label: z.string().min(1),
  targetValue: z.number().finite(),
  unit: z.string().min(1),
  frequency: Frequency,
  owner: z.string().min(1),
  departmentId: z.string().nullish(),
  processId: z.string().nullish(),
  active: z.boolean().optional(),
});

const UpdateKpiBody = CreateKpiBody.partial();

const LinkKpiBody = z.object({
  departmentId: z.string().nullish(),
  processId: z.string().nullish(),
});

const ArchiveKpiBody = z.object({ reason: z.string().min(1) });

export function kpisRouter(kpiService: KpiService): Router {
  const router = Router();

  // ACT-143: dashboard listing — every KPI here already carries its
  // computed status, filterable by department/process (entity/période
  // filters live on the frontend dashboard page, per A04's scope).
  router.get("/", async (req, res, next) => {
    try {
      const includeInactive = req.query["includeInactive"] === "true";
      const departmentId = typeof req.query["departmentId"] === "string" ? req.query["departmentId"] : undefined;
      const processId = typeof req.query["processId"] === "string" ? req.query["processId"] : undefined;
      const kpis = await kpiService.list(req.user, { includeInactive, departmentId, processId });
      res.json({ data: kpis });
    } catch (err) {
      next(err);
    }
  });

  router.get("/:id", async (req, res, next) => {
    try {
      const kpi = await kpiService.get(req.user, req.params["id"] as string);
      res.json({ data: kpi });
    } catch (err) {
      next(err);
    }
  });

  router.post("/", async (req, res, next) => {
    try {
      const body = CreateKpiBody.parse(req.body);
      const kpi = await kpiService.create(req.user, body, req.requestId);
      res.status(201).json({ data: kpi });
    } catch (err) {
      next(err);
    }
  });

  router.patch("/:id", async (req, res, next) => {
    try {
      const body = UpdateKpiBody.parse(req.body);
      const kpi = await kpiService.update(req.user, req.params["id"] as string, body, req.requestId);
      res.json({ data: kpi });
    } catch (err) {
      next(err);
    }
  });

  router.post("/:id/link", async (req, res, next) => {
    try {
      const body = LinkKpiBody.parse(req.body);
      const kpi = await kpiService.link(req.user, req.params["id"] as string, body, req.requestId);
      res.json({ data: kpi });
    } catch (err) {
      next(err);
    }
  });

  router.post("/:id/archive", async (req, res, next) => {
    try {
      const body = ArchiveKpiBody.parse(req.body);
      await kpiService.archive(req.user, req.params["id"] as string, body.reason, req.requestId);
      res.json({ data: { status: "ARCHIVED" } });
    } catch (err) {
      next(err);
    }
  });

  return router;
}
