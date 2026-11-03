import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { CATALOG_VERSION, PRINCIPLES } from "../src/domain/governance/catalog.js";
import { computePanel, DETECTORS, type ActiveAcceptance, type GovernanceFacts } from "../src/domain/governance/health.js";
import { GovernanceHealthService } from "../src/services/GovernanceHealthService.js";
import { PostgresGovernanceHealthRepository } from "../src/infrastructure/database/postgres/PostgresGovernanceHealthRepository.js";
import { ForbiddenError } from "../src/domain/errors/DomainErrors.js";
import type { AuthenticatedUser } from "../src/infrastructure/identity/IdentityProvider.js";
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
    processGaps: [],
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
    ...over,
  };
}
const status = (f: GovernanceFacts, id: string, acc: ActiveAcceptance[] = []) => computePanel(f, acc).find((r) => r.id === id)!;

describe("D6 — catalog copied from the A13 JSON", () => {
  it("same ids, titles, consequences, severities and indications as docs/governance/principes; one detector per principle", () => {
    const json = JSON.parse(readFileSync(join(__dirname, "..", "..", "docs", "governance", "principes", "principes-gouvernance.json"), "utf8"));
    expect(CATALOG_VERSION).toBe(json.meta.version);
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

  it("TRC-02: a high-severity principle not respected and no manager designated", () => {
    expect(status(facts(), "GOV-TRC-02").status).toBe("NOT_RESPECTED");
    expect(status(facts({ managerDesignated: true }), "GOV-TRC-02").status).toBe("RESPECTED");
  });
});

describe("D6 — GovernanceHealthService (masking R-6.1 / q156)", () => {
  const marked = { auditId: "m1", at: new Date(Date.now() - 2.5 * 86_400_000), userId: RM, rule: "noSelfValidation", entityType: "ControlExecution", entityId: "e1", action: "VALIDATE", reason: "seul", reviewed: false };
  const service = () =>
    new GovernanceHealthService(
      { loadFacts: async () => facts({ markedActions: [marked], markedTotal: 1, unreviewedTotal: 1, oldestUnreviewedAt: marked.at, exceptionReviewDelayDays: 1 }), activeAcceptances: async () => [] },
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
    expect(view.exceptions).toMatchObject({ total: 1, unreviewed: 1, items: [{ userId: null, userLabel: null, ageDays: 2, overdue: true, mine: false }] });
    expect(view.organizationSize).toBeNull();
    expect(view.principles.every((p) => p.highlighted === null)).toBe(true);
  });

  it("with audit.read: the names are shown", async () => {
    const view = await service().get(actor(["governancehealth.read", "audit.read"]));
    expect(view.exceptions.items[0]).toMatchObject({ userId: RM, userLabel: "Awa Risk" });
    expect(view.principles.find((p) => p.id === "GOV-SOD-04")!.offenders[0]).toMatchObject({ id: RM, label: "Awa Risk" });
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
  });
});
