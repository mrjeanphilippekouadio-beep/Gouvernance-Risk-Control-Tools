import { describe, expect, it, vi } from "vitest";
import { createLastSeenRecorder } from "../src/infrastructure/identity/lastSeen.js";
import { GoogleIdentityProvider } from "../src/infrastructure/identity/GoogleIdentityProvider.js";
import { LocalIdentityProvider, hashLocalPassword } from "../src/infrastructure/identity/LocalIdentityProvider.js";

const flush = () => new Promise((r) => setTimeout(r, 0));

describe("last_seen_at recorder", () => {
  it("writes once per hour per user, scoped by tenant", async () => {
    const query = vi.fn().mockResolvedValue({ rows: [] });
    const record = createLastSeenRecorder({ query } as never);
    record("t1", "u1");
    record("t1", "u1");
    record("t1", "u2");
    await flush();
    expect(query).toHaveBeenCalledTimes(2);
    expect(query.mock.calls[0]![0]).toContain("tenant_id = $1");
    expect(query.mock.calls[0]![1]).toEqual(["t1", "u1"]);
  });

  it("never throws nor rejects when the write fails", async () => {
    const query = vi.fn().mockRejectedValue(new Error("db down"));
    const record = createLastSeenRecorder({ query } as never);
    expect(() => record("t1", "u1")).not.toThrow();
    await flush();
    record("t1", "u1");
    await flush();
    expect(query).toHaveBeenCalledTimes(2);
  });

  it("q155 local: recorded at login (authenticate) only, not on verifyToken; a throwing recorder does not block", async () => {
    const m = { userId: "u1", tenantId: "t1", email: "a@b.c", displayName: "A", roles: [], dashboardScopeMode: "ALL" } as never;
    const record = vi.fn(() => {
      throw new Error("boom");
    });
    const p = new LocalIdentityProvider([{ email: "a@b.c", passwordHash: hashLocalPassword("pw") }], "s".repeat(32), 3600, async () => m, record);
    const token = await p.authenticate("a@b.c", "pw");
    expect(record).toHaveBeenCalledTimes(1);
    expect(record).toHaveBeenCalledWith("t1", "u1");
    await p.verifyToken(token);
    await p.verifyToken(token);
    expect(record).toHaveBeenCalledTimes(1);
    await expect(p.authenticate("a@b.c", "bad")).rejects.toThrow();
    expect(record).toHaveBeenCalledTimes(1);
  });

  it("q155 google: recorded on the first verification of a new token (iat), not on every request", async () => {
    let iat = 100;
    const m = { userId: "u1", tenantId: "t1", roles: [], dashboardScopeMode: "ALL" } as never;
    const record = vi.fn();
    const p = new GoogleIdentityProvider("cid", async () => m, record);
    (p as unknown as { client: unknown }).client = {
      verifyIdToken: async () => ({ getPayload: () => ({ email: "a@b.c", email_verified: true, iat }) }),
    };
    await p.verifyToken("x");
    await p.verifyToken("x");
    expect(record).toHaveBeenCalledTimes(1);
    iat = 200; // nouvelle connexion
    await p.verifyToken("y");
    expect(record).toHaveBeenCalledTimes(2);
  });
});
