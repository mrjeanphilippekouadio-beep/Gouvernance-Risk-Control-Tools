import { describe, expect, it } from "vitest";
import { PostgresUserRepository } from "../src/infrastructure/database/postgres/PostgresUserRepository.js";

// F-EVD2b-01: suspend must lock users before roles, like RoleRepository.assignToUser/update,
// otherwise it deadlocks against a concurrent Risk Manager group widening.
describe("PostgresUserRepository.suspend lock order", () => {
  it("locks the users row before the Risk Manager group row", async () => {
    const sql: string[] = [];
    const client = {
      async query(text: string) {
        sql.push(text.replace(/\s+/g, " ").trim());
        if (text.startsWith("UPDATE users")) return { rows: [], rowCount: 1 };
        return { rows: [], rowCount: 0 };
      },
      release() {},
    };
    const repo = new PostgresUserRepository({ async connect() { return client; } } as never);
    await repo.suspend("t1", "u1");
    const usersLock = sql.findIndex((q) => /FROM users .*FOR UPDATE/.test(q));
    const rolesLock = sql.findIndex((q) => /FROM roles .*FOR UPDATE OF r/.test(q));
    expect(usersLock).toBeGreaterThan(0);
    expect(rolesLock).toBeGreaterThan(usersLock);
  });
});
