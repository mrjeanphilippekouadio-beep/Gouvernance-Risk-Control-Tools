import type { NextFunction, Request, Response } from "express";
import type { ModuleToggleService } from "../../services/ModuleToggleService.js";
import type { ModuleName } from "../../domain/entities/ModuleToggle.js";
import { ForbiddenError } from "../../domain/errors/DomainErrors.js";

/**
 * ACT-221 — blocks a request to a module's routes when that module is
 * toggled off for the caller's tenant. Mount after authMiddleware (needs
 * req.user) and before the module's router.
 */
export function moduleGuard(moduleToggleService: ModuleToggleService, moduleName: ModuleName) {
  return async (req: Request, _res: Response, next: NextFunction): Promise<void> => {
    try {
      const enabled = await moduleToggleService.isEnabled(req.user.tenantId, moduleName);
      if (!enabled) {
        next(new ForbiddenError(`Module "${moduleName}" is disabled for this tenant`));
        return;
      }
      next();
    } catch (err) {
      next(err);
    }
  };
}
