import type { OrganizationAnswers } from "./organizationQuestionnaire.js";

/**
 * Organization size classification (DECISION-075 q146/q147/q148, DECISION-076 q154) from
 * docs/governance/principes/principes-gouvernance.json v0.3, `questionnaireProfil.regleDeduction`.
 * Pure: no I/O, no clock. The server is the only place this runs; the API ships the result, the frontend never
 * recomputes it. The size is never stored: it follows the active answers, the observed accounts and the rule.
 */
export type OrganizationSize = "TPE" | "PME" | "GRANDE_ENTREPRISE";

export const RULE_VERSION = "0.3";

/** Thresholds chosen by the PO (q154): 250 / 100 with 3 of 4 / 20 with at most 1. */
export interface ClassificationRule {
  version: string;
  /** Headcount at or above which the organization is a large company whatever the structure. */
  largeHeadcount: number;
  /** Headcount at or above which a well-structured organization is a large company. */
  largeStructuredHeadcount: number;
  /** Structure score S (out of 4) that, with `largeStructuredHeadcount`, makes a large company. */
  largeStructureScore: number;
  /** TPE: headcount at or below, structure score at or below, and not supervised. */
  tpeMaxHeadcount: number;
  tpeMaxStructureScore: number;
}

export const DEFAULT_RULE: ClassificationRule = {
  version: RULE_VERSION,
  largeHeadcount: 250,
  largeStructuredHeadcount: 100,
  largeStructureScore: 3,
  tpeMaxHeadcount: 20,
  tpeMaxStructureScore: 1,
};

/** What the tool already sees (active accounts of the tenant, members of the three fixed groups). A person counts once per group. */
export interface ObservedOrganization {
  activeAccounts: number;
  riskManagers: number;
  committeeMembers: number;
  auditMembers: number;
}

export interface StructureCriterion {
  id: "C1" | "C2" | "C3" | "C4";
  label: string;
  met: boolean;
  declared: boolean;
  observed: boolean;
}

export interface Classification {
  /** The size retained: the most demanding of declared and observed (q147). */
  value: OrganizationSize;
  ruleVersion: string;
  /** E = max(Q1, active accounts). */
  effectiveHeadcount: number;
  declaredHeadcount: number;
  observedAccounts: number;
  /** S, number of structure criteria met out of 4. */
  structureScore: number;
  criteria: StructureCriterion[];
  /** Q11 answer: only "NO" can leave room for a TPE. */
  supervised: "YES" | "NO" | "UNKNOWN";
  /** "à confirmer": a PI-2 / PI-3 / PI-1 signal applies. */
  toConfirm: boolean;
  /** PI-1: a value is within 20 % of a threshold. */
  nearLimit: boolean;
  /** Plausible other sizes to show next to the retained one (neighbour column, unknowns that change the result). */
  alternatives: OrganizationSize[];
  /** Why, in order: the figures and rules that produced the result. */
  justification: string[];
}

const RANK: Record<OrganizationSize, number> = { TPE: 0, PME: 1, GRANDE_ENTREPRISE: 2 };
export const sizeRank = (s: OrganizationSize): number => RANK[s];

const SIZE_LABEL: Record<OrganizationSize, string> = { TPE: "TPE", PME: "PME", GRANDE_ENTREPRISE: "grande entreprise" };

function structure(a: OrganizationAnswers, o: ObservedOrganization): StructureCriterion[] {
  const c = (id: StructureCriterion["id"], label: string, declared: boolean, observed: boolean): StructureCriterion => ({
    id,
    label,
    declared,
    observed,
    met: declared || observed,
  });
  return [
    c("C1", "Fonction risque d'au moins 2 personnes", a.Q2 >= 2, o.riskManagers >= 2),
    c("C2", "Audit interne", a.Q5 === "YES", o.auditMembers >= 1),
    c("C3", "Organe de contrôle de la direction", a.Q7 === "YES", false),
    c("C4", "Comité formel", a.Q8 === "FORMAL", o.committeeMembers >= 2),
  ];
}

function sizeFor(rule: ClassificationRule, e: number, s: number, supervised: "YES" | "NO" | "UNKNOWN"): OrganizationSize {
  if (e >= rule.largeHeadcount || (e >= rule.largeStructuredHeadcount && s >= rule.largeStructureScore)) return "GRANDE_ENTREPRISE";
  if (e <= rule.tpeMaxHeadcount && s <= rule.tpeMaxStructureScore && supervised === "NO") return "TPE";
  return "PME";
}

const within20 = (e: number, threshold: number): boolean => e >= threshold * 0.8 && e <= threshold * 1.2;

export function classifyOrganization(
  answers: OrganizationAnswers,
  observed: ObservedOrganization,
  rule: ClassificationRule = DEFAULT_RULE,
): Classification {
  const e = Math.max(answers.Q1, observed.activeAccounts);
  const criteria = structure(answers, observed);
  const s = criteria.filter((x) => x.met).length;
  const supervised = answers.Q11 === "YES" ? "YES" : answers.Q11 === "NO" ? "NO" : "UNKNOWN";
  const value = sizeFor(rule, e, s, supervised);

  // PI-3: a "don't know" answer that would change the size if it were resolved either way.
  const alternatives = new Set<OrganizationSize>();
  const tryAnswers = (patch: Partial<OrganizationAnswers>): void => {
    const alt = { ...answers, ...patch };
    const altS = structure(alt, observed).filter((x) => x.met).length;
    const altSup = alt.Q11 === "YES" ? "YES" : alt.Q11 === "NO" ? "NO" : "UNKNOWN";
    const v = sizeFor(rule, e, altS, altSup);
    if (v !== value) alternatives.add(v);
  };
  if (answers.Q5 === "UNKNOWN") (["NO", "YES"] as const).forEach((v) => tryAnswers({ Q5: v }));
  if (answers.Q7 === "UNKNOWN") (["NO", "YES"] as const).forEach((v) => tryAnswers({ Q7: v }));
  if (answers.Q8 === "UNKNOWN") (["NO", "INFORMAL", "FORMAL"] as const).forEach((v) => tryAnswers({ Q8: v }));
  if (answers.Q11 === "UNKNOWN") (["NO", "YES"] as const).forEach((v) => tryAnswers({ Q11: v }));
  const unknownChangesSize = alternatives.size > 0;

  // PI-1: close to a threshold.
  const nearLimit =
    within20(e, rule.tpeMaxHeadcount) ||
    within20(e, rule.largeStructuredHeadcount) ||
    within20(e, rule.largeHeadcount) ||
    (e <= rule.tpeMaxHeadcount * 1.2 && s === rule.tpeMaxStructureScore + 1) ||
    (e >= rule.largeStructuredHeadcount * 0.8 && e < rule.largeHeadcount && s === rule.largeStructureScore - 1);
  if (nearLimit) {
    const neighbour: OrganizationSize =
      value === "TPE" ? "PME" : value === "GRANDE_ENTREPRISE" ? "PME" : e <= (rule.tpeMaxHeadcount + rule.largeStructuredHeadcount) / 2 ? "TPE" : "GRANDE_ENTREPRISE";
    alternatives.add(neighbour);
  }

  // PI-2: contradictory signals.
  const contradictions: string[] = [];
  if (e <= 10 && s >= 3) contradictions.push("très petit effectif mais structure très complète");
  if (e >= rule.largeHeadcount && s === 0) contradictions.push("effectif très élevé mais aucune structure de contrôle");
  if (supervised === "YES" && e <= rule.tpeMaxHeadcount) contradictions.push("petite structure sous supervision (plancher PME)");
  if (answers.Q1 < observed.activeAccounts) contradictions.push("effectif déclaré inférieur au nombre de comptes actifs");

  const toConfirm = nearLimit || contradictions.length > 0 || answers.Q11 === "UNKNOWN" || unknownChangesSize;

  const justification: string[] = [
    `Effectif retenu E = ${e} (déclaré ${answers.Q1}, comptes actifs ${observed.activeAccounts} : le plus grand des deux).`,
    `Structuration S = ${s} sur 4 (${criteria.map((c) => `${c.id} ${c.met ? "remplie" : "non remplie"}`).join(", ")}).`,
    supervised === "YES"
      ? "Activité supervisée : jamais classée TPE."
      : supervised === "UNKNOWN"
        ? "Supervision inconnue : pas de classement TPE tant que la réponse n'est pas levée."
        : "Activité non supervisée.",
  ];
  if (value === "GRANDE_ENTREPRISE") {
    justification.push(
      e >= rule.largeHeadcount
        ? `E >= ${rule.largeHeadcount} : grande entreprise.`
        : `E >= ${rule.largeStructuredHeadcount} et S >= ${rule.largeStructureScore} : grande entreprise.`,
    );
  } else if (value === "TPE") {
    justification.push(`E <= ${rule.tpeMaxHeadcount}, S <= ${rule.tpeMaxStructureScore} et activité non supervisée : TPE.`);
  } else {
    justification.push("Ni grande entreprise ni TPE : PME.");
  }
  if (nearLimit) justification.push("Une valeur est proche d'un seuil : classement proche de la limite, à confirmer.");
  for (const c of contradictions) justification.push(`Signal contradictoire : ${c}.`);
  if (unknownChangesSize) {
    justification.push(`Une réponse « je ne sais pas » changerait le classement (${[...alternatives].map((a) => SIZE_LABEL[a]).join(", ")}) : à confirmer.`);
  }

  return {
    value,
    ruleVersion: rule.version,
    effectiveHeadcount: e,
    declaredHeadcount: answers.Q1,
    observedAccounts: observed.activeAccounts,
    structureScore: s,
    criteria,
    supervised,
    toConfirm,
    nearLimit,
    alternatives: [...alternatives].sort((a, b) => RANK[a] - RANK[b]),
    justification,
  };
}

/** A declared figure that disagrees with what the tool observes (E1 to E4, E7). Information, never a block. */
export interface ProfileGap {
  id: "E1" | "E2" | "E3" | "E4" | "E7";
  questionId: "Q1" | "Q2" | "Q5" | "Q8";
  declared: string | number;
  observed: number;
  message: string;
}

export function computeProfileGaps(a: OrganizationAnswers, o: ObservedOrganization): ProfileGap[] {
  const gaps: ProfileGap[] = [];
  if (a.Q2 > o.riskManagers) {
    gaps.push({ id: "E1", questionId: "Q2", declared: a.Q2, observed: o.riskManagers, message: `Vous déclarez ${a.Q2} personnes dans la fonction risque, l'outil n'en voit que ${o.riskManagers} : créer les comptes ou corriger la déclaration.` });
  } else if (a.Q2 < o.riskManagers) {
    gaps.push({ id: "E2", questionId: "Q2", declared: a.Q2, observed: o.riskManagers, message: `L'outil voit ${o.riskManagers} Risk Managers pour ${a.Q2} déclarés : déclaration périmée ou comptes en trop (cumul, ancien salarié ?).` });
  }
  if ((a.Q5 === "YES" && o.auditMembers === 0) || (a.Q5 === "NO" && o.auditMembers >= 1)) {
    gaps.push({ id: "E3", questionId: "Q5", declared: a.Q5, observed: o.auditMembers, message: a.Q5 === "YES" ? "Audit déclaré non présent dans l'outil." : "Audit présent dans l'outil mais non déclaré." });
  }
  if ((a.Q8 === "FORMAL" && o.committeeMembers < 2) || (a.Q8 === "NO" && o.committeeMembers >= 2)) {
    gaps.push({ id: "E4", questionId: "Q8", declared: a.Q8, observed: o.committeeMembers, message: a.Q8 === "FORMAL" ? "Comité déclaré sans membres suffisants dans l'outil." : "Membres de comité dans l'outil sans comité déclaré." });
  }
  if (a.Q1 < o.activeAccounts) {
    gaps.push({ id: "E7", questionId: "Q1", declared: a.Q1, observed: o.activeAccounts, message: `Vous déclarez ${a.Q1} personnes mais l'outil compte ${o.activeAccounts} comptes actifs : l'effectif retenu est ${o.activeAccounts} ; corriger la déclaration ou clôturer des comptes.` });
  }
  return gaps;
}
