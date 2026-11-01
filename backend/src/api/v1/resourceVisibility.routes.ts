import type { Router } from "express";
import { z } from "zod";
import { boundedArray, reasonText } from "../validation.js";
import type { Visibility } from "../../domain/visibility.js";
import type { AuthenticatedUser } from "../../infrastructure/identity/IdentityProvider.js";

/** Lot V2: level at creation (the list is set afterwards through PUT /:id/visibility). */
export const VisibilityLevel = z.enum(["CLIENT", "PERIMETRE", "NOMINATIF"]);

const MAX_ACCESS_CHANGE = 50;
const VisibilityBody = z.object({
  visibility: VisibilityLevel,
  addUserIds: boundedArray(z.guid(), MAX_ACCESS_CHANGE).optional(),
  revokeUserIds: boundedArray(z.guid(), MAX_ACCESS_CHANGE).optional(),
  reason: reasonText(500),
});

interface VisibilityService {
  getAccess(actor: AuthenticatedUser, id: string): Promise<unknown>;
  setVisibility(
    actor: AuthenticatedUser,
    id: string,
    input: { visibility: Visibility; addUserIds?: string[]; revokeUserIds?: string[]; reason: string },
    requestId: string,
  ): Promise<unknown>;
}

/**
 * Lot V2 (q192, q194): GET / PUT `/:id/visibility` of a control, anomaly, action plan or KPI — same contract as the
 * risks' (lot V1). The service decides who may change it (Risk Manager group or owner account).
 */
export function mountVisibilityRoutes(router: Router, service: VisibilityService): void {
  router.get("/:id/visibility", async (req, res, next) => {
    try {
      res.json({ data: await service.getAccess(req.user, z.guid().parse(req.params["id"])) });
    } catch (err) {
      next(err);
    }
  });

  router.put("/:id/visibility", async (req, res, next) => {
    try {
      const body = VisibilityBody.parse(req.body);
      res.json({ data: await service.setVisibility(req.user, z.guid().parse(req.params["id"]), body, req.requestId) });
    } catch (err) {
      next(err);
    }
  });
}
