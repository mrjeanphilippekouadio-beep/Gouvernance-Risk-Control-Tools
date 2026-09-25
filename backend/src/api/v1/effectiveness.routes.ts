import { Router } from "express";
import { z } from "zod";
import type { ControlEffectivenessService } from "../../services/ControlEffectivenessService.js";

const Rating = z.enum(["EFFECTIVE", "PARTIALLY_EFFECTIVE", "INEFFECTIVE"]);
const Result = z.enum(["EFFECTIVE", "PARTIALLY_EFFECTIVE", "INEFFECTIVE", "INCONCLUSIVE"]);
const AssessmentStatus = z.enum(["COMPLETED", "PROVISIONAL", "VALIDATED"]);

const CreateAssessmentBody = z.object({
  controlId: z.string().min(1),
  evalType: z.string().nullish(),
  designAdequacy: z.string().nullish(),
  executionQuality: z.string().nullish(),
  operationalEffectiveness: Rating,
  result: Result.nullish(),
  limitations: z.string().nullish(),
  compensatingControls: z.string().nullish(),
  conclusion: z.string().nullish(),
  justification: z.string().min(1),
  controlVersionSnapshot: z.string().nullish(),
  status: AssessmentStatus.optional(),
});

const ValidateAssessmentBody = z.object({ comment: z.string().nullish() });

export function effectivenessRouter(effectivenessService: ControlEffectivenessService): Router {
  const router = Router();

  router.get("/", async (req, res, next) => {
    try {
      const controlId = req.query["controlId"];
      if (typeof controlId !== "string") {
        res.status(400).json({ error: "controlId query param is required" });
        return;
      }
      const assessments = await effectivenessService.listForControl(req.user, controlId);
      res.json({ data: assessments });
    } catch (err) {
      next(err);
    }
  });

  router.get("/:id", async (req, res, next) => {
    try {
      const assessment = await effectivenessService.get(req.user, req.params["id"] as string);
      res.json({ data: assessment });
    } catch (err) {
      next(err);
    }
  });

  router.post("/", async (req, res, next) => {
    try {
      const body = CreateAssessmentBody.parse(req.body);
      const assessment = await effectivenessService.create(req.user, body, req.requestId);
      res.status(201).json({ data: assessment });
    } catch (err) {
      next(err);
    }
  });

  router.post("/:id/validate", async (req, res, next) => {
    try {
      const body = ValidateAssessmentBody.parse(req.body);
      const assessment = await effectivenessService.validate(
        req.user,
        req.params["id"] as string,
        body.comment ?? null,
        req.requestId,
      );
      res.json({ data: assessment });
    } catch (err) {
      next(err);
    }
  });

  return router;
}
