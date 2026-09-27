import { Router } from "express";
import multer from "multer";
import type { BrandingService } from "../../services/BrandingService.js";
import { ValidationError } from "../../domain/errors/DomainErrors.js";

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024 } });

/**
 * ACT-084 — `GET /settings/branding` + `POST /settings/branding`
 * (multipart image). Intended to be mounted at `/api/v1/settings/branding`
 * — left for the orchestrator to wire into server.ts per this batch's
 * merge-conflict constraint (see actionPlanDashboard.routes.ts for the
 * established precedent of leaving that wiring for later).
 */
export function brandingRouter(brandingService: BrandingService): Router {
  const router = Router();

  router.get("/", async (req, res, next) => {
    try {
      const branding = await brandingService.getBranding(req.user);
      res.json({ data: branding });
    } catch (err) {
      next(err);
    }
  });

  router.post("/", upload.single("file"), async (req, res, next) => {
    try {
      if (!req.file) throw new ValidationError("Missing file field");
      const branding = await brandingService.uploadLogo(
        req.user,
        { fileName: req.file.originalname, mimeType: req.file.mimetype, content: req.file.buffer },
        req.requestId,
      );
      res.status(201).json({ data: branding });
    } catch (err) {
      next(err);
    }
  });

  return router;
}
