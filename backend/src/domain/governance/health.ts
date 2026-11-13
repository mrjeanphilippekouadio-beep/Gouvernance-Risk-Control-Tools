import type { Permission } from "../permissions.js";
import type { Role, SystemGroup } from "../entities/Role.js";
import {
  ADMIN_PERMISSIONS,
  isAdministrator,
  isAuditGroupPermission,
  isCommitteeMember,
  isRiskManagerMember,
} from "../fixedGroupPermissions.js";
import { PRINCIPLES, type PrincipleId } from "./catalog.js";
import type { GovernanceThresholds } from "../entities/Config.js";

/** q233 A (A13 rule 3): RISK-01 and OWN-01 (d) need at least this many live risks; below, « échantillon insuffisant ». */
export const MIN_RISKS_SAMPLE = 10;

/**
 * Lot D6 (DECISION-074 R-6, spec RM-V1-Panel-Principes-Gouvernance): what the governance panel computes, as pure
 * functions over one read-only snapshot of the client (`GovernanceFacts`). No I/O, no clock (`now` is a fact). The
 * frontend displays the result; it never recomputes a status.
 *
 * A detector returns the offending objects (none = RESPECTED) or NOT_EVALUABLE with a reason: a principle is never shown
 * "respected" for lack of data. Only the unambiguous parts of each A13 rule are evaluated; a part that needs a threshold
 * the PO has not fixed is left out (never invented) and the detector says which parts it covers.
 */

export interface FactRole {
  id: string;
  name: string;
  systemGroup: SystemGroup | null;
  permissions: string[];
}

export interface FactUser {
  id: string;
  label: string;
  active: boolean;
  /** Legacy permissions carried directly by the account (`users.roles`). */
  directPermissions: string[];
  /** ACC-01 (c) only: never exposed by the panel (q156). Optional for older fixtures. */
  lastSeenAt?: Date | null;
}

export interface MarkedAction {
  auditId: string;
  at: Date;
  userId: string;
  rule: string;
  entityType: string;
  entityId: string;
  action: string;
  reason: string | null;
  reviewed: boolean;
}

export interface GovernanceFacts {
  now: Date;
  trackedSince: Date;
  users: FactUser[];
  roles: FactRole[];
  /** Active assignments only (not revoked, role not deleted). */
  assignments: Array<{ userId: string; roleId: string; grantedBy: string }>;
  config: { committeeAuditCumulAllowed: boolean; committeeEvaluationEnforced: boolean; committeeTreatmentMinScore: number | null } | null;
  /** Risk framework decisions taken in FALLBACK / BOOTSTRAP whose ratification is still pending. */
  pendingRatifications: Array<{ requestId: string; regime: string; deciderGroup: string | null; decidedAt: Date }>;
  /** Live risks (not deleted, not archived) without an owner, or whose owner account is suspended. Label null when restricted. */
  riskOwnerGaps: Array<{ id: string; label: string | null; restricted: boolean; issue: "NO_OWNER" | "OWNER_SUSPENDED" }>;
  /** Exact count behind the bounded list (QA-D6-02). */
  riskOwnerGapsTotal: number;
  /** Active processes missing an owner account or a risk champion (D2b). */
  processGaps: Array<{ id: string; label: string; missingOwner: boolean; missingChampion: boolean }>;
  processGapsTotal: number;
  /** Marked actions since trackedSince, exact count per rule (the list itself is bounded). */
  markedCountByRule: Record<string, number>;
  /** Actions marked « applied without a second validation » since trackedSince, most recent first (bounded). */
  markedActions: MarkedAction[];
  markedTotal: number;
  unreviewedTotal: number;
  oldestUnreviewedAt: Date | null;
  /** Detective control: validations / closures by the author of the object, without the marker (bounded). */
  selfValidatedUnmarked: Array<{ auditId: string; at: Date; userId: string; entityType: string; entityId: string; action: string }>;
  selfValidatedUnmarkedTotal: number;
  managerDesignated: boolean;
  interimDesignated: boolean;
  /** Single-person regime (D2d): declared and not lifted. */
  singlePersonRegimeActive: boolean;
  riskManagerVacancySince: Date | null;
  riskManagerVacancyMaxDays: number | null;
  exceptionReviewDelayDays: number | null;
  /** q266 A (C3): SOLE_RM confirmations since trackedSince, one per confirmation; `overdue` already uses the delay (tenant's, else the SOLE_RM default). Optional: absent = none. */
  soleRm?: { total: number; unreviewed: number; overdue: number; withoutPriorReview: number };
  /** q231 B: last real execution of the R3 purge (its execution trace), null if never run. */
  lastSeenPurgeAt: Date | null;
  /** q233 A: live risks (not deleted, not archived), those whose creator is the owner, and the count per owner. */
  risksTotal: number;
  risksCreatorIsOwner: number;
  risksOwnedBy: Record<string, number>;
  /** q234 C: last change of the Committee + Audit cumul setting (who, when), null if never changed. */
  cumulSetting: { userId: string; at: Date } | null;
  /** D6B-02: every account that validated its own input since trackedSince (marked or not), never a bounded list. */
  selfValidators: string[];
  /** q233 A: the client's panel thresholds. */
  thresholds: GovernanceThresholds;
}

export type OffenderKind = "ROLE" | "PERMISSION" | "USER" | "GROUP" | "SETTING" | "DECISION" | "RISK" | "PROCESS";

export interface Offender {
  kind: OffenderKind;
  id: string;
  label: string | null;
  count?: number;
  detail?: string;
  /** A restricted resource (not CLIENT): its id and state are for the fixed groups only (q232 A, SEC D6-02). */
  restricted?: boolean;
}

/** `total`: the exact number of offenders when the list is bounded (QA-D6-02); the list length otherwise. */
export type DetectorResult =
  /** `allowedBySetting`: every offender is a cumul the client's setting allows (q234 C). */
  | { offenders: Offender[]; covers?: string; total?: number; allowedBySetting?: boolean }
  | { notEvaluable: string };

const DAY = 86_400_000;
const NOT_BUILT = "Donnée appartenant à une fonction non livrée (R-Q3, DECISION-075) : évaluable à sa livraison";

function rolesByUser(f: GovernanceFacts): Map<string, FactRole[]> {
  const byId = new Map(f.roles.map((r) => [r.id, r]));
  const out = new Map<string, FactRole[]>();
  for (const a of f.assignments) {
    const role = byId.get(a.roleId);
    if (!role) continue;
    out.set(a.userId, [...(out.get(a.userId) ?? []), role]);
  }
  return out;
}

const activeUsers = (f: GovernanceFacts): FactUser[] => f.users.filter((u) => u.active);
const asRoles = (rs: FactRole[]): Role[] => rs as unknown as Role[];

/** Active members of a fixed group (a person counts once). */
export function groupMembers(f: GovernanceFacts, group: SystemGroup): FactUser[] {
  const by = rolesByUser(f);
  return activeUsers(f).filter((u) => (by.get(u.id) ?? []).some((r) => r.systemGroup === group));
}

const userOffender = (u: FactUser, detail?: string): Offender => ({ kind: "USER", id: u.id, label: u.label, ...(detail ? { detail } : {}) });
const groupOffender = (group: SystemGroup, count: number, detail: string): Offender => ({ kind: "GROUP", id: group, label: group, count, detail });

function isAdminUser(roles: FactRole[], u: FactUser): boolean {
  return isAdministrator(asRoles(roles)) || u.directPermissions.some((p) => (ADMIN_PERMISSIONS as string[]).includes(p));
}

const decision = (a: { auditId: string; entityType: string; entityId: string; action: string; at: Date }, detail?: string): Offender => ({
  kind: "DECISION",
  id: a.auditId,
  label: `${a.entityType} ${a.entityId}`,
  detail: detail ?? `${a.action} — ${a.at.toISOString().slice(0, 10)}`,
});

export const DETECTORS: Record<PrincipleId, (f: GovernanceFacts) => DetectorResult> = {
  // Self-validation: marked noSelfValidation acts, and (detective control) validations by the author left unmarked.
  "GOV-SOD-01": (f) => ({
    covers: "actes marqués « sans validation indépendante » et validations par l'auteur sans marqueur, depuis le début du suivi",
    total: (f.markedCountByRule["noSelfValidation"] ?? 0) + f.selfValidatedUnmarkedTotal,
    offenders: [
      ...f.markedActions.filter((m) => m.rule === "noSelfValidation").map((m) => decision(m, "validé par son auteur (marqué)")),
      ...f.selfValidatedUnmarked.map((m) => decision(m, "validé par son auteur sans marqueur (contrôle détectif)")),
    ],
  }),
  "GOV-SOD-02": (f) => ({
    offenders: f.pendingRatifications.map((r) => ({
      kind: "DECISION" as const,
      id: r.requestId,
      label: `Dispositif — décision ${r.regime}`,
      detail: `ratification en attente depuis ${Math.floor((f.now.getTime() - r.decidedAt.getTime()) / DAY)} jour(s)`,
    })),
  }),
  "GOV-SOD-03": (f) => {
    const users = new Map(f.users.map((u) => [u.id, u]));
    const roles = new Map(f.roles.map((r) => [r.id, r]));
    return {
      covers: "attributions de rôle actives faites par le bénéficiaire",
      offenders: f.assignments
        .filter((a) => a.grantedBy === a.userId && users.get(a.userId)?.active)
        .map((a) => userOffender(users.get(a.userId)!, `s'est attribué le rôle ${roles.get(a.roleId)?.name ?? a.roleId}`)),
    };
  },
  "GOV-SOD-04": (f) => {
    const by = rolesByUser(f);
    const offenders: Offender[] = [];
    // q234 C: a Committee + Audit cumul allowed by the setting is out of the alerts — unless the person validated their own input.
    // D6B-02: from a dedicated, complete query — the display lists are cut at 50.
    const selfValidators = new Set(f.selfValidators);
    let allAllowed = true;
    for (const u of activeUsers(f)) {
      const rs = by.get(u.id) ?? [];
      const admin = isAdminUser(rs, u);
      const rm = isRiskManagerMember(asRoles(rs));
      const committee = isCommitteeMember(asRoles(rs));
      const audit = rs.some((r) => r.systemGroup === "AUDIT");
      const cumuls: string[] = [];
      if (admin && rm) cumuls.push("administrateur + Risk Manager");
      if (admin && audit) cumuls.push("administrateur + Audit");
      if (rm && committee) cumuls.push("Risk Manager + Comité");
      if (rm && audit) cumuls.push("Risk Manager + Audit (anomalie)");
      const allowedCumul = committee && audit && f.config?.committeeAuditCumulAllowed === true;
      if (committee && audit) {
        const setting = f.cumulSetting ? ` (réglage du ${f.cumulSetting.at.toISOString().slice(0, 10)} par ${f.cumulSetting.userId})` : "";
        cumuls.push(allowedCumul ? `Comité + Audit — autorisé par le paramètre${setting}` : "Comité + Audit (paramètre : interdit)");
      }
      if (cumuls.length === 0) continue;
      const votedOwn = selfValidators.has(u.id);
      if (votedOwn) cumuls.push("a validé ses propres saisies");
      if (!(allowedCumul && cumuls.length === 1)) allAllowed = false;
      offenders.push(userOffender(u, cumuls.join(" ; ")));
    }
    return { offenders, allowedBySetting: offenders.length > 0 && allAllowed };
  },
  "GOV-SOD-05": () => ({ notEvaluable: "Croisement par dossier (exécution, efficacité, validation de l'évaluation) non construit dans ce lot" }),
  "GOV-RISK-01": (f) => {
    const members = groupMembers(f, "RISK_MANAGER");
    const n = members.length;
    const offenders: Offender[] = n <= 1 ? [groupOffender("RISK_MANAGER", n, n === 0 ? "fonction risque vacante" : "dépendance à une seule personne")] : [];
    const max = f.thresholds.govRmRiskShareMaxPct;
    const sampled = f.risksTotal >= MIN_RISKS_SAMPLE;
    if (sampled) {
      for (const u of members) {
        const pct = ((f.risksOwnedBy[u.id] ?? 0) * 100) / f.risksTotal;
        if (pct > max) offenders.push(userOffender(u, `propriétaire direct de ${Math.round(pct)} % des risques (seuil ${max} %)`));
      }
    }
    // q233 A: below the sample the share cannot be judged — never « respected » for lack of data.
    if (!sampled && offenders.length === 0) return { notEvaluable: `Échantillon insuffisant : ${f.risksTotal} risque(s), au moins ${MIN_RISKS_SAMPLE} requis` };
    return { covers: `effectif du groupe Risk Manager et part des risques dont un Risk Manager est propriétaire (seuil ${max} %)`, offenders };
  },
  "GOV-RISK-02": (f) => {
    const offenders: Offender[] = [];
    const rm = groupMembers(f, "RISK_MANAGER").length;
    if (rm === 0) offenders.push(groupOffender("RISK_MANAGER", 0, "vacance"));
    else if (rm === 1 && !f.interimDesignated) offenders.push(groupOffender("RISK_MANAGER", 1, "un seul membre, ni suppléant ni intérimaire désigné"));
    if (f.riskManagerVacancySince && f.riskManagerVacancyMaxDays !== null) {
      const days = Math.floor((f.now.getTime() - f.riskManagerVacancySince.getTime()) / DAY);
      if (days > f.riskManagerVacancyMaxDays) {
        offenders.push({ kind: "SETTING", id: "riskManagerVacancyMaxDays", label: "Vacance du Risk Manager", detail: `${days} jours, au-delà de ${f.riskManagerVacancyMaxDays}` });
      }
    }
    const committee = groupMembers(f, "RISK_COMMITTEE").length;
    if (committee < 2) offenders.push(groupOffender("RISK_COMMITTEE", committee, "moins de deux membres actifs"));
    return { offenders };
  },
  "GOV-AUD-01": (f) => {
    const by = rolesByUser(f);
    const offenders: Offender[] = [];
    for (const u of groupMembers(f, "AUDIT")) {
      if ((by.get(u.id) ?? []).some((r) => r.systemGroup === "RISK_MANAGER")) offenders.push(userOffender(u, "membre d'Audit et Risk Manager"));
    }
    for (const r of f.roles.filter((r) => r.systemGroup === "AUDIT")) {
      for (const p of r.permissions.filter((p) => !isAuditGroupPermission(p as Permission))) {
        offenders.push({ kind: "PERMISSION", id: p, label: p, detail: `porté par le rôle Audit ${r.name}` });
      }
    }
    return { covers: "cumul Audit + Risk Manager et droits hors lecture du rôle Audit", offenders };
  },
  "GOV-AUD-02": (f) => {
    const n = groupMembers(f, "AUDIT").length;
    return { covers: "effectif du groupe Audit", offenders: n === 0 ? [groupOffender("AUDIT", 0, "aucune 3e ligne")] : [] };
  },
  "GOV-COM-01": (f) => {
    if (!f.config) return { notEvaluable: "Paramètres du client absents" };
    const offenders: Offender[] = [];
    const n = groupMembers(f, "RISK_COMMITTEE").length;
    if (n <= 1) offenders.push(groupOffender("RISK_COMMITTEE", n, n === 0 ? "aucun Comité" : "un seul membre"));
    if (!f.config.committeeEvaluationEnforced) {
      offenders.push({ kind: "SETTING", id: "committeeEvaluationEnforced", label: "Passage obligatoire au Comité", detail: "désactivé" });
    }
    if (f.config.committeeTreatmentMinScore === null) {
      offenders.push({ kind: "SETTING", id: "committeeTreatmentMinScore", label: "Seuil de traitement au Comité", detail: "non fixé : aucune décision n'atteint le Comité" });
    }
    return { covers: "effectif du Comité et réglages de passage au Comité", offenders };
  },
  "GOV-COM-02": () => ({ notEvaluable: `${NOT_BUILT} (votes nominatifs du Comité, B-12)` }),
  "GOV-APP-01": (f) => ({
    covers: "changements d'appétence marqués « sans seconde validation »",
    offenders: f.markedActions.filter((m) => m.rule.startsWith("riskappetite")).map((m) => decision(m)),
    total: Object.entries(f.markedCountByRule).filter(([rule]) => rule.startsWith("riskappetite")).reduce((n, [, c]) => n + c, 0),
  }),
  "GOV-OWN-01": (f) => {
    const offenders: Offender[] = f.riskOwnerGaps.map((r) => ({
      kind: "RISK" as const,
      id: r.id,
      label: r.label,
      ...(r.restricted ? { restricted: true } : {}),
      detail: r.issue === "NO_OWNER" ? "sans propriétaire" : "propriétaire suspendu",
    }));
    let total = f.riskOwnerGapsTotal;
    const max = f.thresholds.govOwnerCreatorShareMaxPct;
    const sampled = f.risksTotal >= MIN_RISKS_SAMPLE;
    if (sampled) {
      const pct = (f.risksCreatorIsOwner * 100) / f.risksTotal;
      if (pct > max) {
        offenders.push({ kind: "SETTING", id: "creatorOwnerShare", label: "Risques créés et possédés par la même personne", count: f.risksCreatorIsOwner, detail: `${Math.round(pct)} % des risques (seuil ${max} %)` });
        total += 1;
      }
    }
    // q233 A: (d) needs at least 10 risks — a small registry with no other gap is « échantillon insuffisant », never « respected ».
    if (!sampled && offenders.length === 0) return { notEvaluable: `Échantillon insuffisant : ${f.risksTotal} risque(s), au moins ${MIN_RISKS_SAMPLE} requis` };
    return { covers: `risques sans propriétaire ou à propriétaire suspendu, et part des risques créés et possédés par la même personne (seuil ${max} %)`, total, offenders };
  },
  "GOV-OWN-02": (f) => ({
    covers: "processus actifs sans propriétaire rattaché à un compte ou sans champion de risque",
    total: f.processGapsTotal,
    offenders: f.processGaps.map((p) => ({
      kind: "PROCESS" as const,
      id: p.id,
      label: p.label,
      detail: [p.missingOwner ? "sans propriétaire (compte)" : null, p.missingChampion ? "sans champion de risque" : null].filter(Boolean).join(" ; "),
    })),
  }),
  "GOV-OWN-03": () => ({ notEvaluable: `${NOT_BUILT} (étape Analyse)` }),
  "GOV-ACC-01": (f) => {
    const t = f.thresholds;
    const by = rolesByUser(f);
    const offenders: Offender[] = [];
    // (a) number of active administrators
    const admins = activeUsers(f).filter((u) => isAdminUser(by.get(u.id) ?? [], u));
    if (admins.length > t.govMaxAdmins) {
      offenders.push({ kind: "SETTING", id: "administrators", label: "Administrateurs actifs", count: admins.length, detail: `${admins.length} administrateurs (seuil ${t.govMaxAdmins})` });
    }
    // (b) custom roles too wide (fixed groups excluded), and rolegroup.audit.update on a custom role (forbidden)
    for (const r of f.roles.filter((r) => r.systemGroup === null)) {
      const families = new Set(r.permissions.map((p) => p.split(".")[0])).size;
      const reasons: string[] = [];
      if (r.permissions.length > t.govRoleMaxPermissions) reasons.push(`${r.permissions.length} permissions (seuil ${t.govRoleMaxPermissions})`);
      if (families >= t.govRoleMaxFamilies) reasons.push(`${families} familles de permissions (seuil ${t.govRoleMaxFamilies})`);
      if (r.permissions.includes("rolegroup.audit.update")) reasons.push("porte rolegroup.audit.update");
      if (reasons.length > 0) offenders.push({ kind: "ROLE", id: r.id, label: r.name, detail: reasons.join(" ; ") });
    }
    // (c) dormant privileged accounts (administration or a fixed group): flagged, never suspended; NULL counts only once
    // the tracking is older than the threshold (q233 A). No date is ever returned (q156).
    const limit = f.now.getTime() - t.govDormantDays * DAY;
    const fixed = new Set((["RISK_MANAGER", "RISK_COMMITTEE", "AUDIT"] as const).flatMap((g) => groupMembers(f, g).map((u) => u.id)));
    for (const u of activeUsers(f)) {
      if (!isAdminUser(by.get(u.id) ?? [], u) && !fixed.has(u.id)) continue;
      const seen = u.lastSeenAt ?? null;
      const dormant = seen ? seen.getTime() < limit : f.trackedSince.getTime() < limit;
      if (dormant) offenders.push(userOffender(u, `compte à privilèges sans activité depuis plus de ${t.govDormantDays} jours`));
    }
    return { covers: `administrateurs actifs (seuil ${t.govMaxAdmins}), largeur des rôles personnalisés, comptes à privilèges dormants (${t.govDormantDays} jours)`, offenders };
  },
  "GOV-TRC-01": (f) => {
    if (f.unreviewedTotal === 0) return { offenders: [] };
    const days = f.oldestUnreviewedAt ? Math.floor((f.now.getTime() - f.oldestUnreviewedAt.getTime()) / DAY) : 0;
    return {
      covers: "décisions marquées « sans seconde validation » non revues par un tiers",
      offenders: [{ kind: "DECISION", id: "unreviewed", label: "Décisions non revues", count: f.unreviewedTotal, detail: `la plus ancienne date de ${days} jour(s)` }],
    };
  },
  // Depends on the other results: computed by computePanel once the high-severity statuses are known.
  "GOV-TRC-02": () => ({ offenders: [] }),
  "GOV-REG-01": (f) => {
    const governancePeople = new Set(
      f.assignments.filter((a) => f.users.find((u) => u.id === a.userId)?.active).map((a) => a.userId),
    ).size;
    if (f.singlePersonRegimeActive && governancePeople > 1) {
      return { offenders: [{ kind: "SETTING", id: "singlePersonRegime", label: "Régime « structure à une personne »", count: governancePeople, detail: "déclaré alors que plusieurs personnes ont un rôle" }] };
    }
    const selfValidations = (f.markedCountByRule["noSelfValidation"] ?? 0) + f.selfValidatedUnmarkedTotal;
    // Codex P2 (PR #235): exactly one active person with a role (0 people is a vacancy, not this signal).
    if (!f.singlePersonRegimeActive && governancePeople === 1 && selfValidations > 0) {
      return { offenders: [{ kind: "SETTING", id: "singlePersonRegime", label: "Régime « structure à une personne »", count: governancePeople, detail: "non déclaré alors qu'une seule personne valide ses propres actes" }] };
    }
    return { offenders: [] };
  },
};

/** ALLOWED_BY_SETTING (q234 C): out of the alerts because the client's setting allows it, still listed with who set it. */
export type PrincipleStatus = "NOT_RESPECTED" | "RESPECTED" | "NOT_EVALUABLE" | "ACCEPTED" | "ALLOWED_BY_SETTING";

export interface ActiveAcceptance {
  id: string;
  principleId: string;
  expiresAt: Date;
  reason: string;
  regime: string | null;
  acceptedBy: string;
  confirmedBy: string | null;
  offendersSnapshot: unknown[];
}

export interface PrincipleResult {
  id: PrincipleId;
  status: PrincipleStatus;
  notEvaluableReason: string | null;
  covers: string | null;
  offenders: Offender[];
  /** Exact number of offenders; larger than `offenders.length` when the list is bounded (QA-D6-02). */
  offendersTotal: number;
  acceptance: ActiveAcceptance | null;
  /** Why an active acceptance was not applied (e.g. the offender list is incomplete); null otherwise. */
  acceptanceNote: string | null;
}

export const offenderKey = (o: { kind?: unknown; id?: unknown }): string => `${String(o.kind)}:${String(o.id)}`;

/**
 * R-5: an ACTIVE, unexpired acceptance turns NOT_RESPECTED into ACCEPTED only while every current offender was already in
 * its snapshot (a new offender makes the principle NOT_RESPECTED again: fail-closed).
 */
function applyAcceptance(offenders: Offender[], acceptance: ActiveAcceptance | undefined, now: Date, total = offenders.length): ActiveAcceptance | null {
  if (!acceptance || acceptance.expiresAt.getTime() <= now.getTime()) return null;
  // Codex P2 (PR #235): with a bounded list the offenders past the bound are unknown — never ACCEPTED (fail-closed).
  if (total > offenders.length) return null;
  const covered = new Set(acceptance.offendersSnapshot.map((o) => offenderKey(o as Offender)));
  return offenders.every((o) => covered.has(offenderKey(o))) ? acceptance : null;
}

export function computePanel(f: GovernanceFacts, acceptances: ActiveAcceptance[]): PrincipleResult[] {
  const accByPrinciple = new Map(acceptances.map((a) => [a.principleId, a]));
  const results = PRINCIPLES.map((p): PrincipleResult => {
    const r = DETECTORS[p.id](f);
    if ("notEvaluable" in r) return { id: p.id, status: "NOT_EVALUABLE", notEvaluableReason: r.notEvaluable, covers: null, offenders: [], offendersTotal: 0, acceptance: null, acceptanceNote: null };
    if (r.offenders.length === 0) return { id: p.id, status: "RESPECTED", notEvaluableReason: null, covers: r.covers ?? null, offenders: [], offendersTotal: 0, acceptance: null, acceptanceNote: null };
    const total = Math.max(r.total ?? 0, r.offenders.length);
    if (r.allowedBySetting) {
      return { id: p.id, status: "ALLOWED_BY_SETTING", notEvaluableReason: null, covers: r.covers ?? null, offenders: r.offenders, offendersTotal: total, acceptance: null, acceptanceNote: null };
    }
    const acceptance = accByPrinciple.get(p.id);
    const accepted = applyAcceptance(r.offenders, acceptance, f.now, total);
    const acceptanceNote = acceptance && !accepted && total > r.offenders.length && acceptance.expiresAt.getTime() > f.now.getTime()
      ? `Acceptation non appliquée : ${total} objets en cause, seuls ${r.offenders.length} sont listés ; la couverture ne peut pas être vérifiée.`
      : null;
    return { id: p.id, status: accepted ? "ACCEPTED" : "NOT_RESPECTED", notEvaluableReason: null, covers: r.covers ?? null, offenders: r.offenders, offendersTotal: total, acceptance: accepted, acceptanceNote };
  });
  // GOV-TRC-02: a high-severity principle not respected and nobody designated as manager.
  const severe = results.filter((r) => r.status === "NOT_RESPECTED" && PRINCIPLES.find((p) => p.id === r.id)?.severity === "elevee");
  const trc02 = results.find((r) => r.id === "GOV-TRC-02")!;
  if (severe.length > 0 && !f.managerDesignated) {
    trc02.offendersTotal = 1;
    trc02.offenders = [{ kind: "SETTING", id: "manager", label: "Gérant désigné", count: severe.length, detail: "absent alors que des principes de gravité élevée ne sont pas respectés" }];
    trc02.covers = "gérant désigné face aux principes de gravité élevée non respectés";
    const accepted = applyAcceptance(trc02.offenders, accByPrinciple.get("GOV-TRC-02"), f.now);
    trc02.status = accepted ? "ACCEPTED" : "NOT_RESPECTED";
    trc02.acceptance = accepted;
  }
  return results;
}

/** Offenders of one principle now, for the acceptance snapshot (R-5 « portée »). Unknown id or not evaluable: none. */
export function offendersOf(f: GovernanceFacts, principleId: string): Offender[] {
  const result = computePanel(f, []).find((r) => r.id === principleId);
  return result?.offenders ?? [];
}
