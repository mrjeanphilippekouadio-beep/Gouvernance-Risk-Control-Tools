import { Router } from "express";
import { z } from "zod";
import { reasonText } from "../validation.js";
import type { ProcessService } from "../../services/ProcessService.js";

const Level = z.enum(["PROCESS", "SUBPROCESS", "ACTIVITY"]);
const DocumentType = z.enum(["CHARTER", "POLICY", "PROCEDURES_MANUAL", "PROCEDURE", "WORK_INSTRUCTION"]);

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
  departmentId: z.guid().nullish(),
});

const UpdateProcessBody = CreateProcessBody.partial();
// B-8 bis (q46): mandatory on creation only (the update body keeps it optional/nullish).
const CreateProcessBodyStrict = CreateProcessBody.extend({ departmentId: z.guid() });
// D2b: omitted = untouched, null = cleared. Strict: no other field (and no attribution field) is accepted.
const ResponsibilitiesBody = z
  .object({
    ownerUserId: z.guid().nullable().optional(),
    riskChampionUserId: z.guid().nullable().optional(),
    deputyUserId: z.guid().nullable().optional(),
  })
  .strict();
const ArchiveProcessBody = z.object({ reason: reasonText(2000) });

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
      const body = CreateProcessBodyStrict.parse(req.body);
      const process = await processService.create(req.user, body, req.requestId);
      res.status(201).json({ data: process });
    } catch (err) {
      next(err);
    }
  });

  router.get("/:id/responsibilities", async (req, res, next) => {
    try {
      res.json({ data: await processService.getResponsibilities(req.user, req.params["id"] as string) });
    } catch (err) {
      next(err);
    }
  });

  router.put("/:id/responsibilities", async (req, res, next) => {
    try {
      const body = ResponsibilitiesBody.parse(req.body);
      const process = await processService.setResponsibilities(req.user, req.params["id"] as string, body, req.requestId);
      res.json({ data: process });
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
   * DECISION-054 (one write path): the direct write of Process.evaluationMode is closed — contract §10
   * withdraws process.evaluationmode.set. The only path is the propose/validate circuit
   * (POST /process-evaluation-mode-requests, then /:id/validate), maker-checker.
   */
  router.put("/:id/evaluation-mode", (_req, res) => {
    res.status(410).json({ error: "Écriture directe fermée : proposez le changement via /process-evaluation-mode-requests (validation par un tiers)." });
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
