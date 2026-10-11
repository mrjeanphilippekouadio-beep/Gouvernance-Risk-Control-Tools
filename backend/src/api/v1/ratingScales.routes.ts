import { Router } from "express";
import { z } from "zod";
import { boundedArray, MAX_DEFENSE_LINES, MAX_IMPACT_AXES, MAX_SCALE_SIZE } from "../validation.js";
import type { RatingScaleService } from "../../services/RatingScaleService.js";

const ScaleLevelSchema = z.object({
  level: z.number().int(),
  label: z.string().min(1).max(200),
});

const ScoreThresholdSchema = z.object({
  label: z.string().min(1),
  min: z.number().int(),
  max: z.number().int(),
});

const ImpactAxisSchema = z.object({
  code: z.string().min(1).max(200),
  label: z.string().min(1).max(200),
  order: z.number().int(),
  levelLabels: boundedArray(ScaleLevelSchema, MAX_SCALE_SIZE).optional(),
});

const CreateRatingScaleBody = z.object({
  name: z.string().min(1).max(120),
  version: z.string().min(1).max(120),
  probabilityLevels: z.number().int(),
  impactLevels: z.number().int(),
  probabilityLabels: boundedArray(ScaleLevelSchema, MAX_SCALE_SIZE).nullish(),
  impactLabels: boundedArray(ScaleLevelSchema, MAX_SCALE_SIZE).nullish(),
});

const UpdateThresholdsBody = z.object({
  thresholds: boundedArray(ScoreThresholdSchema, 50),
});

const UpdateImpactAxesBody = z.object({
  axes: boundedArray(ImpactAxisSchema, MAX_IMPACT_AXES),
  retainedImpactRule: z.enum(["MAX", "AVERAGE", "WEIGHTED_SUM"]).optional(),
});

const UpdateLevelsBody = z.object({
  levels: boundedArray(ScaleLevelSchema, 50),
});

const UpdateMasteryBody = z.object({
  levels: boundedArray(ScaleLevelSchema, 50),
  defenseLines: boundedArray(z.string().min(1), MAX_DEFENSE_LINES),
  thresholds: boundedArray(ScoreThresholdSchema, 50).nullish(),
});

const DisableRatingScaleBody = z.object({ reason: z.string().min(1) });

export function ratingScalesRouter(ratingScaleService: RatingScaleService): Router {
  const router = Router();

  router.get("/", async (req, res, next) => {
    try {
      const includeArchived = req.query["includeArchived"] === "true";
      const scales = await ratingScaleService.list(req.user, includeArchived);
      res.json({ data: scales });
    } catch (err) {
      next(err);
    }
  });

  router.get("/:id", async (req, res, next) => {
    try {
      const scale = await ratingScaleService.get(req.user, req.params["id"] as string);
      res.json({ data: scale });
    } catch (err) {
      next(err);
    }
  });

  router.post("/", async (req, res, next) => {
    try {
      const body = CreateRatingScaleBody.parse(req.body);
      const scale = await ratingScaleService.create(req.user, body, req.requestId);
      res.status(201).json({ data: scale });
    } catch (err) {
      next(err);
    }
  });

  router.put("/:id/thresholds", async (req, res, next) => {
    try {
      const body = UpdateThresholdsBody.parse(req.body);
      const scale = await ratingScaleService.updateThresholds(req.user, req.params["id"] as string, body, req.requestId);
      res.json({ data: scale });
    } catch (err) {
      next(err);
    }
  });

  router.put("/:id/impact-axes", async (req, res, next) => {
    try {
      const body = UpdateImpactAxesBody.parse(req.body);
      const scale = await ratingScaleService.updateImpactAxes(req.user, req.params["id"] as string, body, req.requestId);
      res.json({ data: scale });
    } catch (err) {
      next(err);
    }
  });

  router.put("/:id/velocity", async (req, res, next) => {
    try {
      const body = UpdateLevelsBody.parse(req.body);
      const scale = await ratingScaleService.updateVelocity(req.user, req.params["id"] as string, body, req.requestId);
      res.json({ data: scale });
    } catch (err) {
      next(err);
    }
  });

  router.put("/:id/persistence", async (req, res, next) => {
    try {
      const body = UpdateLevelsBody.parse(req.body);
      const scale = await ratingScaleService.updatePersistence(req.user, req.params["id"] as string, body, req.requestId);
      res.json({ data: scale });
    } catch (err) {
      next(err);
    }
  });

  router.put("/:id/mastery", async (req, res, next) => {
    try {
      const body = UpdateMasteryBody.parse(req.body);
      const scale = await ratingScaleService.updateMastery(req.user, req.params["id"] as string, body, req.requestId);
      res.json({ data: scale });
    } catch (err) {
      next(err);
    }
  });

  router.patch("/:id/activate", async (req, res, next) => {
    try {
      const scale = await ratingScaleService.activateVersion(req.user, req.params["id"] as string, req.requestId);
      res.json({ data: scale });
    } catch (err) {
      next(err);
    }
  });

  router.patch("/:id/disable", async (req, res, next) => {
    try {
      const body = DisableRatingScaleBody.parse(req.body);
      await ratingScaleService.disable(req.user, req.params["id"] as string, body.reason, req.requestId);
      res.json({ data: { status: "DISABLED" } });
    } catch (err) {
      next(err);
    }
  });

  return router;
}
