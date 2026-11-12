import { Router } from "express";
import multer from "multer";
import { z } from "zod";
import type { FrameworkFamilyImportService } from "../../services/FrameworkFamilyImportService.js";
import { MAX_FILE_BYTES } from "../../services/FrameworkFamilyImportService.js";
import { ValidationError } from "../../domain/errors/DomainErrors.js";
import { costlyOperationRateLimiter } from "../middleware/rateLimit.js";

const Id = z.guid();
const Fingerprint = z.string().regex(/^[0-9a-fA-F]{64}$/);

// One file part (+ the fingerprint field on commit). The limit applies to the received stream, not to a header.
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_FILE_BYTES, files: 1, fields: 1, parts: 2 },
});

function textFile(file: Express.Multer.File | undefined): Buffer {
  if (!file) throw new ValidationError("Champ « file » manquant");
  if (!/\.txt$/i.test(file.originalname) || file.mimetype !== "text/plain") {
    throw new ValidationError("Le fichier doit être un fichier texte (.txt, text/plain)");
  }
  return file.buffer;
}

/** DECISION-133: import of the "families and sub-categories" file into a DRAFT Dispositif version. Parses only; rules live in the service. */
export function riskFrameworkFamilyImportRouter(service: FrameworkFamilyImportService): Router {
  const router = Router();
  const limiter = costlyOperationRateLimiter();

  router.post("/:id/versions/:vid/import-families/preview", limiter, upload.single("file"), async (req, res, next) => {
    try {
      const report = await service.preview(req.user, Id.parse(req.params["id"]), Id.parse(req.params["vid"]), textFile(req.file));
      res.json({ data: report });
    } catch (err) {
      next(err);
    }
  });

  router.post("/:id/versions/:vid/import-families/commit", limiter, upload.single("file"), async (req, res, next) => {
    try {
      const fingerprint = Fingerprint.parse((req.body as Record<string, unknown> | undefined)?.["fingerprint"]);
      const report = await service.commit(
        req.user, Id.parse(req.params["id"]), Id.parse(req.params["vid"]), textFile(req.file), fingerprint, req.requestId,
      );
      res.json({ data: report });
    } catch (err) {
      next(err);
    }
  });

  return router;
}
