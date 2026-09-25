import type { NextFunction, Request, Response } from "express";
import { newRequestId } from "../../services/RiskService.js";

declare module "express-serve-static-core" {
  interface Request {
    requestId: string;
  }
}

/** Every request gets a correlation id, carried through service → repository → audit log. */
export function requestIdMiddleware(req: Request, res: Response, next: NextFunction): void {
  req.requestId = (req.header("X-Request-Id") ?? newRequestId());
  res.setHeader("X-Request-Id", req.requestId);
  next();
}
