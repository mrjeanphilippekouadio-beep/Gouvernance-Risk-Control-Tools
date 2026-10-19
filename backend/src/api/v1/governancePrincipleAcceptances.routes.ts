import { Router } from "express";
import { z } from "zod";
import {
  MAX_ACCEPTANCE_REASON_LENGTH,
  type GovernancePrincipleAcceptanceService,
} from "../../services/GovernancePrincipleAcceptanceService.js";
import { reasonText } from "../validation.js";
import { perUserRateLimiter } from "../middleware/rateLimit.js";

// acceptedBy / confirmedBy / endedBy are never accepted: the service takes the authenticated actor.
const AcceptBody = z
  .object({
    principleId: z.string().regex(/^[A-Z]+(-[A-Z0-9]+)+$/).max(40),
    reason: reasonText(MAX_ACCEPTANCE_REASON_LENGTH),
    expiresAt: z.coerce.date(),
  })
  .strict();
const ReasonBody = z.object({ reason: reasonText(MAX_ACCEPTANCE_REASON_LENGTH) }).strict();
const IdParam = z.guid();

/** Lot D5 (q138): dated acceptance of a non-respected principle. Permissions are checked by the service. */
export function governancePrincipleAcceptancesRouter(service: GovernancePrincipleAcceptanceService): Router {
  const router = Router();

  router.get("/", async (req, res, next) => {
    try {
      res.json({ data: await service.list(req.user) });
    } catch (err) {
      next(err);
    }
  });

  router.post("/", perUserRateLimiter(), async (req, res, next) => {
    try {
      const body = AcceptBody.parse(req.body);
      res.status(201).json({ data: await service.accept(req.user, body, req.requestId) });
    } catch (err) {
      next(err);
    }
  });

  router.post("/:id/confirm", perUserRateLimiter(), async (req, res, next) => {
    try {
      const id = IdParam.parse(req.params["id"]);
      res.json({ data: await service.confirm(req.user, id, req.requestId) });
    } catch (err) {
      next(err);
    }
  });

  router.post("/:id/reject", perUserRateLimiter(), async (req, res, next) => {
    try {
      const id = IdParam.parse(req.params["id"]);
      const body = ReasonBody.parse(req.body);
      res.json({ data: await service.reject(req.user, id, body.reason, req.requestId) });
    } catch (err) {
      next(err);
    }
  });

  router.post("/:id/revoke", perUserRateLimiter(), async (req, res, next) => {
    try {
      const id = IdParam.parse(req.params["id"]);
      const body = ReasonBody.parse(req.body);
      res.json({ data: await service.revoke(req.user, id, body.reason, req.requestId) });
    } catch (err) {
      next(err);
    }
  });

  return router;
}
