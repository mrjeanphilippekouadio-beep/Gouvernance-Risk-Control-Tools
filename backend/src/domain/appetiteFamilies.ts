/** The 12 appetite families of the mandate taxonomy (A13, DECISION-133). Fixed list: it is the key of the default thresholds. */
export type AppetiteFamily =
  | "STRATEGIC" | "FINANCIAL" | "OPERATIONAL" | "TECHNOLOGICAL" | "COMPLIANCE" | "FRAUD"
  | "CYBERSECURITY" | "THIRD_PARTY" | "BUSINESS_CONTINUITY" | "HUMAN_CAPITAL" | "DATA_PRIVACY" | "REPUTATIONAL";

/** `strict` families get the "low" appetite (top of the lowest criticality band), the others the "moderate" one. */
export const APPETITE_FAMILIES: ReadonlyArray<{ code: AppetiteFamily; label: string; strict: boolean }> = [
  { code: "STRATEGIC", label: "Stratégique", strict: false },
  { code: "FINANCIAL", label: "Financier", strict: false },
  { code: "OPERATIONAL", label: "Opérationnel", strict: false },
  { code: "TECHNOLOGICAL", label: "Technologique", strict: false },
  { code: "COMPLIANCE", label: "Conformité", strict: true },
  { code: "FRAUD", label: "Fraude", strict: true },
  { code: "CYBERSECURITY", label: "Cybersécurité", strict: true },
  { code: "THIRD_PARTY", label: "Tiers", strict: false },
  { code: "BUSINESS_CONTINUITY", label: "Continuité", strict: false },
  { code: "HUMAN_CAPITAL", label: "Capital humain", strict: false },
  { code: "DATA_PRIVACY", label: "Données et vie privée", strict: true },
  { code: "REPUTATIONAL", label: "Réputation", strict: false },
];

/** Case, accent and separator insensitive form used to compare labels (families and categories). */
export function normalizeLabel(s: string): string {
  return s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[\s_-]+/g, " ").trim();
}
