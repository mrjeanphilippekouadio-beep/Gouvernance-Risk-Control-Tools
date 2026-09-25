import { Router } from "express";
import { z } from "zod";
import type { AnomalyService } from "../../services/AnomalyService.js";

const Severity = z.enum(["LOW", "MODERATE", "HIGH", "MAJOR", "CRITICAL"]);
const Status = z.enum(["NEW", "UNDER_ANALYSIS", "ACTION_IN_PROGRESS", "CLOSED"]);

const CreateAnomalyBody = z.object({
  controlId: z.string().nullish(),
  controlExecutionId: z.string().nullish(),
  riskId: z.string().nullish(),
  description: z.string().min(1),
  severity: Severity,
  origin: z.string().nullish(),
});

const UpdateStatusBody = z.object({
  status: Status,
  comment: z.string().nullish(),
});

export function anomaliesRouter(anomalyService: AnomalyService): Router {
  const router = Router();

  router.get("/", async (req, res, next) => {
    try {
      const status = req.query["status"];
      const anomalies = await anomalyService.list(
        req.user,
        typeof status === "string" ? Status.parse(status) : undefined,
      );
      res.json({ data: anomalies });
    } catch (err) {
      next(err);
    }
  });

  router.get("/:id", async (req, res, next) => {
    try {
      const anomaly = await anomalyService.get(req.user, req.params["id"] as string);
      res.json({ data: anomaly });
    } catch (err) {
      next(err);
    }
  });

  router.post("/", async (req, res, next) => {
    try {
      const body = CreateAnomalyBody.parse(req.body);
      const anomaly = await anomalyService.create(req.user, body, req.requestId);
      res.status(201).json({ data: anomaly });
    } catch (err) {
      next(err);
    }
  });

  router.patch("/:id/status", async (req, res, next) => {
    try {
      const body = UpdateStatusBody.parse(req.body);
      const anomaly = await anomalyService.updateStatus(
        req.user,
        req.params["id"] as string,
        body.status,
        body.comment ?? null,
        req.requestId,
      );
      res.json({ data: anomaly });
    } catch (err) {
      next(err);
    }
  });

  return router;
}
