import { ValidationError } from "../errors/DomainErrors.js";

/**
 * Organization profile questionnaire (DECISION-074 q135, DECISION-075 q146, DECISION-076 q154): the six questions
 * Q1, Q2, Q5, Q7, Q8, Q11 of docs/governance/principes/principes-gouvernance.json v0.3 (`questionnaireProfil`).
 * Lives in code, like the notification catalogue: a test keeps ids / types / options in sync with that JSON.
 * Identifiers are kept from the v0.2 questionnaire so references do not break.
 *
 * Stored answers are the raw values below (numbers for Q1/Q2, codes otherwise). "UNKNOWN" is the
 * "je ne sais pas" answer: allowed everywhere except Q1 and Q2.
 */
export const QUESTIONNAIRE_VERSION = "0.3";

export const MAX_HEADCOUNT = 10_000_000;
export const MAX_RISK_PEOPLE = 1_000_000;

export type YesNoUnknown = "NO" | "YES" | "UNKNOWN";
export type CommitteeAnswer = "NO" | "INFORMAL" | "FORMAL" | "UNKNOWN";

export interface OrganizationAnswers {
  /** People working in the company, all statuses (integer >= 1). */
  Q1: number;
  /** People involved in risk management, even part-time (integer >= 0). */
  Q2: number;
  /** An internal audit exists. */
  Q5: YesNoUnknown;
  /** A board / supervisory body that controls management. */
  Q7: YesNoUnknown;
  /** A risk or audit committee: none, informal, formal. */
  Q8: CommitteeAnswer;
  /** Activity under a supervisory authority (licence). */
  Q11: YesNoUnknown;
}

export const YES_NO_UNKNOWN: readonly YesNoUnknown[] = ["NO", "YES", "UNKNOWN"];
export const COMMITTEE_ANSWERS: readonly CommitteeAnswer[] = ["NO", "INFORMAL", "FORMAL", "UNKNOWN"];

export type QuestionDefinition =
  | { id: "Q1" | "Q2"; label: string; type: "number"; min: number; max: number }
  | { id: "Q5" | "Q7" | "Q8" | "Q11"; label: string; type: "choice"; options: readonly { value: string; label: string }[] };

const yesNoUnknownOptions = [
  { value: "NO", label: "non" },
  { value: "YES", label: "oui" },
  { value: "UNKNOWN", label: "je ne sais pas" },
] as const;

export const ORGANIZATION_QUESTIONS: readonly QuestionDefinition[] = [
  {
    id: "Q1",
    label: "Combien de personnes travaillent dans votre entreprise, tous statuts confondus (salariés, temps partiel, prestataires réguliers) ?",
    type: "number",
    min: 1,
    max: MAX_HEADCOUNT,
  },
  {
    id: "Q2",
    label: "Combien de personnes s'occupent de la gestion des risques, même à temps partiel ? (0 si personne)",
    type: "number",
    min: 0,
    max: MAX_RISK_PEOPLE,
  },
  {
    id: "Q5",
    label: "Avez-vous un audit interne (au moins une personne dont le travail est de contrôler l'entreprise de l'intérieur) ?",
    type: "choice",
    options: yesNoUnknownOptions,
  },
  {
    id: "Q7",
    label: "Avez-vous un conseil d'administration, un conseil de surveillance ou un organe équivalent qui contrôle la direction ?",
    type: "choice",
    options: yesNoUnknownOptions,
  },
  {
    id: "Q8",
    label: "Avez-vous un comité des risques ou un comité d'audit ?",
    type: "choice",
    options: [
      { value: "NO", label: "non" },
      { value: "INFORMAL", label: "oui, informel (se réunit au besoin)" },
      { value: "FORMAL", label: "oui, formel (membres nommés, réunions régulières)" },
      { value: "UNKNOWN", label: "je ne sais pas" },
    ],
  },
  {
    id: "Q11",
    label: "Votre activité est-elle placée sous le contrôle d'une autorité de supervision, avec un agrément ou une licence ?",
    type: "choice",
    options: yesNoUnknownOptions,
  },
];

const ANSWER_KEYS = ["Q1", "Q2", "Q5", "Q7", "Q8", "Q11"] as const;

/**
 * Server-side validation of a submitted answer set against a questionnaire version. Strict: every question
 * answered, no extra key, integers within bounds, choices from the allowed list. Only the current version is
 * writable; older versions stay readable (stored rows) but cannot be submitted again.
 */
export function parseOrganizationAnswers(questionnaireVersion: string, raw: unknown): OrganizationAnswers {
  if (questionnaireVersion !== QUESTIONNAIRE_VERSION) {
    throw new ValidationError(`Unsupported questionnaire version ${questionnaireVersion} (current: ${QUESTIONNAIRE_VERSION})`);
  }
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) throw new ValidationError("answers must be an object");
  const obj = raw as Record<string, unknown>;
  for (const key of Object.keys(obj)) {
    if (!(ANSWER_KEYS as readonly string[]).includes(key)) throw new ValidationError(`Unknown question ${key}`);
  }
  for (const q of ORGANIZATION_QUESTIONS) {
    const v = obj[q.id];
    if (q.type === "number") {
      if (typeof v !== "number" || !Number.isInteger(v) || v < q.min || v > q.max) {
        throw new ValidationError(`${q.id} must be an integer between ${q.min} and ${q.max}`);
      }
    } else if (typeof v !== "string" || !q.options.some((o) => o.value === v)) {
      throw new ValidationError(`${q.id} must be one of ${q.options.map((o) => o.value).join(", ")}`);
    }
  }
  return {
    Q1: obj["Q1"] as number,
    Q2: obj["Q2"] as number,
    Q5: obj["Q5"] as YesNoUnknown,
    Q7: obj["Q7"] as YesNoUnknown,
    Q8: obj["Q8"] as CommitteeAnswer,
    Q11: obj["Q11"] as YesNoUnknown,
  };
}
