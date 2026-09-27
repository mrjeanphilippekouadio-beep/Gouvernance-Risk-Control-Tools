import { Router } from "express";
import { z } from "zod";
import type { CartographyFilters, CartographyService, CartographyVersion } from "../../services/CartographyService.js";
import { ValidationError } from "../../domain/errors/DomainErrors.js";

const VersionQuery = z.enum(["inherent", "residual"]);

function readString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function readScore(value: unknown, fieldName: string): number | undefined {
  if (typeof value !== "string" || !value.trim()) return undefined;
  const n = Number(value);
  if (!Number.isFinite(n)) throw new ValidationError(`${fieldName} must be a number`);
  return n;
}

/** ACT-181/183: combinable, all-optional query filters shared by every cartography endpoint. */
function parseFilters(query: Record<string, unknown>): CartographyFilters {
  const filters: CartographyFilters = {};
  const entity = readString(query["entity"]);
  if (entity !== undefined) filters.entity = entity;
  const subCategory = readString(query["subCategory"]);
  if (subCategory !== undefined) filters.subCategory = subCategory;
  const departmentId = readString(query["departmentId"]);
  if (departmentId !== undefined) filters.departmentId = departmentId;
  const ownerId = readString(query["ownerId"]);
  if (ownerId !== undefined) filters.ownerId = ownerId;
  const minScore = readScore(query["minScore"], "minScore");
  if (minScore !== undefined) filters.minScore = minScore;
  const maxScore = readScore(query["maxScore"], "maxScore");
  if (maxScore !== undefined) filters.maxScore = maxScore;
  return filters;
}

/**
 * ACT-180/181/183/184 — read-only risk heatmap. Composes Risk +
 * RiskEvaluation; no create/update/delete, so a single `cartography.read`
 * permission covers every route here (see CartographyService). Intended
 * mount path is "/cartography" — left for the orchestrator to wire into
 * server.ts alongside the other in-flight modules (RiskOwnership,
 * ActionPlan) to avoid parallel-edit conflicts on that shared file.
 */
export function cartographyRouter(cartographyService: CartographyService): Router {
  const router = Router();

  // ACT-180/ACT-181/ACT-183
  router.get("/", async (req, res, next) => {
    try {
      const versionRaw = req.query["version"];
      const version: CartographyVersion = typeof versionRaw === "string" ? VersionQuery.parse(versionRaw) : "residual";
      const filters = parseFilters(req.query as Record<string, unknown>);
      const data = await cartographyService.getCartography(req.user, version, filters);
      res.json({ data });
    } catch (err) {
      next(err);
    }
  });

  // ACT-184: both versions, same filter set, one response.
  router.get("/compare", async (req, res, next) => {
    try {
      const filters = parseFilters(req.query as Record<string, unknown>);
      const data = await cartographyService.compare(req.user, filters);
      res.json({ data });
    } catch (err) {
      next(err);
    }
  });

  return router;
}
