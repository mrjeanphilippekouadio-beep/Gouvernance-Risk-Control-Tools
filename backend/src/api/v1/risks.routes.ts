import { Router } from "express";
import { z } from "zod";
import type { RiskService } from "../../services/RiskService.js";

const CreateRiskBody = z.object({
  process: z.string().min(1),
  description: z.string().min(1),
  ownerDepartmentId: z.string().nullish(),
});

const UpdateRiskBody = z.object({
  process: z.string().min(1).optional(),
  description: z.string().min(1).optional(),
  ownerDepartmentId: z.string().nullish(),
  status: z.enum(["DRAFT", "ACTIVE", "ARCHIVED"]).optional(),
});

const ArchiveRiskBody = z.object({
  reason: z.string().min(1),
});

/**
 * Thin HTTP layer: parse/validate input, call the service, shape the
 * response. No business rule lives here — see RiskService.
 */
export function risksRouter(riskService: RiskService): Router {
  const router = Router();

  router.get("/", async (req, res, next) => {
    try {
      const includeArchived = req.query["includeArchived"] === "true";
      const risks = await riskService.list(req.user, includeArchived);
      res.json({ data: risks });
    } catch (err) {
      next(err);
    }
  });

  router.get("/:id", async (req, res, next) => {
    try {
      const risk = await riskService.get(req.user, req.params["id"] as string);
      res.json({ data: risk });
    } catch (err) {
      next(err);
    }
  });

  router.post("/", async (req, res, next) => {
    try {
      const body = CreateRiskBody.parse(req.body);
      const risk = await riskService.create(req.user, body, req.requestId);
      res.status(201).json({ data: risk });
    } catch (err) {
      next(err);
    }
  });

  router.patch("/:id", async (req, res, next) => {
    try {
      const body = UpdateRiskBody.parse(req.body);
      const risk = await riskService.update(req.user, req.params["id"] as string, body, req.requestId);
      res.json({ data: risk });
    } catch (err) {
      next(err);
    }
  });

  router.post("/:id/archive", async (req, res, next) => {
    try {
      const body = ArchiveRiskBody.parse(req.body);
      await riskService.archive(req.user, req.params["id"] as string, body.reason, req.requestId);
      res.json({ data: { status: "ARCHIVED" } });
    } catch (err) {
      next(err);
    }
  });

  return router;
}
