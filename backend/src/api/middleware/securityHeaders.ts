import helmet from "helmet";
import type { RequestHandler } from "express";

/**
 * HTTP hardening (external audit 2026-09-30, SEC-CAMP2-04/WEB-008/WEB-010 —
 * see docs/security/external-audit-2026-09-30/README.md). Extracted from
 * server.ts so the exact configuration used in production is also what the
 * tests exercise (test/securityHeaders.test.ts), not a re-typed copy that
 * could drift.
 */
export function securityHeadersMiddleware(): RequestHandler {
  return helmet({
    // The frontend (a different origin) and the Google Identity Services
    // script it loads both need this API and its assets reachable without
    // COEP/CORP blocking them — helmet's stricter defaults are meant for
    // same-origin apps serving their own HTML, not a pure JSON API behind a
    // separate SPA + Google SSO.
    crossOriginResourcePolicy: { policy: "cross-origin" },
    crossOriginEmbedderPolicy: false,
    // This is a JSON API with no HTML views of its own — a CSP tuned for
    // rendered pages (script-src/style-src) doesn't apply here and would
    // only risk breaking the health/ready responses; the frontend origin
    // serves and enforces its own CSP.
    contentSecurityPolicy: false,
  });
}
