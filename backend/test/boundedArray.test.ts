import { describe, expect, it, afterEach } from "vitest";
import express from "express";
import type { Server } from "node:http";
import { readdirSync, readFileSync } from "node:fs";
import { z } from "zod";
import { boundedArray } from "../src/api/validation.js";
import { errorHandler } from "../src/api/middleware/errorHandler.js";
import { ratingScalesRouter } from "../src/api/v1/ratingScales.routes.js";
import type { RatingScaleService } from "../src/services/RatingScaleService.js";

// CVE-2023-54404 (zod 4.6.5): see docs/security/snyk-dependencies.md.
const El = z.object({ label: z.string().min(1), min: z.number().int() });

describe("boundedArray", () => {
  it("accepts valid arrays within bounds", () => {
    expect(boundedArray(El, 2).parse([{ label: "a", min: 1 }])).toEqual([{ label: "a", min: 1 }]);
  });

  it("rejects more than max, fewer than min and non-arrays", () => {
    expect(boundedArray(z.string(), 2).safeParse(["a", "b", "c"]).success).toBe(false);
    expect(boundedArray(z.string(), 2, 1).safeParse([]).success).toBe(false);
    expect(boundedArray(z.string(), 2).safeParse("a").success).toBe(false);
  });

  it("still validates elements", () => {
    expect(boundedArray(El, 5).safeParse([{ label: "", min: 1 }]).success).toBe(false);
  });

  it("rejects an oversized array of invalid elements fast (no per-element issues)", () => {
    const huge = Array.from({ length: 349_000 }, () => ({}));
    const t0 = performance.now();
    const res = boundedArray(El, 50).safeParse(huge);
    expect(res.success).toBe(false);
    if (!res.success) expect(res.error.issues).toHaveLength(1);
    expect(performance.now() - t0).toBeLessThan(200);
  });
});

describe("HTTP: 1 MB array of {} on a representative route", () => {
  let server: Server | undefined;
  afterEach(() => new Promise<void>((r) => (server ? server.close(() => r()) : r())));

  it("returns 400 'Requête invalide.' in < 200 ms", async () => {
    const service = {} as RatingScaleService; // never reached: parse fails first
    const app = express();
    app.use(express.json({ limit: "1mb" }));
    app.use("/rs", ratingScalesRouter(service));
    app.use(errorHandler);
    const port = await new Promise<number>((resolve) => {
      server = app.listen(0, () => resolve((server!.address() as { port: number }).port));
    });
    const body = "[" + Array(349_000).fill("{}").join(",") + "]";
    const payload = `{"thresholds":${body}}`;
    expect(payload.length).toBeLessThan(1024 * 1024);

    const t0 = performance.now();
    const res = await fetch(`http://127.0.0.1:${port}/rs/abc/thresholds`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: payload,
    });
    const elapsed = performance.now() - t0;
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: string }).error).toBe("Requête invalide.");
    expect(elapsed).toBeLessThan(200);
  });
});

describe("guard: no bare z.array in api/v1", () => {
  it("every array schema on HTTP input goes through boundedArray", () => {
    const dir = new URL("../src/api/v1/", import.meta.url);
    const offenders = readdirSync(dir)
      .filter((f) => f.endsWith(".ts"))
      .filter((f) => /\bz\.array\(/.test(readFileSync(new URL(f, dir), "utf8")));
    expect(offenders).toEqual([]);
  });
});
