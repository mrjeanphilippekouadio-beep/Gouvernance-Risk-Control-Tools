import { Router } from "express";
import { z } from "zod";
import type { ResourceVisibilityManager } from "../../services/resourceVisibility.js";

const PageQuery = z.object({ limit: z.coerce.number().int().min(1).max(500).optional(), offset: z.coerce.number().int().min(0).optional() });

/**
 * q208 (DECISION-107): the restricted resources of the client (risks, controls, anomalies, action plans, KPIs), for the
 * Risk Manager group (`resourcevisibility.set`, checked by the service). Mounted at /api/v1/restricted-resources.
 */
export function restrictedResourcesRouter(manager: ResourceVisibilityManager): Router {
  const router = Router();
  router.get("/", async (req, res, next) => {
    try {
      res.json({ data: await manager.listRestricted(req.user, PageQuery.parse(req.query)) });
    } catch (err) {
      next(err);
    }
  });
  return router;
}

/** V3 (q196, q198): « X éléments non visibles », one number per type. Mounted at /api/v1/hidden-counts. */
export function hiddenCountsRouter(manager: ResourceVisibilityManager): Router {
  const router = Router();
  router.get("/", async (req, res, next) => {
    try {
      res.json({ data: await manager.hiddenCounts(req.user) });
    } catch (err) {
      next(err);
    }
  });
  return router;
}
