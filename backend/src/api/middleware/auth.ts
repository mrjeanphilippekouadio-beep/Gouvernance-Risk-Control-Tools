import type { NextFunction, Request, Response } from "express";
import type { IdentityProvider, AuthenticatedUser } from "../../infrastructure/identity/IdentityProvider.js";

declare module "express-serve-static-core" {
  interface Request {
    user: AuthenticatedUser;
  }
}

/**
 * Resolves the caller via the injected IdentityProvider. The frontend
 * never sends a tenant id or role — both come from server-side lookup,
 * never from client-supplied data (ADR-001 principle #2).
 */
export function authMiddleware(identity: IdentityProvider) {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    const header = req.header("Authorization");
    if (!header?.startsWith("Bearer ")) {
      res.status(401).json({ error: "Missing bearer token" });
      return;
    }

    try {
      req.user = await identity.verifyToken(header.slice("Bearer ".length));
      next();
    } catch {
      res.status(401).json({ error: "Invalid or expired token" });
    }
  };
}
