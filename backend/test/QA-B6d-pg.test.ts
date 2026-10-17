import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Pool, type PoolClient } from "pg";
import { PostgresRiskFrameworkRepository } from "../src/infrastructure/database/postgres/PostgresRiskFrameworkRepository.js";
import { PostgresUserRepository } from "../src/infrastructure/database/postgres/PostgresUserRepository.js";
import { PostgresRoleRepository } from "../src/infrastructure/database/postgres/PostgresRoleRepository.js";
import { bootstrapRefusal } from "../src/domain/frameworkApproval.js";
import type { BootstrapFacts, BootstrapJustification } from "../src/domain/entities/RiskFramework.js";

/**
 * QA level 2 for B-6d on a REAL PostgreSQL 16 (disposable, unix socket directory). Skipped unless QA_FB6B02_PGHOST
 * starts with "/". Database QA_FB6B02_PGDB (default grc_qa), user postgres, migrations 001..062.
 * Unlike B6dBootstrap-pg this file COMMITS (concurrency needs real transactions): every world has its own tenant,
 * so nothing is shared. Run with --no-file-parallelism together with the other *-pg files.
 */
const HOST = process.env.QA_FB6B02_PGHOST ?? "";
const enabled = HOST.startsWith("/");
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const J: BootstrapJustification = {
  askedUserId: "x", askedOn: "2026-10-01", outcome: "none",
  freeParameters: { scaleSize: 5, appetiteThresholds: [], lowCriticalityThreshold: 5, delegationMaxDays: null, committeeTreatmentMinScore: null, lowThresholdToExamine: false },
};

describe.skipIf(!enabled)("QA-B6d on real PostgreSQL 16", () => {
  let pool: Pool;
  let repo: PostgresRiskFrameworkRepository;
  const q = async <T = { id: string }>(sql: string, p: unknown[] = []) => (await pool.query(sql, p)).rows as T[];
  const one = async (sql: string, p: unknown[] = []) => (await q<{ id: string }>(sql, p))[0]!.id;

  let n = 0;
  interface World { t: string; admin: string; rm: string; roles: Record<"RISK_MANAGER" | "RISK_COMMITTEE" | "AUDIT", string> }
  const user = (t: string, tag: string) => one(`INSERT INTO users (tenant_id, email, display_name) VALUES ($1, $2, $2) RETURNING id`, [t, `${tag}-${Math.random()}@qab6d`]);
  async function world(): Promise<World> {
    n += 1;
    const t = await one(`INSERT INTO tenants (name) VALUES ($1) RETURNING id`, [`qab6d-${Date.now()}-${n}`]);
    const admin = await user(t, "admin");
    const roles = {} as World["roles"];
    for (const g of ["RISK_MANAGER", "RISK_COMMITTEE", "AUDIT"] as const) {
      roles[g] = await one(`INSERT INTO roles (tenant_id, name, permissions, system_group) VALUES ($1, $2, '{}', $3) RETURNING id`, [t, `${g}-${n}`, g]);
    }
    const w: World = { t, admin, rm: "", roles };
    w.rm = await user(t, "rm");
    await grant(w, "RISK_MANAGER", w.rm);
    return w;
  }
  const grant = (w: World, g: keyof World["roles"], u: string, c?: PoolClient) =>
    (c ?? pool).query(`INSERT INTO user_roles (tenant_id, role_id, user_id, granted_by) VALUES ($1, $2, $3, $4) RETURNING id`, [w.t, w.roles[g], u, w.admin]);
  const ended = async (t: string) => (await q<{ e: Date | null }>(`SELECT risk_framework_bootstrap_ended_at AS e FROM tenants WHERE id = $1`, [t]))[0]!.e;

  async function pending(w: World) {
    const fw = await one(`INSERT INTO risk_frameworks (tenant_id, name) VALUES ($1, $2) RETURNING id`, [w.t, `fw-${Math.random()}`]);
    const scale = await one(`INSERT INTO rating_scales (tenant_id, name, version, probability_levels, impact_levels) VALUES ($1, 's', '1', 5, 5) RETURNING id`, [w.t]);
    const v = await one(`INSERT INTO risk_framework_versions (tenant_id, framework_id, version_number, rating_scale_id, committee_evaluation_min_score) VALUES ($1, $2, 1, $3, 15) RETURNING id`, [w.t, fw, scale]);
    await q(`UPDATE risk_framework_versions SET status = 'PENDING_APPROVAL' WHERE id = $1`, [v]);
    const r = await one(`INSERT INTO risk_framework_change_requests (tenant_id, kind, framework_id, version_id, reason, requested_by) VALUES ($1, 'ACTIVATE_VERSION', $2, $3, 'r', $4) RETURNING id`, [w.t, fw, v, w.rm]);
    return { fw, v, r };
  }
  /** Same refusal logic as RiskFrameworkService.bootstrapApprove (contract defaults and self-proposal assumed fine). */
  const validate = async (f: BootstrapFacts) => {
    const refusal = bootstrapRefusal({
      kind: "ACTIVATE_VERSION", endedAt: f.endedAt, activeMembers: f.activeMembers, requesterIsActiveRiskManager: f.requesterIsActiveRiskManager,
      firstActivationOfTenant: f.firstActivationOfTenant, contractDefaultsOnly: true, switchesSelfProposalOn: false,
    });
    if (refusal) throw new Error(`REFUSED:${refusal}`);
  };
  const decide = (w: World, r: string, gate?: () => Promise<void>) =>
    repo.recordBootstrapDecision!(w.t, r, { decidedBy: w.rm, comment: "ok", justification: J }, async (f) => { await gate?.(); await validate(f); });
  const state = async (p: { v: string; r: string }) => ({
    v: (await q<{ status: string }>(`SELECT status FROM risk_framework_versions WHERE id = $1`, [p.v]))[0]!.status,
    r: (await q<{ status: string; decision_regime: string | null }>(`SELECT status, decision_regime FROM risk_framework_change_requests WHERE id = $1`, [p.r]))[0]!,
  });

  beforeAll(() => {
    pool = new Pool({ host: HOST, user: "postgres", database: process.env.QA_FB6B02_PGDB ?? "grc_qa", max: 8 });
    repo = new PostgresRiskFrameworkRepository(pool);
  });
  afterAll(async () => { await pool?.end(); });

  // -- facts read by the repository (the live counts the service relies on) ------------------------------------

  it("facts: a suspended member and a member of a disabled role are not counted; other tenants are invisible", async () => {
    const w = await world();
    const other = await world();
    await grant(other, "AUDIT", await user(other.t, "o1"));
    await grant(other, "AUDIT", await user(other.t, "o2")); // other tenant ends its own bootstrap, not ours
    const a1 = await user(w.t, "a1");
    const a2 = await user(w.t, "a2");
    await grant(w, "AUDIT", a1);
    await q(`UPDATE users SET deleted_at = now() WHERE id = $1`, [a2]);
    await grant(w, "AUDIT", a2);
    const f = await repo.getBootstrapFacts!(w.t, w.rm);
    expect(f.activeMembers).toEqual({ RISK_MANAGER: 1, COMMITTEE: 0, AUDIT: 1 });
    expect(f.requesterIsActiveRiskManager).toBe(true);
    expect(f.endedAt).toBeNull();
    expect(await ended(other.t)).not.toBeNull();
    await q(`UPDATE roles SET deleted_at = now() WHERE id = $1`, [w.roles.AUDIT]);
    expect((await repo.getBootstrapFacts!(w.t, w.rm)).activeMembers.AUDIT).toBe(0);
    await q(`UPDATE users SET deleted_at = now() WHERE id = $1`, [w.rm]);
    expect((await repo.getBootstrapFacts!(w.t, w.rm)).requesterIsActiveRiskManager).toBe(false);
  });

  it("q100 on the real repository: the fallback cause is stored and read back for approve and for reject; a NORMAL decision stores none", async () => {
    const w = await world();
    const rm2 = await user(w.t, "rm2");
    const viaRepo = (r: string, outcome: "APPROVED" | "REJECTED", cause: "LEGACY_APPROVER_PRE_B12" | null) =>
      repo.recordDecision(w.t, r, { outcome, decidedBy: rm2, comment: "repli", decisionRegime: cause ? "FALLBACK" : "NORMAL", deciderGroup: "RISK_MANAGER", ratificationStatus: cause ? "PENDING" : null, fallbackCause: cause });
    const a = await pending(w);
    const ok = await viaRepo(a.r, "APPROVED", "LEGACY_APPROVER_PRE_B12");
    expect(ok.request).toMatchObject({ decisionRegime: "FALLBACK", ratificationStatus: "PENDING", fallbackCause: "LEGACY_APPROVER_PRE_B12" });
    expect((await repo.getRequest(w.t, a.r))?.fallbackCause).toBe("LEGACY_APPROVER_PRE_B12");
    const b = await pending(w);
    const rej = await viaRepo(b.r, "REJECTED", "LEGACY_APPROVER_PRE_B12");
    expect(rej.request).toMatchObject({ status: "REJECTED", fallbackCause: "LEGACY_APPROVER_PRE_B12" });
    expect((await state(b)).v).toBe("DRAFT");
    const c = await pending(w);
    expect((await viaRepo(c.r, "REJECTED", null)).request.fallbackCause).toBeNull();
    // the CHECK refuses a cause on a NORMAL decision even if a caller tried
    const d = await pending(w);
    await expect(repo.recordDecision(w.t, d.r, { outcome: "REJECTED", decidedBy: rm2, comment: "x", decisionRegime: "NORMAL", deciderGroup: "RISK_MANAGER", ratificationStatus: null, fallbackCause: "LEGACY_APPROVER_PRE_B12" })).rejects.toThrow();
    expect((await state(d)).r.status).toBe("PENDING");
  });

  // -- end marker: sequential paths ---------------------------------------------------------------------------

  it("q102: second RM then revoked: marker stays, bootstrap stays refused with ENDED while the live counts are back to 1 RM; request untouched", async () => {
    const w = await world();
    const p = await pending(w);
    const rm2 = await user(w.t, "rm2");
    await grant(w, "RISK_MANAGER", rm2);
    expect(await ended(w.t)).not.toBeNull();
    await q(`UPDATE user_roles SET revoked_at = now() WHERE tenant_id = $1 AND user_id = $2`, [w.t, rm2]);
    expect((await repo.getBootstrapFacts!(w.t, w.rm)).activeMembers.RISK_MANAGER).toBe(1);
    await expect(decide(w, p.r)).rejects.toThrow("REFUSED:ENDED");
    expect(await state(p)).toMatchObject({ v: "PENDING_APPROVAL", r: { status: "PENDING", decision_regime: null } });
    // re-assigning the revoked member does not change the marker either
    const before = await ended(w.t);
    await grant(w, "RISK_MANAGER", rm2);
    expect(await ended(w.t)).toEqual(before);
  });

  it("1 Audit + 1 Committee member: the bootstrap is allowed, the decision activates the version, the marker stays NULL, a second bootstrap is refused (q81)", async () => {
    const w = await world();
    await grant(w, "AUDIT", await user(w.t, "a1"));
    await grant(w, "RISK_COMMITTEE", await user(w.t, "c1"));
    const p = await pending(w);
    const out = await decide(w, p.r);
    expect(out.request).toMatchObject({ decisionRegime: "BOOTSTRAP", decidedBy: w.rm, requestedBy: w.rm, ratificationStatus: null, fallbackCause: null });
    expect(out.request.bootstrapJustification?.freeParameters.scaleSize).toBe(5);
    expect(await state(p)).toMatchObject({ v: "ACTIVE", r: { status: "APPROVED", decision_regime: "BOOTSTRAP" } });
    expect(await ended(w.t)).toBeNull();
    const p2 = await pending(w);
    await expect(decide(w, p2.r)).rejects.toThrow("REFUSED:NOT_FIRST_ACTIVATION");
    expect((await state(p2)).r.status).toBe("PENDING");
  });

  it("a refusal inside validateLocked rolls everything back (no BOOTSTRAP row, version still pending, no default framework)", async () => {
    const w = await world();
    await grant(w, "AUDIT", await user(w.t, "a1"));
    await grant(w, "AUDIT", await user(w.t, "a2"));
    const p = await pending(w);
    await expect(decide(w, p.r)).rejects.toThrow("REFUSED:ENDED");
    expect(await state(p)).toMatchObject({ v: "PENDING_APPROVAL", r: { status: "PENDING" } });
    expect((await q<{ is_default: boolean }>(`SELECT is_default FROM risk_frameworks WHERE id = $1`, [p.fw]))[0]!.is_default).toBe(false);
  });

  it("the decision is refused when someone other than the requester asks (repository guard), nothing written", async () => {
    const w = await world();
    const p = await pending(w);
    await expect(repo.recordBootstrapDecision!(w.t, p.r, { decidedBy: w.admin, comment: "x", justification: J }, () => undefined)).rejects.toThrow(/demandeur/);
    expect((await state(p)).r.status).toBe("PENDING");
  });

  it("tenant scope: a request id of another tenant is not found, whatever the tenant lock", async () => {
    const a = await world();
    const b = await world();
    const p = await pending(b);
    await expect(repo.recordBootstrapDecision!(a.t, p.r, { decidedBy: a.rm, comment: "x", justification: J }, () => undefined)).rejects.toThrow();
    expect((await state(p)).r.status).toBe("PENDING");
  });

  // -- concurrency (spec section 17) ---------------------------------------------------------------------------

  it("two first Audit members assigned in parallel transactions end the bootstrap (the second trigger sees the first)", async () => {
    const w = await world();
    const u1 = await user(w.t, "a1");
    const u2 = await user(w.t, "a2");
    const a = await pool.connect();
    const b = await pool.connect();
    try {
      await a.query("BEGIN");
      await b.query("BEGIN");
      await grant(w, "AUDIT", u1, a);
      let bDone = false;
      const bInsert = grant(w, "AUDIT", u2, b).then(() => { bDone = true; });
      await sleep(300);
      expect(bDone).toBe(false); // waits on the tenant lock taken by a's trigger
      await a.query("COMMIT");
      await bInsert;
      await b.query("COMMIT");
    } finally { a.release(); b.release(); }
    expect(await ended(w.t)).not.toBeNull();
  });

  it("a bootstrap decision racing with the assignment of a second RM: assignment first -> decision refused ENDED; decision first -> decision stands and the assignment ends the bootstrap afterwards", { timeout: 30_000 }, async () => {
    // (1) assignment holds the tenant lock (uncommitted), decision waits and then sees the end
    const w1 = await world();
    const p1 = await pending(w1);
    const a = await pool.connect();
    try {
      await a.query("BEGIN");
      await grant(w1, "RISK_MANAGER", await user(w1.t, "rm2"), a);
      let settled = false;
      const dec = decide(w1, p1.r).then(() => { settled = true; }, () => { settled = true; });
      await sleep(300);
      expect(settled).toBe(false);
      await a.query("COMMIT");
      await dec;
    } finally { a.release(); }
    expect((await state(p1)).r.status).toBe("PENDING");
    expect(await ended(w1.t)).not.toBeNull();

    // (2) decision holds the lock inside validateLocked, the assignment blocks in its trigger until the decision commits
    const w2 = await world();
    const p2 = await pending(w2);
    const rm2 = await user(w2.t, "rm2"); // created first: any INSERT into users of the tenant waits for the decision's tenant lock (FK key share)
    let release!: () => void;
    const gate = new Promise<void>((res) => { release = res; });
    let inside = false;
    let early: unknown = null;
    const dec2 = decide(w2, p2.r, async () => { inside = true; await gate; });
    dec2.catch((e) => { early = e; });
    while (!inside && !early) await sleep(20);
    if (early) throw early;
    const b = await pool.connect();
    try {
      await b.query("BEGIN");
      let assigned = false;
      const ins = grant(w2, "RISK_MANAGER", rm2, b).then(() => { assigned = true; });
      await sleep(300);
      expect(assigned).toBe(false);
      release();
      await dec2;
      await ins;
      await b.query("COMMIT");
    } finally { b.release(); }
    expect(await state(p2)).toMatchObject({ v: "ACTIVE", r: { status: "APPROVED", decision_regime: "BOOTSTRAP" } });
    expect(await ended(w2.t)).not.toBeNull();
  });

  // -- known limit declared by A06 (unreachable through the API: no endpoint writes roles.system_group or un-deletes a role) --

  it.fails("KNOWN LIMIT: reactivating a disabled Audit role that carries 2 members should set the end marker (it does not)", async () => {
    const w = await world();
    await q(`UPDATE roles SET deleted_at = now() WHERE id = $1`, [w.roles.AUDIT]);
    await grant(w, "AUDIT", await user(w.t, "a1"));
    await grant(w, "AUDIT", await user(w.t, "a2"));
    await q(`UPDATE roles SET deleted_at = NULL WHERE id = $1`, [w.roles.AUDIT]);
    expect(await ended(w.t)).not.toBeNull();
  });

  it.fails("KNOWN LIMIT: changing roles.system_group to AUDIT on a role carrying 2 members should set the end marker (it does not)", async () => {
    const w = await world();
    const plain = await one(`INSERT INTO roles (tenant_id, name, permissions) VALUES ($1, 'plain', '{}') RETURNING id`, [w.t]);
    const wp = { ...w, roles: { ...w.roles, AUDIT: plain } };
    await grant(wp, "AUDIT", await user(w.t, "a1"));
    await grant(wp, "AUDIT", await user(w.t, "a2"));
    await q(`UPDATE roles SET deleted_at = now() WHERE id = $1`, [w.roles.AUDIT]);
    await q(`UPDATE roles SET system_group = 'AUDIT' WHERE id = $1`, [plain]);
    expect(await ended(w.t)).not.toBeNull();
  });

  it.fails("KNOWN LIMIT consequence: after the unmarked circuit shrinks back, the bootstrap reopens (q102 says never)", async () => {
    const w = await world();
    const p = await pending(w);
    await q(`UPDATE roles SET deleted_at = now() WHERE id = $1`, [w.roles.AUDIT]);
    const a1 = await user(w.t, "a1");
    await grant(w, "AUDIT", a1);
    await grant(w, "AUDIT", await user(w.t, "a2"));
    await q(`UPDATE roles SET deleted_at = NULL WHERE id = $1`, [w.roles.AUDIT]);
    // the live safety net still refuses while the circuit works ...
    await expect(decide(w, p.r)).rejects.toThrow("REFUSED:CIRCUIT_FUNCTIONAL");
    // ... but once one member leaves, nothing remembers that a circuit existed
    await q(`UPDATE user_roles SET revoked_at = now() WHERE tenant_id = $1 AND user_id = $2`, [w.t, a1]);
    await expect(decide(w, p.r)).rejects.toThrow("REFUSED:ENDED");
  });

  // -- QA-B6d-01: the I-D9 comparison is textual, PostgreSQL compares uuids case-insensitively --------------------

  it("QA-B6d-01 evidence: an UPPER-CASE uuid resolves to the same user and the same roles (so a textual `===` guard is bypassable)", async () => {
    const w = await world();
    const adminRole = await one(`INSERT INTO roles (tenant_id, name, permissions) VALUES ($1, 'adm', ARRAY['role.assign']) RETURNING id`, [w.t]);
    await q(`INSERT INTO user_roles (tenant_id, role_id, user_id, granted_by) VALUES ($1, $2, $3, $4)`, [w.t, adminRole, w.rm, w.admin]);
    const upper = w.rm.toUpperCase();
    expect(upper).not.toBe(w.rm);
    const u = await new PostgresUserRepository(pool).getById(w.t, upper);
    expect(u?.id).toBe(w.rm);
    const held = await new PostgresRoleRepository(pool).listForUser(w.t, upper);
    expect(held.some((r) => r.permissions.includes("role.assign" as never))).toBe(true);
  });
});
