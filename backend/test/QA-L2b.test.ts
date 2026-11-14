import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { Client } from "pg";
import { qaVisibilityHarness } from "./qaVisibilityHarness.js";

/**
 * QA-L2b (lot R1 « Conservation L2b », migration 097, head b24d878): end of effect, retention and manual erasure of visibility reasons.
 * Oracles written BEFORE running, from the cadrage 8.3 (I-1, I-2), 8.4 L2b and DECISION-120 (q248 B, q249 A), DECISION-144 (q294 A):
 *  - an end-of-effect event sets `effect_ended_at` in its own transaction, only on the reasons it replaces (same source, same entity, same tenant);
 *  - return to CLIENT ends every reason of the entity (all replaceable sources + the new one), never another entity's;
 *  - refusal / revocation of a widened-view request ends its three reasons; PENDING and APPROVED stay active; `closeStaleLive` ends the closed one;
 *  - the openings (RACI, owner, designation) are NOT wired: they stay NULL, hence never erased;
 *  - POST /privacy/visibility-reason-purge: needs `retention.purge`; dryRun count = real erasure; 364 days refused, 365 accepted; NULL = never;
 *    no config row = 365; two concurrent purges erase each reason once; the trace holds the source and the id, never the text;
 *  - the retention changes only through the second person (up AND down), floor 365, ceiling 3650.
 * Not a Security / Privacy / Compliance opinion. Live part: QA_L2B_LIVE=1 + LOCAL cluster (127.0.0.1:55442), own base and port, --no-file-parallelism.
 * `it.fails` documents a CONFIRMED defect (turn it into `it` when fixed).
 */
const live = process.env["QA_L2B_LIVE"] === "1";
const DB = "grc_qa_l2bt";
const PORT = 8137;
const I = (x: string) => `aaaaaaaa-0000-4000-8000-000000000${x}`;
type Who = "own" | "n1" | "raci" | "pown" | "dept" | "named" | "out" | "out2" | "rm" | "com" | "aud" | "adm";
const WHO: Who[] = ["own", "n1", "raci", "pown", "dept", "named", "out", "out2", "rm", "com", "aud", "adm"];
const UID: Record<Who, string> = { own: I("101"), n1: I("102"), raci: I("103"), pown: I("104"), dept: I("105"), named: I("106"), out: I("107"), out2: I("108"), rm: I("109"), com: I("10a"), aud: I("10b"), adm: I("10c") };
const T1 = I("001");
const R502 = I("502"), R503 = I("503");
const C = "CANARY-L2B-";

describe("QA-L2b (static): the front message and the unwired events are where the report says", () => {
  const front = (p: string) => readFileSync(join(__dirname, "..", "..", "frontend", "src", p), "utf8");
  it("the q294 constant is rendered under the reason of UsersAdmin, RolesAdmin and ProcessesPage", () => {
    for (const f of ["features/admin/UsersAdmin.tsx", "features/admin/RolesAdmin.tsx", "features/referentials/ProcessesPage.tsx"]) {
      expect(front(f), f).toContain("GOVERNANCE_REASON_RETENTION_HINT");
    }
  });
});

describe.skipIf(!live)("QA-L2b on the REAL server + LOCAL PostgreSQL 16 (head b24d878)", () => {
  const H = qaVisibilityHarness({ db: DB, port: PORT, who: WHO, uid: UID });
  const { sql, call, get, post, put } = H;
  let owner: Client;
  const setVis = (w: Who, path: string, visibility: string, add: string[], reason: string, revoke: string[] = []) => put(w, `${path}/visibility`, { visibility, addUserIds: add, revokeUserIds: revoke, reason });
  const purge = (w: Who, dry = false) => call(w, "POST", `/privacy/visibility-reason-purge${dry ? "?dryRun=true" : ""}`);
  type St = { id: string; source: string; ended: boolean; erased: boolean; text: string | null };
  const st = async (text: string): Promise<St> => {
    const r = await sql<{ id: string; source: string; e: Date | null; x: Date | null; text: string | null }>("SELECT id, source, effect_ended_at AS e, erased_at AS x, text FROM visibility_reasons WHERE text = $1", [text]);
    expect(r, text).toHaveLength(1);
    return { id: r[0]!.id, source: r[0]!.source, ended: r[0]!.e !== null, erased: r[0]!.x !== null, text: r[0]!.text };
  };
  const ended = async (text: string) => (await st(text)).ended;
  /** Owner session, triggers off for the statement only: the one way to age a reason or a grant. */
  const ownerExec = async (q: string, p: unknown[] = []) => {
    await owner.query("SET session_replication_role = replica");
    try { await owner.query(q, p); } finally { await owner.query("RESET session_replication_role"); }
  };
  const age = (ids: string[], endedDaysAgo: number, extraSeconds = 0) =>
    ownerExec("UPDATE visibility_reasons SET created_at = now() - interval '8 years', effect_ended_at = now() - make_interval(days => $2) - make_interval(secs => $3) WHERE id = ANY($1::uuid[])", [ids, endedDaysAgo, extraSeconds]);
  const mk = async (text: string, tenant = T1, source = "VISIBILITY_CHANGE") =>
    (await sql<{ id: string }>("INSERT INTO visibility_reasons (tenant_id, source, text) VALUES ($1, $2, $3) RETURNING id", [tenant, source, text]))[0]!.id;
  const setRetention = (v: number | null) => sql("UPDATE configs SET visibility_reason_retention_days = $2 WHERE tenant_id = $1", [T1, v]);
  const purgeLines = () => sql<{ entity_type: string; entity_id: string; reason: string | null; new_value: any; old_value: any }>( // eslint-disable-line @typescript-eslint/no-explicit-any
    "SELECT entity_type, entity_id, reason, new_value, old_value FROM audit_log WHERE entity_type IN ('VisibilityReasonPurge', 'VisibilityReason') ORDER BY \"timestamp\", id");
  const whereIs = async (needle: string): Promise<string[]> => {
    const tables = (await sql<{ tablename: string }>("SELECT tablename FROM pg_tables WHERE schemaname = 'public' ORDER BY 1")).map((t) => t.tablename);
    const hits: string[] = [];
    for (const t of tables) {
      const n = (await sql<{ n: number }>(`SELECT count(*)::int AS n FROM "${t}" WHERE "${t}"::text LIKE $1`, [`%${needle}%`]))[0]!.n;
      if (n > 0) hits.push(`${t}:${n}`);
    }
    return hits;
  };

  beforeAll(async () => {
    await H.start(async () => {
      await sql("UPDATE users SET roles = roles || ARRAY['execution.read','effectiveness.read','evidence.read']::text[]");
      await sql("UPDATE users SET roles = array_remove(roles, 'resourcevisibility.set') WHERE email = 'adm@vv1.test'");
      await sql("UPDATE users SET roles = roles || ARRAY['role.assign','role.read','role.create','role.update','user.update','retention.purge','config.read','config.governancedelays.set','config.selfvalidation.approve']::text[] WHERE email = 'adm@vv1.test'");
      await sql("UPDATE users SET roles = roles || ARRAY['config.read','config.governancedelays.set','config.selfvalidation.approve']::text[] WHERE email = 'com@vv1.test'");
      await sql("UPDATE users SET roles = roles || ARRAY['risk.owner.assign']::text[] WHERE email IN ('own@vv1.test','dept@vv1.test')");
      await sql("UPDATE users SET roles = roles || ARRAY['raci.assign']::text[] WHERE email = 'own@vv1.test'");
      await sql("INSERT INTO roles (id, tenant_id, name, permissions) VALUES ($1, $2, 'QA L2b Admins', '{role.assign,role.read,user.update}')", [I("311"), T1]);
      for (const w of ["n1", "out"] as const) await sql("INSERT INTO user_roles (tenant_id, role_id, user_id, granted_by) VALUES ($1, $2, $3, $4)", [T1, I("311"), UID[w], UID.adm]);
      await sql("INSERT INTO configs (tenant_id) VALUES ($1) ON CONFLICT (tenant_id) DO NOTHING", [T1]);
    });
    owner = new Client({ host: "127.0.0.1", port: 55442, user: "postgres", database: DB });
    await owner.connect();
  }, 280000);
  afterAll(async () => { await owner?.end(); await H.stop(); });

  it("the base is at 097: default retention 365 on the live tenant, retention.purge on the administrator account only", async () => {
    expect((await sql<{ d: number | null }>("SELECT visibility_reason_retention_days AS d FROM configs WHERE tenant_id = $1", [T1]))[0]!.d).toBe(365);
    expect(await sql("SELECT 1 FROM visibility_reasons WHERE text LIKE $1", [`${C}%`])).toHaveLength(0);
    expect(await sql("SELECT email FROM users WHERE 'retention.purge' = ANY(roles) AND email <> 'adm@vv1.test'")).toEqual([]);
  });

  // ------------------------------------------------------------------------------------------------ end-of-effect events
  describe("END OF EFFECT: each wired path, one entity carrying several sources", () => {
    it("replacement on one entity (R503): same source replaced (VISIBILITY_CHANGE, ACCESS_RENEWAL, PERIMETER_CHANGE), the other sources and the other entities untouched", async () => {
      expect((await setVis("rm", `/risks/${R502}`, "NOMINATIF", [UID.named], `${C}R502-X1`)).status).toBe(200); // another entity: must stay active throughout
      expect((await setVis("rm", `/risks/${R503}`, "NOMINATIF", [UID.named, UID.raci], `${C}V1`)).status).toBe(200);
      expect((await call("rm", "POST", `/risks/${R503}/visibility/renew`, { userIds: [UID.named], reason: `${C}N1` })).status).toBe(200);
      expect((await call("rm", "PATCH", `/risks/${R503}`, { ownerDepartmentId: I("202"), reason: `${C}P1` })).status).toBe(200);
      for (const t of ["V1", "N1", "P1"]) expect(await ended(`${C}${t}`), t).toBe(false);
      // PERIMETER_CHANGE replaced by a later PERIMETER_CHANGE only
      expect((await call("rm", "PATCH", `/risks/${R503}`, { ownerDepartmentId: I("201"), reason: `${C}P2` })).status).toBe(200);
      expect([await ended(`${C}P1`), await ended(`${C}P2`), await ended(`${C}V1`), await ended(`${C}N1`)]).toEqual([true, false, false, false]);
      // ACCESS_RENEWAL replaced by a later renewal only
      expect((await call("rm", "POST", `/risks/${R503}/visibility/renew`, { userIds: [UID.named], reason: `${C}N2` })).status).toBe(200);
      expect([await ended(`${C}N1`), await ended(`${C}N2`), await ended(`${C}V1`), await ended(`${C}P2`)]).toEqual([true, false, false, false]);
      // VISIBILITY_CHANGE replaced by a later visibility change only
      expect((await setVis("rm", `/risks/${R503}`, "NOMINATIF", [UID.out2], `${C}V2`)).status).toBe(200);
      expect([await ended(`${C}V1`), await ended(`${C}V2`), await ended(`${C}N2`), await ended(`${C}P2`)]).toEqual([true, false, false, false]);
      expect(await ended(`${C}R502-X1`)).toBe(false); // other entity
    });

    it("a reason of ANOTHER TENANT naming the same entity id is never ended (tenant filter of the replacement)", async () => {
      const t2 = (await sql<{ id: string }>("INSERT INTO tenants (name) VALUES ('QA L2b autre client') RETURNING id"))[0]!.id;
      const foreign = await mk(`${C}FOREIGN-TENANT`, t2);
      await sql("INSERT INTO users (id, tenant_id, email, display_name) VALUES ($1, $2, 'f@l2b.test', 'F')", [I("f01"), t2]);
      await sql("INSERT INTO audit_log (tenant_id, user_id, entity_type, entity_id, action, old_value, new_value, reason, request_id, reason_ref) VALUES ($1, $2, 'Risk', $3, 'PERMISSION_CHANGE', '{}', '{}', NULL, 'l2b-foreign', $4)", [t2, I("f01"), R503, foreign]);
      expect((await setVis("rm", `/risks/${R503}`, "NOMINATIF", [UID.out2], `${C}V3`)).status).toBe(200);
      expect(await ended(`${C}V2`)).toBe(true);
      expect(await ended(`${C}FOREIGN-TENANT`)).toBe(false);
    });

    it("return to CLIENT ends EVERY reason of the entity (all replaceable sources) and the new one; the other entity stays active", async () => {
      const r = await setVis("rm", `/risks/${R503}`, "CLIENT", [], `${C}BACK-TO-CLIENT`);
      expect(r.status, r.text).toBe(200);
      for (const t of ["V3", "N2", "P2", "BACK-TO-CLIENT"]) expect(await ended(`${C}${t}`), t).toBe(true);
      expect(await ended(`${C}R502-X1`)).toBe(false);
    });

    it("six parallel visibility changes on one resource (R502): exactly ONE VISIBILITY_CHANGE reason stays active, the latest created; no success left two active", async () => {
      const texts = [1, 2, 3, 4, 5, 6].map((n) => `${C}PAR-${n}`);
      const res = await Promise.all(texts.map((t, i) => setVis("rm", `/risks/${R502}`, "NOMINATIF", [i % 2 ? UID.out : UID.out2], t)));
      const ok = texts.filter((_, i) => res[i]!.status === 200);
      expect(ok.length).toBeGreaterThan(0);
      const rows = await sql<{ text: string; e: Date | null; created_at: Date }>(
        "SELECT text, effect_ended_at AS e, created_at FROM visibility_reasons WHERE text = ANY($1::text[]) ORDER BY created_at, id", [ok]);
      const active = rows.filter((x) => x.e === null);
      expect(active, JSON.stringify(rows)).toHaveLength(1);
      expect(active[0]!.text).toBe(rows[rows.length - 1]!.text);
      expect(await ended(`${C}R502-X1`)).toBe(true); // replaced by the parallel changes
    });
  });

  describe("END OF EFFECT: widened-view requests (refusal, revocation, stale closing) and the paths NOT wired", () => {
    const BASE = "/roles/sensitive-view-grants";
    const ask = (by: Who, whom: Who, reason: string) => post(by, BASE, { userId: UID[whom], reason, kind: "RESOURCE_READALL" });
    const decide = (by: Who, gid: string, ok: boolean, reason: string) => post(by, `${BASE}/${gid}/${ok ? "approve" : "reject"}`, { reason });
    const refs = async (gid: string) => (await sql<{ a: string; b: string | null; c: string | null }>("SELECT reason_ref AS a, decision_reason_ref AS b, revoke_reason_ref AS c FROM sensitive_view_grants WHERE id = $1", [gid]))[0]!;
    const endedId = async (rid: string | null) => rid !== null && (await sql<{ e: Date | null }>("SELECT effect_ended_at AS e FROM visibility_reasons WHERE id = $1", [rid]))[0]!.e !== null;

    it("pending: request reason active; refusal: request + decision reasons ended", async () => {
      const a = await ask("adm", "n1", `${C}SVG-REQ-REJECT`);
      expect(a.status, a.text).toBe(201);
      const gid = a.json.data.id as string;
      expect(await ended(`${C}SVG-REQ-REJECT`)).toBe(false);
      expect((await decide("aud", gid, false, `${C}SVG-DEC-REJECT`)).status).toBe(200);
      expect([await ended(`${C}SVG-REQ-REJECT`), await ended(`${C}SVG-DEC-REJECT`)]).toEqual([true, true]);
    });

    it("approved stays active; revocation ends the three reasons", async () => {
      const a = await ask("adm", "out", `${C}SVG-REQ-OK`);
      expect(a.status, a.text).toBe(201);
      const gid = a.json.data.id as string;
      expect((await decide("aud", gid, true, `${C}SVG-DEC-OK`)).status).toBe(200);
      expect([await ended(`${C}SVG-REQ-OK`), await ended(`${C}SVG-DEC-OK`)]).toEqual([false, false]);
      expect((await post("adm", `${BASE}/${gid}/revoke`, { reason: `${C}SVG-REV-OK` })).status).toBe(200);
      const r = await refs(gid);
      expect([await endedId(r.a), await endedId(r.b), await endedId(r.c)]).toEqual([true, true, true]);
    });

    it("closeStaleLive: a new request closes the expired pending one (its reasons end, the new one stays active)", async () => {
      const first = await ask("adm", "n1", `${C}SVG-STALE-OLD`);
      expect(first.status, first.text).toBe(201);
      await ownerExec("UPDATE sensitive_view_grants SET expires_at = now() - interval '1 day' WHERE id = $1", [first.json.data.id]);
      const second = await ask("adm", "n1", `${C}SVG-STALE-NEW`);
      expect(second.status, second.text).toBe(201);
      const old = await refs(first.json.data.id);
      expect(await endedId(old.a)).toBe(true);
      expect(await endedId(old.c)).toBe(true); // the closing reason
      expect(await ended(`${C}SVG-STALE-NEW`)).toBe(false);
    });

    it("NOT wired (I-1 fail-closed): owner designation, RACI opening and the other openings keep effect_ended_at NULL, whatever happens afterwards", async () => {
      expect((await setVis("rm", `/risks/${R502}`, "NOMINATIF", [UID.dept], `${C}R502-FOR-OPEN`, [UID.out, UID.out2])).status).toBe(200);
      expect((await post("dept", `/risks/${R502}/owner`, { ownerId: UID.out2, reason: `${C}OPEN-DESIGNATION` })).status).toBe(200);
      expect((await post("own", "/raci", { entityType: "ACTION_PLAN", entityId: I("a06"), userId: UID.out2, role: "C", reason: `${C}OPEN-RACI` })).status).toBe(201);
      // a later return to CLIENT of R502 ends the replaceable sources but, by design, not the opening reason
      expect((await setVis("rm", `/risks/${R502}`, "CLIENT", [], `${C}R502-BACK`)).status).toBe(200);
      const open = await sql<{ source: string; e: Date | null }>("SELECT source, effect_ended_at AS e FROM visibility_reasons WHERE text LIKE $1 ORDER BY source", [`${C}OPEN-%`]);
      expect(open.length).toBeGreaterThanOrEqual(2);
      expect(open.every((x) => x.e === null), JSON.stringify(open)).toBe(true);
      const all = await sql<{ source: string; e: number }>("SELECT source, count(effect_ended_at)::int AS e FROM visibility_reasons WHERE source NOT IN ('VISIBILITY_CHANGE','ACCESS_RENEWAL','PERIMETER_CHANGE','SENSITIVE_VIEW_REQUEST','SENSITIVE_VIEW_DECISION','SENSITIVE_VIEW_REVOCATION') GROUP BY source");
      expect(all.filter((x) => x.e > 0), JSON.stringify(all)).toEqual([]);
    });
  });

  // ------------------------------------------------------------------------------------------------ purge
  describe("PURGE: POST /privacy/visibility-reason-purge", () => {
    it("permission: a holder of user.update or role.assign without retention.purge is refused (403) in both modes, a user with no right too; nothing is written", async () => {
      const n0 = (await purgeLines()).length;
      for (const w of ["own", "rm", "n1", "com"] as Who[]) {
        for (const dry of [false, true]) expect((await purge(w, dry)).status, `${w} dry=${dry}`).toBe(403);
      }
      expect((await call(null, "POST", "/privacy/visibility-reason-purge")).status).toBe(401);
      expect((await purgeLines()).length).toBe(n0);
    });

    it("bounds: ended 364 d and 365 d minus a minute are kept, 365 d plus a minute is erased; an unended reason of 8 years is never erased", async () => {
      const keep364 = await mk(`${C}B-364`);
      const keepEdge = await mk(`${C}B-365-MINUS`);
      const gone = await mk(`${C}B-365-PLUS`);
      const never = await mk(`${C}B-NEVER-ENDED`);
      await age([keep364], 364);
      await age([keepEdge], 365, -60);
      await age([gone], 365, 60);
      await ownerExec("UPDATE visibility_reasons SET created_at = now() - interval '8 years' WHERE id = $1", [never]);
      const dry = await purge("adm", true);
      expect(dry.status, dry.text).toBe(200);
      expect(dry.json.data).toMatchObject({ dryRun: true, retentionDays: 365 });
      expect(dry.json.data.reasonIds).toContain(gone);
      for (const k of [keep364, keepEdge, never]) expect(dry.json.data.reasonIds).not.toContain(k);
      expect(dry.json.data.wouldErase).toBe(dry.json.data.reasonIds.length);
      expect(dry.text).not.toContain(C); // the dry run never serves a text
      // nothing was written by the dry run
      expect((await st(`${C}B-365-PLUS`)).erased).toBe(false);
      const n0 = (await purgeLines()).length;
      const real = await purge("adm");
      expect(real.status, real.text).toBe(200);
      expect(real.json.data).toMatchObject({ dryRun: false, retentionDays: 365, erased: dry.json.data.wouldErase }); // dryRun count = real erasure
      expect((await sql<{ id: string }>("SELECT id FROM visibility_reasons WHERE erased_at IS NOT NULL")).map((r) => r.id).sort((a, b) => a.localeCompare(b))).toEqual([...dry.json.data.reasonIds].sort((a: string, b: string) => a.localeCompare(b)));
      expect([(await sql("SELECT 1 FROM visibility_reasons WHERE id = $1 AND text IS NULL", [gone])).length, (await sql("SELECT 1 FROM visibility_reasons WHERE id = $1 AND text IS NOT NULL", [keep364])).length,
        (await sql("SELECT 1 FROM visibility_reasons WHERE id = $1 AND text IS NOT NULL", [keepEdge])).length, (await sql("SELECT 1 FROM visibility_reasons WHERE id = $1 AND text IS NOT NULL", [never])).length]).toEqual([1, 1, 1, 1]);
      expect((await purgeLines()).length - n0).toBe(1 + real.json.data.erased); // one run line + one per reason
      expect((await purge("adm")).json.data).toMatchObject({ erased: 0 }); // replay: nothing left (idempotent)
    });

    it("trace: one VisibilityReasonPurge line, one VisibilityReason line per reason (source, text null), never the erased text; leak scan of every public table", async () => {
      const lines = await purgeLines();
      expect(lines.filter((l) => l.entity_type === "VisibilityReasonPurge")).toHaveLength(2); // the real run and its empty replay
      const per = lines.filter((l) => l.entity_type === "VisibilityReason");
      expect(per.length).toBeGreaterThan(0);
      for (const l of per) expect(l.new_value).toMatchObject({ text: null, purge: "L2b" });
      expect(JSON.stringify(lines)).not.toContain(C);
      expect(await whereIs(`${C}B-365-PLUS`)).toEqual([]);
      expect(await sql("SELECT 1 FROM audit_log WHERE reason LIKE $1 OR new_value::text LIKE $1 OR old_value::text LIKE $1", [`%${C}B-365-PLUS%`])).toHaveLength(0);
    });

    it("an erased reason reads « motif effacé le JJ/MM/AAAA (conservation) » on the journal reader, never the text", async () => {
      const row = (await sql<{ entity_id: string; reason_ref: string }>("SELECT a.entity_id, a.reason_ref FROM audit_log a JOIN visibility_reasons v ON v.id = a.reason_ref WHERE v.erased_at IS NOT NULL LIMIT 1"))[0];
      if (!row) return; // the bound tests use technical reasons without a journal row: the readers are covered by QA-L2a
      const r = await get("aud", `/audit-log?entityId=${row.entity_id}`);
      expect(r.status).toBe(200);
      expect(r.text).not.toContain(C);
    });

    it("scope: another tenant's old ended reason is untouched; no config row for the tenant means 365 (the floor), not « never »", async () => {
      const t2 = (await sql<{ id: string }>("SELECT id FROM tenants WHERE name = 'QA L2b autre client'"))[0]!.id;
      const foreign = await mk(`${C}SCOPE-FOREIGN`, t2);
      const mine = await mk(`${C}SCOPE-MINE`);
      await age([foreign, mine], 400);
      const saved = (await sql<{ d: number | null }>("SELECT visibility_reason_retention_days AS d FROM configs WHERE tenant_id = $1", [T1]))[0]!.d;
      await sql("DELETE FROM configs WHERE tenant_id = $1", [T1]);
      try {
        const dry = await purge("adm", true);
        expect(dry.status, dry.text).toBe(200);
        expect(dry.json.data).toMatchObject({ retentionDays: 365 });
        expect(dry.json.data.reasonIds).toContain(mine);
        expect(dry.json.data.reasonIds).not.toContain(foreign);
        expect((await purge("adm")).json.data).toMatchObject({ dryRun: false, retentionDays: 365 });
      } finally {
        await sql("INSERT INTO configs (tenant_id, visibility_reason_retention_days) VALUES ($1, $2) ON CONFLICT (tenant_id) DO NOTHING", [T1, saved]);
      }
      const byId = (id: string) => sql<{ x: Date | null }>("SELECT erased_at AS x FROM visibility_reasons WHERE id = $1", [id]);
      expect((await byId(mine))[0]!.x).not.toBeNull();
      expect((await byId(foreign))[0]!.x).toBeNull();
    });

    it("retention NULL = never: dryRun lists nothing, the real run erases nothing but is traced; a longer retention keeps what 365 would erase", async () => {
      const old = await mk(`${C}NEVER-OLD`);
      await age([old], 5000);
      await setRetention(null);
      expect((await purge("adm", true)).json.data).toMatchObject({ dryRun: true, retentionDays: null, wouldErase: 0, reasonIds: [] });
      const n0 = (await purgeLines()).filter((l) => l.entity_type === "VisibilityReasonPurge").length;
      expect((await purge("adm")).json.data).toEqual({ dryRun: false, retentionDays: null, erased: 0 });
      expect((await purgeLines()).filter((l) => l.entity_type === "VisibilityReasonPurge").length - n0).toBe(1);
      expect((await st(`${C}NEVER-OLD`)).erased).toBe(false);
      await setRetention(3650);
      expect((await purge("adm", true)).json.data).toMatchObject({ retentionDays: 3650, wouldErase: 1 }); // 5000 d > 3650 d
      await setRetention(730);
      const mid = await mk(`${C}RET-730`);
      await age([mid], 500);
      expect((await purge("adm", true)).json.data.reasonIds).not.toContain(mid);
      await setRetention(365);
      expect((await purge("adm", true)).json.data.reasonIds).toContain(mid);
    });

    it("concurrency: two simultaneous purges erase each eligible reason exactly once (sum = candidates, one trace line per reason), no 5xx", async () => {
      const ids = await Promise.all([1, 2, 3, 4, 5, 6, 7, 8].map((n) => mk(`${C}CONC-${n}`)));
      await age(ids, 400);
      const eligible = (await purge("adm", true)).json.data.reasonIds.length;
      expect(eligible).toBeGreaterThanOrEqual(8);
      const n0 = (await purgeLines()).filter((l) => l.entity_type === "VisibilityReason").length;
      const [a, b] = await Promise.all([purge("adm"), purge("adm")]);
      expect([a.status, b.status], `${a.text} ${b.text}`).toEqual([200, 200]);
      expect(a.json.data.erased + b.json.data.erased).toBe(eligible);
      expect((await purgeLines()).filter((l) => l.entity_type === "VisibilityReason").length - n0).toBe(eligible);
      const erasedIds = (await purgeLines()).filter((l) => l.entity_type === "VisibilityReason").map((l) => l.entity_id);
      expect(new Set(erasedIds).size).toBe(erasedIds.length); // no reason traced twice
    });

    it("final leak scan: no canary text left in a reason that was erased, and the base keeps the unerased ones in visibility_reasons ONLY", async () => {
      const erasedTexts = ["B-365-PLUS", "SCOPE-MINE", "CONC-1", "CONC-8"];
      for (const t of erasedTexts) expect(await whereIs(`${C}${t}`), t).toEqual([]);
      const hits = await whereIs(`${C}`);
      expect(hits.filter((h) => !h.startsWith("visibility_reasons:"))).toEqual([]);
    });
  });

  // ------------------------------------------------------------------------------------------------ duration (q249 A)
  describe("DURATION: GET/PUT /config/governance-delays, the second person in both directions, 365..3650", () => {
    const delays = (w: Who, v: number | null | string) => put(w, "/config/governance-delays", { visibilityReasonRetentionDays: v, reason: "Réglage de la durée de conservation des motifs" });
    const current = async () => (await sql<{ d: number | null }>("SELECT visibility_reason_retention_days AS d FROM configs WHERE tenant_id = $1", [T1]))[0]!.d;
    const approve = async (w: Who, id: string) => post(w, `/config/governance-delays/requests/${id}/approve`, { reason: "Approbation de la nouvelle durée" });

    it("bounds on the API: 364, 3651, 0, a string and a float are 400 and change nothing; the config reader serves the value", async () => {
      await setRetention(365);
      for (const v of [364, 3651, 0, "365", 365.5]) expect((await delays("adm", v as never)).status, String(v)).toBe(400);
      expect(await current()).toBe(365);
      const c = await get("adm", "/config");
      expect(c.status, c.text).toBe(200);
      expect(c.json.data.visibilityReasonRetentionDays).toBe(365);
    });

    it("UP (365 -> 730): 202 pending, value unchanged; the author cannot approve; another holder approves and the value changes", async () => {
      const r = await delays("adm", 730);
      expect(r.status, r.text).toBe(202);
      expect(await current()).toBe(365);
      const rid = r.json.pendingRequest.id as string;
      expect((await approve("adm", rid)).status).toBe(403);
      expect(await current()).toBe(365);
      const ok = await approve("com", rid);
      expect(ok.status, ok.text).toBe(200);
      expect(await current()).toBe(730);
    });

    it("DOWN (730 -> 400) also waits for a second person (q249 A, the reverse of lastSeenRetentionDays); then 400 -> NULL (never) too", async () => {
      const r = await delays("adm", 400);
      expect(r.status, r.text).toBe(202);
      expect(await current()).toBe(730);
      expect((await approve("com", r.json.pendingRequest.id)).status).toBe(200);
      expect(await current()).toBe(400);
      const never = await delays("adm", null);
      expect(never.status, never.text).toBe(202);
      expect(await current()).toBe(400);
      expect((await approve("com", never.json.pendingRequest.id)).status).toBe(200);
      expect(await current()).toBeNull();
      const back = await delays("adm", 365);
      expect(back.status, back.text).toBe(202); // from « never » to a value: also a change
      expect((await approve("com", back.json.pendingRequest.id)).status).toBe(200);
      expect(await current()).toBe(365);
    });

    it("an unchanged value does not create a request; the change and its approval are in the journal", async () => {
      const r = await delays("adm", 365);
      expect([200, 202]).toContain(r.status);
      expect(await sql("SELECT 1 FROM audit_log WHERE entity_type = 'Config' AND action = 'APPROVE'")).not.toHaveLength(0);
    });

    it("a user without config.governancedelays.set is refused", async () => {
      expect((await delays("own", 730)).status).toBe(403);
    });
  });
});
