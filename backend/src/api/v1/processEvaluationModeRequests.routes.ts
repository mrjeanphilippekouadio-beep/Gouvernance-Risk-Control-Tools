import { Router } from "express";
import { z } from "zod";
import type { ProcessEvaluationModeRequestService } from "../../services/ProcessEvaluationModeRequestService.js";
import { GovernanceConfirmationBody } from "../validation.js";
import { withIndependence } from "../validationIndependence.js";
import type { GovernanceExceptionLookup } from "../../domain/governance/selfValidation.js";

const EvaluationMode = z.enum(["CLASSIQUE", "PARTICIPATIF"]);

const ProposeBody = z.object({
  processId: z.string().min(1),
  requestedMode: EvaluationMode,
});
const RejectBody = z.object({ reason: z.string().min(1) });
const ValidateBody = z.object({ governanceConfirmation: GovernanceConfirmationBody.optional() });

/**
 * DECISION-006 (Option A, PO-confirmed 2026-09-29): the process-owner
 * proposal/validation workflow. DECISION-054: this circuit is the ONLY
 * write path to `processes.evaluation_mode`. The direct Risk-Manager path
 * (the former direct setter on the process service) has no route: `PUT
 * /processes/:id/evaluation-mode` answers 410. Do not re-expose it.
 */
export function processEvaluationModeRequestsRouter(service: ProcessEvaluationModeRequestService, independence?: GovernanceExceptionLookup): Router {
  const router = Router();
  const indep = withIndependence(independence, "ProcessEvaluationModeRequest");

  router.get("/", async (req, res, next) => {
    try {
      const processId = req.query["processId"];
      if (typeof processId !== "string" || !processId) {
        res.status(400).json({ error: "processId query parameter is required" });
        return;
      }
      const requests = await service.listForProcess(req.user, processId);
      res.json({ data: await indep(req.user.tenantId, requests) });
    } catch (err) {
      next(err);
    }
  });

  router.get("/:id", async (req, res, next) => {
    try {
      const request = await service.get(req.user, req.params["id"] as string);
      res.json({ data: await indep(req.user.tenantId, request) });
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
      const body = ValidateBody.parse(req.body ?? {});
      const process = await service.validate(req.user, req.params["id"] as string, req.requestId, body.governanceConfirmation);
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
