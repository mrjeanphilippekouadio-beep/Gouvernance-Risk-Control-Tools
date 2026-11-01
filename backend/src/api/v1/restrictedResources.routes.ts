import { Router } from "express";
import type { ResourceVisibilityManager } from "../../services/resourceVisibility.js";

/**
 * q208 (DECISION-107): the restricted resources of the client (risks, controls, anomalies, action plans, KPIs), for the
 * Risk Manager group (`resourcevisibility.set`, checked by the service). Mounted at /api/v1/restricted-resources.
 */
export function restrictedResourcesRouter(manager: ResourceVisibilityManager): Router {
  const router = Router();
  router.get("/", async (req, res, next) => {
    try {
      res.json({ data: await manager.listRestricted(req.user) });
    } catch (err) {
      next(err);
    }
  });
  return router;
}
