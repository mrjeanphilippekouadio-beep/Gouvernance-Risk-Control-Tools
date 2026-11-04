import { Router } from "express";
import type { PrivacyService } from "../../services/PrivacyService.js";
import { perUserRateLimiter } from "../middleware/rateLimit.js";

/**
 * R3 / R5 (q227): GET /notice — what the « Vos données » text needs (any signed-in person); POST /last-seen-purge — erase
 * the « dernière activité » date of ended accounts past the client's retention (idempotent, for an external job or an admin).
 */
export function privacyRouter(service: PrivacyService): Router {
  const router = Router();
  router.get("/notice", async (req, res, next) => {
    try {
      res.json({ data: await service.notice(req.user) });
    } catch (err) {
      next(err);
    }
  });
  router.post("/last-seen-purge", perUserRateLimiter(), async (req, res, next) => {
    try {
      // q231 B: `?dryRun=true` lists the accounts concerned (count and ids) without erasing anything.
      const dryRun = req.query["dryRun"] === "true";
      res.json({ data: await service.purgeLastSeen(req.user, req.requestId, { dryRun }) });
    } catch (err) {
      next(err);
    }
  });
  return router;
}
