import { Router } from "express";
import { z } from "zod";
import type { DepartmentService } from "../../services/DepartmentService.js";

const CreateDepartmentBody = z.object({
  name: z.string().min(1),
  entity: z.string().nullish(),
  manager: z.string().min(1),
  riskOwner: z.string().nullish(),
  riskOwnerDesignatedBy: z.string().nullish(),
  linkedProcesses: z.string().nullish(),
  active: z.boolean().optional(),
});

// SEC-003: riskOwner/riskOwnerDesignatedBy are intentionally excluded —
// a generic PATCH must never bypass the audited ASSIGN event that
// designate-risk-owner records. Setting an initial risk owner at
// creation is fine (no prior designation to protect); changing one
// later must go through POST /:id/designate-risk-owner.
const UpdateDepartmentBody = CreateDepartmentBody.omit({ riskOwner: true, riskOwnerDesignatedBy: true }).partial();

const DesignateRiskOwnerBody = z.object({ riskOwner: z.string().min(1) });
const ArchiveDepartmentBody = z.object({ reason: z.string().min(1) });

export function departmentsRouter(departmentService: DepartmentService): Router {
  const router = Router();

  router.get("/", async (req, res, next) => {
    try {
      const includeInactive = req.query["includeInactive"] === "true";
      const departments = await departmentService.list(req.user, includeInactive);
      res.json({ data: departments });
    } catch (err) {
      next(err);
    }
  });

  router.get("/:id", async (req, res, next) => {
    try {
      const department = await departmentService.get(req.user, req.params["id"] as string);
      res.json({ data: department });
    } catch (err) {
      next(err);
    }
  });

  router.post("/", async (req, res, next) => {
    try {
      const body = CreateDepartmentBody.parse(req.body);
      const department = await departmentService.create(req.user, body, req.requestId);
      res.status(201).json({ data: department });
    } catch (err) {
      next(err);
    }
  });

  router.patch("/:id", async (req, res, next) => {
    try {
      const body = UpdateDepartmentBody.parse(req.body);
      const department = await departmentService.update(req.user, req.params["id"] as string, body, req.requestId);
      res.json({ data: department });
    } catch (err) {
      next(err);
    }
  });

  router.post("/:id/designate-risk-owner", async (req, res, next) => {
    try {
      const body = DesignateRiskOwnerBody.parse(req.body);
      const department = await departmentService.designateRiskOwner(
        req.user,
        req.params["id"] as string,
        body.riskOwner,
        req.requestId,
      );
      res.json({ data: department });
    } catch (err) {
      next(err);
    }
  });

  router.post("/:id/archive", async (req, res, next) => {
    try {
      const body = ArchiveDepartmentBody.parse(req.body);
      await departmentService.archive(req.user, req.params["id"] as string, body.reason, req.requestId);
      res.json({ data: { status: "ARCHIVED" } });
    } catch (err) {
      next(err);
    }
  });

  return router;
}
