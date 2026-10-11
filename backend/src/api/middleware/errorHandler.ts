import type { NextFunction, Request, Response } from "express";
import { NotFoundError, ValidationError, ForbiddenError, ConflictError } from "../../domain/errors/DomainErrors.js";

export function errorHandler(err: unknown, req: Request, res: Response, _next: NextFunction): void {
  if (err instanceof ValidationError) {
    res.status(400).json({ error: err.message, requestId: req.requestId });
    return;
  }
  if (err instanceof NotFoundError) {
    res.status(404).json({ error: err.message, requestId: req.requestId });
    return;
  }
  if (err instanceof ConflictError) {
    res.status(409).json({ error: err.message, existingId: err.existingId, requestId: req.requestId });
    return;
  }
  if (err instanceof ForbiddenError) {
    res.status(403).json({ error: err.message, requestId: req.requestId });
    return;
  }

  req.log?.error({ err, requestId: req.requestId }, "Unhandled error");
  res.status(500).json({ error: "Internal server error", requestId: req.requestId });
}
