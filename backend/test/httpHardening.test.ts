import { describe, expect, it, afterEach } from "vitest";
import express, { type Express } from "express";
import type { Server } from "node:http";
import { securityHeadersMiddleware } from "../src/api/middleware/securityHeaders.js";
import { authAttemptRateLimiter, costlyOperationRateLimiter } from "../src/api/middleware/rateLimit.js";
import { httpLogger } from "../src/api/middleware/httpLogger.js";

/**
 * HTTP hardening added for the external audit 2026-09-30 findings
 * (SEC-CAMP2-04/WEB-008/WEB-010/AUTH-011 — see
 * docs/security/external-audit-2026-09-30/README.md): helmet security
 * headers and rate limiting on the auth surface and costly endpoints.
 *
 * This exercises the real middleware wired into server.ts (not a re-typed
 * copy) against a minimal express app bound to an ephemeral port, using
 * Node's built-in fetch — no new test dependency needed.
 */
function listen(app: Express): Promise<{ server: Server; baseUrl: string }> {
  return new Promise((resolve) => {
    const server = app.listen(0, () => {
      const address = server.address();
      const port = typeof address === "object" && address ? address.port : 0;
      resolve({ server, baseUrl: `http://127.0.0.1:${port}` });
    });
  });
}

function close(server: Server): Promise<void> {
  return new Promise((resolve) => server.close(() => resolve()));
}

describe("securityHeadersMiddleware", () => {
  let server: Server | undefined;

  afterEach(async () => {
    if (server) await close(server);
    server = undefined;
  });

  it("sets the expected hardening headers on every response", async () => {
    const app = express();
    app.use(securityHeadersMiddleware());
    app.get("/probe", (_req, res) => res.json({ ok: true }));

    const listening = await listen(app);
    server = listening.server;

    const res = await fetch(`${listening.baseUrl}/probe`);
    expect(res.status).toBe(200);
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");
    expect(res.headers.get("x-frame-options")).toBe("SAMEORIGIN");
    expect(res.headers.get("strict-transport-security")).toBeTruthy();
    // Deliberately relaxed for the SPA + Google SSO flow — see doc comment.
    expect(res.headers.get("cross-origin-resource-policy")).toBe("cross-origin");
    expect(res.headers.get("content-security-policy")).toBeNull();
  });
});

describe("rate limiting", () => {
  let server: Server | undefined;

  afterEach(async () => {
    if (server) await close(server);
    server = undefined;
  });

  it("throttles repeated failed requests but never counts a successful one", async () => {
    const app = express();
    app.get("/ok", authAttemptRateLimiter(), (_req, res) => res.json({ ok: true }));
    app.get("/fail", authAttemptRateLimiter(), (_req, res) => res.status(401).json({ error: "nope" }));

    const listening = await listen(app);
    server = listening.server;

    // 50 successful requests never consume the quota (skipSuccessfulRequests).
    for (let i = 0; i < 50; i++) {
      const res = await fetch(`${listening.baseUrl}/ok`);
      expect(res.status).toBe(200);
    }

    // The configured limit is 50 failed requests per window — the 51st is throttled.
    let sawThrottled = false;
    for (let i = 0; i < 51; i++) {
      const res = await fetch(`${listening.baseUrl}/fail`);
      if (res.status === 429) {
        sawThrottled = true;
        break;
      }
      expect(res.status).toBe(401);
    }
    expect(sawThrottled).toBe(true);

    // A success on the shared route is still never throttled, even after
    // the failure quota above was exhausted.
    const okAfter = await fetch(`${listening.baseUrl}/ok`);
    expect(okAfter.status).toBe(200);
  });

  it("throttles a costly endpoint after its configured limit regardless of outcome", async () => {
    const app = express();
    app.get("/costly", costlyOperationRateLimiter(), (_req, res) => res.json({ ok: true }));

    const listening = await listen(app);
    server = listening.server;

    let sawThrottled = false;
    for (let i = 0; i < 31; i++) {
      const res = await fetch(`${listening.baseUrl}/costly`);
      if (res.status === 429) {
        sawThrottled = true;
        break;
      }
      expect(res.status).toBe(200);
    }
    expect(sawThrottled).toBe(true);
  });

  it("keys the failure quota per client once trust proxy matches the Render proxy chain", async () => {
    const app = express();
    app.set("trust proxy", 3);
    app.get("/fail", authAttemptRateLimiter(), (_req, res) => res.status(401).json({ error: "nope" }));

    const listening = await listen(app);
    server = listening.server;

    // Same X-Forwarded-For shape as observed on Render staging: client, Cloudflare, Render proxy.
    const failAs = (client: string) =>
      fetch(`${listening.baseUrl}/fail`, { headers: { "x-forwarded-for": `${client}, 172.70.243.113, 10.196.1.145` } });

    expect((await failAs("102.207.9.41")).headers.get("ratelimit-remaining")).toBe("49");
    expect((await failAs("102.207.9.41")).headers.get("ratelimit-remaining")).toBe("48");
    // A different client has its own quota instead of sharing the proxy's.
    expect((await failAs("41.66.10.20")).headers.get("ratelimit-remaining")).toBe("49");
  });
});

describe("httpLogger", () => {
  let server: Server | undefined;

  afterEach(async () => {
    if (server) await close(server);
    server = undefined;
  });

  it("never writes the Authorization or Cookie header to the logs", async () => {
    const lines: string[] = [];
    const app = express();
    app.use(httpLogger({ write: (line: string) => void lines.push(line) }));
    app.get("/probe", (_req, res) => res.json({ ok: true }));

    const listening = await listen(app);
    server = listening.server;

    await fetch(`${listening.baseUrl}/probe`, {
      headers: { authorization: "Bearer secret-token-value", cookie: "session=secret-cookie-value" },
    });

    const logged = lines.join("\n");
    expect(logged).toContain("/probe");
    expect(logged).not.toContain("secret-token-value");
    expect(logged).not.toContain("secret-cookie-value");
  });
});
