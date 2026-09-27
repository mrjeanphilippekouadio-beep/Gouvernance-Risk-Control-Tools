import { Router } from "express";
import type { RiskOwnershipService } from "../../services/RiskOwnershipService.js";

/**
 * ACT-127: thin HTTP layer for the admin "risk owners" view — see
 * RiskOwnershipService for the aggregation logic. Not wired into
 * server.ts by this batch (see task constraints); mount at
 * `/api/v1/risk-owners` alongside the other v1 routers.
 */
export function riskOwnersRouter(riskOwnershipService: RiskOwnershipService): Router {
  const router = Router();

  router.get("/", async (req, res, next) => {
    try {
      const includeArchived = req.query["includeArchived"] === "true";
      const groups = await riskOwnershipService.listOwners(req.user, { includeArchived });
      res.json({ data: groups });
    } catch (err) {
      next(err);
    }
  });

  return router;
}
