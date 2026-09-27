import { Router } from "express";
import { z } from "zod";
import type { KpiMeasureService } from "../../services/KpiMeasureService.js";

const CreateKpiMeasureBody = z.object({
  kpiId: z.string().min(1),
  period: z.coerce.date(),
  value: z.number().finite(),
  comment: z.string().nullish(),
  recordedBy: z.string().nullish(),
});

export function kpiMeasuresRouter(kpiMeasureService: KpiMeasureService): Router {
  const router = Router();

  router.get("/", async (req, res, next) => {
    try {
      const kpiId = req.query["kpiId"];
      if (typeof kpiId !== "string") {
        res.status(400).json({ error: "kpiId query param is required" });
        return;
      }
      const measures = await kpiMeasureService.listForKpi(req.user, kpiId);
      res.json({ data: measures });
    } catch (err) {
      next(err);
    }
  });

  router.post("/", async (req, res, next) => {
    try {
      const body = CreateKpiMeasureBody.parse(req.body);
      const measure = await kpiMeasureService.record(
        req.user,
        { ...body, recordedBy: body.recordedBy ?? undefined },
        req.requestId,
      );
      res.status(201).json({ data: measure });
    } catch (err) {
      next(err);
    }
  });

  return router;
}
