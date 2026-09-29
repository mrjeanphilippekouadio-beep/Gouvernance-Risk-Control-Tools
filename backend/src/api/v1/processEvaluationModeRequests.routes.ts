import { Router } from "express";
import { z } from "zod";
import type { ProcessEvaluationModeRequestService } from "../../services/ProcessEvaluationModeRequestService.js";

const EvaluationMode = z.enum(["CLASSIQUE", "PARTICIPATIF"]);

const ProposeBody = z.object({
  processId: z.string().min(1),
  requestedMode: EvaluationMode,
});
const RejectBody = z.object({ reason: z.string().min(1) });

/**
 * DECISION-006 (Option A, PO-confirmed 2026-09-29): the process-owner
 * proposal/validation workflow. `ProcessEvaluationModeRequestService.
 * setMode` (the direct Risk-Manager path) deliberately has no route
 * here — `processes.routes.ts`'s existing `PUT /:id/evaluation-mode`
 * (ProcessService.setEvaluationMode) already exposes that exact
 * operation under the same `process.evaluationmode.set` permission;
 * adding a second route for it would just be two paths to one write.
 */
export function processEvaluationModeRequestsRouter(service: ProcessEvaluationModeRequestService): Router {
  const router = Router();

  router.get("/", async (req, res, next) => {
    try {
      const processId = req.query["processId"];
      if (typeof processId !== "string" || !processId) {
        res.status(400).json({ error: "processId query parameter is required" });
        return;
      }
      const requests = await service.listForProcess(req.user, processId);
      res.json({ data: requests });
    } catch (err) {
      next(err);
    }
  });

  router.get("/:id", async (req, res, next) => {
    try {
      const request = await service.get(req.user, req.params["id"] as string);
      res.json({ data: request });
    } catch (err) {
      next(err);
    }
  });

  router.post("/", async (req, res, next) => {
    try {
      const body = ProposeBody.parse(req.body);
      const request = await service.propose(req.user, body.processId, body.requestedMode, req.requestId);
      res.status(201).json({ data: request });
    } catch (err) {
      next(err);
    }
  });

  router.post("/:id/validate", async (req, res, next) => {
    try {
      const process = await service.validate(req.user, req.params["id"] as string, req.requestId);
      res.json({ data: process });
    } catch (err) {
      next(err);
    }
  });

  router.post("/:id/reject", async (req, res, next) => {
    try {
      const body = RejectBody.parse(req.body);
      const request = await service.reject(req.user, req.params["id"] as string, body.reason, req.requestId);
      res.json({ data: request });
    } catch (err) {
      next(err);
    }
  });

  return router;
}
