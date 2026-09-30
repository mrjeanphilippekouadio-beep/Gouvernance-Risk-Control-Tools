import { Router } from "express";
import { z } from "zod";
import type { FindingService } from "../../services/FindingService.js";

const Severity = z.enum(["LOW", "MODERATE", "HIGH", "MAJOR", "CRITICAL"]);
const Status = z.enum(["OUVERT", "EN_TRAITEMENT", "CLOS"]);
const RelatedObjectType = z.enum(["RISK", "CONTROL", "INCIDENT", "ANOMALY"]);

const CreateFindingBody = z.object({
  auditMissionId: z.string().min(1),
  title: z.string().min(1),
  description: z.string().min(1),
  severity: Severity,
  recommendation: z.string().nullish(),
  relatedObjectType: RelatedObjectType.nullish(),
  relatedObjectId: z.string().nullish(),
});

const CloseFindingBody = z.object({
  comment: z.string().min(1),
});

export function findingsRouter(findingService: FindingService): Router {
  const router = Router();

  router.get("/", async (req, res, next) => {
    try {
      const auditMissionId = req.query["auditMissionId"];
      const status = req.query["status"];
      const severity = req.query["severity"];
      const findings = await findingService.list(req.user, {
        auditMissionId: typeof auditMissionId === "string" ? auditMissionId : undefined,
        status: typeof status === "string" ? Status.parse(status) : undefined,
        severity: typeof severity === "string" ? Severity.parse(severity) : undefined,
      });
      res.json({ data: findings });
    } catch (err) {
      next(err);
    }
  });

  router.get("/:id", async (req, res, next) => {
    try {
      const finding = await findingService.get(req.user, req.params["id"] as string);
      res.json({ data: finding });
    } catch (err) {
      next(err);
    }
  });

  router.post("/", async (req, res, next) => {
    try {
      const body = CreateFindingBody.parse(req.body);
      const finding = await findingService.create(req.user, body, req.requestId);
      res.status(201).json({ data: finding });
    } catch (err) {
      next(err);
    }
  });

  router.post("/:id/start-treatment", async (req, res, next) => {
    try {
      const finding = await findingService.startTreatment(req.user, req.params["id"] as string, req.requestId);
      res.json({ data: finding });
    } catch (err) {
      next(err);
    }
  });

  router.post("/:id/close", async (req, res, next) => {
    try {
      const body = CloseFindingBody.parse(req.body);
      const finding = await findingService.close(req.user, req.params["id"] as string, body.comment, req.requestId);
      res.json({ data: finding });
    } catch (err) {
      next(err);
    }
  });

  return router;
}
