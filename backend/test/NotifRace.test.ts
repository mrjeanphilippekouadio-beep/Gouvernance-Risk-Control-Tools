import { describe, expect, it } from "vitest";
import type { Pool } from "pg";
import { PostgresNotificationRepository } from "../src/infrastructure/database/postgres/PostgresNotificationRepository.js";
import { NotificationService } from "../src/services/NotificationService.js";
import { kriMeasuresRouter } from "../src/api/v1/kriMeasures.routes.js";
import type { Notification } from "../src/domain/entities/Notification.js";

const input = { tenantId: "t1", recipientUserId: "u1", resourceType: "KRI" as const, resourceId: "k1", eventType: "KRI_THRESHOLD_BREACH", message: "m" };
const row = { id: "n1", tenant_id: "t1", recipient_user_id: "u1", resource_type: "KRI", resource_id: "k1", event_type: "KRI_THRESHOLD_BREACH", message: "m", sent_at: new Date(), read_at: null };

function fakePool(opts: { existing?: boolean; failOn?: RegExp } = {}) {
  const log: string[] = [];
  let released = 0;
  const client = {
    async query(sql: string) {
      log.push(sql.trim().split(/\s+/).slice(0, 4).join(" "));
      if (opts.failOn?.test(sql)) throw new Error("boom");
      if (/^\s*SELECT 1/.test(sql)) return { rows: opts.existing ? [{}] : [] };
      if (/INSERT/.test(sql)) return { rows: [row] };
      return { rows: [] };
    },
    release() { released++; },
  };
  return { pool: { connect: async () => client } as unknown as Pool, log, released: () => released };
}

describe("PostgresNotificationRepository.insertIfNoUnread (F-NOTIF-01)", () => {
  it("takes the advisory lock before SELECT and INSERT, in one transaction", async () => {
    const f = fakePool();
    const n = await new PostgresNotificationRepository(f.pool).insertIfNoUnread(input);
    expect(n?.id).toBe("n1");
    expect(f.log).toEqual(["BEGIN", "SELECT pg_advisory_xact_lock(hashtextextended($1, 0))", "SELECT 1 FROM notifications", "INSERT INTO notifications (tenant_id,", "COMMIT"]);
    expect(f.released()).toBe(1);
  });

  it("returns null without INSERT when an unread one exists", async () => {
    const f = fakePool({ existing: true });
    expect(await new PostgresNotificationRepository(f.pool).insertIfNoUnread(input)).toBeNull();
    expect(f.log).not.toContain("INSERT INTO notifications (tenant_id,");
    expect(f.log.at(-1)).toBe("COMMIT");
  });

  it("ROLLBACKs and releases on error", async () => {
    const f = fakePool({ failOn: /INSERT/ });
    await expect(new PostgresNotificationRepository(f.pool).insertIfNoUnread(input)).rejects.toThrow("boom");
    expect(f.log.at(-1)).toBe("ROLLBACK");
    expect(f.released()).toBe(1);
  });
});

describe("NotificationService.emit with insertIfNoUnread", () => {
  it("uses the atomic method and skips the plain pre-check", async () => {
    let existsCalls = 0;
    let stored = false;
    const svc = new NotificationService(
      {
        async create() { throw new Error("must not be called"); },
        async insertIfNoUnread(i: object) {
          if (stored) return null;
          stored = true;
          return { id: "x", ...i, sentAt: new Date(), readAt: null } as Notification;
        },
        async existsUnread() { existsCalls++; return false; },
      } as never,
      { async getByKey() { return null; } } as never,
      { async record() {} } as never,
    );
    const base = { ...input, triggeredBy: "u9", requestId: "r", skipIfUnread: true };
    expect(await svc.emit(base)).not.toBeNull();
    expect(await svc.emit(base)).toBeNull();
    expect(existsCalls).toBe(0);
  });
});

describe("KRI measure route", () => {
  it("mounts a rate limiter on POST /", () => {
    const stack = (kriMeasuresRouter({} as never) as unknown as { stack: { route?: { path: string; methods: { post?: boolean }; stack: unknown[] } }[] }).stack;
    const layer = stack.find((l) => l.route?.path === "/" && l.route.methods.post);
    expect(layer?.route?.stack.length).toBe(2);
  });
});
