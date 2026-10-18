import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Pool, type PoolClient } from "pg";
import { PostgresGovernanceQueries } from "../src/infrastructure/database/postgres/PostgresGovernanceQueries.js";
import { PostgresAuditRepository } from "../src/infrastructure/database/postgres/PostgresAuditRepository.js";

/**
 * Lot D4 queries on a REAL PostgreSQL (skipped unless QA_SWP_PGHOST is a unix socket directory; needs 001..068).
 * One transaction rolled back.
 */
const HOST = process.env.QA_SWP_PGHOST ?? "";

describe.skipIf(!HOST.startsWith("/"))("D4 PostgresGovernanceQueries", () => {
  let pool: Pool;
  let c: PoolClient;
  let q: PostgresGovernanceQueries;
  let audit: PostgresAuditRepository;
  const one = async (sql: string, p: unknown[] = []) => (await c.query<{ id: string }>(sql, p)).rows[0]!.id;
  let n = 0;
  async function world() {
    n += 1;
    const t = await one(`INSERT INTO tenants (name) VALUES ($1) RETURNING id`, [`d4-${n}`]);
    const user = (tag: string, roles = "{}") =>
      one(`INSERT INTO users (tenant_id, email, display_name, roles) VALUES ($1, $2, $2, $3) RETURNING id`, [t, `${tag}${n}-${Math.random()}@d4`, roles]);
    const role = (permissions: string[], systemGroup: string | null = null) =>
      one(`INSERT INTO roles (tenant_id, name, permissions, system_group) VALUES ($1, $2, $3, $4) RETURNING id`, [t, `r-${Math.random()}`, permissions, systemGroup]);
    const grant = (roleId: string, userId: string, by: string) =>
      one(`INSERT INTO user_roles (tenant_id, role_id, user_id, granted_by) VALUES ($1, $2, $3, $4) RETURNING id`, [t, roleId, userId, by]);
    return { t, user, role, grant };
  }

  beforeAll(async () => {
    pool = new Pool({ host: HOST, port: Number(process.env.QA_SWP_PGPORT ?? 5531), user: "postgres", database: process.env.QA_SWP_PGDB ?? "grc_qa_a08", max: 1 });
    c = await pool.connect();
    await c.query("BEGIN");
    q = new PostgresGovernanceQueries(c as never);
    audit = new PostgresAuditRepository(c as never);
  });
  afterAll(async () => { await c?.query("ROLLBACK"); c?.release(); await pool?.end(); });

  it("existsOther: role permission, legacy users.roles, never the actor, never an excluded maker", async () => {
    const w = await world();
    const actor = await w.user("actor", "{execution.validate}");
    expect(await q.existsOther(w.t, actor, "execution.validate")).toBe(false);

    const holder = await w.user("holder");
    const role = await w.role(["execution.validate"]);
    await w.grant(role, holder, actor);
    expect(await q.existsOther(w.t, actor, "execution.validate")).toBe(true);
    expect(await q.existsOther(w.t, actor, "execution.validate", [holder])).toBe(false);
    expect(await q.existsOther(w.t, actor, "effectiveness.validate")).toBe(false);

    const legacy = await w.user("legacy", "{effectiveness.validate}");
    expect(await q.existsOther(w.t, actor, "effectiveness.validate")).toBe(true);
    expect(await q.existsOther(w.t, legacy, "effectiveness.validate")).toBe(false);
  });

  it("existsOther ignores a suspended user, a revoked assignment, a deleted role, and another tenant", async () => {
    const w = await world();
    const actor = await w.user("actor");
    const suspended = await w.user("susp");
    const revoked = await w.user("rev");
    const onDeletedRole = await w.user("del");
    const role = await w.role(["execution.validate"]);
    const deletedRole = await w.role(["execution.validate"]);
    await w.grant(role, suspended, actor);
    await c.query(`UPDATE users SET deleted_at = now() WHERE id = $1`, [suspended]);
    await c.query(`UPDATE user_roles SET revoked_at = now() WHERE id = $1`, [await w.grant(role, revoked, actor)]);
    await w.grant(deletedRole, onDeletedRole, actor);
    await c.query(`UPDATE roles SET deleted_at = now() WHERE id = $1`, [deletedRole]);
    expect(await q.existsOther(w.t, actor, "execution.validate")).toBe(false);

    const w2 = await world();
    const foreign = await w2.user("foreign");
    await w2.grant(await w2.role(["execution.validate"]), foreign, foreign);
    expect(await q.existsOther(w.t, actor, "execution.validate")).toBe(false);
  });

  it("existsGovernanceThirdParty: another RM / Committee / Audit member only", async () => {
    const w = await world();
    const actor = await w.user("actor");
    const rm = await w.role([], "RISK_MANAGER");
    await w.grant(rm, actor, actor);
    expect(await q.existsGovernanceThirdParty(w.t, actor)).toBe(false);
    const plain = await w.user("plain");
    await w.grant(await w.role(["role.assign"]), plain, actor);
    expect(await q.existsGovernanceThirdParty(w.t, actor)).toBe(false);
    const audit1 = await w.user("audit");
    await w.grant(await w.role([], "AUDIT"), audit1, actor);
    expect(await q.existsGovernanceThirdParty(w.t, actor)).toBe(true);
    expect(await q.existsGovernanceThirdParty(w.t, audit1)).toBe(true); // the RM is a third party for the Audit member
  });

  it("forEntities marks only the entities that have a marked audit row, tenant and type scoped", async () => {
    const w = await world();
    const u = await w.user("u");
    const marked = "00000000-0000-4000-8000-0000000000a1";
    const plain = "00000000-0000-4000-8000-0000000000a2";
    const ev = (entityId: string, governanceException?: string, entityType = "ControlExecution") =>
      audit.record({ tenantId: w.t, userId: u, entityType, entityId, action: "VALIDATE", oldValue: null, newValue: {}, reason: null, requestId: "r", governanceException });
    await ev(marked, "noSelfValidation");
    await ev(plain);
    await ev(plain, undefined, "Other");
    const result = await q.forEntities(w.t, "ControlExecution", [marked, plain]);
    expect(result.get(marked)).toBe("WITHOUT_INDEPENDENT_REVIEW");
    expect(result.get(plain)).toBe("INDEPENDENT");
    expect((await q.forEntities(w.t, "Other", [marked])).get(marked)).toBe("INDEPENDENT");
    const w2 = await world();
    expect((await q.forEntities(w2.t, "ControlExecution", [marked])).get(marked)).toBe("INDEPENDENT");
    expect((await q.forEntities(w.t, "ControlExecution", [])).size).toBe(0);
  });
});
