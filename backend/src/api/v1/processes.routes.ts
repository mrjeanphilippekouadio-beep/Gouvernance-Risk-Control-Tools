import { Router } from "express";
import { z } from "zod";
import type { ProcessService } from "../../services/ProcessService.js";

const Level = z.enum(["PROCESS", "SUBPROCESS", "ACTIVITY"]);
const DocumentType = z.enum(["CHARTER", "POLICY", "PROCEDURES_MANUAL", "PROCEDURE", "WORK_INSTRUCTION"]);
const EvaluationMode = z.enum(["CLASSIQUE", "PARTICIPATIF"]);

/**
 * Governance finding (2026-09-29 architect review, DECISION-006; widened
 * to creation by the 2026-09-29 gouvernance refresh audit): evaluationMode
 * must never be reachable through the generic create/update bodies —
 * omitted here, not just left unused, so it can never silently regain a
 * route. `process.create` is a much wider grant than
 * `process.evaluationmode.set`; a created process's evaluationMode is
 * always null (inherited) until set through the dedicated route/service
 * below.
 */
const CreateProcessBody = z.object({
  parentId: z.string().nullish(),
  level: Level,
  name: z.string().min(1),
  description: z.string().nullish(),
  documentType: DocumentType.nullish(),
  documentReference: z.string().nullish(),
  owner: z.string().nullish(),
  active: z.boolean().optional(),
});

const UpdateProcessBody = CreateProcessBody.partial();
const ArchiveProcessBody = z.object({ reason: z.string().min(1) });
const SetEvaluationModeBody = z.object({ evaluationMode: EvaluationMode.nullable() });

export function processesRouter(processService: ProcessService): Router {
  const router = Router();

  router.get("/", async (req, res, next) => {
    try {
      const includeInactive = req.query["includeInactive"] === "true";
      const processes = await processService.list(req.user, includeInactive);
      res.json({ data: processes });
    } catch (err) {
      next(err);
    }
  });

  router.get("/:id", async (req, res, next) => {
    try {
      const process = await processService.get(req.user, req.params["id"] as string);
      res.json({ data: process });
    } catch (err) {
      next(err);
    }
  });

  router.post("/", async (req, res, next) => {
    try {
      const body = CreateProcessBody.parse(req.body);
      const process = await processService.create(req.user, body, req.requestId);
      res.status(201).json({ data: process });
    } catch (err) {
      next(err);
    }
  });

  router.patch("/:id", async (req, res, next) => {
    try {
      const body = UpdateProcessBody.parse(req.body);
      const process = await processService.update(req.user, req.params["id"] as string, body, req.requestId);
      res.json({ data: process });
    } catch (err) {
      next(err);
    }
  });

  /**
   * DECISION-006 governance finding: dedicated route for
   * Process.evaluationMode, gated by process.evaluationmode.set (reserved
   * to the Risk Manager) instead of the generic PATCH above.
   */
  router.put("/:id/evaluation-mode", async (req, res, next) => {
    try {
      const body = SetEvaluationModeBody.parse(req.body);
      const process = await processService.setEvaluationMode(
        req.user,
        req.params["id"] as string,
        body.evaluationMode,
        req.requestId,
      );
      res.json({ data: process });
    } catch (err) {
      next(err);
    }
  });

  router.post("/:id/archive", async (req, res, next) => {
    try {
      const body = ArchiveProcessBody.parse(req.body);
      await processService.archive(req.user, req.params["id"] as string, body.reason, req.requestId);
      res.json({ data: { status: "ARCHIVED" } });
    } catch (err) {
      next(err);
    }
  });

  return router;
}
