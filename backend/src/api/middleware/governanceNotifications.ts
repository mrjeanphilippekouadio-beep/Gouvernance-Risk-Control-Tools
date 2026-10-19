import type { NextFunction, Request, Response } from "express";
import type { GovernanceNotifier } from "../../services/GovernanceNotifier.js";

const READ_ONLY_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

/**
 * Lot D5: governance notifications are emitted AFTER the commit. Once a mutating request has been answered with a
 * success status, every transaction it opened is over; the notifier then reads the audit rows that request wrote
 * (same request id, same authenticated actor) and notifies. Nothing happens for a failed request, and a notifier failure
 * can neither delay nor change the response (`processRequest` never throws; the promise is not awaited).
 * Mounted once, before the routers; `req.user` is set later by each router's own authentication and read at "finish".
 */
export function governanceNotificationsMiddleware(notifier: Pick<GovernanceNotifier, "processRequest">) {
  return (req: Request, res: Response, next: NextFunction): void => {
    if (!READ_ONLY_METHODS.has(req.method)) {
      res.on("finish", () => {
        if (res.statusCode >= 300 || !req.user) return;
        void notifier.processRequest(req.user.tenantId, req.user.userId, req.requestId);
      });
    }
    next();
  };
}
