import { Router } from "express";
import { z } from "zod";
import type { TreatmentDecisionService } from "../../services/TreatmentDecisionService.js";
import { GovernanceConfirmationBody } from "../validation.js";
import { withIndependence } from "../validationIndependence.js";
import type { GovernanceExceptionLookup } from "../../domain/governance/selfValidation.js";

const TreatmentDecisionStatus = z.enum(["PROPOSEE", "CONFIRMEE", "INVALIDEE", "VALIDEE_COMITE"]);
const TreatmentOptionSchema = z.enum(["ACCEPTER", "SURVEILLER", "REDUIRE", "TRANSFERER", "EVITER"]);

const CreateTreatmentDecisionBody = z.object({
  riskEvaluationId: z.string().min(1),
  option: TreatmentOptionSchema,
  justification: z.string().min(1),
});

const ConfirmBody = z.object({ comment: z.string().nullish() });
const InvalidateBody = z.object({ comment: z.string().min(1) });
const ValidateCommitteeBody = z.object({ comment: z.string().nullish(), governanceConfirmation: GovernanceConfirmationBody.optional() });

export function treatmentDecisionsRouter(treatmentDecisionService: TreatmentDecisionService, independence?: GovernanceExceptionLookup): Router {
  const router = Router();
  const indep = withIndependence(independence, "TreatmentDecision");

  // §5: GET /?riskId=&status= — mirrors riskEvaluationsRouter's GET /
  // convention (riskId required, status optional).
  router.get("/", async (req, res, next) => {
    try {
      const riskId = req.query["riskId"];
      if (typeof riskId !== "string") {
        res.status(400).json({ error: "riskId query param is required" });
        return;
      }
      const statusRaw = req.query["status"];
      const status = typeof statusRaw === "string" ? TreatmentDecisionStatus.parse(statusRaw) : undefined;

      const decisions = await treatmentDecisionService.listForRisk(req.user, riskId, { status });
      res.json({ data: await indep(req.user.tenantId, decisions) });
    } catch (err) {
      next(err);
    }
  });

  router.get("/:id", async (req, res, next) => {
    try {
      const decision = await treatmentDecisionService.get(req.user, req.params["id"] as string);
      res.json({ data: await indep(req.user.tenantId, decision) });
    } catch (err) {
      next(err);
    }
  });

  router.post("/", async (req, res, next) => {
    try {
      const body = CreateTreatmentDecisionBody.parse(req.body);
      const decision = await treatmentDecisionService.create(req.user, body, req.requestId);
      res.status(201).json({ data: decision });
    } catch (err) {
      next(err);
    }
  });

  router.patch("/:id/confirm", async (req, res, next) => {
    try {
      const body = ConfirmBody.parse(req.body);
      const decision = await treatmentDecisionService.confirm(req.user, req.params["id"] as string, body.comment ?? null, req.requestId);
      res.json({ data: await indep(req.user.tenantId, decision) });
    } catch (err) {
      next(err);
    }
  });

  router.patch("/:id/invalidate", async (req, res, next) => {
    try {
      const body = InvalidateBody.parse(req.body);
      const decision = await treatmentDecisionService.invalidate(req.user, req.params["id"] as string, body.comment, req.requestId);
      res.json({ data: await indep(req.user.tenantId, decision) });
    } catch (err) {
      next(err);
    }
  });

  router.patch("/:id/validate-committee", async (req, res, next) => {
    try {
      const body = ValidateCommitteeBody.parse(req.body);
      const decision = await treatmentDecisionService.validateByCommittee(
        req.user,
        req.params["id"] as string,
        body.comment ?? null,
        req.requestId,
        body.governanceConfirmation,
      );
      res.json({ data: await indep(req.user.tenantId, decision) });
    } catch (err) {
      next(err);
    }
  });

  return router;
}
