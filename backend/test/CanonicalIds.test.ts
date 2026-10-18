import { readFileSync } from "node:fs";
import express from "express";
import { describe, expect, it } from "vitest";
import { canonicalIdsMiddleware } from "../src/api/middleware/canonicalIds.js";
import { canonicalId } from "../src/domain/ids.js";

// SEC-ID-01: every spelling Postgres reads as the same uuid must reach the routes in canonical form.
const ID = "a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11";
const SPELLINGS = [ID.toUpperCase(), ID.replace(/-/g, ""), `{${ID}}`, "a0ee-bc99-9c0b-4ef8-bb6d-6bb9-bd38-0a11", ` ${ID} `];

describe("canonicalId / canonicalIdsMiddleware (SEC-ID-01)", () => {
  it("canonicalId maps every Postgres-accepted spelling to one form", () => {
    for (const s of SPELLINGS) expect(canonicalId(s)).toBe(ID);
  });

  it("path, query and JSON body ids are canonical before routing; other strings and repeated keys are untouched", async () => {
    const app = express();
    app.use(express.json());
    app.use(canonicalIdsMiddleware);
    app.post("/roles/:id/assign", (req, res) => { res.json({ id: req.params["id"], q: req.query, body: req.body }); });
    const server = app.listen(0);
    try {
      const { port } = server.address() as { port: number };
      for (const s of SPELLINGS.slice(0, 4)) {
        const res = await fetch(`http://127.0.0.1:${port}/roles/${s}/assign?userId=${encodeURIComponent(s)}&tag=Ab&tag=Cd`, {
          method: "POST", headers: { "content-type": "application/json" },
          body: JSON.stringify({ userId: s, ids: [s], nested: { by: s }, reason: "Keep Me", hash: "ABCDEF" }),
        });
        expect(await res.json()).toEqual({
          id: ID, q: { userId: ID, tag: ["Ab", "Cd"] },
          body: { userId: ID, ids: [ID], nested: { by: ID }, reason: "Keep Me", hash: "ABCDEF" },
        });
      }
      // percent-encoded hex digit in the path is decoded only after the middleware: must be canonical anyway
      const enc = await fetch(`http://127.0.0.1:${port}/roles/${ID.toUpperCase().replace("A", "%41")}/assign`, { method: "POST" });
      expect((await enc.json()).id).toBe(ID);
    } finally {
      server.close();
    }
  });

  it("is mounted in server.ts after the JSON parser and before every /api/v1 route", () => {
    const src = readFileSync(new URL("../src/server.ts", import.meta.url), "utf8");
    const mw = src.indexOf("app.use(canonicalIdsMiddleware);");
    expect(mw).toBeGreaterThan(src.indexOf("app.use(express.json("));
    expect(mw).toBeLessThan(src.indexOf('app.use("/api/v1'));
  });
});
