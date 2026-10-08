import { Router } from "express";
import { z } from "zod";
import type { ConfigService } from "../../services/ConfigService.js";

const LevelThresholdBody = z.object({
  label: z.string().min(1),
  min: z.number().int(),
  max: z.number().int(),
});

const UpdateMethodologyBody = z.object({
  scoreFormula: z.enum(["P_X_I", "WEIGHTED_SUM"]).optional(),
  levelThresholds: z.array(LevelThresholdBody).optional(),
  impactRetenuRule: z.enum(["MAX", "AVERAGE", "WEIGHTED_SUM"]).optional(),
  reason: z.string().min(1),
});

const UpdateAppetiteModeBody = z.object({
  mode: z.enum(["AUTO", "MANUEL", "AUTO_AVEC_SURCHARGE_MANUELLE"]),
  reason: z.string().min(1),
});

const UpdateEvaluationModeBody = z.object({
  mode: z.enum(["CLASSIQUE", "PARTICIPATIF"]),
  reason: z.string().min(1),
});

const UpdateCommitteeThresholdsBody = z.object({
  evaluationMinScore: z.number().int().optional(),
  treatmentMinScore: z.number().int().nullable().optional(),
  reason: z.string().min(1),
});

const UpdateCommitteeEnforcementBody = z.object({
  enforced: z.boolean(),
  reason: z.string().min(1),
});

/** ACT-220 (PUT /config), ACT-226 (PUT /config/appetite-mode) and DIV-06 (PUT /config/evaluation-mode) — see ConfigService for what's deliberately not wired yet. */
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

  router.put("/", async (req, res, next) => {
    try {
      const body = UpdateMethodologyBody.parse(req.body);
      const { reason, ...input } = body;
      const config = await configService.updateMethodology(req.user, input, reason, req.requestId);
      res.json({ data: config });
    } catch (err) {
      next(err);
    }
  });

  router.put("/appetite-mode", async (req, res, next) => {
    try {
      const body = UpdateAppetiteModeBody.parse(req.body);
      const config = await configService.updateAppetiteMode(req.user, body.mode, body.reason, req.requestId);
      res.json({ data: config });
    } catch (err) {
      next(err);
    }
  });

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

  return router;
}
