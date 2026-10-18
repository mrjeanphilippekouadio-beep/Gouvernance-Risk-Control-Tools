import { describe, expect, it, vi } from "vitest";
import { createLastSeenRecorder, withLastSeen } from "../src/infrastructure/identity/lastSeen.js";

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

  it("withLastSeen returns the membership unchanged and tolerates a throwing recorder", async () => {
    const m = { userId: "u1", tenantId: "t1", roles: [] };
    const record = vi.fn(() => {
      throw new Error("boom");
    });
    const lookup = withLastSeen(async (_e: string) => m, record);
    await expect(lookup("a@b.c")).resolves.toBe(m);
    expect(record).toHaveBeenCalledWith("t1", "u1");
    const none = withLastSeen(async (_e: string) => null, record);
    await expect(none("x")).resolves.toBeNull();
  });
});
