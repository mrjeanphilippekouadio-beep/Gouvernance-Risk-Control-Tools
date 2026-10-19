import type { NextFunction, Request, Response } from "express";
import type { GovernanceNotifier } from "../../services/GovernanceNotifier.js";

const READ_ONLY_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

/**
 * Lot D5: governance notifications are emitted AFTER the commit. Once the handler of a mutating request ends the
 * response with a success status, every transaction it opened is over; the notifier then reads the audit rows that
 * request wrote (same request id, same authenticated actor) and notifies. Nothing happens for a failed request, and a
 * notifier failure can neither delay nor change the response (`processRequest` never throws; the promise is not awaited).
 * SEC-PNL2-01: the trigger is `res.end`, not the "finish" event. "finish" is never emitted when the client closes the
 * socket before the answer, which let the author of an action drop the mandatory notification of its own exception;
 * the handler still runs to its end (the effect and its audit are committed), so `res.end` is always reached.
 * Residual, accepted: a crash or instance stop between the COMMIT and `res.end` (the audit row stays; no push).
 * Mounted once, before the routers; `req.user` is set later by each router's own authentication and read at `res.end`.
 */
export function governanceNotificationsMiddleware(notifier: Pick<GovernanceNotifier, "processRequest">) {
  return (req: Request, res: Response, next: NextFunction): void => {
    if (!READ_ONLY_METHODS.has(req.method)) {
      const end = res.end;
      let triggered = false;
      res.end = function (this: Response, ...args: unknown[]) {
        const out = Reflect.apply(end, this, args);
        if (!triggered) {
          triggered = true;
          if (res.statusCode < 300 && req.user) void notifier.processRequest(req.user.tenantId, req.user.userId, req.requestId);
        }
        return out;
      } as typeof res.end;
    }
    next();
  };
}
