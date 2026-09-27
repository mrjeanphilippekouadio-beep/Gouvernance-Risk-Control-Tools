import { Router } from "express";
import { z } from "zod";
import type { RiskAppetiteService } from "../../services/RiskAppetiteService.js";

const SetRiskAppetiteBody = z.object({
  entity: z.string().trim().min(1).nullish(),
  threshold: z.number().int().min(1).max(25),
  methodologyVersion: z.string().min(1),
  description: z.string().nullish(),
  active: z.boolean().optional(),
});

const ArchiveRiskAppetiteBody = z.object({ reason: z.string().min(1) });

/**
 * ACT-165 (PUT /appetite/:sous_categorie) and ACT-168 (GET /appetite) —
 * see RiskAppetiteService for why ACT-166/ACT-167 aren't here.
 */
export function riskAppetiteRouter(riskAppetiteService: RiskAppetiteService): Router {
  const router = Router();

  router.get("/", async (req, res, next) => {
    try {
      const includeInactive = req.query["includeInactive"] === "true";
      const entity = typeof req.query["entity"] === "string" ? req.query["entity"] : undefined;
      const appetites = await riskAppetiteService.list(req.user, {
        activeOnly: !includeInactive,
        ...(entity ? { entity } : {}),
      });
      res.json({ data: appetites });
    } catch (err) {
      next(err);
    }
  });

  router.get("/:id", async (req, res, next) => {
    try {
      const appetite = await riskAppetiteService.get(req.user, req.params["id"] as string);
      res.json({ data: appetite });
    } catch (err) {
      next(err);
    }
  });

  router.put("/:subCategory", async (req, res, next) => {
    try {
      const body = SetRiskAppetiteBody.parse(req.body);
      const appetite = await riskAppetiteService.setThreshold(
        req.user,
        req.params["subCategory"] as string,
        body,
        req.requestId,
      );
      res.json({ data: appetite });
    } catch (err) {
      next(err);
    }
  });

  router.post("/:id/archive", async (req, res, next) => {
    try {
      const body = ArchiveRiskAppetiteBody.parse(req.body);
      await riskAppetiteService.archive(req.user, req.params["id"] as string, body.reason, req.requestId);
      res.json({ data: { status: "ARCHIVED" } });
    } catch (err) {
      next(err);
    }
  });

  return router;
}
