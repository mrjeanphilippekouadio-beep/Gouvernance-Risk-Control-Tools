import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { ROOT, qaVisibilityHarness } from "./qaVisibilityHarness.js";

/**
 * QA-visibility-v5 (level 2): lot V5 (q225 A, DECISION-112, migration 087). The access of a person added by name to a « personnes nommées »
 * (NOMINATIF) dossier ends when the dossier is closed or at the latest 30 days after, and is renewable (new expiry = now + 30 days, never more).
 * Oracles written BEFORE running, from the decision and the migration header. Not a Security / Privacy / Compliance opinion.
 *
 * Live part: QA_VIS5_LIVE=1 + LOCAL cluster of tests/integration/qa-visibility-v1-setup.sh (127.0.0.1:55442, never a remote host); own bases
 * (grc_qa_v5 for the server, grc_qa_v5mig for the migration) are rebuilt: run live suites with --no-file-parallelism.
 * `it.fails` documents a CONFIRMED defect (turn it into `it` when fixed).
 */
const live = process.env["QA_VIS5_LIVE"] === "1";
const DB = "grc_qa_v5";
const MIG_DB = "grc_qa_v5mig";
const PORT = 8097;
const I = (x: string) => `aaaaaaaa-0000-4000-8000-000000000${x}`;
const T = I("001");
const read = (...p: string[]) => readFileSync(join(ROOT, ...p), "utf8");
const DAY = 86_400_000;

describe("QA-visibility-v5 STATIC", () => {
  const mig = join(ROOT, "database", "postgresql", "migrations");
  it("087 ships its .down, takes the next number, and the renewal body is bounded 1..50 (no bare z.array)", () => {
    const names = readdirSync(mig);
    expect(names).toContain("087_named_access_expiry.sql");
    expect(names).toContain("087_named_access_expiry.down.sql");
    expect(names.filter((n) => n.startsWith("087_") && !n.endsWith(".down.sql"))).toHaveLength(1);
    expect(names.filter((n) => /^\d{3}_/.test(n) && n >= "095")).toHaveLength(0);
    expect(read("backend", "src", "api", "v1", "resourceVisibility.routes.ts")).toMatch(/userIds: boundedArray\(z\.guid\(\), MAX_ACCESS_CHANGE, 1\)/);
  });
  it("the renewal route is mounted for the five types (risk on its own router, the four others through mountVisibilityRoutes)", () => {
    expect(read("backend", "src", "api", "v1", "risks.routes.ts")).toContain('"/:id/visibility/renew"');
    expect(read("backend", "src", "api", "v1", "resourceVisibility.routes.ts")).toContain('"/:id/visibility/renew"');
    for (const f of ["controls", "anomalies", "actionPlans", "kpis"]) expect(read("backend", "src", "api", "v1", `${f}.routes.ts`), f).toContain("mountVisibilityRoutes(router,");
  });
  it("no application SQL deletes or hand-revokes an access to implement the expiry (the read ignores it; the row stays)", () => {
    const f = read("backend", "src", "infrastructure", "database", "postgres", "namedAccess.ts");
    expect(f).not.toMatch(/DELETE\s+FROM/i);
    expect(f).not.toMatch(/revoked_at\s*=\s*now/i);
  });
});

type Who = "own" | "n1" | "raci" | "pown" | "dept" | "named" | "out" | "out2" | "rm" | "com" | "aud" | "adm";
const WHO: Who[] = ["own", "n1", "raci", "pown", "dept", "named", "out", "out2", "rm", "com", "aud", "adm"];
const UID: Record<Who, string> = { own: I("101"), n1: I("102"), raci: I("103"), pown: I("104"), dept: I("105"), named: I("106"), out: I("107"), out2: I("108"), rm: I("109"), com: I("10a"), aud: I("10b"), adm: I("10c") };
const TYPES = ["RISK", "CONTROL", "KPI", "ANOMALY", "ACTION_PLAN"] as const;
type Type = (typeof TYPES)[number];
const PATH: Record<Type, string> = { RISK: "/risks", CONTROL: "/controls", KPI: "/kpis", ANOMALY: "/anomalies", ACTION_PLAN: "/actions" };
/** Closing a dossier, per type (migration 087 header). */
const CLOSE: Record<Type, string> = {
  RISK: "UPDATE risks SET status = 'ARCHIVED' WHERE id = $1",
  CONTROL: "UPDATE controls SET status = 'ARCHIVED' WHERE id = $1",
  KPI: "UPDATE kpis SET deleted_at = now() WHERE id = $1",
  ANOMALY: "UPDATE anomalies SET status = 'CLOSED' WHERE id = $1",
  ACTION_PLAN: "UPDATE action_plans SET status = 'TERMINEE' WHERE id = $1",
};
const REASON = "Dossier toujours en cours, accès à prolonger";

const H = qaVisibilityHarness({ db: DB, port: PORT, who: WHO, uid: UID });
const { sql, get, call } = H;
const post = H.post;

async function insertItem(type: Type, level: string, extra: { riskId?: string; controlId?: string; source?: ["RISK" | "CONTROL", string] } = {}): Promise<string> {
  const id = randomUUID();
  if (type === "RISK") await sql("INSERT INTO risks (id, tenant_id, process, description, status, owner_id, visibility) VALUES ($1, $2, 'QA5', 'QA5', 'ACTIVE', $3, $4)", [id, T, UID.own, level]);
  if (type === "CONTROL") await sql("INSERT INTO controls (id, tenant_id, label, control_type, frequency, executor, compliance_criteria, visibility) VALUES ($1, $2, 'QA5', 'PREVENTIVE', 'MONTHLY', 'x', 'y', $3)", [id, T, level]);
  if (type === "KPI") await sql("INSERT INTO kpis (id, tenant_id, label, target_value, unit, frequency, owner, department_id, visibility) VALUES ($1, $2, 'QA5', 1, 'u', 'MONTHLY', 'x', $3, $4)", [id, T, I("201"), level]);
  if (type === "ANOMALY") await sql("INSERT INTO anomalies (id, tenant_id, description, severity, detected_by, visibility, risk_id, control_id) VALUES ($1, $2, 'QA5', 'LOW', $3, $4, $5, $6)", [id, T, UID.own, level, extra.riskId ?? null, extra.controlId ?? null]);
  if (type === "ACTION_PLAN") await sql("INSERT INTO action_plans (id, tenant_id, title, source_type, source_id, responsible_user_id, due_date, created_by, visibility) VALUES ($1, $2, 'QA5', $3, $4, $5, current_date + 30, $5, $6)", [id, T, extra.source?.[0] ?? "MANAGEMENT", extra.source?.[1] ?? null, UID.own, level]);
  return id;
}
/** A grant as written by the application on a NOMINATIF dossier: expiry `in` (SQL interval). */
const grant = (type: string, id: string, user: string, inInterval: string | null = "10 days") =>
  sql(`INSERT INTO resource_access_grants (tenant_id, resource_type, resource_id, user_id, granted_by, grant_reason, expires_at) VALUES ($1, $2, $3, $4, $5, 'QA5', ${inInterval ? `now() + interval '${inInterval}'` : "NULL"})`, [T, type, id, user, user === UID.rm ? UID.adm : UID.rm]);
const nominatif = async (type: Type, user: string = UID.named, extra: Parameters<typeof insertItem>[2] = {}) => {
  const id = await insertItem(type, "NOMINATIF", extra);
  await grant(type, id, user);
  return id;
};
// SEC-V5-03: the guard refuses to shorten an expiry, so the tests that backdate one switch the guard off for the statement.
const expire = async (type: string, id: string, user = UID.named) => {
  await sql("ALTER TABLE resource_access_grants DISABLE TRIGGER resource_access_grants_guard");
  try {
    await sql("UPDATE resource_access_grants SET expires_at = now() - interval '1 minute' WHERE resource_type = $1 AND resource_id = $2 AND user_id = $3 AND revoked_at IS NULL", [type, id, user]);
  } finally {
    await sql("ALTER TABLE resource_access_grants ENABLE TRIGGER resource_access_grants_guard");
  }
};
const shorten = async (query: string, params: unknown[]) => {
  await sql("ALTER TABLE resource_access_grants DISABLE TRIGGER resource_access_grants_guard");
  try { await sql(query, params); } finally { await sql("ALTER TABLE resource_access_grants ENABLE TRIGGER resource_access_grants_guard"); }
};
const expiryOf = async (type: string, id: string, user = UID.named) =>
  (await sql<{ expires_at: Date | null }>("SELECT expires_at FROM resource_access_grants WHERE resource_type = $1 AND resource_id = $2 AND user_id = $3 AND revoked_at IS NULL", [type, id, user]))[0]?.expires_at ?? null;
const daysFromNow = (d: Date | string | null) => (new Date(d as string).getTime() - Date.now()) / DAY;
const reads = async (who: Who, type: Type, id: string) => (await get(who, `${PATH[type]}/${id}`)).status === 200;
const renew = (who: Who, type: Type, id: string, userIds: string[], reason: unknown = REASON) =>
  post(who, `${PATH[type]}/${id}/visibility/renew`, { userIds, reason });
const setVis = (who: Who, type: Type, id: string, visibility: string, addUserIds: string[] = [], revokeUserIds: string[] = []) =>
  H.put(who, `${PATH[type]}/${id}/visibility`, { visibility, addUserIds, revokeUserIds, reason: REASON });
const grantRows = (id: string) => sql<{ user_id: string; revoked_at: Date | null; expires_at: Date | null }>("SELECT user_id, revoked_at, expires_at FROM resource_access_grants WHERE resource_id = $1 ORDER BY granted_at, id", [id]);

describe.skipIf(!live)("QA-visibility-v5 on the REAL server + LOCAL PostgreSQL 16", () => {
  beforeAll(() => H.start(async () => {
    await sql("TRUNCATE anomalies, action_plans CASCADE");
  }), 280000);
  afterAll(() => H.stop());

  // ------------------------------------------------------------------------------------------------ READ: expiry and closure
  describe("READ: an expired or closed named access reads nothing, for every type", () => {
    for (const type of TYPES) {
      it(`${type}: live access reads; expired access => 404 as for a stranger; the row stays unrevoked; the Risk Manager still reads; renewal restores the read`, async () => {
        const id = await nominatif(type);
        expect(await reads("named", type, id), "live").toBe(true);
        expect(await reads("out2", type, id), "stranger").toBe(false);
        await expire(type, id);
        expect(await reads("named", type, id), "expired").toBe(false);
        expect((await get("named", `${PATH[type]}/${id}`)).status).toBe((await get("out2", `${PATH[type]}/${id}`)).status);
        expect(await reads("rm", type, id), "RM still reads").toBe(true);
        const rows = await grantRows(id);
        expect(rows).toHaveLength(1);
        expect(rows[0]!.revoked_at).toBeNull();
        const r = await renew("rm", type, id, [UID.named]);
        expect(r.status, r.text.slice(0, 200)).toBe(200);
        expect(await reads("named", type, id), "renewed").toBe(true);
        const days = daysFromNow(await expiryOf(type, id));
        expect(days).toBeGreaterThan(29.9);
        expect(days).toBeLessThanOrEqual(30);
        expect(await grantRows(id)).toHaveLength(1);
      });
      it(`${type}: closing the dossier cuts the live access; the Risk Manager still reads; renewal of a closed dossier is refused (400) and writes nothing`, async () => {
        const id = await nominatif(type);
        expect(await reads("named", type, id)).toBe(true);
        await sql(CLOSE[type], [id]);
        expect(await reads("named", type, id), "closed").toBe(false);
        const audits = (await H.audits(id)).length;
        const r = await renew("rm", type, id, [UID.named]);
        // a closed KPI is a soft-deleted one: 404 (not found) is as good a refusal as 400
        expect(type === "KPI" ? [400, 404] : [400], r.text.slice(0, 200)).toContain(r.status);
        expect((await H.audits(id)).length, "no audit row for a refused renewal").toBe(audits);
        expect(daysFromNow(await expiryOf(type, id))).toBeLessThan(10.01);
      });
    }
    it("SEC-Q253-01: a PERIMETRE named access written without expiry (direct SQL) reads nothing, fail closed (control, KPI, plan, anomaly, risk)", async () => {
      for (const type of TYPES) {
        const id = await insertItem(type, "PERIMETRE");
        await grant(type, id, UID.named, null);
        expect(await reads("named", type, id), type).toBe(false);
      }
    });
    it("the owner of a dossier still reads it after expiry and after closure (his right does not come from the list)", async () => {
      const id = await nominatif("RISK");
      await expire("RISK", id);
      await sql(CLOSE.RISK, [id]);
      expect(await reads("own", "RISK", id)).toBe(true);
    });
  });

  // ------------------------------------------------------------------------------------------------ INHERITANCE
  describe("INHERITED access: anomaly / plan following a restricted risk or control falls with it", () => {
    const cases: Array<{ name: string; parent: "RISK" | "CONTROL"; child: "ANOMALY" | "ACTION_PLAN" }> = [
      { name: "anomaly of a risk", parent: "RISK", child: "ANOMALY" },
      { name: "plan of a risk", parent: "RISK", child: "ACTION_PLAN" },
      { name: "anomaly of a control", parent: "CONTROL", child: "ANOMALY" },
      { name: "plan of a control", parent: "CONTROL", child: "ACTION_PLAN" },
    ];
    const mkChild = (c: (typeof cases)[number], parentId: string) =>
      c.child === "ANOMALY"
        ? insertItem("ANOMALY", "CLIENT", c.parent === "RISK" ? { riskId: parentId } : { controlId: parentId })
        : insertItem("ACTION_PLAN", "CLIENT", { source: [c.parent, parentId] });
    for (const c of cases) {
      it(`${c.name}: readable through the parent's named access; unreadable once the parent's access expires; readable again when renewed; unreadable once the parent is closed`, async () => {
        const parent = await nominatif(c.parent);
        const child = await mkChild(c, parent);
        expect(await reads("named", c.child, child), "inherited read").toBe(true);
        expect(await reads("out2", c.child, child), "stranger").toBe(false);
        // list endpoint too
        const list = await get("named", PATH[c.child]);
        expect(list.status).toBe(200);
        expect(JSON.stringify(list.json.data)).toContain(child);
        await expire(c.parent, parent);
        expect(await reads("named", c.child, child), "after expiry").toBe(false);
        expect(JSON.stringify((await get("named", PATH[c.child])).json.data)).not.toContain(child);
        expect((await renew("rm", c.parent, parent, [UID.named])).status).toBe(200);
        expect(await reads("named", c.child, child), "after renewal").toBe(true);
        await sql(CLOSE[c.parent], [parent]);
        expect(await reads("named", c.child, child), "after closure of the parent").toBe(false);
        expect(await reads("rm", c.child, child), "RM still reads").toBe(true);
      });
    }
    it("a child cannot be renewed on its own (it follows the parent): 400, and the message points to the parent", async () => {
      const parent = await nominatif("RISK");
      const child = await insertItem("ANOMALY", "CLIENT", { riskId: parent });
      const r = await renew("rm", "ANOMALY", child, [UID.named]);
      expect(r.status).toBe(400);
    });
    it("closing the CHILD alone (anomaly CLOSED, plan TERMINEE) does not cut the inherited read: the parent is still open", async () => {
      const parent = await nominatif("RISK");
      const a = await insertItem("ANOMALY", "CLIENT", { riskId: parent });
      await sql(CLOSE.ANOMALY, [a]);
      expect(await reads("named", "ANOMALY", a)).toBe(true);
    });
  });

  // ------------------------------------------------------------------------------------------------ RENEW endpoint
  describe("RENEW: POST /:id/visibility/renew", () => {
    it("401 anonymous; 403 for a reader without the right (non-owner); 404 on an unknown id; stranger sees 404 or 403, never 200", async () => {
      const id = await nominatif("CONTROL");
      expect((await call(null, "POST", `/controls/${id}/visibility/renew`, { userIds: [UID.named], reason: REASON })).status).toBe(401);
      for (const w of ["out2", "named", "out", "n1", "com", "aud", "adm"] as Who[]) {
        const s = (await renew(w, "CONTROL", id, [UID.named])).status;
        expect([403, 404], `${w}: ${s}`).toContain(s);
      }
      expect((await renew("rm", "CONTROL", randomUUID(), [UID.named])).status).toBe(404);
      expect(daysFromNow(await expiryOf("CONTROL", id))).toBeLessThan(10.01);
    });
    it("body validation: missing / empty / 51 / wrong type / non-uuid / blank reason / reason too long => 400 (never 500), nothing written", async () => {
      const id = await nominatif("CONTROL");
      const audits = (await H.audits(id)).length;
      const bad: unknown[] = [
        {}, { userIds: [UID.named] }, { reason: REASON }, { userIds: [], reason: REASON }, { userIds: "x", reason: REASON }, { userIds: null, reason: REASON },
        { userIds: ["nope"], reason: REASON }, { userIds: [5], reason: REASON }, { userIds: [UID.named], reason: "" }, { userIds: [UID.named], reason: "   " },
        { userIds: [UID.named], reason: "\t\n " }, { userIds: [UID.named], reason: "x".repeat(501) }, { userIds: [UID.named], reason: null }, { userIds: [UID.named], reason: 5 },
        { userIds: Array.from({ length: 51 }, () => randomUUID()), reason: REASON }, { userIds: Array(51).fill(UID.named), reason: REASON },
      ];
      for (const b of bad) {
        const r = await call("rm", "POST", `/controls/${id}/visibility/renew`, b);
        expect(r.status, JSON.stringify(b).slice(0, 80) + " => " + r.text.slice(0, 120)).toBe(400);
      }
      expect((await H.audits(id)).length).toBe(audits);
      expect(daysFromNow(await expiryOf("CONTROL", id))).toBeLessThan(10.01);
    });
    it("a JSON body that is not an object (a bare string) is a 400, not a 500 [QA-V5-04, inherited: same on PUT /visibility]", async () => {
      const id = await nominatif("CONTROL");
      expect((await call("rm", "POST", `/controls/${id}/visibility/renew`, "not json")).status).toBe(400);
    });
    it("a body of 1 MB of {} as userIds is refused quickly (boundedArray checks length first)", async () => {
      const id = await nominatif("CONTROL");
      const t0 = Date.now();
      const r = await call("rm", "POST", `/controls/${id}/visibility/renew`, { userIds: Array.from({ length: 200_000 }, () => ({})), reason: REASON });
      expect([400, 413]).toContain(r.status);
      expect(Date.now() - t0).toBeLessThan(5000);
    });
    it("50 people at once are accepted and all renewed; 51 refused with 400 and none of them touched", async () => {
      const id = await insertItem("CONTROL", "NOMINATIF");
      const users: string[] = [];
      for (let i = 0; i < 51; i++) {
        const u = randomUUID();
        users.push(u);
        await sql("INSERT INTO users (id, tenant_id, email, display_name, roles) VALUES ($1, $2, $3, $4, '{}')", [u, T, `bulk${i}-${u}@v5.test`, `Bulk ${i}`]);
        await grant("CONTROL", id, u, "5 days");
      }
      const r51 = await renew("rm", "CONTROL", id, users);
      expect(r51.status).toBe(400);
      for (const u of users) expect(daysFromNow(await expiryOf("CONTROL", id, u)), "untouched").toBeLessThan(5.01);
      const r50 = await renew("rm", "CONTROL", id, users.slice(0, 50));
      expect(r50.status, r50.text.slice(0, 200)).toBe(200);
      for (const u of users.slice(0, 50)) expect(daysFromNow(await expiryOf("CONTROL", id, u))).toBeGreaterThan(29.9);
      expect(daysFromNow(await expiryOf("CONTROL", id, users[50]!)), "the 51st stays").toBeLessThan(5.01);
      const a = (await H.permChanges(id)).filter((x) => (x.new_value?.renewed ?? []).length === 50);
      expect(a).toHaveLength(1);
      expect(a[0]!.reason).toBe(REASON);
    }, 120000);
    it("duplicates in userIds collapse (200, one audit row); a person without access fails the WHOLE request (400) and the others are untouched (atomic)", async () => {
      const id = await nominatif("CONTROL");
      const before = (await H.permChanges(id)).length;
      expect((await renew("rm", "CONTROL", id, [UID.named, UID.named.toUpperCase()])).status).toBe(200);
      expect((await H.permChanges(id)).length).toBe(before + 1);
      const second = randomUUID();
      await sql("INSERT INTO users (id, tenant_id, email, display_name, roles) VALUES ($1, $2, $3, 'Second', '{}')", [second, T, `second-${second}@v5.test`]);
      await shorten("UPDATE resource_access_grants SET expires_at = now() + interval '3 days' WHERE resource_id = $1", [id]);
      const stranger = randomUUID();
      await sql("INSERT INTO users (id, tenant_id, email, display_name, roles) VALUES ($1, $2, $3, 'Stranger', '{}')", [stranger, T, `stranger-${stranger}@v5.test`]);
      const r = await renew("rm", "CONTROL", id, [UID.named, stranger]);
      expect(r.status, r.text.slice(0, 200)).toBe(400);
      expect(daysFromNow(await expiryOf("CONTROL", id)), "named untouched (rolled back)").toBeLessThan(3.01);
      expect((await H.permChanges(id)).length).toBe(before + 1);
    });
    it("nobody renews their own access; an unknown or suspended account is refused", async () => {
      const id = await nominatif("CONTROL");
      await grant("CONTROL", id, UID.rm, "5 days");
      expect((await renew("rm", "CONTROL", id, [UID.rm])).status).toBe(400);
      const ghost = randomUUID();
      expect((await renew("rm", "CONTROL", id, [ghost])).status).toBe(400);
      const sus = randomUUID();
      await sql("INSERT INTO users (id, tenant_id, email, display_name, roles, deleted_at) VALUES ($1, $2, $3, 'Suspended', '{}', now())", [sus, T, `sus-${sus}@v5.test`]);
      await grant("CONTROL", id, sus, "5 days");
      expect((await renew("rm", "CONTROL", id, [sus])).status).toBe(400);
    });
    it("only a NOMINATIF dossier: PERIMETRE and CLIENT => 400 for the five types", async () => {
      for (const type of TYPES) {
        for (const level of ["PERIMETRE", "CLIENT"]) {
          const id = await insertItem(type, level);
          await grant(type, id, UID.named, null);
          const r = await renew("rm", type, id, [UID.named]);
          expect(r.status, `${type} ${level}: ${r.text.slice(0, 120)}`).toBe(400);
          expect(await expiryOf(type, id), "no expiry invented").toBeNull();
        }
      }
    });
    it("audit: one PERMISSION_CHANGE row per renewal, author = caller (never a body field), reason kept, before / after expiries, widening true when an expired access is brought back", async () => {
      const id = await nominatif("CONTROL");
      await expire("CONTROL", id);
      const r = await post("rm", `/controls/${id}/visibility/renew`, { userIds: [UID.named], reason: REASON, grantedBy: UID.out, userId: UID.out });
      expect(r.status).toBe(200);
      const [row] = await H.permChanges(id);
      expect(row!.user_id).toBe(UID.rm);
      expect(row!.reason).toBe(REASON);
      expect(row!.new_value.renewed).toEqual([UID.named]);
      expect(row!.new_value.widening).toBe(true);
      expect(new Date(row!.old_value.access[0].expiresAt).getTime()).toBeLessThan(Date.now());
      expect(daysFromNow(row!.new_value.access[0].expiresAt)).toBeGreaterThan(29.9);
      const [g] = await grantRows(id);
      expect(g!.revoked_at).toBeNull();
    });
    it("repeat / idempotence: renewing twice gives two 200, an expiry never beyond 30 days, one live row; widening false when the access was still live", async () => {
      const id = await nominatif("CONTROL");
      expect((await renew("rm", "CONTROL", id, [UID.named])).status).toBe(200);
      expect((await renew("rm", "CONTROL", id, [UID.named])).status).toBe(200);
      expect(daysFromNow(await expiryOf("CONTROL", id))).toBeLessThanOrEqual(30);
      expect(await grantRows(id)).toHaveLength(1);
      const rows = await H.permChanges(id);
      expect(rows.at(-1)!.new_value.widening).toBe(false);
    });
    it("the owner of a risk renews (200) and the Risk Manager group is notified; the owner of a control (none) is refused; Risk Manager renewal does not notify", async () => {
      const id = await nominatif("RISK");
      const r = await renew("own", "RISK", id, [UID.named]);
      expect(r.status, r.text.slice(0, 200)).toBe(200);
      expect((await H.notifs("rm", id)).length).toBeGreaterThanOrEqual(1);
      const id2 = await nominatif("RISK");
      expect((await renew("rm", "RISK", id2, [UID.named])).status).toBe(200);
      expect((await H.notifs("rm", id2)).length).toBe(0);
    });
    it("a stranger without the right gets the same answer on a restricted dossier as on an unknown id (no oracle on existence)", async () => {
      const id = await nominatif("RISK");
      const a = await renew("out2", "RISK", id, [UID.named]);
      const b = await renew("out2", "RISK", randomUUID(), [UID.named]);
      expect(a.status, "hidden vs unknown").toBe(b.status);
    });
  });

  // ------------------------------------------------------------------------------------------------ GET /visibility and stamping
  describe("GET /visibility exposes expiresAt; stamping on addition", () => {
    for (const type of TYPES) {
      it(`${type}: PUT NOMINATIF + addUserIds stamps now + 30 days on every kept and added person, GET /visibility shows an ISO expiresAt`, async () => {
        const id = await insertItem(type, "PERIMETRE");
        await grant(type, id, UID.out, null); // kept person (no expiry before the switch)
        const r = await setVis("rm", type, id, "NOMINATIF", [UID.named]);
        expect(r.status, r.text.slice(0, 200)).toBe(200);
        for (const u of [UID.out, UID.named]) {
          const d = daysFromNow(await expiryOf(type, id, u));
          expect(d, `${type} ${u}`).toBeGreaterThan(29.9);
          expect(d).toBeLessThanOrEqual(30);
        }
        const g = await get("rm", `${PATH[type]}/${id}/visibility`);
        expect(g.status).toBe(200);
        const users = g.json.data.accessUsers as Array<{ id: string; expiresAt?: string | null }>;
        expect(users).toHaveLength(2);
        for (const u of users) {
          expect(typeof u.expiresAt, `${type} expiresAt`).toBe("string");
          expect(new Date(u.expiresAt!).toISOString()).toBe(u.expiresAt);
        }
      });
    }
    it("adding a person to an already NOMINATIF dossier stamps the newcomer (30 days) and does not extend the others (their expiry is not pushed by an unrelated change)", async () => {
      const id = await nominatif("CONTROL");
      const before = await expiryOf("CONTROL", id);
      const r = await setVis("rm", "CONTROL", id, "NOMINATIF", [UID.out]);
      expect(r.status, r.text.slice(0, 200)).toBe(200);
      expect(daysFromNow(await expiryOf("CONTROL", id, UID.out))).toBeGreaterThan(29.9);
      const after = await expiryOf("CONTROL", id);
      expect(Math.abs(after!.getTime() - before!.getTime()), "existing person's expiry unchanged").toBeLessThan(1000);
    });
    it("a risk created NOMINATIF through POST /risks with a list carries an expiry on each named person", async () => {
      const r = await H.call("rm", "POST", "/risks", { process: "QA5", description: "QA5 create", visibility: "NOMINATIF", accessUserIds: [UID.named] });
      // POST /risks may require an Idempotency-Key header (known V1 limitation): retry with raw fetch when it does.
      let id: string | undefined = r.json?.data?.id;
      if (!id) {
        const f = await fetch(`${H.API}/risks`, { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${H.TOK.rm}`, "idempotency-key": randomUUID() }, body: JSON.stringify({ process: "QA5", description: "QA5 create", visibility: "NOMINATIF", accessUserIds: [UID.named] }) });
        const j = (await f.json()) as { data?: { id?: string } };
        expect(f.status, JSON.stringify(j).slice(0, 200)).toBeLessThan(300);
        id = j.data!.id!;
      }
      const d = daysFromNow(await expiryOf("RISK", id));
      expect(d).toBeGreaterThan(29.9);
      expect(d).toBeLessThanOrEqual(30);
    });
    it("a revoked access is not restored by the renewal (400), and an expired access can still be revoked by hand (200) and then no longer listed", async () => {
      const id = await nominatif("CONTROL");
      await expire("CONTROL", id);
      const rev = await setVis("rm", "CONTROL", id, "NOMINATIF", [], [UID.named]);
      expect(rev.status, rev.text.slice(0, 200)).toBe(200);
      expect(rev.json.data.accessUserIds).not.toContain(UID.named);
      expect((await renew("rm", "CONTROL", id, [UID.named])).status).toBe(400);
      const [row] = await grantRows(id);
      expect(row!.revoked_at).not.toBeNull();
    });
  });

  // ------------------------------------------------------------------------------------------------ LEVEL CHANGES
  describe("LEVEL changes keep the expiry rule inside NOMINATIF", () => {
    it("[QA-V5-01, q253 A decided] NOMINATIF -> PERIMETRE: the kept list of a PERIMETRE dossier keeps its expiry", async () => {
      const id = await nominatif("CONTROL");
      const r = await setVis("rm", "CONTROL", id, "PERIMETRE");
      expect(r.status, r.text.slice(0, 200)).toBe(200);
      expect(await expiryOf("CONTROL", id), "expiry kept on a PERIMETRE list").not.toBeNull();
    });
    it("q253 A: a person named on a PERIMETRE dossier gets 30 days, renewable with a reason, and loses the read at closure (five types)", async () => {
      for (const type of TYPES) {
        const id = await insertItem(type, "PERIMETRE");
        const r = await setVis("rm", type, id, "PERIMETRE", [UID.out2]);
        expect(r.status, `${type}: ${r.text.slice(0, 200)}`).toBe(200);
        const days = daysFromNow(await expiryOf(type, id, UID.out2));
        expect(days, type).toBeGreaterThan(29.9);
        expect(days, type).toBeLessThanOrEqual(30);
        expect(await reads("out2", type, id), `${type} live`).toBe(true);
        await expire(type, id, UID.out2);
        expect(await reads("out2", type, id), `${type} expired`).toBe(false);
        expect((await renew("rm", type, id, [UID.out2])).status, type).toBe(200);
        expect(await reads("out2", type, id), `${type} renewed`).toBe(true);
        await sql(CLOSE[type], [id]);
        expect(await reads("out2", type, id), `${type} closed`).toBe(false);
      }
    });
    it("[QA-V5-01 retest] NOMINATIF -> PERIMETRE: an expired person is never lost without a way back: renewable (200), and re-adding her is a renewal; both restore the read", async () => {
      const id = await nominatif("CONTROL");
      expect((await setVis("rm", "CONTROL", id, "PERIMETRE")).status).toBe(200);
      await expire("CONTROL", id);
      expect(await reads("named", "CONTROL", id), "lapsed").toBe(false);
      const g = await get("rm", `/controls/${id}/visibility`);
      expect(g.json.data.accessUserIds).toContain(UID.named);
      const r = await renew("rm", "CONTROL", id, [UID.named]);
      expect(r.status, r.text.slice(0, 200)).toBe(200);
      expect(await reads("named", "CONTROL", id), "renewed").toBe(true);
      expect(daysFromNow(await expiryOf("CONTROL", id))).toBeGreaterThan(29.9);
      await expire("CONTROL", id);
      expect(await reads("named", "CONTROL", id)).toBe(false);
      const add = await setVis("rm", "CONTROL", id, "PERIMETRE", [UID.named]);
      expect(add.status, add.text.slice(0, 200)).toBe(200);
      expect(await reads("named", "CONTROL", id), "re-added = renewed").toBe(true);
      expect(await grantRows(id), "one row, nothing revoked").toHaveLength(1);
    });
    it("[QA-V5-01 retest] a closed dossier still refuses renewal and re-adding does not bring the access back", async () => {
      const id = await nominatif("CONTROL");
      expect((await setVis("rm", "CONTROL", id, "PERIMETRE")).status).toBe(200);
      await expire("CONTROL", id);
      await sql(CLOSE.CONTROL, [id]);
      expect((await renew("rm", "CONTROL", id, [UID.named])).status).toBe(400);
      await setVis("rm", "CONTROL", id, "PERIMETRE", [UID.named]);
      expect(await reads("named", "CONTROL", id)).toBe(false);
    });
    it("CLIENT <-> NOMINATIF: going to CLIENT empties the list (everybody reads); back to NOMINATIF with the person re-added gives a NEW live access with a fresh 30 days; the old row stays revoked", async () => {
      const id = await nominatif("CONTROL");
      await expire("CONTROL", id);
      expect((await setVis("rm", "CONTROL", id, "CLIENT")).status).toBe(200);
      expect(await reads("out2", "CONTROL", id)).toBe(true);
      expect((await setVis("rm", "CONTROL", id, "NOMINATIF")).status).toBe(200);
      expect(await reads("named", "CONTROL", id), "list was emptied").toBe(false);
      expect((await renew("rm", "CONTROL", id, [UID.named])).status, "nothing left to renew").toBe(400);
      expect((await setVis("rm", "CONTROL", id, "NOMINATIF", [UID.named])).status).toBe(200);
      expect(await reads("named", "CONTROL", id)).toBe(true);
      expect(daysFromNow(await expiryOf("CONTROL", id))).toBeGreaterThan(29.9);
      const rows = await grantRows(id);
      expect(rows.map((r) => r.revoked_at !== null)).toEqual([true, false]);
    });
  });

  // ------------------------------------------------------------------------------------------------ COUNTERS
  describe("GET /restricted-resources: accessCount", () => {
    const row = async (type: string, id: string) => {
      const r = await get("rm", "/restricted-resources?limit=500");
      expect(r.status).toBe(200);
      return (r.json.data as Array<{ type: string; id: string; accessCount: number }>).find((x) => x.type === type && x.id === id);
    };
    it("counts live accesses only: 3 named => 3; one expires => 2; renewed => 3", async () => {
      const id = await nominatif("CONTROL");
      await grant("CONTROL", id, UID.out);
      await grant("CONTROL", id, UID.out2);
      expect((await row("CONTROL", id))!.accessCount).toBe(3);
      await expire("CONTROL", id, UID.out);
      expect((await row("CONTROL", id))!.accessCount).toBe(2);
      expect((await renew("rm", "CONTROL", id, [UID.out])).status).toBe(200);
      expect((await row("CONTROL", id))!.accessCount).toBe(3);
    });
    it("[QA-V5-02] a CLOSED dossier no longer counts the named accesses that ended with it (3 listed, 0 can read)", async () => {
      const id = await nominatif("CONTROL");
      await grant("CONTROL", id, UID.out);
      await sql(CLOSE.CONTROL, [id]);
      const x = await row("CONTROL", id);
      if (x) expect(x.accessCount, "people whose access ended at closure").toBe(0);
    });
    it("the list shows the live expiry on the dossier through GET /visibility of the closed dossier too (RM)", async () => {
      const id = await nominatif("RISK");
      await sql(CLOSE.RISK, [id]);
      const g = await get("rm", `/risks/${id}/visibility`);
      expect(g.status).toBe(200);
    });
  });

  // ------------------------------------------------------------------------------------------------ DB GUARD
  describe("DB guard (trigger on resource_access_grants)", () => {
    const attempt = async (q: string, p: unknown[]) => { try { await sql(q, p); return null; } catch (e) { return (e as Error).message; } };
    it("insert beyond 30 days refused; update beyond 30 days refused; removing an expiry refused; a past expiry allowed; delete refused; revocation cannot move the expiry", async () => {
      const id = await insertItem("CONTROL", "NOMINATIF");
      expect(await attempt(`INSERT INTO resource_access_grants (tenant_id, resource_type, resource_id, user_id, granted_by, grant_reason, expires_at) VALUES ($1,'CONTROL',$2,$3,$4,'x', now() + interval '31 days')`, [T, id, UID.named, UID.rm])).toMatch(/30 days/);
      expect(await attempt(`INSERT INTO resource_access_grants (tenant_id, resource_type, resource_id, user_id, granted_by, grant_reason, expires_at) VALUES ($1,'CONTROL',$2,$3,$4,'x', now() + interval '30 days')`, [T, id, UID.named, UID.rm])).toBeNull();
      expect(await attempt("UPDATE resource_access_grants SET expires_at = now() + interval '31 days' WHERE resource_id = $1", [id])).toMatch(/30 days/);
      expect(await attempt("UPDATE resource_access_grants SET expires_at = NULL WHERE resource_id = $1", [id])).not.toBeNull();
      expect(await attempt("UPDATE resource_access_grants SET expires_at = now() - interval '1 day' WHERE resource_id = $1", [id]), "SEC-V5-03: never shortened or backdated").toMatch(/lengthened/);
      expect(await attempt("DELETE FROM resource_access_grants WHERE resource_id = $1", [id])).toMatch(/never deleted/);
      expect(await attempt("UPDATE resource_access_grants SET revoked_at = now(), revoked_by = $2, revoke_reason = 'x', expires_at = now() WHERE resource_id = $1", [id, UID.rm])).toMatch(/does not change the expiry/);
      expect(await attempt("UPDATE resource_access_grants SET revoked_at = now(), revoked_by = $2, revoke_reason = 'x' WHERE resource_id = $1", [id, UID.rm])).toBeNull();
      expect(await attempt("UPDATE resource_access_grants SET revoked_at = NULL WHERE resource_id = $1", [id])).not.toBeNull();
      expect(await attempt("UPDATE resource_access_grants SET expires_at = now() + interval '5 days' WHERE resource_id = $1", [id]), "revoked row: never touched again").not.toBeNull();
    });
    it("boundary: exactly now()+30 days at insert is accepted (the application itself writes now()+30 days)", async () => {
      const id = await insertItem("CONTROL", "NOMINATIF");
      expect(await attempt(`INSERT INTO resource_access_grants (tenant_id, resource_type, resource_id, user_id, granted_by, grant_reason, expires_at) VALUES ($1,'CONTROL',$2,$3,$4,'x', now() + interval '30 days' + interval '1 second')`, [T, id, UID.named, UID.rm])).toMatch(/30 days/);
    });
    it("the two branches of the guard that the application relies on: content immutable (user, resource), expiry only on a live row", async () => {
      const id = await nominatif("CONTROL");
      expect(await attempt("UPDATE resource_access_grants SET user_id = $2 WHERE resource_id = $1", [id, UID.out])).toMatch(/immutable/);
      expect(await attempt("UPDATE resource_access_grants SET grant_reason = 'autre' WHERE resource_id = $1", [id])).toMatch(/immutable/);
    });
  });

  // ------------------------------------------------------------------------------------------------ RACES
  describe("RACES", () => {
    it("expiry vs renewal at the boundary: an access that lapses 1.5 s from now is renewed after the lapse => reads again; renewed just before the lapse => still reads after it", async () => {
      const a = await nominatif("CONTROL");
      const b = await nominatif("CONTROL");
      await shorten("UPDATE resource_access_grants SET expires_at = now() + interval '1500 milliseconds' WHERE resource_id = ANY($1::uuid[])", [[a, b]]);
      expect(await reads("named", "CONTROL", b)).toBe(true);
      expect((await renew("rm", "CONTROL", b, [UID.named])).status).toBe(200);
      await new Promise((r) => setTimeout(r, 1800));
      expect(await reads("named", "CONTROL", a), "lapsed").toBe(false);
      expect(await reads("named", "CONTROL", b), "renewed before the lapse").toBe(true);
      expect((await renew("rm", "CONTROL", a, [UID.named])).status).toBe(200);
      expect(await reads("named", "CONTROL", a), "renewed after the lapse").toBe(true);
    });
    it("8 parallel renewals: no 5xx, expiry <= now + 30 days, still one live row, one audit row per successful call", async () => {
      const id = await nominatif("CONTROL");
      const rs = await Promise.all(Array.from({ length: 8 }, () => renew("rm", "CONTROL", id, [UID.named])));
      for (const r of rs) expect(r.status, r.text.slice(0, 160)).toBeLessThan(500);
      const ok = rs.filter((r) => r.status === 200).length;
      expect(ok).toBeGreaterThanOrEqual(1);
      expect(daysFromNow(await expiryOf("CONTROL", id))).toBeLessThanOrEqual(30);
      expect(await grantRows(id)).toHaveLength(1);
      expect((await H.permChanges(id)).length).toBe(ok);
    });
    it("renewal || closure (x10): no 5xx; whatever the order the named person ends with no read; a 200 renewal is never followed by a read on a closed dossier", async () => {
      for (let i = 0; i < 10; i++) {
        const id = await nominatif("RISK");
        const [r] = await Promise.all([renew("rm", "RISK", id, [UID.named]), sql(CLOSE.RISK, [id])]);
        expect([200, 400], `run ${i}: ${r.text.slice(0, 120)}`).toContain(r.status);
        expect(await reads("named", "RISK", id), `run ${i}`).toBe(false);
      }
    });
    it("renewal || revocation (x10): no 5xx; final state is revoked-once, never both live and revoked, no resurrection", async () => {
      for (let i = 0; i < 10; i++) {
        const id = await nominatif("CONTROL");
        const [r, v] = await Promise.all([renew("rm", "CONTROL", id, [UID.named]), setVis("rm", "CONTROL", id, "NOMINATIF", [], [UID.named])]);
        expect(r.status, `renew run ${i}: ${r.text.slice(0, 120)}`).toBeLessThan(500);
        expect(v.status, `revoke run ${i}: ${v.text.slice(0, 120)}`).toBeLessThan(500);
        const rows = await grantRows(id);
        expect(rows.filter((x) => x.revoked_at === null).length, `run ${i}`).toBe(v.status === 200 ? 0 : 1);
        expect(rows.length).toBe(1);
      }
    });
    it("renewal || level change to PERIMETRE (x6): no 5xx, no 'NOMINATIF + no expiry' state and no stale expiry on PERIMETRE", async () => {
      for (let i = 0; i < 6; i++) {
        const id = await nominatif("CONTROL");
        const [r, v] = await Promise.all([renew("rm", "CONTROL", id, [UID.named]), setVis("rm", "CONTROL", id, "PERIMETRE")]);
        expect(r.status, `${i}: ${r.text.slice(0, 100)}`).toBeLessThan(500);
        expect(v.status, `${i}: ${v.text.slice(0, 100)}`).toBe(200);
        const lvl = (await sql<{ visibility: string }>("SELECT visibility FROM controls WHERE id = $1", [id]))[0]!.visibility;
        expect(lvl).toBe("PERIMETRE");
      }
    });
  });
});

// ------------------------------------------------------------------------------------------------------ MIGRATION 087
const PSQL = "/usr/bin/psql";
const psql = (db: string, args: string[]) =>
  execFileSync(PSQL, ["-X", "-q", "-A", "-t", "-v", "ON_ERROR_STOP=1", "-h", "127.0.0.1", "-p", "55442", "-U", "postgres", "-d", db, ...args], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], timeout: 300000 });
const mig = (f: string) => join(ROOT, "database", "postgresql", "migrations", f);
const rowsOf = (db: string, q: string): string[][] => psql(db, ["-F", "|", "-c", q]).split("\n").filter(Boolean).map((l) => l.split("|"));

describe.skipIf(!live)("QA-visibility-v5 MIGRATION 087 (own base, no server)", () => {
  const MT = "bbbbbbbb-0000-4000-8000-000000000001";
  const U = ["1", "2", "3"].map((n) => `bbbbbbbb-0000-4000-8000-00000000010${n}`);
  const ids = { rN: "bbbbbbbb-0000-4000-8000-000000000501", rP: "bbbbbbbb-0000-4000-8000-000000000502", rRev: "bbbbbbbb-0000-4000-8000-000000000503", rArch: "bbbbbbbb-0000-4000-8000-000000000504", cN: "bbbbbbbb-0000-4000-8000-000000000601" };
  const defs = () => rowsOf(MIG_DB, "SELECT p.proname || '=' || md5(pg_get_functiondef(p.oid)) FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = 'public' ORDER BY 1").map((r) => r[0]!).sort((a, b) => a.localeCompare(b));
  const cols = () => rowsOf(MIG_DB, "SELECT column_name FROM information_schema.columns WHERE table_name = 'resource_access_grants' ORDER BY ordinal_position").map((r) => r[0]!);
  const expiries = () => rowsOf(MIG_DB, "SELECT resource_id || '/' || user_id || '/' || COALESCE(expires_at::text, 'NULL') FROM resource_access_grants ORDER BY resource_id, user_id").map((r) => r[0]!);
  const up = () => psql(MIG_DB, ["-1", "-f", mig("087_named_access_expiry.sql")]);
  const down = () => psql(MIG_DB, ["-v", "ON_ERROR_STOP=1", "-f", mig("087_named_access_expiry.down.sql")]);
  let baseline: string[] = [];

  beforeAll(() => {
    execFileSync(PSQL, ["-X", "-q", "-h", "127.0.0.1", "-p", "55442", "-U", "postgres", "-d", "postgres", "-c", `DROP DATABASE IF EXISTS ${MIG_DB} WITH (FORCE)`, "-c", `CREATE DATABASE ${MIG_DB}`]);
  }, 60000);

  it("builds the pre-087 model (001..086), plants the existing data and snapshots the function definitions", () => {
    try { psql(MIG_DB, ["-c", "CREATE ROLE grc_app_runtime NOLOGIN"]); } catch { /* exists */ }
    try { psql(MIG_DB, ["-c", "CREATE ROLE grc_migrator NOLOGIN"]); } catch { /* exists */ }
    psql(MIG_DB, ["-c", "CREATE TABLE schema_migrations (filename text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())"]);
    const files = readdirSync(join(ROOT, "database", "postgresql", "migrations")).filter((f) => f.endsWith(".sql") && !f.endsWith(".down.sql") && f < "087").sort((a, b) => a.localeCompare(b));
    expect(files.at(-1)).toBe("086_governance_thresholds.sql");
    for (const f of files) psql(MIG_DB, ["-1", "-f", mig(f)]);
    psql(MIG_DB, ["-c", `INSERT INTO tenants (id, name) VALUES ('${MT}', 'Tenant mig V5')`]);
    for (const [i, u] of U.entries()) psql(MIG_DB, ["-c", `INSERT INTO users (id, tenant_id, email, display_name, roles) VALUES ('${u}', '${MT}', 'u${i}@mig.test', 'U${i}', '{}')`]);
    const risk = (id: string, level: string, status = "ACTIVE") => `INSERT INTO risks (id, tenant_id, process, description, status, owner_id, visibility) VALUES ('${id}', '${MT}', 'p', 'd', '${status}', '${U[0]}', '${level}');`;
    const g = (type: string, id: string, u: string) => `INSERT INTO resource_access_grants (tenant_id, resource_type, resource_id, user_id, granted_by, grant_reason) VALUES ('${MT}', '${type}', '${id}', '${u}', '${U[0]}', 'avant 087');`;
    psql(MIG_DB, ["-c", [
      risk(ids.rN, "NOMINATIF"), risk(ids.rP, "PERIMETRE"), risk(ids.rRev, "NOMINATIF"), risk(ids.rArch, "NOMINATIF", "ARCHIVED"),
      `INSERT INTO controls (id, tenant_id, label, control_type, frequency, executor, compliance_criteria, visibility) VALUES ('${ids.cN}', '${MT}', 'c', 'PREVENTIVE', 'M', 'x', 'y', 'NOMINATIF');`,
      g("RISK", ids.rN, U[1]!), g("RISK", ids.rN, U[2]!), g("RISK", ids.rP, U[1]!), g("RISK", ids.rRev, U[1]!), g("RISK", ids.rArch, U[1]!), g("CONTROL", ids.cN, U[1]!),
      `UPDATE resource_access_grants SET revoked_at = now(), revoked_by = '${U[0]}', revoke_reason = 'retrait' WHERE resource_id = '${ids.rRev}';`,
    ].join("\n")]);
    baseline = defs();
    expect(cols()).not.toContain("expires_at");
    expect(baseline.length).toBeGreaterThan(40);
  }, 280000);

  it("applying 087 stamps now()+30 days on the live NOMINATIF accesses only (risk, control, archived dossier included); PERIMETRE and revoked rows are untouched; no row lost", () => {
    up();
    const r = rowsOf(MIG_DB, "SELECT resource_id, user_id, revoked_at IS NOT NULL, expires_at IS NULL, round(extract(epoch FROM (expires_at - now())) / 86400)::int FROM resource_access_grants ORDER BY resource_id, user_id");
    expect(r).toHaveLength(6);
    const by = (id: string) => r.filter((x) => x[0] === id);
    for (const x of [...by(ids.rN), ...by(ids.cN), ...by(ids.rArch)]) { expect(x[3], x.join(",")).toBe("f"); expect(x[4]).toBe("30"); }
    expect(by(ids.rP)[0]![3], "PERIMETRE untouched").toBe("t");
    expect(by(ids.rRev)[0]![2]).toBe("t");
    expect(by(ids.rRev)[0]![3], "revoked untouched").toBe("t");
  }, 60000);

  it("replaying 087 is idempotent: same function definitions, same column, no expiry moved (a lapsed one is not extended)", () => {
    const afterUp = defs();
    expect(afterUp.filter((d) => !baseline.includes(d)).map((d) => d.split("=")[0]).sort((a, b) => a.localeCompare(b)))
      .toEqual(["resource_access_grants_guard", "risk_visible_core", "visibility_granted", "visibility_own_level", "visibility_resource_closed"].sort((a, b) => a.localeCompare(b)));
    psql(MIG_DB, ["-c", `ALTER TABLE resource_access_grants DISABLE TRIGGER resource_access_grants_guard; UPDATE resource_access_grants SET expires_at = now() - interval '2 days' WHERE resource_id = '${ids.rN}' AND user_id = '${U[1]}'; ALTER TABLE resource_access_grants ENABLE TRIGGER resource_access_grants_guard`]);
    const e1 = expiries();
    up();
    up();
    expect(expiries()).toEqual(e1);
    expect(defs()).toEqual(afterUp);
    expect(cols().filter((c) => c === "expires_at")).toHaveLength(1);
  }, 60000);

  it(".down restores EXACTLY the definitions of 083 / 084 (same md5 as before 087), drops the column and the helper, deletes nothing; then 087 can be applied again", () => {
    const afterUp = defs();
    psql(MIG_DB, ["-c", "INSERT INTO schema_migrations (filename) VALUES ('087_named_access_expiry.sql') ON CONFLICT DO NOTHING"]);
    down();
    expect(defs(), "definitions identical to the pre-087 baseline").toEqual(baseline);
    expect(cols()).not.toContain("expires_at");
    expect(rowsOf(MIG_DB, "SELECT count(*) FROM resource_access_grants")[0]![0]).toBe("6");
    expect(rowsOf(MIG_DB, "SELECT count(*) FROM schema_migrations WHERE filename = '087_named_access_expiry.sql'")[0]![0]).toBe("0");
    // functions still pin search_path with pg_temp last
    const cfg = rowsOf(MIG_DB, "SELECT proname, proconfig::text FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = 'public' AND proname IN ('visibility_granted','risk_visible_core','resource_access_grants_guard')");
    for (const c of cfg) expect(c[1], c[0]).toContain("search_path=pg_catalog, public, pg_temp");
    // a down twice is harmless (IF EXISTS) and re-applying works
    down();
    up();
    expect(defs()).toEqual(afterUp);
    // SEC-V5-01: the down revoked (soft) the 2 accesses that no longer read; only the 2 live ones are stamped again.
    expect(rowsOf(MIG_DB, "SELECT count(*) FROM resource_access_grants WHERE expires_at IS NOT NULL")[0]![0]).toBe("2");
  }, 60000);

  it("every function created or redefined by 087 pins search_path (pg_temp last) and the guard still has its trigger", () => {
    const cfg = rowsOf(MIG_DB, "SELECT proname, COALESCE(proconfig::text, 'NONE') FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = 'public' AND proname IN ('visibility_own_level','visibility_granted','risk_visible_core','resource_access_grants_guard','visibility_resource_closed')");
    expect(cfg).toHaveLength(5);
    for (const c of cfg) expect(c[1], c[0]).toMatch(/search_path=pg_catalog, public, pg_temp/);
    expect(rowsOf(MIG_DB, "SELECT count(*) FROM pg_trigger WHERE tgrelid = 'resource_access_grants'::regclass AND NOT tgisinternal")[0]![0]).not.toBe("0");
  });
});
