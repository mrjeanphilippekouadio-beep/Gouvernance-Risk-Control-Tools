import { Router, type RequestHandler } from "express";
import { z } from "zod";
import { ABSOLUTE_MAX_SCORE } from "../../domain/scoring.js";
import type { ConfigService } from "../../services/ConfigService.js";

const UpdateEvaluationModeBody = z.object({
  mode: z.enum(["CLASSIQUE", "PARTICIPATIF"]),
  reason: z.string().min(1),
});

const UpdateCommitteeThresholdsBody = z.object({
  evaluationMinScore: z.number().int().max(ABSOLUTE_MAX_SCORE).optional(),
  treatmentMinScore: z.number().int().max(ABSOLUTE_MAX_SCORE).nullable().optional(),
  reason: z.string().min(1),
});

const UpdateCommitteeEnforcementBody = z.object({
  enforced: z.boolean(),
  reason: z.string().min(1),
});

const UpdateCommitteeAuditCumulBody = z.object({
  allowed: z.boolean(),
  reason: z.string().min(1).max(500),
});

/** PUT /config and PUT /config/appetite-mode answer 410 (DECISION-054); DIV-06 evaluation-mode and Lot A committee settings stay. */
export function configRouter(configService: ConfigService): Router {
  const router = Router();

  router.get("/", async (req, res, next) => {
    try {
      const config = await configService.get(req.user);
      res.json({ data: config });
    } catch (err) {
      next(err);
    }
  });

  // DECISION-054: these two settings are read by no code (scoring and appetite are driven by the Dispositif).
  // Accepting a write would let a client believe it changed something: answer clearly instead.
  const notApplied: RequestHandler = (_req, res) => {
    res.status(410).json({ error: "Réglage non appliqué : la formule de score, les seuils de niveau, la règle d'impact retenu et le mode d'appétence sont portés par le Dispositif (nouvelle version)." });
  };
  router.put("/", notApplied);
  router.put("/appetite-mode", notApplied);

  router.put("/evaluation-mode", async (req, res, next) => {
    try {
      const body = UpdateEvaluationModeBody.parse(req.body);
      const config = await configService.updateEvaluationMode(req.user, body.mode, body.reason, req.requestId);
      res.json({ data: config });
    } catch (err) {
      next(err);
    }
  });

  // Lot A (RISK_MANAGEMENT_V1 §8): committee thresholds + enforcement toggle, two distinct endpoints/permissions — see ConfigService.
  router.put("/committee-thresholds", async (req, res, next) => {
    try {
      const body = UpdateCommitteeThresholdsBody.parse(req.body);
      const config = await configService.updateCommitteeThresholds(
        req.user,
        { evaluationMinScore: body.evaluationMinScore, treatmentMinScore: body.treatmentMinScore },
        body.reason,
        req.requestId,
      );
      res.json({ data: config });
    } catch (err) {
      next(err);
    }
  });

  router.put("/committee-enforcement", async (req, res, next) => {
    try {
      const body = UpdateCommitteeEnforcementBody.parse(req.body);
      const config = await configService.setCommitteeEnforcement(req.user, body.enforced, body.reason, req.requestId);
      res.json({ data: config });
    } catch (err) {
      next(err);
    }
  });

  router.put("/committee-audit-cumul", async (req, res, next) => {
    try {
      const body = UpdateCommitteeAuditCumulBody.parse(req.body);
      const config = await configService.setCommitteeAuditCumul(req.user, body.allowed, body.reason, req.requestId);
      res.json({ data: config });
    } catch (err) {
      next(err);
    }
  });

  return router;
}
