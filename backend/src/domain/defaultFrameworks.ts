import type { ImpactAxis, ScaleLevel, ScoreThreshold } from "./entities/RatingScale.js";

/**
 * B-13 (DECISION-124, DECISION-127): the three ready-to-use Dispositifs, values validated by the PO exactly as
 * proposed by A13 (docs/risk/A13-dispositifs-par-defaut-B13-2026-11-11.md, sections 3 to 6 and 12). Nothing here is
 * invented: a value that the document does not give is absent (appetite entries: they depend on the tenant's own
 * sub-categories, so the list stays empty, see `appetiteNote`).
 *
 * Names: Tranché (4x4), Standard (5x5), Renforcé (6x6). Tranché takes Standard's axes, velocity, persistence, the three
 * defense lines and the 90-day delegation (variant 2 of section 12.2). Standard equals the contract defaults, so it is
 * the one that always passes the bootstrap (spec 5.6 point 2); Tranché does too (committee threshold floor(16*15/25) = 9).
 * Renforcé is stricter and cannot be the very first Dispositif of a tenant with a single Risk Manager.
 *
 * `committeeVoteRule` and `changeApprover` of Renforcé stay DEFAULT / RISK_MANAGER: section 4 of the document says
 * the target values (rule C, COMMITTEE) are refused or unread before B-12 and are to be set by a new version then.
 */

export interface DefaultFrameworkTemplate {
  name: string;
  description: string;
  scale: {
    name: string;
    version: string;
    size: number;
    probabilityLabels: ScaleLevel[];
    impactLabels: ScaleLevel[];
    thresholds: ScoreThreshold[];
    axes: ImpactAxis[];
    velocity: ScaleLevel[];
    persistence: ScaleLevel[];
    mastery: { levels: ScaleLevel[]; defenseLines: string[]; thresholds: ScoreThreshold[] };
  };
  params: {
    committeeEvaluationMinScore: number;
    committeeTreatmentMinScore: number;
    lowCriticalityThreshold: number;
    riskOwnerExecutorCumulAllowed: boolean;
    delegateExecutorCumulAllowed: boolean;
    delegationMaxDays: number;
  };
  /** Section 6: one threshold per family of categories, applied to the tenant's sub-categories. Not created (no tenant taxonomy to map to). */
  appetiteNote: string;
}

const levels = (labels: string[]): ScaleLevel[] => labels.map((label, i) => ({ level: i + 1, label }));
const band = (label: string, min: number, max: number): ScoreThreshold => ({ label, min, max });

/** Section 5.1: shared by the three. */
const VELOCITY = levels(["Lente", "Moyenne", "Rapide"]);
const PERSISTENCE = levels(["Ponctuelle", "Récurrente", "Durable"]);
const MASTERY_LEVELS = levels(["Inadéquate", "Partielle", "Adéquate"]);
const MASTERY_THRESHOLDS = [band("Inadéquate", 1, 1), band("Partielle", 2, 2), band("Adéquate", 3, 3)];
const LINES = ["L1", "L2", "L3"];

const axis = (code: string, label: string, order: number, descriptors: string[]): ImpactAxis => ({ code, label, order, levelLabels: levels(descriptors) });

// Section 5.5 (Standard, 5 levels).
const STD_FINANCIER = ["Perte absorbée par le budget courant", "Perte absorbée par le budget de l'entité", "Perte exigeant une réallocation budgétaire", "Perte qui pèse sur le résultat annuel", "Perte qui menace la solvabilité ou la liquidité"];
const STD_REGLEMENTAIRE = ["Écart interne, sans notification", "Observation du régulateur, sans sanction", "Mise en demeure ou rapport de non-conformité", "Sanction financière ou restriction d'activité", "Retrait d'agrément ou suspension d'activité"];
const STD_OPERATIONNEL = ["Gêne interne, brève", "Dégradation ponctuelle d'un service non critique", "Service critique indisponible quelques heures", "Service critique indisponible une journée ou plus", "Arrêt prolongé de l'activité de paiement"];
const STD_CLIENT = ["Plainte isolée", "Plaintes multiples sans perte", "Clients touchés, perte limitée et remboursée", "Fonds ou données de nombreux clients compromis", "Perte massive de fonds ou fuite de données à grande échelle"];
const STD_REPUTATION = ["Aucune visibilité externe", "Mentions isolées", "Couverture locale limitée", "Couverture nationale, perte d'un partenaire", "Perte de confiance durable, retrait de partenaires majeurs"];

// Section 12.3 (4x4, 4 levels).
const T4_FINANCIER = ["Perte absorbée par le budget courant ou celui de l'entité", "Perte exigeant une réallocation budgétaire", "Perte qui pèse sur le résultat annuel", "Perte qui menace la solvabilité ou la liquidité"];
const T4_REGLEMENTAIRE = ["Écart interne ou observation sans sanction", "Mise en demeure ou rapport de non-conformité", "Sanction financière ou restriction d'activité", "Retrait d'agrément ou suspension d'activité"];
const T4_OPERATIONNEL = ["Gêne interne ou service non critique dégradé", "Service critique indisponible quelques heures", "Service critique indisponible une journée ou plus", "Arrêt prolongé de l'activité de paiement"];
const T4_CLIENT = ["Plaintes isolées ou multiples, sans perte", "Clients touchés, perte limitée et remboursée", "Fonds ou données de nombreux clients compromis", "Perte massive de fonds ou fuite de données à grande échelle"];
const T4_REPUTATION = ["Aucune visibilité externe ou mentions isolées", "Couverture locale limitée", "Couverture nationale, perte d'un partenaire", "Perte de confiance durable, retrait de partenaires majeurs"];

// Section 12.3 (6x6, 6 levels, 7 axes).
const R6_FINANCIER = ["Perte absorbée par le budget courant", "Perte absorbée par le budget de l'entité", "Perte exigeant l'arbitrage du responsable budgétaire", "Perte exigeant une réallocation entre entités", "Perte qui pèse sur le résultat annuel", "Perte qui menace la solvabilité ou la liquidité"];
const R6_REGLEMENTAIRE = ["Écart interne, sans notification", "Observation informelle du régulateur", "Observation formelle, sans sanction", "Mise en demeure ou rapport de non-conformité", "Sanction financière ou restriction d'activité", "Retrait d'agrément ou suspension d'activité"];
const R6_OPERATIONNEL = ["Gêne interne brève", "Dégradation ponctuelle d'un service non critique", "Service critique ralenti ou indisponible moins d'une heure", "Service critique indisponible quelques heures", "Service critique indisponible une journée ou plus", "Arrêt prolongé de l'activité de paiement"];
const R6_CLIENT = ["Plainte isolée", "Plaintes multiples, sans perte", "Quelques clients touchés, perte remboursée rapidement", "Nombreux clients touchés, perte limitée et remboursée", "Fonds ou données de nombreux clients compromis", "Perte massive de fonds ou fuite de données à grande échelle"];
const R6_REPUTATION = ["Aucune visibilité externe", "Mentions isolées", "Mentions répétées sur les réseaux", "Couverture locale limitée", "Couverture nationale, perte d'un partenaire", "Perte de confiance durable, retrait de partenaires majeurs"];
const R6_DONNEES = ["Incident interne, sans donnée sensible", "Donnée non sensible exposée à un tiers, corrigée", "Donnée sensible exposée en interne, sans usage constaté", "Données sensibles de quelques clients exposées", "Données sensibles de nombreux clients exposées ou altérées", "Fuite ou corruption à grande échelle, irrécupérable"];
const R6_HUMAIN = ["Gêne sans effet sur les personnes", "Incident mineur, sans arrêt de travail", "Blessure ou stress nécessitant des soins légers", "Arrêt de travail d'un ou plusieurs collaborateurs", "Atteinte grave à la santé ou à la sécurité", "Décès ou invalidité permanente"];

const APPETITE_NOTE = "Appétence par famille (document A13, section 6) non créée : elle se rattache aux sous-catégories propres au client.";

export const DEFAULT_FRAMEWORK_TEMPLATES: DefaultFrameworkTemplate[] = [
  {
    name: "Tranché",
    description: "4 niveaux, pas de niveau du milieu : on est obligé de se prononcer. Moins de nuances.",
    scale: {
      name: "Tranché (4x4)",
      version: "1",
      size: 4,
      probabilityLabels: levels([
        "Rare : moins d'une fois en 3 ans",
        "Possible : une fois tous les 1 à 3 ans",
        "Probable : plusieurs fois par an",
        "Quasi certain : mensuel ou plus",
      ]),
      impactLabels: levels(["Mineur", "Modéré", "Majeur", "Critique"]),
      thresholds: [band("Faible", 1, 3), band("Moyen", 4, 6), band("Élevé", 7, 8), band("Critique", 9, 16)],
      axes: [
        axis("FINANCIER", "Financier", 1, T4_FINANCIER),
        axis("REGLEMENTAIRE", "Réglementaire", 2, T4_REGLEMENTAIRE),
        axis("OPERATIONNEL", "Opérationnel", 3, T4_OPERATIONNEL),
        axis("CLIENT", "Client", 4, T4_CLIENT),
        axis("REPUTATION", "Réputation", 5, T4_REPUTATION),
      ],
      velocity: VELOCITY,
      persistence: PERSISTENCE,
      mastery: { levels: MASTERY_LEVELS, defenseLines: LINES, thresholds: MASTERY_THRESHOLDS },
    },
    // Variant 2: delegation 90 days like Standard. Committee 9 of 16, treatment 9, "low" = top of the Faible band.
    params: { committeeEvaluationMinScore: 9, committeeTreatmentMinScore: 9, lowCriticalityThreshold: 3, riskOwnerExecutorCumulAllowed: true, delegateExecutorCumulAllowed: true, delegationMaxDays: 90 },
    appetiteNote: APPETITE_NOTE,
  },
  {
    name: "Standard",
    description: "5 niveaux, l'échelle classique. Le niveau 3 est un milieu, à utiliser avec prudence.",
    scale: {
      name: "Standard (5x5)",
      version: "1",
      size: 5,
      probabilityLabels: levels([
        "Rare : moins d'une fois en 5 ans",
        "Peu probable : une fois tous les 2 à 5 ans",
        "Possible : environ une fois par an",
        "Probable : plusieurs fois par an",
        "Quasi certain : mensuel ou plus",
      ]),
      impactLabels: levels(["Négligeable", "Mineur", "Modéré", "Majeur", "Critique"]),
      thresholds: [band("Faible", 1, 4), band("Moyen", 5, 9), band("Élevé", 10, 14), band("Critique", 15, 25)],
      axes: [
        axis("FINANCIER", "Financier", 1, STD_FINANCIER),
        axis("REGLEMENTAIRE", "Réglementaire", 2, STD_REGLEMENTAIRE),
        axis("OPERATIONNEL", "Opérationnel", 3, STD_OPERATIONNEL),
        axis("CLIENT", "Client", 4, STD_CLIENT),
        axis("REPUTATION", "Réputation", 5, STD_REPUTATION),
      ],
      velocity: VELOCITY,
      persistence: PERSISTENCE,
      mastery: { levels: MASTERY_LEVELS, defenseLines: LINES, thresholds: MASTERY_THRESHOLDS },
    },
    params: { committeeEvaluationMinScore: 15, committeeTreatmentMinScore: 15, lowCriticalityThreshold: 4, riskOwnerExecutorCumulAllowed: true, delegateExecutorCumulAllowed: true, delegationMaxDays: 90 },
    appetiteNote: APPETITE_NOTE,
  },
  {
    name: "Renforcé",
    description: "6 niveaux, pas de milieu, plus de nuances, gouvernance plus stricte (cumuls interdits, Comité plus sollicité).",
    scale: {
      name: "Renforcé (6x6)",
      version: "1",
      size: 6,
      probabilityLabels: levels([
        "Exceptionnel : moins d'une fois en 10 ans",
        "Rare : une fois tous les 5 à 10 ans",
        "Peu probable : une fois tous les 2 à 5 ans",
        "Possible : environ une fois par an",
        "Probable : trimestriel",
        "Quasi certain : mensuel ou plus",
      ]),
      impactLabels: levels(["Négligeable", "Mineur", "Modéré", "Important", "Majeur", "Catastrophique"]),
      thresholds: [band("Faible", 1, 3), band("Moyen", 4, 8), band("Élevé", 9, 14), band("Critique", 15, 36)],
      axes: [
        axis("FINANCIER", "Financier", 1, R6_FINANCIER),
        axis("REGLEMENTAIRE", "Réglementaire", 2, R6_REGLEMENTAIRE),
        axis("OPERATIONNEL", "Opérationnel", 3, R6_OPERATIONNEL),
        axis("CLIENT", "Client", 4, R6_CLIENT),
        axis("REPUTATION", "Réputation", 5, R6_REPUTATION),
        axis("DONNEES", "Données", 6, R6_DONNEES),
        axis("HUMAIN", "Humain", 7, R6_HUMAIN),
      ],
      velocity: VELOCITY,
      persistence: PERSISTENCE,
      mastery: { levels: MASTERY_LEVELS, defenseLines: LINES, thresholds: MASTERY_THRESHOLDS },
    },
    // Both cumuls forbidden, delegation 30 days; Committee at 15 of 36 (below the contract default 21, hence not bootstrap-compatible).
    params: { committeeEvaluationMinScore: 15, committeeTreatmentMinScore: 9, lowCriticalityThreshold: 3, riskOwnerExecutorCumulAllowed: false, delegateExecutorCumulAllowed: false, delegationMaxDays: 30 },
    appetiteNote: APPETITE_NOTE,
  },
];
