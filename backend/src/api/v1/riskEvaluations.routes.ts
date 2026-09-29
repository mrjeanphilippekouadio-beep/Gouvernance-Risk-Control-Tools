import { Router } from "express";
import { z } from "zod";
import type { RiskEvaluationService } from "../../services/RiskEvaluationService.js";
import type { RiskEvaluationViewService } from "../../services/RiskEvaluationViewService.js";

const EvaluationType = z.enum(["AD_HOC", "ANNUELLE", "ANTICIPEE"]);
const EvaluationStatus = z.enum(["BROUILLON", "VALIDATED", "REJECTED", "VALIDE_COMITE"]);

const ImpactAxisScoreSchema = z.object({
  code: z.string().min(1),
  value: z.number().int(),
});

const MasteryLineScoreSchema = z.object({
  line: z.string().min(1),
  adequacy: z.number().int(),
  execution: z.number().int(),
  effectiveness: z.number().int(),
});

const CreateEvaluationBody = z.object({
  riskId: z.string().min(1),
  evaluationType: EvaluationType,
  subCategory: z.string().min(1),
  entity: z.string().nullish(),
});

const InherentScoringBody = z.object({
  probability: z.number().int(),
  impacts: z.array(ImpactAxisScoreSchema),
});

const MasteryAssessmentBody = z.object({
  lines: z.array(MasteryLineScoreSchema),
});

const ResidualScoringBody = z.object({
  probability: z.number().int(),
  impacts: z.array(ImpactAxisScoreSchema),
  justification: z.string().min(1),
  appetiteOverride: z.number().int().nullish(),
});

const ValidateBody = z.object({ comment: z.string().nullish() });
const RejectBody = z.object({ comment: z.string().min(1) });

export function riskEvaluationsRouter(
  riskEvaluationService: RiskEvaluationService,
  riskEvaluationViewService: RiskEvaluationViewService,
): Router {
  const router = Router();

  // DIV-07: read-only composition — the covering controls and their last
  // known effectiveness, to inform the human mastery rating. Never a
  // computed mastery score.
  router.get("/:id/context", async (req, res, next) => {
    try {
      const context = await riskEvaluationViewService.getEvaluationContext(req.user, req.params["id"] as string);
      res.json({ data: context });
    } catch (err) {
      next(err);
    }
  });

  // ACT-159: full history for a risk, most recent first, paginated, optional status filter.
  router.get("/", async (req, res, next) => {
    try {
      const riskId = req.query["riskId"];
      if (typeof riskId !== "string") {
        res.status(400).json({ error: "riskId query param is required" });
        return;
      }
      const statusRaw = req.query["status"];
      const status = typeof statusRaw === "string" ? EvaluationStatus.parse(statusRaw) : undefined;
      const limit = req.query["limit"] ? Number(req.query["limit"]) : undefined;
      const offset = req.query["offset"] ? Number(req.query["offset"]) : undefined;

      const evaluations = await riskEvaluationService.listForRisk(req.user, riskId, { status, limit, offset });
      res.json({ data: evaluations });
    } catch (err) {
      next(err);
    }
  });

  router.get("/:id", async (req, res, next) => {
    try {
      const evaluation = await riskEvaluationService.get(req.user, req.params["id"] as string);
      res.json({ data: evaluation });
    } catch (err) {
      next(err);
    }
  });

  // ACT-155: read-only appetite suggestion for the evaluation's (subCategory, entity).
  router.get("/:id/appetite-suggestion", async (req, res, next) => {
    try {
      const suggestion = await riskEvaluationService.suggestAppetite(req.user, req.params["id"] as string);
      res.json({ data: suggestion });
    } catch (err) {
      next(err);
    }
  });

  // ACT-160: residual score vs applicable appetite threshold.
  router.get("/:id/vs-appetite", async (req, res, next) => {
    try {
      const comparison = await riskEvaluationService.compareToAppetite(req.user, req.params["id"] as string);
      res.json({ data: comparison });
    } catch (err) {
      next(err);
    }
  });

  // ACT-150/ACT-158: type=ANTICIPEE is just this same endpoint, not a separate route.
  router.post("/", async (req, res, next) => {
    try {
      const body = CreateEvaluationBody.parse(req.body);
      const evaluation = await riskEvaluationService.create(req.user, body, req.requestId);
      res.status(201).json({ data: evaluation });
    } catch (err) {
      next(err);
    }
  });

  // ACT-151/ACT-154
  router.patch("/:id/inherent", async (req, res, next) => {
    try {
      const body = InherentScoringBody.parse(req.body);
      const evaluation = await riskEvaluationService.recordInherentScoring(req.user, req.params["id"] as string, body, req.requestId);
      res.json({ data: evaluation });
    } catch (err) {
      next(err);
    }
  });

  // ACT-152
  router.patch("/:id/mastery", async (req, res, next) => {
    try {
      const body = MasteryAssessmentBody.parse(req.body);
      const evaluation = await riskEvaluationService.recordMasteryAssessment(req.user, req.params["id"] as string, body, req.requestId);
      res.json({ data: evaluation });
    } catch (err) {
      next(err);
    }
  });

  // ACT-153/ACT-154/ACT-155
  router.patch("/:id/residual", async (req, res, next) => {
    try {
      const body = ResidualScoringBody.parse(req.body);
      const evaluation = await riskEvaluationService.recordResidualScoring(req.user, req.params["id"] as string, body, req.requestId);
      res.json({ data: evaluation });
    } catch (err) {
      next(err);
    }
  });

  // ACT-156
  router.patch("/:id/validate", async (req, res, next) => {
    try {
      const body = ValidateBody.parse(req.body);
      const evaluation = await riskEvaluationService.validate(req.user, req.params["id"] as string, body.comment ?? null, req.requestId);
      res.json({ data: evaluation });
    } catch (err) {
      next(err);
    }
  });

  // ACT-157
  router.patch("/:id/reject", async (req, res, next) => {
    try {
      const body = RejectBody.parse(req.body);
      const evaluation = await riskEvaluationService.reject(req.user, req.params["id"] as string, body.comment, req.requestId);
      res.json({ data: evaluation });
    } catch (err) {
      next(err);
    }
  });

  // ACT-253: distinct from /validate — Comité des Risques / Direction, Majeur/Critique only.
  router.patch("/:id/validate-committee", async (req, res, next) => {
    try {
      const body = ValidateBody.parse(req.body);
      const evaluation = await riskEvaluationService.validateByCommittee(
        req.user,
        req.params["id"] as string,
        body.comment ?? null,
        req.requestId,
      );
      res.json({ data: evaluation });
    } catch (err) {
      next(err);
    }
  });

  return router;
}
