import rateLimit from "express-rate-limit";

/**
 * HTTP hardening (external audit 2026-09-30, SEC-CAMP2-04/WEB-008/WEB-010/
 * AUTH-011 — see docs/security/external-audit-2026-09-30/README.md).
 *
 * There is no dedicated `/login` route in this API: authentication is a
 * bearer Google-issued token verified on every `/api/v1/*` call
 * (`authMiddleware`, GoogleIdentityProvider.verifyToken). That makes every
 * authenticated route an implicit "auth" entry point, so the auth-hardening
 * requirement is met by limiting *failed* verification attempts across the
 * whole API surface rather than a single route.
 *
 * `skipSuccessfulRequests: true` means normal authenticated traffic (2xx/3xx
 * responses) never counts against the quota — only requests that end in an
 * error status (expired/invalid/missing token → 401, but also any other
 * 4xx/5xx) do. This throttles credential-stuffing / token-guessing without
 * punishing legitimate heavy users of the API.
 */
export function authAttemptRateLimiter() {
  return rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 50,
    standardHeaders: true,
    legacyHeaders: false,
    skipSuccessfulRequests: true,
    message: { error: "Too many failed requests, please try again later" },
  });
}

/**
 * Stricter limiter for the handful of endpoints that do real work per
 * request (file upload + parsing, Google Drive round-trip, Excel parsing):
 * evidence upload and risk Excel import (preview/commit). Applied on top of
 * `authAttemptRateLimiter`, not instead of it.
 */
export function costlyOperationRateLimiter() {
  return rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 30,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: "Too many requests to this endpoint, please try again later" },
  });
}
