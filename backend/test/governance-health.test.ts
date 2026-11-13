import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { CATALOG_VERSION, PRINCIPLES } from "../src/domain/governance/catalog.js";
import { computePanel, DETECTORS, type ActiveAcceptance, type GovernanceFacts } from "../src/domain/governance/health.js";
import { GovernanceHealthService } from "../src/services/GovernanceHealthService.js";
import { PostgresGovernanceHealthRepository } from "../src/infrastructure/database/postgres/PostgresGovernanceHealthRepository.js";
import { ForbiddenError } from "../src/domain/errors/DomainErrors.js";
import type { AuthenticatedUser } from "../src/infrastructure/identity/IdentityProvider.js";
import { GOVERNANCE_THRESHOLDS } from "../src/domain/entities/Config.js";
import { SOLE_RM_REVIEW_DEFAULT_DAYS } from "../src/domain/entities/GovernanceReviews.js";
import { hasLocalPg, migrationSql, useMigrationTenant } from "./migrationHarness.js";

/** Lot D6 (DECISION-074 R-6, DECISION-113) — level 1. */
const NOW = new Date("2026-11-03T12:00:00Z");
const RM = "11111111-1111-4111-8111-111111111111";
const ADM = "22222222-2222-4222-8222-222222222222";
const AUD = "33333333-3333-4333-8333-333333333333";

function facts(over: Partial<GovernanceFacts> = {}): GovernanceFacts {
  return {
    now: NOW,
    trackedSince: new Date("2026-11-01T00:00:00Z"),
    users: [
      { id: RM, label: "Awa Risk", active: true, directPermissions: [] },
      { id: ADM, label: "Bakary Admin", active: true, directPermissions: [] },
      { id: AUD, label: "Chantal Audit", active: true, directPermissions: [] },
    ],
    roles: [
      { id: "r-rm", name: "Risk Manager", systemGroup: "RISK_MANAGER", permissions: ["risk.read"] },
      { id: "r-adm", name: "Admin", systemGroup: null, permissions: ["role.assign"] },
      { id: "r-aud", name: "Audit", systemGroup: "AUDIT", permissions: ["audit.read"] },
    ],
    assignments: [
      { userId: RM, roleId: "r-rm", grantedBy: ADM },
      { userId: RM, roleId: "r-adm", grantedBy: ADM },
      { userId: AUD, roleId: "r-aud", grantedBy: ADM },
    ],
    config: { committeeAuditCumulAllowed: false, committeeEvaluationEnforced: true, committeeTreatmentMinScore: 12 },
    pendingRatifications: [],
    riskOwnerGaps: [],
    riskOwnerGapsTotal: 0,
    processGaps: [],
    processGapsTotal: 0,
    markedCountByRule: {},
    markedActions: [],
    markedTotal: 0,
    unreviewedTotal: 0,
    oldestUnreviewedAt: null,
    selfValidatedUnmarked: [],
    selfValidatedUnmarkedTotal: 0,
    managerDesignated: false,
    interimDesignated: false,
    singlePersonRegimeActive: false,
    riskManagerVacancySince: null,
    riskManagerVacancyMaxDays: 60,
    exceptionReviewDelayDays: 5,
    lastSeenPurgeAt: null,
    risksTotal: 0,
    risksCreatorIsOwner: 0,
    risksOwnedBy: {},
    cumulSetting: null,
    selfValidators: [],
    thresholds: { govRmRiskShareMaxPct: 20, govMaxAdmins: 3, govRoleMaxPermissions: 25, govRoleMaxFamilies: 4, govDormantDays: 90, govOwnerCreatorShareMaxPct: 50 },
    ...over,
  };
}
const status = (f: GovernanceFacts, id: string, acc: ActiveAcceptance[] = []) => computePanel(f, acc).find((r) => r.id === id)!;

describe("D6 — catalog copied from the A13 JSON", () => {
  it("same ids, titles, consequences, severities and indications as docs/governance/principes; one detector per principle", () => {
    const json = JSON.parse(readFileSync(join(__dirname, "..", "..", "docs", "governance", "principes", "principes-gouvernance.json"), "utf8"));
    // q230 A (DECISION-115): the catalog and the A13 JSON both read « 0.3 », content identical.
    expect(CATALOG_VERSION).toBe("0.3");
    expect(json.meta.version).toBe(CATALOG_VERSION);
    expect(PRINCIPLES.map((p) => [p.id, p.title, p.consequence, p.severity, p.indications.TPE.action, p.indications.GRANDE_ENTREPRISE.level]))
      .toEqual(json.principes.map((p: any) => [p.id, p.titre, p.consequence, p.gravite, p.indications.tpe.action, p.indications.grande_entreprise.niveau]));
    expect(Object.keys(DETECTORS).sort()).toEqual(PRINCIPLES.map((p) => p.id).sort());
  });
});

describe("D6 — detectors (pure)", () => {
  it("a single Risk Manager, who is also administrator: RISK-01 and SOD-04 not respected; Committee-less: COM-01", () => {
    const f = facts();
    expect(status(f, "GOV-RISK-01")).toMatchObject({ status: "NOT_RESPECTED", offenders: [{ kind: "GROUP", id: "RISK_MANAGER", count: 1 }] });
    expect(status(f, "GOV-SOD-04").offenders).toEqual([{ kind: "USER", id: RM, label: "Awa Risk", detail: "administrateur + Risk Manager" }]);
    expect(status(f, "GOV-COM-01").status).toBe("NOT_RESPECTED");
    expect(status(f, "GOV-AUD-02").status).toBe("RESPECTED");
  });

  it("never « respected » for lack of data: Analyse and Committee votes are NOT_EVALUABLE", () => {
    expect(status(facts(), "GOV-OWN-03")).toMatchObject({ status: "NOT_EVALUABLE", offenders: [] });
    expect(status(facts(), "GOV-COM-02").notEvaluableReason).toMatch(/B-12/);
  });

  it("contrôle détectif: a validation by the author without the marker is an offender of SOD-01", () => {
    const f = facts({ selfValidatedUnmarked: [{ auditId: "a1", at: NOW, userId: RM, entityType: "ControlExecution", entityId: "e1", action: "VALIDATE" }], selfValidatedUnmarkedTotal: 1 });
    expect(status(f, "GOV-SOD-01").offenders[0]).toMatchObject({ kind: "DECISION", id: "a1", detail: expect.stringMatching(/sans marqueur/) });
  });

  it("an active acceptance covering every current offender gives ACCEPTED; a new offender, or an expired one, NOT_RESPECTED", () => {
    const acc: ActiveAcceptance = { id: "acc", principleId: "GOV-RISK-01", expiresAt: new Date("2027-01-01"), reason: "TPE", regime: "ALONE", acceptedBy: ADM, confirmedBy: null, offendersSnapshot: [{ kind: "GROUP", id: "RISK_MANAGER" }] };
    expect(status(facts(), "GOV-RISK-01", [acc]).status).toBe("ACCEPTED");
    expect(status(facts(), "GOV-RISK-01", [{ ...acc, expiresAt: new Date("2026-11-02") }]).status).toBe("NOT_RESPECTED");
    expect(status(facts(), "GOV-SOD-04", [{ ...acc, principleId: "GOV-SOD-04", offendersSnapshot: [] }]).status).toBe("NOT_RESPECTED");
  });

  it("CMP: ACCEPTED leaves as soon as a new offender appears, and when the acceptance expires", () => {
    const OTHER = "44444444-4444-4444-8444-444444444444";
    const acc: ActiveAcceptance = { id: "acc", principleId: "GOV-SOD-04", expiresAt: new Date("2027-01-01"), reason: "TPE", regime: "ALONE", acceptedBy: ADM, confirmedBy: null, offendersSnapshot: [{ kind: "USER", id: RM }] };
    expect(status(facts(), "GOV-SOD-04", [acc]).status).toBe("ACCEPTED");
    const withNew = facts({
      users: [...facts().users, { id: OTHER, label: "Dina", active: true, directPermissions: [] }],
      assignments: [...facts().assignments, { userId: OTHER, roleId: "r-adm", grantedBy: ADM }, { userId: OTHER, roleId: "r-aud", grantedBy: ADM }],
    });
    expect(status(withNew, "GOV-SOD-04", [acc])).toMatchObject({ status: "NOT_RESPECTED", acceptance: null });
    expect(status(facts({ now: new Date("2027-01-02") }), "GOV-SOD-04", [acc]).status).toBe("NOT_RESPECTED");
  });

  it("QA-D6-02: a bounded list gives the exact total (offendersTotal)", () => {
    const gaps = Array.from({ length: 50 }, (_, i) => ({ id: `r${i}`, label: `R${i}`, restricted: false, issue: "NO_OWNER" as const }));
    expect(status(facts({ riskOwnerGaps: gaps, riskOwnerGapsTotal: 55 }), "GOV-OWN-01")).toMatchObject({ offendersTotal: 55 });
    expect(status(facts(), "GOV-RISK-01").offendersTotal).toBe(1);
  });

  it("Codex P2 (PR #235): beyond the bounded list an acceptance is never applied, with an explicit note", () => {
    const gaps = Array.from({ length: 50 }, (_, i) => ({ id: `r${i}`, label: `R${i}`, restricted: false, issue: "NO_OWNER" as const }));
    const acc: ActiveAcceptance = { id: "acc", principleId: "GOV-OWN-01", expiresAt: new Date("2027-01-01"), reason: "x", regime: "ALONE", acceptedBy: ADM, confirmedBy: null,
      offendersSnapshot: gaps.map((g) => ({ kind: "RISK", id: g.id })) };
    expect(status(facts({ riskOwnerGaps: gaps, riskOwnerGapsTotal: 50 }), "GOV-OWN-01", [acc]).status).toBe("ACCEPTED");
    const over = status(facts({ riskOwnerGaps: gaps, riskOwnerGapsTotal: 51 }), "GOV-OWN-01", [acc]);
    expect(over).toMatchObject({ status: "NOT_RESPECTED", acceptance: null, offendersTotal: 51 });
    expect(over.acceptanceNote).toMatch(/51 objets en cause/);
  });

  it("Codex P2 (PR #235): « régime non déclaré » needs exactly one active person with a role (0 is a vacancy)", () => {
    const one = facts({ assignments: [{ userId: RM, roleId: "r-rm", grantedBy: ADM }], selfValidatedUnmarkedTotal: 1 });
    expect(status(one, "GOV-REG-01").status).toBe("NOT_RESPECTED");
    expect(status(facts({ assignments: [], selfValidatedUnmarkedTotal: 1 }), "GOV-REG-01").status).toBe("RESPECTED");
  });

  describe("D6bis — q233 A thresholds", () => {
    const RM2 = "55555555-5555-4555-8555-555555555555";
    const twoRms = (over: Partial<GovernanceFacts> = {}) => facts({
      users: [...facts().users, { id: RM2, label: "Eli", active: true, directPermissions: [] }],
      assignments: [...facts().assignments, { userId: RM2, roleId: "r-rm", grantedBy: ADM }],
      ...over,
    });

    it("RISK-01: a Risk Manager owning more than 20 % of at least 10 risks; below 10 risks and nothing else, NOT_EVALUABLE", () => {
      expect(status(twoRms({ risksTotal: 10, risksOwnedBy: { [RM]: 3 } }), "GOV-RISK-01").offenders).toEqual([
        { kind: "USER", id: RM, label: "Awa Risk", detail: "propriétaire direct de 30 % des risques (seuil 20 %)" },
      ]);
      expect(status(twoRms({ risksTotal: 10, risksOwnedBy: { [RM]: 2 } }), "GOV-RISK-01").status).toBe("RESPECTED");
      expect(status(twoRms({ risksTotal: 9, risksOwnedBy: { [RM]: 9 } }), "GOV-RISK-01")).toMatchObject({ status: "NOT_EVALUABLE", notEvaluableReason: expect.stringMatching(/Échantillon insuffisant/) });
    });

    it("OWN-01 (d): more than 50 % of at least 10 risks created and owned by the same person; small registry NOT_EVALUABLE", () => {
      expect(status(facts({ risksTotal: 10, risksCreatorIsOwner: 6 }), "GOV-OWN-01").offenders).toEqual([
        expect.objectContaining({ id: "creatorOwnerShare", count: 6, detail: "60 % des risques (seuil 50 %)" }),
      ]);
      expect(status(facts({ risksTotal: 10, risksCreatorIsOwner: 5 }), "GOV-OWN-01").status).toBe("RESPECTED");
      expect(status(facts({ risksTotal: 4 }), "GOV-OWN-01").status).toBe("NOT_EVALUABLE");
    });

    it("ACC-01: too many administrators, a custom role too wide (count or families), a dormant privileged account; fixed groups excluded from width", () => {
      const admins = ["a1", "a2", "a3"].map((id) => ({ id, label: id, active: true, directPermissions: ["user.update"] }));
      const wide = { id: "r-wide", name: "Fourre-tout", systemGroup: null, permissions: ["risk.read", "control.read", "kpi.read", "audit.mission.read"] };
      const big = { id: "r-big", name: "Large", systemGroup: "AUDIT" as const, permissions: Array.from({ length: 30 }, (_, i) => `audit.p${i}.read`) };
      const f = facts({
        users: [...facts().users.map((u) => (u.id === AUD ? { ...u, lastSeenAt: new Date(NOW.getTime() - 100 * 86_400_000) } : { ...u, lastSeenAt: NOW })), ...admins],
        roles: [...facts().roles, wide, big],
      });
      const o = status(f, "GOV-ACC-01").offenders;
      expect(o).toContainEqual(expect.objectContaining({ id: "administrators", count: 4 }));
      expect(o).toContainEqual(expect.objectContaining({ kind: "ROLE", id: "r-wide", detail: "4 familles de permissions (seuil 4)" }));
      expect(o.map((x) => x.id)).not.toContain("r-big");
      expect(o).toContainEqual(expect.objectContaining({ kind: "USER", id: AUD, detail: "compte à privilèges sans activité depuis plus de 90 jours" }));
      // NULL last activity is dormant only once the tracking itself is older than the threshold
      const fresh = facts({ users: facts().users.map((u) => ({ ...u, lastSeenAt: null })) });
      expect(status(fresh, "GOV-ACC-01").offenders.filter((x) => x.kind === "USER")).toEqual([]);
      const old = facts({ users: facts().users.map((u) => ({ ...u, lastSeenAt: null })), trackedSince: new Date(NOW.getTime() - 91 * 86_400_000) });
      expect(status(old, "GOV-ACC-01").offenders.filter((x) => x.kind === "USER").length).toBe(2);
    });
  });

  describe("D6bis — q234 C ALLOWED_BY_SETTING (SOD-04)", () => {
    const COM = "66666666-6666-4666-8666-666666666666";
    const cumul = (allowed: boolean, over: Partial<GovernanceFacts> = {}) => facts({
      users: [{ id: COM, label: "Fanta", active: true, directPermissions: [] }],
      roles: [{ id: "r-com", name: "Comité", systemGroup: "RISK_COMMITTEE", permissions: [] }, { id: "r-aud", name: "Audit", systemGroup: "AUDIT", permissions: ["audit.read"] }],
      assignments: [{ userId: COM, roleId: "r-com", grantedBy: ADM }, { userId: COM, roleId: "r-aud", grantedBy: ADM }],
      config: { committeeAuditCumulAllowed: allowed, committeeEvaluationEnforced: true, committeeTreatmentMinScore: 12 },
      cumulSetting: { userId: ADM, at: new Date("2026-10-20T10:00:00Z") },
      ...over,
    });
    it("Committee + Audit allowed by the setting: out of the alerts, listed with the person and who set it, when", () => {
      expect(status(cumul(true), "GOV-SOD-04")).toMatchObject({
        status: "ALLOWED_BY_SETTING",
        offenders: [{ kind: "USER", id: COM, detail: `Comité + Audit — autorisé par le paramètre (réglage du 2026-10-20 par ${ADM})` }],
      });
    });
    it("stays NOT_RESPECTED when the setting forbids it, or when the person validated their own input", () => {
      expect(status(cumul(false), "GOV-SOD-04").status).toBe("NOT_RESPECTED");
      // D6B-02: the self-validators come from the complete query, never from the bounded display lists
      const voted = cumul(true, { selfValidators: [COM], selfValidatedUnmarked: [] });
      expect(status(voted, "GOV-SOD-04")).toMatchObject({ status: "NOT_RESPECTED", offenders: [{ detail: expect.stringMatching(/a validé ses propres saisies/) }] });
    });
  });

  it("TRC-02: a high-severity principle not respected and no manager designated", () => {
    expect(status(facts(), "GOV-TRC-02").status).toBe("NOT_RESPECTED");
    expect(status(facts({ managerDesignated: true }), "GOV-TRC-02").status).toBe("RESPECTED");
  });
});

describe("D6 — GovernanceHealthService (masking R-6.1 / q156)", () => {
  const marked = { auditId: "m1", at: new Date(Date.now() - 2.5 * 86_400_000), userId: RM, rule: "noSelfValidation", entityType: "ControlExecution", entityId: "e1", action: "VALIDATE", reason: "seul", reviewed: false };
  const vacancy = { ...marked, auditId: "m2", rule: "riskManager.vacancy", entityType: "User", entityId: RM, action: "UPDATE", reviewed: false };
  const service = () =>
    new GovernanceHealthService(
      { loadFacts: async () => facts({ markedActions: [marked, vacancy], markedTotal: 2, unreviewedTotal: 1, oldestUnreviewedAt: marked.at, exceptionReviewDelayDays: 1,
        riskOwnerGaps: [{ id: "r-pub", label: "Public", restricted: false, issue: "NO_OWNER" }, { id: "r-secret", label: null, restricted: true, issue: "OWNER_SUSPENDED" }],
        lastSeenPurgeAt: new Date(Date.now() - 3.5 * 86_400_000) }), activeAcceptances: async () => [] },
      { getActive: async () => null, observe: async () => ({ activeAccounts: 3, riskManagers: 1, committeeMembers: 0, auditMembers: 1 }) },
    );
  const actor = (roles: string[]): AuthenticatedUser => ({ userId: ADM, tenantId: "t", email: "a@t", roles } as AuthenticatedUser);

  it("needs governancehealth.read", async () => {
    await expect(service().get(actor([]))).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("without audit.read: no user id nor name anywhere, « Personne N » instead, counts kept; age and overdue computed", async () => {
    const view = await service().get(actor(["governancehealth.read"]));
    const text = JSON.stringify(view);
    expect(text).not.toContain(RM);
    expect(text).not.toContain("Awa Risk");
    expect(view.principles.find((p) => p.id === "GOV-SOD-04")!.offenders[0]).toMatchObject({ id: null, label: "Personne 1" });
    expect(view.exceptions).toMatchObject({ total: 2, unreviewed: 1, items: [{ userId: null, userLabel: null, ageDays: 2, overdue: true, mine: false }, { entityType: "User", entityId: "Personne 1" }] });
    // q232 A / SEC D6-02: no free-text reason, the day only; a restricted risk is a count for a reader outside the fixed groups.
    expect(view.exceptions.items[0]).toMatchObject({ reason: null, at: marked.at.toISOString().slice(0, 10) });
    expect(text).not.toContain("r-secret");
    // QA-D6-01: an exception on a person's account never hands their id over.
    expect(view.exceptions.items.map((i) => i.entityId)).not.toContain(RM);
    expect(view.principles.find((p) => p.id === "GOV-OWN-01")!.offenders).toEqual([
      expect.objectContaining({ id: "r-pub" }), expect.objectContaining({ id: "restricted", count: 1, label: null }),
    ]);
    expect(view.trackedSince).toBeInstanceOf(Date);
    expect(view.retentionPurge).toMatchObject({ ageDays: 3 });
    // CMP: no global score hides the principles that cannot be evaluated.
    expect(Object.keys(view).sort()).toEqual(["catalogVersion", "computedAt", "exceptions", "organizationSize", "principles", "profileGaps", "retentionPurge", "soleRm", "trackedSince"]);
    expect(view.organizationSize).toBeNull();
    expect(view.principles.every((p) => p.highlighted === null)).toBe(true);
  });

  it("q266 A: a SOLE_RM exception is overdue after the SOLE_RM default delay when the tenant set none, the tenant's delay wins otherwise", async () => {
    const sole = { ...marked, auditId: "s1", rule: "riskFramework.soleRiskManager", entityType: "RiskFrameworkChangeRequest", action: "APPROVE", at: new Date(Date.now() - 10 * 86_400_000) };
    const view = (delay: number | null) => new GovernanceHealthService(
      { loadFacts: async () => facts({ markedActions: [sole, marked], markedTotal: 2, unreviewedTotal: 2, exceptionReviewDelayDays: delay,
        soleRm: { total: 1, unreviewed: 1, overdue: 0, withoutPriorReview: 0 } }), activeAcceptances: async () => [] },
      { getActive: async () => null, observe: async () => ({ activeAccounts: 3, riskManagers: 1, committeeMembers: 0, auditMembers: 1 }) },
    ).get(actor(["governancehealth.read"]));
    const none = await view(null);
    expect(none.exceptions.items.map((i) => i.overdue)).toEqual([false, false]);
    expect(none.soleRm).toEqual({ total: 1, unreviewed: 1, overdue: 0, withoutPriorReview: 0, reviewDelayDays: SOLE_RM_REVIEW_DEFAULT_DAYS });
    const set = await view(5);
    expect(set.exceptions.items.map((i) => i.overdue)).toEqual([true, false]);
    expect(set.soleRm.reviewDelayDays).toBe(5);
  });

  it("a fixed-group member sees the restricted risk; the exception reviewer sees reason and exact time", async () => {
    const rmView = await service().get({ ...actor(["governancehealth.read", "governanceexception.review"]), userId: RM } as AuthenticatedUser);
    expect(rmView.principles.find((p) => p.id === "GOV-OWN-01")!.offenders.map((o) => o.id)).toEqual(["r-pub", "r-secret"]);
    expect(rmView.exceptions.items[0]).toMatchObject({ reason: "seul", at: marked.at, mine: true });
  });

  it("with audit.read: the names are shown", async () => {
    const view = await service().get(actor(["governancehealth.read", "audit.read"]));
    expect(view.exceptions.items[0]).toMatchObject({ userId: RM, userLabel: "Awa Risk" });
    expect(view.principles.find((p) => p.id === "GOV-SOD-04")!.offenders[0]).toMatchObject({ id: RM, label: "Awa Risk" });
  });
});

describe("Codex P2 (PR #236): the settings screen shows every key of a pending request", () => {
  const page = readFileSync(new URL("../../frontend/src/features/governance/GovernanceSettingsPage.tsx", import.meta.url), "utf8");
  it("renders the pending request from all its keys (never filtered by a known list), current → requested", () => {
    expect(page).toMatch(/Object\.keys\(requested\)\.map/);
    expect(page).toMatch(/pendingChanges\(delayPending\.requestedDelays/);
    expect(page).not.toMatch(/\.filter\(\(d\) => d\.key in delayPending\.requestedDelays\)/);
  });
  it("has a readable label for every A13 threshold (an unknown key would still show by its name)", () => {
    for (const key of Object.keys(GOVERNANCE_THRESHOLDS)) expect(page, key).toMatch(new RegExp(`${key}: \\{ label: "`));
  });
});

describe("D6bis — migration 086 (D6B-03, DECISION-061)", () => {
  it("gives every client without a configs row the cumul value applied until then (true), never UPDATEs an existing row; the down keeps those rows", () => {
    const up = migrationSql("086_governance_thresholds.sql");
    expect(up).toMatch(/ALTER COLUMN committee_audit_cumul_allowed SET DEFAULT false/);
    expect(up).toMatch(/INSERT INTO configs \(tenant_id, committee_audit_cumul_allowed, committee_evaluation_min_score\)\s+SELECT t\.id, true,/);
    expect(up).toMatch(/WHERE NOT EXISTS \(SELECT 1 FROM configs c WHERE c\.tenant_id = t\.id\)/);
    expect(up.split("\n").filter((l) => !l.trim().startsWith("--")).join("\n")).not.toMatch(/\bUPDATE\b|\bDELETE\b/);
    expect(migrationSql("086_governance_thresholds.down.sql")).toMatch(/SET DEFAULT true/);
  });
});

describe("D6 — migration 085", () => {
  it("adds tenants.governance_tracking_started_at, idempotent, and its down removes it", () => {
    expect(migrationSql("085_governance_tracking.sql")).toMatch(/ADD COLUMN IF NOT EXISTS governance_tracking_started_at timestamptz NOT NULL DEFAULT now\(\)/);
    expect(migrationSql("085_governance_tracking.down.sql")).toMatch(/DROP COLUMN IF EXISTS governance_tracking_started_at/);
  });
});

describe.skipIf(!hasLocalPg)("D6 on real PostgreSQL (local only)", () => {
  const { ctx, one } = useMigrationTenant("d6");
  const user = async (name: string) =>
    (await one(`INSERT INTO users (tenant_id, email, display_name) VALUES ($1, $2, $3) RETURNING id`, [ctx.tenant, `${name}-${Math.random()}@d6`, name])).id as string;

  it("loadFacts: trackedSince, unmarked self-validation (detective control), risk and process gaps, restricted label hidden", async () => {
    const [a, b] = await Promise.all(["a", "b"].map(user));
    const exec = "44444444-4444-4444-8444-444444444444";
    const audit = (u: string, action: string, marker: string | null) =>
      one(`INSERT INTO audit_log (tenant_id, user_id, entity_type, entity_id, action, old_value, new_value, request_id, governance_exception)
           VALUES ($1, $2, 'ControlExecution', $3, $4, '{}', '{}', $5, $6) RETURNING id`, [ctx.tenant, u, exec, action, `d6-${Math.random()}`, marker]);
    await audit(a!, "CREATE", null);
    const validated = (await audit(a!, "VALIDATE", null)).id;
    await one(`INSERT INTO risks (tenant_id, process, description, visibility) VALUES ($1, 'p', 'Risque public D6', 'CLIENT') RETURNING id`, [ctx.tenant]);
    await one(`INSERT INTO risks (tenant_id, process, description, owner_id, visibility) VALUES ($1, 'p', 'Risque restreint D6', $2, 'PERIMETRE') RETURNING id`, [ctx.tenant, b]);
    await one(`UPDATE users SET deleted_at = now() WHERE id = $1 RETURNING id`, [b]);
    await one(`INSERT INTO processes (tenant_id, level, name, owner_user_id) VALUES ($1, 'PROCESS', 'Processus D6', $2) RETURNING id`, [ctx.tenant, a]);

    const f = await new PostgresGovernanceHealthRepository(ctx.pool).loadFacts(ctx.tenant, new Date());
    expect(f.trackedSince).toBeInstanceOf(Date);
    expect(f.selfValidatedUnmarked.map((v) => v.auditId)).toEqual([validated]);
    expect(f.riskOwnerGaps.map((r) => [r.label, r.issue]).sort()).toEqual([["Risque public D6", "NO_OWNER"], [null, "OWNER_SUSPENDED"]].sort());
    expect(f.processGaps).toEqual([expect.objectContaining({ label: "Processus D6", missingOwner: false, missingChampion: true })]);
    expect(f.users.find((u) => u.id === b)?.active).toBe(false);
    // q233 A / q234 C (D6bis): default thresholds of 086, live risk counts, last cumul setting change
    expect(f.thresholds).toEqual({ govRmRiskShareMaxPct: 20, govMaxAdmins: 3, govRoleMaxPermissions: 25, govRoleMaxFamilies: 4, govDormantDays: 90, govOwnerCreatorShareMaxPct: 50 });
    expect([f.risksTotal, f.risksCreatorIsOwner, f.risksOwnedBy]).toEqual([2, 0, { [b!]: 1 }]);
    expect(f.cumulSetting).toBeNull();
    await one(`INSERT INTO audit_log (tenant_id, user_id, entity_type, entity_id, action, old_value, new_value, request_id)
               VALUES ($1, $2, 'Config', $1, 'UPDATE', '{"committeeAuditCumulAllowed": false}', '{"committeeAuditCumulAllowed": true}', 'd6bis') RETURNING id`, [ctx.tenant, a]);
    // the creator is the author of the Risk CREATE audit entry (no creator column on risks)
    const own = (await one(`INSERT INTO risks (tenant_id, process, description, owner_id, visibility) VALUES ($1, 'p', 'Créé et possédé', $2, 'CLIENT') RETURNING id`, [ctx.tenant, a])).id;
    await one(`INSERT INTO audit_log (tenant_id, user_id, entity_type, entity_id, action, old_value, new_value, request_id)
               VALUES ($1, $2, 'Risk', $3, 'CREATE', NULL, '{}', 'd6bis-r') RETURNING id`, [ctx.tenant, a, own]);
    const g = await new PostgresGovernanceHealthRepository(ctx.pool).loadFacts(ctx.tenant, new Date());
    expect(g.cumulSetting).toEqual({ userId: a, at: expect.any(Date) });
    expect([g.risksTotal, g.risksCreatorIsOwner]).toEqual([3, 1]);
  });

  it("D6B-02: the self-validators come from a complete query — one old self-validation behind 51 recent ones of others still counts", async () => {
    const [x, y] = await Promise.all(["x", "y"].map(user));
    const selfValidate = async (u: string) => {
      const obj = crypto.randomUUID();
      for (const action of ["CREATE", "VALIDATE"]) {
        await one(`INSERT INTO audit_log (tenant_id, user_id, entity_type, entity_id, action, old_value, new_value, request_id)
                   VALUES ($1, $2, 'ControlExecution', $3, $4, '{}', '{}', 'd6b02') RETURNING id`, [ctx.tenant, u, obj, action]);
      }
    };
    await selfValidate(x!);
    for (let i = 0; i < 51; i += 1) await selfValidate(y!);
    const f = await new PostgresGovernanceHealthRepository(ctx.pool).loadFacts(ctx.tenant, new Date());
    expect(f.selfValidatedUnmarked.map((v) => v.userId)).not.toContain(x);
    expect(f.selfValidators).toEqual(expect.arrayContaining([x, y]));
  });

  it("DECISION-061 (q119): a tenant created without an explicit setting forbids the Committee + Audit cumul; a cumul is then NOT_RESPECTED", async () => {
    await one(`INSERT INTO configs (tenant_id) VALUES ($1) ON CONFLICT (tenant_id) DO UPDATE SET tenant_id = EXCLUDED.tenant_id RETURNING tenant_id`, [ctx.tenant]);
    const f = await new PostgresGovernanceHealthRepository(ctx.pool).loadFacts(ctx.tenant, new Date());
    expect(f.config?.committeeAuditCumulAllowed).toBe(false);
    const com = "77777777-7777-4777-8777-777777777777";
    const x = computePanel({
      ...f,
      users: [{ id: com, label: "Gaby", active: true, directPermissions: [] }],
      roles: [{ id: "r-com", name: "Comité", systemGroup: "RISK_COMMITTEE", permissions: [] }, { id: "r-aud", name: "Audit", systemGroup: "AUDIT", permissions: ["audit.read"] }],
      assignments: [{ userId: com, roleId: "r-com", grantedBy: com }, { userId: com, roleId: "r-aud", grantedBy: com }],
    }, []).find((r) => r.id === "GOV-SOD-04")!;
    expect(x).toMatchObject({ status: "NOT_RESPECTED", offenders: [{ id: com, detail: "Comité + Audit (paramètre : interdit)" }] });
  });
});
