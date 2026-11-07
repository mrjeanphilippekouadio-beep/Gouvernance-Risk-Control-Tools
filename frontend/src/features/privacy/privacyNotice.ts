/**
 * R5 (q227 / DECISION-114): information text for the people whose account data the tool records. PROJET, à valider par
 * le DPO — source : docs/privacy/texte-information-R5-2026-11-04.md. The only place the text lives: edit it here.
 * `{duree}` is the client's retention setting (R3), `{contactDpo}` the DPO contact; both are filled by `fillPrivacyNotice`.
 */
export const PRIVACY_NOTICE_R5 = {
  title: "Vos données de compte",
  paragraphs: [
    "Ce qui est enregistré : la date de votre dernière activité sur le compte (une seule date, mise à jour à chaque activité), votre nom affiché, et vos rôles et droits.",
    "Pourquoi : repérer les comptes à privilèges restés inactifs, gérer les habilitations et assurer le contrôle interne.",
    "Qui peut voir quoi : votre nom affiché est visible des personnes qui désignent des responsables, composent des équipes de mission ou contrôlent les habilitations. Vos rôles et droits sont consultables par l'administration, l'Audit et le Risk Manager. La date de dernière activité n'est visible que par les personnes ayant le droit de consulter l'audit ; les autres ne voient que des totaux.",
    "Durée : la date de dernière activité est conservée {duree} après la fin de votre compte (durée paramétrable par votre organisation), puis effacée. Les copies de sauvegarde disparaissent au rythme normal de leur rotation.",
    "Base légale : intérêt légitime de sécurité et de gestion des habilitations.",
    "Vos droits : vous pouvez exercer vos droits d'accès, de rectification et d'opposition prévus par la réglementation applicable. Contact du délégué à la protection des données : {contactDpo}.",
  ],
} as const;

export const DPO_CONTACT_MISSING = "à renseigner par l'administrateur";

/** The configured retention in words: years when a whole number of 365 days (1826 counts as 5 years), days otherwise. */
export function retentionLabel(days: number | null): string {
  if (days === null) return "sans limite fixée par votre organisation";
  const years = Math.floor(days / 365);
  // 1826 = 5 × 365 + 1 leap day: still « 5 ans ».
  if (years >= 1 && days - years * 365 <= Math.floor(years / 4) + 1) return `${years} an${years > 1 ? "s" : ""}`;
  return `${days} jour${days > 1 ? "s" : ""}`;
}

/** QA-D6-03: with no retention set (null = never erased), the text must not say the date is « puis effacée ». */
export const NO_RETENTION_PARAGRAPH = "Durée : la date de dernière activité est conservée sans limite de durée fixée par votre organisation.";

export function fillPrivacyNotice(retentionDays: number | null, dpoContact: string | null): string[] {
  return PRIVACY_NOTICE_R5.paragraphs.map((p) => {
    if (retentionDays === null && p.includes("{duree}")) return NO_RETENTION_PARAGRAPH;
    return p.replace("{duree}", retentionLabel(retentionDays)).replace("{contactDpo}", dpoContact?.trim() || DPO_CONTACT_MISSING);
  });
}
