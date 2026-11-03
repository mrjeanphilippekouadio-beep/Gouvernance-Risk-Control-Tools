import { Router } from "express";
import type { GovernanceHealthService } from "../../services/GovernanceHealthService.js";

/**
 * Lot D6: GET /governance-health — the governance panel, computed by the server (statuses, offenders, size, highlighted
 * indication). No parameter: everything is scoped by the authenticated actor's tenant. The client displays, never recomputes.
 */
export function governanceHealthRouter(service: GovernanceHealthService): Router {
  const router = Router();
  router.get("/", async (req, res, next) => {
    try {
      res.json({ data: await service.get(req.user) });
    } catch (err) {
      next(err);
    }
  });
  return router;
}
