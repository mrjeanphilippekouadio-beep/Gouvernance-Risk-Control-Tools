import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { join } from "node:path";
import { qaVisibilityHarness } from "./qaVisibilityHarness.js";

/**
 * QA-L2c (lot R1 "Conservation L2c", head 009b6b3 after SEC-L2C-01/02/04, no migration): yearly review of the active access
 * restrictions by the Risk Manager (q248 B, q269 A / DECISION-129: every 12 months, Risk Manager, late items signalled in the
 * health panel, nothing blocks). Oracles written BEFORE running, from the cadrage 8.4 L2c, CLAUDE.md and the coordinator's brief:
 *  - EVERY restricted resource is listed once its clock passes 12 months, whatever the way the restriction was put in place; the clock
 *    of a resource = max(last RM confirmation, start of the current restriction = last CLIENT -> restricted change, else creation);
 *    nothing else (renewal, designation, perimeter change, other motif) restarts it;
 *  - the review is reserved to the Risk Manager group (membership AND resourcevisibility.set), is written ON the resource as one audit
 *    row without any text or reference, never extends or erases, and a replay is a 404;
 *  - tenant-scoped, bounded list (50) with an exact total (without NOMINATIF for readers who do not see everything), no reason text anywhere.
 * Not a Security / Privacy / Compliance opinion. Live part: QA_L2C_LIVE=1 + LOCAL cluster (127.0.0.1:55442), own base grc_qa_l2ct and
 * own port 8124, run with --no-file-parallelism. `it.fails` documents a CONFIRMED defect (turn it into `it` when fixed).
 */
const SRC = join(__dirname, "..", "src");
const live = process.env["QA_L2C_LIVE"] === "1";
const DB = "grc_qa_l2ct";
const PORT = 8124;
const I = (x: string) => `aaaaaaaa-0000-4000-8000-000000000${x}`;
type Who = "own" | "n1" | "raci" | "pown" | "dept" | "named" | "out" | "out2" | "rm" | "com" | "aud" | "adm";
const WHO: Who[] = ["own", "n1", "raci", "pown", "dept", "named", "out", "out2", "rm", "com", "aud", "adm"];
const UID: Record<Who, string> = { own: I("101"), n1: I("102"), raci: I("103"), pown: I("104"), dept: I("105"), named: I("106"), out: I("107"), out2: I("108"), rm: I("109"), com: I("10a"), aud: I("10b"), adm: I("10c") };
const T1 = I("001");
const CANARY = "CANARY-L2C-SECRET-TEXT";
const TAG = "QA-L2C";

describe("QA-L2c (static): the code that reads and writes the review", () => {
  const repo = readFileSync(join(SRC, "infrastructure/database/postgres/PostgresVisibilityReviewRepository.ts"), "utf8");

  it("no physical DELETE and no UPDATE of any table, the confirmation locks the resource row and writes its audit through the same client", () => {
    expect(repo).not.toMatch(/DELETE\s+FROM/i);
    expect(repo).not.toMatch(/\bUPDATE\s+(public\.)?[a-z_]+\s+SET/i);
    expect(repo).toMatch(/FOR UPDATE/);
    expect(repo).toMatch(/insertAuditEvent\(client,/);
  });

  it("the 12-month period is one constant shared by the list, the confirmation and the panel", () => {
    expect(readFileSync(join(SRC, "domain/repositories/VisibilityReviewRepository.ts"), "utf8")).toMatch(/VISIBILITY_REVIEW_PERIOD_MONTHS\s*=\s*12/);
    expect(repo).toContain("VISIBILITY_REVIEW_PERIOD_MONTHS");
  });

  it("the resource type reaching SQL comes from a whitelist (route enum + table map), never from the client string", () => {
    expect(readFileSync(join(SRC, "api/v1/visibilityReviews.routes.ts"), "utf8")).toMatch(/z\.enum\(REVIEWABLE_TYPES\)/);
    expect(repo).toMatch(/const TABLE: Record<ReviewableType, string>/);
  });
});

describe.skipIf(!live)("QA-L2c on the REAL server + LOCAL PostgreSQL 16", () => {
  const H = qaVisibilityHarness({ db: DB, port: PORT, who: WHO, uid: UID });
  const { sql, call, get, put } = H;

  beforeAll(() => H.start(async () => {
    await sql("UPDATE users SET roles = roles || ARRAY['governancehealth.read','audit.read']::text[] WHERE email IN ('rm@vv1.test','com@vv1.test','aud@vv1.test','adm@vv1.test','out@vv1.test')");
    await sql("UPDATE users SET roles = roles || ARRAY['risk.owner.assign','control.create','anomaly.create']::text[] WHERE email IN ('rm@vv1.test','own@vv1.test')");
  }), 280000);
  afterAll(() => H.stop());

  type Item = { resourceType: string; resourceId: string; visibility: string; dueSince: string; everReviewed: boolean };
  const keyed = async (who: Who, method: string, path: string, body?: unknown) => {
    const r = await fetch(H.API + path, { method, headers: { "content-type": "application/json", authorization: `Bearer ${H.TOK[who]}`, "idempotency-key": randomUUID() }, body: body === undefined ? undefined : JSON.stringify(body) });
    const text = await r.text();
    return { status: r.status, text, json: JSON.parse(text) as { data: { id: string } } };
  };
  /** A risk of the test universe, restricted (or not), created `age` ago (interval text, null = now). */
  const risk = async (visibility = "NOMINATIF", age: string | null = null) =>
    (await sql<{ id: string }>(
      "INSERT INTO risks (tenant_id, process, description, visibility, owner_department_id, created_at) VALUES ($1, $2, $3, $4, $5, now() - coalesce($6::interval, interval '0')) RETURNING id",
      [T1, TAG, `${TAG} risk`, visibility, I("201"), age]))[0]!.id;
  /** A journal row on a risk, dated `age` ago. */
  const journal = (riskId: string, action: string, age: string, oldValue: unknown, newValue: unknown, reasonRef: string | null = null, tenant = T1) =>
    sql(`INSERT INTO audit_log (tenant_id, user_id, entity_type, entity_id, action, old_value, new_value, request_id, reason_ref, "timestamp")
         VALUES ($1, $2, 'Risk', $3, $4, $5, $6, 'qa-l2c', $7, now() - $8::interval)`, [tenant, UID.rm, riskId, action, JSON.stringify(oldValue), JSON.stringify(newValue), reasonRef, age]);
  const restrictedSince = (riskId: string, age: string, from = "CLIENT", to = "NOMINATIF") => journal(riskId, "PERMISSION_CHANGE", age, { visibility: from }, { visibility: to });
  const reviewedAgo = (riskId: string, age: string) => journal(riskId, "UPDATE", age, { lastReviewedAt: null }, { event: "VISIBILITY_REVIEW" });
  const panel = async (who: Who = "rm") => {
    const r = await get(who, "/governance-health");
    expect(r.status, r.text).toBe(200);
    return { body: r.text, v: r.json.data.visibilityReview as { periodMonths: number; total: number | { belowThreshold: true }; canConfirm: boolean; items: Item[] } };
  };
  const ids = async (who: Who = "rm") => new Set((await panel(who)).v.items.map((i) => i.resourceId));
  const confirm = (who: Who | null, type: string, id: string) => call(who, "POST", `/visibility-reviews/${type}/${id}/confirm`);
  const reviews = (id: string) => sql<{ user_id: string; entity_type: string; action: string; reason: string | null; reason_ref: string | null; old_value: any; new_value: any }>( // eslint-disable-line @typescript-eslint/no-explicit-any
    "SELECT user_id, entity_type, action, reason, reason_ref, old_value, new_value FROM audit_log WHERE entity_id = $1 AND new_value->>'event' = 'VISIBILITY_REVIEW' ORDER BY \"timestamp\"", [id]);
  const reset = () => sql("UPDATE risks SET deleted_at = now() WHERE process = $1 AND deleted_at IS NULL", [TAG]);

  it("the data set is what the oracles assume: nothing due yet, rm may confirm", async () => {
    const { v } = await panel();
    expect(v.periodMonths).toBe(12);
    expect(v.total).toBe(0);
    expect(v.canConfirm).toBe(true);
  });

  describe("NOMINAL and TEXT: list, confirm, audit on the resource", () => {
    it("lists a restricted risk created 13 months ago, drops it after Confirm; no text anywhere; one audit row ON the resource", async () => {
      const motif = (await sql<{ id: string }>("INSERT INTO visibility_reasons (tenant_id, source, text) VALUES ($1, 'VISIBILITY_CHANGE', $2) RETURNING id", [T1, CANARY]))[0]!.id;
      const id = await risk("NOMINATIF", "13 months");
      await journal(id, "PERMISSION_CHANGE", "13 months", { visibility: "NOMINATIF" }, { visibility: "NOMINATIF" }, motif); // a motif exists, but is not the clock
      const before = await panel();
      expect(before.v.total).toBe(1);
      expect(before.v.items).toHaveLength(1);
      expect(before.v.items[0]).toMatchObject({ resourceType: "RISK", resourceId: id, visibility: "NOMINATIF", everReviewed: false });
      expect(before.v.items[0]!.dueSince).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(Object.keys(before.v.items[0]!).sort((a, b) => a.localeCompare(b))).toEqual(["dueSince", "everReviewed", "resourceId", "resourceType", "visibility"]);
      expect(before.body).not.toContain(CANARY);

      const r = await confirm("rm", "RISK", id);
      expect(r.status, r.text).toBe(200);
      expect(Object.keys(r.json.data).sort((a, b) => a.localeCompare(b))).toEqual(["resourceId", "resourceType", "reviewedAt"]);
      expect(r.text).not.toContain(CANARY);
      const rows = await reviews(id);
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({ user_id: UID.rm, entity_type: "Risk", action: "UPDATE", reason: null, reason_ref: null });
      expect(JSON.stringify(rows[0])).not.toContain(CANARY);
      expect(new Date(rows[0]!.new_value.reviewedAt).getTime()).toBe(new Date((r.json.data as unknown as { reviewedAt: string }).reviewedAt).getTime());
      // nothing else moved: the risk is still restricted, the motif untouched
      expect((await sql<{ visibility: string }>("SELECT visibility FROM risks WHERE id = $1", [id]))[0]!.visibility).toBe("NOMINATIF");
      expect((await sql<{ text: string | null; reviewed_at: Date | null; effect_ended_at: Date | null; erased_at: Date | null }>("SELECT text, reviewed_at, effect_ended_at, erased_at FROM visibility_reasons WHERE id = $1", [motif]))[0])
        .toEqual({ text: CANARY, reviewed_at: null, effect_ended_at: null, erased_at: null });
      const log = await get("aud", `/audit-log?entityType=Risk&entityId=${id}`);
      expect(log.status, log.text).toBe(200);
      // the motif's own journal row legitimately serves its text (L2a); the REVIEW row never does
      const reviewRow = (log.json.data as Array<{ action: string; newValue: { event?: string } | null }>).filter((e) => e.newValue?.event === "VISIBILITY_REVIEW");
      expect(reviewRow).toHaveLength(1);
      expect(JSON.stringify(reviewRow[0])).not.toContain(CANARY);
      const after = await panel();
      expect(after.v.total).toBe(0);
      expect(after.v.items).toHaveLength(0);
      await reset();
    });

    it("the other blocks of the panel are still served (non-regression of D6, D6bis, q266 shape)", async () => {
      const r = await get("rm", "/governance-health");
      expect(Object.keys(r.json.data)).toEqual(expect.arrayContaining(["principles", "exceptions", "soleRm", "retentionPurge", "visibilityReview"]));
      expect(r.json.data.soleRm).toMatchObject({ total: expect.any(Number), reviewDelayDays: expect.any(Number) });
    });

    it("the RM who put the restriction in place may confirm it himself (SEC-L2C-03, open question PO: pinned as the CURRENT behaviour)", async () => {
      const id = await risk("NOMINATIF", "13 months");
      await restrictedSince(id, "13 months"); // authored by rm (journal user)
      expect((await confirm("rm", "RISK", id)).status).toBe(200);
      await reset();
    });
  });

  describe("COVERAGE of q269 A: which restrictions reach the review, and what restarts the clock", () => {
    it("QA-L2C-01 closed: a risk created restricted through POST /risks (no PERMISSION_CHANGE) and aged 14 months is in the review", async () => {
      const r = await keyed("rm", "POST", "/risks", { process: TAG, description: `${TAG} created restricted`, ownerDepartmentId: I("201"), visibility: "PERIMETRE" });
      expect(r.status, r.text).toBe(201);
      const id = r.json.data.id;
      const rows = await sql<{ action: string }>("SELECT action FROM audit_log WHERE entity_id = $1", [id]);
      expect(rows.map((x) => x.action)).toEqual(["CREATE"]); // the cause of the old hole: no PERMISSION_CHANGE, no motif
      expect(await ids()).not.toContain(id); // brand new: not due
      await sql("UPDATE risks SET created_at = now() - interval '14 months' WHERE id = $1", [id]);
      expect(await ids()).toContain(id);
      expect((await confirm("rm", "RISK", id)).status).toBe(200);
      expect(await ids()).not.toContain(id);
      await reset();
    });

    it("QA-L2C-01b closed: an anomaly created restricted through POST /anomalies, aged 14 months, is listed and confirmable (type ANOMALY)", async () => {
      const r = await keyed("rm", "POST", "/anomalies", { description: `${TAG} anomaly`, severity: "MODERATE", visibility: "PERIMETRE" });
      expect(r.status, r.text).toBe(201);
      const id = r.json.data.id;
      await sql("UPDATE anomalies SET created_at = now() - interval '14 months' WHERE id = $1", [id]);
      const item = (await panel()).v.items.find((i) => i.resourceId === id);
      expect(item).toMatchObject({ resourceType: "ANOMALY", visibility: "PERIMETRE" });
      expect((await confirm("rm", "ANOMALY", id)).status).toBe(200);
      expect((await reviews(id))[0]).toMatchObject({ entity_type: "Anomaly", user_id: UID.rm });
      expect((await panel()).v.items.map((i) => i.resourceId)).not.toContain(id);
      await sql("UPDATE anomalies SET visibility = 'CLIENT' WHERE id = $1", [id]);
    });

    it("QA-L2C-02 closed: an RM designation that opens the restricted risk (journal row without motif) no longer takes it out of the review", async () => {
      const id = await risk("PERIMETRE", "13 months");
      await restrictedSince(id, "13 months", "CLIENT", "PERIMETRE");
      expect(await ids()).toContain(id);
      const r = await keyed("rm", "POST", `/risks/${id}/owner`, { ownerId: UID.out2 });
      expect(r.status, r.text).toBe(200);
      const last = (await sql<{ action: string; reason_ref: string | null }>("SELECT action, reason_ref FROM audit_log WHERE entity_id = $1 AND action = 'PERMISSION_CHANGE' ORDER BY \"timestamp\" DESC LIMIT 1", [id]))[0]!;
      expect(last.reason_ref).toBeNull();
      expect(await ids()).toContain(id);
      await reset();
    });

    it("QA-L2C-03 closed: a fresh motif (renewal, designation with reason) restarts nothing: only a RM confirmation does", async () => {
      const id = await risk("NOMINATIF", "14 months");
      const fresh = (await sql<{ id: string }>("INSERT INTO visibility_reasons (tenant_id, source, text) VALUES ($1, 'ACCESS_RENEWAL', $2) RETURNING id", [T1, CANARY]))[0]!.id;
      await journal(id, "PERMISSION_CHANGE", "1 day", { visibility: "NOMINATIF", access: [] }, { visibility: "NOMINATIF", renewed: [UID.out] }, fresh);
      await journal(id, "PERMISSION_CHANGE", "1 day", { visibility: "PERIMETRE" }, { visibility: "NOMINATIF" }); // restricted -> restricted
      await journal(id, "ASSIGN", "1 day", {}, {});
      expect(await ids()).toContain(id);
      await reviewedAgo(id, "1 day");
      expect(await ids()).not.toContain(id);
      await reset();
    });

    it("the start of the CURRENT restriction restarts the clock: CLIENT -> restricted 2 months ago on a 30-month-old risk is not due; 13 months ago it is, since that date", async () => {
      const recent = await risk("NOMINATIF", "30 months");
      await restrictedSince(recent, "2 months");
      const old = await risk("NOMINATIF", "30 months");
      await restrictedSince(old, "13 months");
      const twice = await risk("NOMINATIF", "30 months"); // restricted 20 months ago, opened, restricted again 3 months ago: the LAST start counts
      await restrictedSince(twice, "20 months");
      await journal(twice, "PERMISSION_CHANGE", "10 months", { visibility: "NOMINATIF" }, { visibility: "CLIENT" });
      await restrictedSince(twice, "3 months");
      const { v } = await panel();
      const got = new Set(v.items.map((i) => i.resourceId));
      expect(got.has(recent)).toBe(false);
      expect(got.has(twice)).toBe(false);
      expect(got.has(old)).toBe(true);
      const want = (await sql<{ d: string }>("SELECT to_char((now() - interval '13 months') AT TIME ZONE 'UTC', 'YYYY-MM-DD') AS d"))[0]!.d;
      expect(v.items.find((i) => i.resourceId === old)!.dueSince).toBe(want);
      await reset();
    });

    it("end to end: a CLIENT risk created 20 months ago and restricted today by PUT /risks/:id/visibility is NOT due (the restriction is new); confirming it is a 404", async () => {
      const id = await risk("CLIENT", "20 months");
      const r = await put("rm", `/risks/${id}/visibility`, { visibility: "NOMINATIF", addUserIds: [UID.named], revokeUserIds: [], reason: "QA-L2C restriction du jour" });
      expect(r.status, r.text).toBe(200);
      expect(await ids()).not.toContain(id);
      expect((await confirm("rm", "RISK", id)).status).toBe(404);
      await reset();
    });

    it("OBSERVATION QA-L2C-05: the clock restarts on any CLIENT -> restricted change, so a flip to CLIENT and back (RM, or the owner, who only notifies the RM) restarts it without a review", async () => {
      const id = await risk("NOMINATIF", "14 months");
      expect(await ids()).toContain(id);
      expect((await put("rm", `/risks/${id}/visibility`, { visibility: "CLIENT", addUserIds: [], revokeUserIds: [], reason: "QA-L2C ouverture" })).status).toBe(200);
      expect((await put("rm", `/risks/${id}/visibility`, { visibility: "NOMINATIF", addUserIds: [UID.named], revokeUserIds: [], reason: "QA-L2C re-restriction" })).status).toBe(200);
      expect(await ids()).not.toContain(id); // pinned: by design of SEC-L2C-04 (new restriction = new clock), to be known by A13
      await reset();
    });

    it("OBSERVATION QA-L2C-04: a resource restricted by a path that writes no journal row (legacy / SQL) takes its creation date as clock, never a later one", async () => {
      const id = await risk("CLIENT", "20 months");
      await sql("UPDATE risks SET visibility = 'NOMINATIF' WHERE id = $1", [id]);
      expect(await ids()).toContain(id);
      await reset();
    });
  });

  describe("REPLAY and CONCURRENCY", () => {
    it("a second confirmation of the same resource is a 404 and writes nothing", async () => {
      const id = await risk("NOMINATIF", "14 months");
      expect((await confirm("rm", "RISK", id)).status).toBe(200);
      for (const n of [1, 2]) {
        const r = await confirm("rm", "RISK", id);
        expect(r.status, `replay ${n}: ${r.text}`).toBe(404);
      }
      expect(await reviews(id)).toHaveLength(1);
      await reset();
    });

    it("8 simultaneous confirmations: exactly one 200, seven 404, ONE audit row", async () => {
      const id = await risk("NOMINATIF", "15 months");
      const rs = await Promise.all(Array.from({ length: 8 }, () => confirm("rm", "RISK", id)));
      expect(rs.map((r) => r.status).sort((a, b) => a - b)).toEqual([200, 404, 404, 404, 404, 404, 404, 404]);
      expect(await reviews(id)).toHaveLength(1);
      await reset();
    });

    it("an audit failure aborts the confirmation: 5xx, no review row, the resource stays due (same transaction)", async () => {
      const id = await risk("NOMINATIF", "14 months");
      await sql("CREATE OR REPLACE FUNCTION qa_l2c_fail_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.new_value->>'event' = 'VISIBILITY_REVIEW' THEN RAISE EXCEPTION 'qa audit failure'; END IF; RETURN NEW; END $$");
      await sql("DROP TRIGGER IF EXISTS qa_l2c_fail ON audit_log");
      await sql("CREATE TRIGGER qa_l2c_fail BEFORE INSERT ON audit_log FOR EACH ROW EXECUTE FUNCTION qa_l2c_fail_audit()");
      try {
        const r = await confirm("rm", "RISK", id);
        expect(r.status, r.text).toBe(500);
        expect(r.text).not.toContain("qa audit failure");
      } finally {
        await sql("DROP TRIGGER IF EXISTS qa_l2c_fail ON audit_log");
      }
      expect(await reviews(id)).toHaveLength(0);
      expect(await ids()).toContain(id);
      expect((await confirm("rm", "RISK", id)).status).toBe(200);
      await reset();
    });
  });

  describe("REFUSALS: who may confirm, what may be confirmed", () => {
    it("Committee, Audit, an ordinary reader and an administrator outside the Risk Manager group (even holding resourcevisibility.set) get 403; nothing is written", async () => {
      await sql("UPDATE users SET roles = roles || ARRAY['resourcevisibility.set']::text[] WHERE email IN ('com@vv1.test','aud@vv1.test','out@vv1.test')");
      const id = await risk("NOMINATIF", "13 months");
      for (const w of ["com", "aud", "out", "adm"] as const) {
        const r = await confirm(w, "RISK", id);
        expect(r.status, `${w}: ${r.text}`).toBe(403);
      }
      expect(await reviews(id)).toHaveLength(0);
      expect((await sql<{ roles: string[] }>("SELECT roles FROM users WHERE email = 'adm@vv1.test'"))[0]!.roles).toContain("resourcevisibility.set");
      await reset();
    });

    it("a Risk Manager whose permission was removed gets 403 and canConfirm=false", async () => {
      const id = await risk("NOMINATIF", "13 months");
      const saved = (await sql<{ id: string; permissions: string[] }>("SELECT id, permissions FROM roles WHERE system_group = 'RISK_MANAGER' AND tenant_id = $1", [T1]))[0]!;
      await sql("UPDATE users SET roles = array_remove(roles, 'resourcevisibility.set') WHERE email = 'rm@vv1.test'");
      await sql("UPDATE roles SET permissions = array_remove(permissions, 'resourcevisibility.set') WHERE id = $1", [saved.id]);
      try {
        expect((await confirm("rm", "RISK", id)).status).toBe(403);
        expect((await panel("rm")).v.canConfirm).toBe(false);
        expect(await reviews(id)).toHaveLength(0);
      } finally {
        await sql("UPDATE roles SET permissions = $2 WHERE id = $1", [saved.id, saved.permissions]);
        await sql("UPDATE users SET roles = roles || ARRAY['resourcevisibility.set']::text[] WHERE email = 'rm@vv1.test'");
      }
      await reset();
    });

    it("no token 401; malformed id 400; unknown type 400; unknown id 404; a non-restricted, a soft-deleted and a recently reviewed resource 404", async () => {
      const any = await risk("NOMINATIF", "14 months");
      expect((await confirm(null, "RISK", any)).status).toBe(401);
      expect((await confirm("rm", "RISK", "not-a-uuid")).status).toBe(400);
      expect((await confirm("rm", "RISK%3B%20DROP", any)).status).toBe(400);
      expect((await confirm("rm", "USER", any)).status).toBe(400);
      const unknown = await Promise.all(["RISK", "CONTROL", "ANOMALY", "ACTION_PLAN", "KPI"].map(async (t) => (await confirm("rm", t, "aaaaaaaa-0000-4000-8000-0000000fffff")).status));
      expect(unknown).toEqual([404, 404, 404, 404, 404]); // the lock and the due query run on all five tables
      const open = await risk("CLIENT", "30 months");
      expect((await confirm("rm", "RISK", open)).status).toBe(404);
      const gone = await risk("NOMINATIF", "30 months");
      await sql("UPDATE risks SET deleted_at = now() WHERE id = $1", [gone]);
      expect((await confirm("rm", "RISK", gone)).status).toBe(404);
      const fresh = await risk("NOMINATIF", "30 months");
      await reviewedAgo(fresh, "1 month");
      expect((await confirm("rm", "RISK", fresh)).status).toBe(404);
      expect((await confirm("rm", "CONTROL", any)).status).toBe(404); // right id, wrong type
      expect(await reviews(any)).toHaveLength(0);
      await reset();
    });

    it("canConfirm per profile; total masking: the groups that see everything get exact total and items, others a total WITHOUT the NOMINATIF ones and no item", async () => {
      const nom = await risk("NOMINATIF", "13 months");
      const per = await risk("PERIMETRE", "13 months");
      const seen: Record<string, { canConfirm: boolean; items: number; total: number | { belowThreshold: true } }> = {};
      for (const w of ["rm", "com", "aud", "adm", "out"] as const) {
        const { v, body } = await panel(w);
        seen[w] = { canConfirm: v.canConfirm, items: v.items.length, total: v.total };
        if (w === "adm" || w === "out") expect(body, w).not.toContain(nom); // a NOMINATIF id never reaches a reader who does not see everything
      }
      expect(seen["rm"]).toEqual({ canConfirm: true, items: 2, total: 2 });
      for (const w of ["com", "aud"]) expect(seen[w], w).toMatchObject({ canConfirm: false, items: 2, total: 2 });
      for (const w of ["adm", "out"]) expect(seen[w], w).toEqual({ canConfirm: false, items: 0, total: { belowThreshold: true } }); // 1 PERIMETRE (the NOMINATIF is left out), 1 to 4 is never sent
      expect(per).toBeTruthy();
      await reset();
    });
  });

  describe("SMALL-CELL rule of the total for readers who do not see everything (q228 A: 0 and 5+ exact, 1 to 4 never sent)", () => {
    const totals = async (who: Who) => (await panel(who)).v.total;
    it("0, 4, 5 and 6 due PERIMETRE restrictions (+ NOMINATIF ones that never count): adm and an ordinary reader see 0, belowThreshold, 5, 6; rm, com, aud stay exact", async () => {
      await risk("NOMINATIF", "13 months"); // never counted for adm / out
      await risk("NOMINATIF", "13 months");
      expect([await totals("adm"), await totals("out")]).toEqual([0, 0]);
      expect(await totals("rm")).toBe(2);
      for (const n of [4, 5, 6]) {
        const have = (await sql<{ n: number }>("SELECT count(*)::int AS n FROM risks WHERE process = $1 AND deleted_at IS NULL AND visibility = 'PERIMETRE'", [TAG]))[0]!.n;
        await Promise.all(Array.from({ length: n - have }, () => risk("PERIMETRE", "13 months")));
        const want = n < 5 ? { belowThreshold: true } : n;
        expect([n, await totals("adm"), await totals("out")]).toEqual([n, want, want]);
        expect([await totals("rm"), await totals("com"), await totals("aud")]).toEqual([n + 2, n + 2, n + 2]);
        expect(JSON.stringify((await panel("out")).v)).not.toMatch(/"total":[1-4]\b/); // no exact 1..4 in the block
      }
      await reset();
    });
  });

  describe("TENANT scoping", () => {
    it("another tenant's restricted risk is not listed here and cannot be confirmed from here (404, untouched)", async () => {
      const t2 = (await sql<{ id: string }>("INSERT INTO tenants (name) VALUES ($1) RETURNING id", [`${TAG}-${Date.now()}`]))[0]!.id;
      const foreign = (await sql<{ id: string }>("INSERT INTO risks (tenant_id, process, description, visibility, created_at) VALUES ($1, $2, 'x', 'NOMINATIF', now() - interval '30 months') RETURNING id", [t2, TAG]))[0]!.id;
      const own = await risk("NOMINATIF", "13 months");
      const { v } = await panel();
      expect(v.items.map((i) => i.resourceId)).toEqual([own]);
      expect(v.total).toBe(1);
      expect((await confirm("rm", "RISK", foreign)).status).toBe(404);
      expect(await reviews(foreign)).toHaveLength(0);
      // a review row of ANOTHER tenant naming my risk id does not restart my clock
      await journal(own, "UPDATE", "1 day", {}, { event: "VISIBILITY_REVIEW" }, null, t2);
      expect(await ids()).toContain(own);
      await reset();
      await sql("UPDATE risks SET deleted_at = now() WHERE tenant_id = $1", [t2]);
    });
  });

  describe("BOUNDARIES of the 12 months and of the list", () => {
    it("a calendar 12 months: 1 hour inside is not due, 1 hour outside is due; a review restarts the clock, a late review does not", async () => {
      const inside = await risk("NOMINATIF", "12 months -1 hour");
      const outside = await risk("NOMINATIF", "12 months 1 hour");
      const reviewedRecently = await risk("NOMINATIF", "30 months");
      await reviewedAgo(reviewedRecently, "2 months");
      const reviewedLate = await risk("NOMINATIF", "30 months");
      await reviewedAgo(reviewedLate, "12 months 1 hour");
      const { v } = await panel();
      const got = new Set(v.items.map((i) => i.resourceId));
      expect([got.has(inside), got.has(outside), got.has(reviewedRecently), got.has(reviewedLate)]).toEqual([false, true, false, true]);
      expect(v.items.find((i) => i.resourceId === reviewedLate)!.everReviewed).toBe(true);
      expect(v.items.find((i) => i.resourceId === outside)!.everReviewed).toBe(false);
      await reset();
    });

    it("PostgreSQL calendar months: Feb 29 minus 12 months = Feb 28 (the window is calendar-based, not 365 days)", async () => {
      const r = await sql<{ a: string; b: string }>(
        "SELECT to_char(timestamptz '2024-02-29 12:00+00' - make_interval(months => 12), 'YYYY-MM-DD') AS a, to_char(timestamptz '2025-03-31 12:00+00' - make_interval(months => 12), 'YYYY-MM-DD') AS b");
      expect(r[0]).toEqual({ a: "2023-02-28", b: "2024-03-31" });
    });

    it("a review dated in the future (clock skew) keeps the resource out of the list and the confirmation refused", async () => {
      const id = await risk("NOMINATIF", "30 months");
      await journal(id, "UPDATE", "-1 day", {}, { event: "VISIBILITY_REVIEW" });
      expect(await ids()).not.toContain(id);
      expect((await confirm("rm", "RISK", id)).status).toBe(404);
      await reset();
    });

    it("55 due restrictions: 50 items, exact total 55, oldest first", async () => {
      await sql(
        `INSERT INTO risks (tenant_id, process, description, visibility, owner_department_id, created_at)
         SELECT $1, $2, $2 || ' bulk', 'NOMINATIF', $3, now() - interval '13 months' - n * interval '1 hour' FROM generate_series(1, 55) n`, [T1, TAG, I("201")]);
      const { v } = await panel();
      expect(v.total).toBe(55);
      expect(v.items).toHaveLength(50);
      const dates = v.items.map((i) => i.dueSince);
      expect([...dates].sort((x, y) => x.localeCompare(y))).toEqual(dates);
      await reset();
      expect((await panel()).v.total).toBe(0);
    });
  });

  describe("LEAK scan and non-interference", () => {
    it("every public table, row by row: the canary only answers in visibility_reasons (journal, grants, notifications included)", async () => {
      const tables = (await sql<{ tablename: string }>("SELECT tablename FROM pg_tables WHERE schemaname = 'public' ORDER BY 1")).map((t) => t.tablename);
      const counts = await Promise.all(tables.map(async (t) => ({ t, n: (await sql<{ n: number }>(`SELECT count(*)::int AS n FROM "${t}" WHERE "${t}"::text LIKE $1`, [`%${CANARY}%`]))[0]!.n })));
      expect(counts.filter((c) => c.n > 0).map((c) => c.t)).toEqual(["visibility_reasons"]);
    });

    it("the review row on a risk is an UPDATE by the RM: GET /risks/:id still serves the risk unchanged", async () => {
      const id = await risk("NOMINATIF", "14 months");
      const before = await get("rm", `/risks/${id}`);
      expect((await confirm("rm", "RISK", id)).status).toBe(200);
      const after = await get("rm", `/risks/${id}`);
      expect(after.status).toBe(200);
      expect(after.json.data).toEqual(before.json.data);
      await reset();
    });
  });
});
