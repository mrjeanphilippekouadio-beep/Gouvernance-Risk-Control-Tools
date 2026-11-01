import type { CorsOptions } from "cors";

/**
 * Request headers the browser may send cross-origin. `Idempotency-Key` is required by POST /risks (risks.routes.ts):
 * without it here the preflight fails and the risk creation form cannot submit when front and API differ in origin
 * (QA-VIS1-05).
 */
export const CORS_ALLOWED_HEADERS = ["Authorization", "Content-Type", "Idempotency-Key"] as const;

export const corsOptions = (origins: CorsOptions["origin"]): CorsOptions => ({
  origin: origins,
  allowedHeaders: [...CORS_ALLOWED_HEADERS],
});
