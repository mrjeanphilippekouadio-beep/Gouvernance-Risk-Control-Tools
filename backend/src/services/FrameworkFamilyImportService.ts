import { createHash } from "node:crypto";
import type { AuditRepository } from "../domain/repositories/AuditRepository.js";
import type { RatingScaleRepository } from "../domain/repositories/RatingScaleRepository.js";
import type { RiskCategoryRepository } from "../domain/repositories/RiskCategoryRepository.js";
import type { AppetiteThresholdEntry, RiskFrameworkVersion } from "../domain/entities/RiskFramework.js";
import { APPETITE_FAMILIES, normalizeLabel, type AppetiteFamily } from "../domain/appetiteFamilies.js";
import { ConflictError, ValidationError } from "../domain/errors/DomainErrors.js";
import { requirePermission } from "../domain/permissions.js";
import type { AuthenticatedUser } from "../infrastructure/identity/IdentityProvider.js";
import type { RiskFrameworkService } from "./RiskFrameworkService.js";

export const MAX_FILE_BYTES = 64 * 1024;
const MAX_DATA_LINES = 200;
const MAX_FIELD = 120;
const MAX_APPETITE_ENTRIES = 200; // same ceiling as RiskFrameworkService
export const STARTING_VALUE_NOTE = "valeur de départ à confirmer";

export type LineVerdict = "ACCEPTED" | "WARNING" | "ERROR" | "KEPT";
export interface FamilyImportLine {
  /** 1-based line number in the file (0 = a verdict about the file as a whole). */
  line: number;
  verdict: LineVerdict;
  family?: string;
  subCategory?: string;
  messages: string[];
}
export interface FamilyImportReport {
  fingerprint: string;
  dataLines: number;
  acceptedCount: number;
  keptCount: number;
  warningCount: number;
  errorCount: number;
  /** Active sub-categories of the client not named in the file: no appetite entry will exist for them. */
  withoutFamily: string[];
  /** File-level warnings (e.g. a strict family with no sub-category). */
  notices: string[];
  lines: FamilyImportLine[];
  /** Thresholds the new entries receive (taken from the draft's scale). */
  thresholds: { strict: number; moderate: number };
}

const MAGIC: Array<[string, number[]]> = [
  ["PK", [0x50, 0x4b]], ["%PDF", [0x25, 0x50, 0x44, 0x46]], ["gzip", [0x1f, 0x8b]],
  ["OLE", [0xd0, 0xcf, 0x11, 0xe0]], ["7z", [0x37, 0x7a, 0xbc, 0xaf]], ["Rar", [0x52, 0x61, 0x72, 0x21]],
];

function levenshtein(a: string, b: string): number {
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    for (let j = 1; j <= b.length; j++) cur[j] = Math.min(prev[j]! + 1, cur[j - 1]! + 1, prev[j - 1]! + (a[i - 1] === b[j - 1] ? 0 : 1));
    prev = cur;
  }
  return prev[b.length]!;
}

function findFamily(raw: string) {
  const n = normalizeLabel(raw);
  return APPETITE_FAMILIES.find((f) => normalizeLabel(f.label) === n || normalizeLabel(f.code) === n) ?? null;
}

function closestFamilies(raw: string): string[] {
  const n = normalizeLabel(raw);
  return APPETITE_FAMILIES
    .map((f) => ({ f, d: Math.min(levenshtein(n, normalizeLabel(f.label)), levenshtein(n, normalizeLabel(f.code))) }))
    .sort((x, y) => x.d - y.d)
    .slice(0, 3)
    .map((x) => x.f.label);
}

/** Size, NUL, binary signatures, strict UTF-8 (BOM tolerated). Returns the text; throws ValidationError otherwise. */
export function decodeFamilyFile(buffer: Buffer): string {
  if (buffer.length === 0) throw new ValidationError("Le fichier est vide");
  if (buffer.length > MAX_FILE_BYTES) throw new ValidationError(`Fichier trop volumineux (maximum ${MAX_FILE_BYTES / 1024} Ko)`);
  if (buffer.includes(0)) throw new ValidationError("Ce fichier n'est pas du texte (octet nul détecté)");
  for (const [name, sig] of MAGIC) {
    if (sig.every((b, i) => buffer[i] === b)) throw new ValidationError(`Ce fichier n'est pas du texte (en-tête ${name})`);
  }
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(buffer);
  } catch {
    let start = 0;
    let line = 1;
    for (let i = 0; i <= buffer.length; i++) {
      if (i === buffer.length || buffer[i] === 0x0a) {
        try {
          new TextDecoder("utf-8", { fatal: true }).decode(buffer.subarray(start, i));
        } catch {
          throw new ValidationError(`Le fichier n'est pas en UTF-8 valide (ligne ${line}). Enregistrez-le en UTF-8.`);
        }
        start = i + 1;
        line++;
      }
    }
    throw new ValidationError("Le fichier n'est pas en UTF-8 valide. Enregistrez-le en UTF-8.");
  }
}

function isSame(a: AppetiteThresholdEntry, b: AppetiteThresholdEntry): boolean {
  if (a.subCategoryId && b.subCategoryId) return a.subCategoryId.toLowerCase() === b.subCategoryId.toLowerCase();
  return !a.subCategoryId && a.subCategory === b.subCategory; // legacy entry saved before q133, label only
}

/**
 * DECISION-133 / DECISION-135 (A): maps the client's sub-categories to the appetite families and writes one starting
 * threshold per sub-category into a DRAFT Dispositif version. Matching only: nothing is ever created in the referential.
 * The write goes through `RiskFrameworkService.updateDraft`, which keeps every existing rule (riskframework.update,
 * Risk Manager membership, draft only, sub-category resolution, audit of the change).
 */
export class FrameworkFamilyImportService {
  constructor(
    private readonly frameworks: Pick<RiskFrameworkService, "getVersion" | "updateDraft">,
    private readonly categories: Pick<RiskCategoryRepository, "list">,
    private readonly ratingScales: Pick<RatingScaleRepository, "getById">,
    private readonly audit: AuditRepository,
  ) {}

  /** Dry run: reads and judges the file, writes nothing. */
  async preview(actor: AuthenticatedUser, frameworkId: string, versionId: string, buffer: Buffer): Promise<FamilyImportReport> {
    requirePermission(actor, "riskframework.update");
    return (await this.analyse(actor, frameworkId, versionId, buffer)).report;
  }

  /** Re-runs the whole analysis (the referential may have changed since the preview), then writes all or nothing. */
  async commit(
    actor: AuthenticatedUser, frameworkId: string, versionId: string, buffer: Buffer, fingerprint: string, requestId: string,
  ): Promise<FamilyImportReport & { createdCount: number }> {
    requirePermission(actor, "riskframework.update");
    const { report, toAdd, existing } = await this.analyse(actor, frameworkId, versionId, buffer);
    if (report.fingerprint !== fingerprint.toLowerCase()) {
      throw new ConflictError("Le fichier n'est plus celui de l'aperçu : relancez l'aperçu", undefined, "IMPORT_FINGERPRINT_MISMATCH");
    }
    if (report.errorCount > 0) throw new ValidationError(`Import refusé : ${report.errorCount} erreur(s) bloquante(s), rien n'a été écrit`);
    if (toAdd.length > 0) {
      // Existing entries are passed through untouched: a value entered by the client is never overwritten.
      await this.frameworks.updateDraft(actor, frameworkId, versionId, { appetiteThresholds: [...existing, ...toAdd] }, requestId);
    }
    // Audit without the file content: fingerprint and counts only.
    await this.audit.record({
      tenantId: actor.tenantId, userId: actor.userId, entityType: "RiskFrameworkVersion", entityId: versionId, action: "UPDATE",
      oldValue: null,
      newValue: { operation: "IMPORT_FAMILIES", fingerprint: report.fingerprint, dataLines: report.dataLines, createdCount: toAdd.length, keptCount: report.keptCount },
      reason: null, requestId,
    });
    return { ...report, createdCount: toAdd.length };
  }

  private async analyse(actor: AuthenticatedUser, frameworkId: string, versionId: string, buffer: Buffer) {
    const text = decodeFamilyFile(buffer);
    const fingerprint = createHash("sha256").update(buffer).digest("hex");
    const version: RiskFrameworkVersion = await this.frameworks.getVersion(actor, frameworkId, versionId);
    if (version.status !== "DRAFT") throw new ValidationError("L'import ne s'applique qu'à un brouillon de Dispositif");
    const existing = version.appetiteThresholds;
    const thresholds = await this.thresholdsOf(actor.tenantId, version);
    const cats = await this.categories.list(actor.tenantId);
    const byName = new Map<string, typeof cats>();
    for (const c of cats.filter((c) => c.parentId)) {
      const k = normalizeLabel(c.name);
      byName.set(k, [...(byName.get(k) ?? []), c]);
    }
    const catById = new Map(cats.map((c) => [c.id, c]));

    const lines: FamilyImportLine[] = [];
    const seen = new Map<string, { line: number; family: AppetiteFamily }>(); // sub-category id -> first occurrence
    const toAdd: AppetiteThresholdEntry[] = [];
    let dataLines = 0;
    let keptCount = 0;

    text.split(/\r\n|\n/).forEach((rawLine, idx) => {
      const no = idx + 1;
      const trimmed = rawLine.trim();
      if (trimmed === "" || trimmed.startsWith("#")) return;
      dataLines++;
      if (dataLines > MAX_DATA_LINES) throw new ValidationError(`Trop de lignes : ${MAX_DATA_LINES} lignes de données au maximum`);
      const out: FamilyImportLine = { line: no, verdict: "ACCEPTED", messages: [] };
      const err = (m: string) => { out.verdict = "ERROR"; out.messages.push(m); };
      lines.push(out);

      const fields = trimmed.split(";").map((f) => f.trim());
      if (fields.length < 2 || fields.length > 3) {
        return err(`${fields.length} champ(s) au lieu de 2 ou 3. Format : famille;sous-catégorie[;catégorie parente]. Les guillemets ne sont pas gérés et un « ; » est interdit dans un nom.`);
      }
      if (fields.some((f) => f === "")) return err("Champ vide");
      if (fields.some((f) => f.length > MAX_FIELD)) return err(`Champ de plus de ${MAX_FIELD} caractères`);
      // eslint-disable-next-line no-control-regex
      if (fields.some((f) => /[\u0000-\u001f\u007f-\u009f]/.test(f))) return err("Caractère de contrôle interdit");
      const [famRaw, subRaw, parentRaw] = fields as [string, string, string | undefined];
      // The echo of the raw text is bounded (120 chars, no control character) and never goes to the audit.
      out.family = famRaw;
      out.subCategory = subRaw;

      const family = findFamily(famRaw);
      if (!family) return err(`Famille inconnue. Les plus proches : ${closestFamilies(famRaw).join(", ")}`);
      out.family = family.label;

      let candidates = byName.get(normalizeLabel(subRaw)) ?? [];
      if (candidates.length === 0) {
        const top = cats.some((c) => !c.parentId && normalizeLabel(c.name) === normalizeLabel(subRaw));
        return err(top
          ? "C'est une catégorie de premier niveau : l'appétence se porte sur une sous-catégorie"
          : "Sous-catégorie absente du référentiel : créez-la par l'écran des catégories de risque, puis relancez l'aperçu");
      }
      if (parentRaw !== undefined) {
        candidates = candidates.filter((c) => normalizeLabel(catById.get(c.parentId!)?.name ?? "") === normalizeLabel(parentRaw));
        if (candidates.length === 0) return err("La catégorie parente indiquée ne correspond pas à cette sous-catégorie");
      }
      if (candidates.length > 1) return err("Plusieurs sous-catégories portent ce nom : ajoutez la catégorie parente en troisième colonne");
      const cat = candidates[0]!;

      const first = seen.get(cat.id);
      if (first) {
        if (first.family !== family.code) return err(`Cette sous-catégorie est déjà rattachée à une autre famille (ligne ${first.line}) : une seule famille par sous-catégorie`);
        out.verdict = "WARNING";
        out.messages.push(`Doublon de la ligne ${first.line}, ignoré`);
        return;
      }
      seen.set(cat.id, { line: no, family: family.code });

      if (!cat.active) {
        out.verdict = "WARNING";
        out.messages.push("Sous-catégorie inactive : ignorée (une entrée d'appétence exige une sous-catégorie active)");
        return;
      }
      const entry: AppetiteThresholdEntry = {
        subCategory: cat.name, subCategoryId: cat.id, entity: null,
        threshold: family.strict ? thresholds.strict : thresholds.moderate, description: STARTING_VALUE_NOTE,
      };
      if (existing.some((x) => isSame(x, entry))) {
        out.verdict = "KEPT";
        out.messages.push("Entrée déjà saisie dans le brouillon : conservée telle quelle");
        keptCount++;
        return;
      }
      toAdd.push(entry);
    });

    const notices: string[] = [];
    if (lines.length === 0) lines.push({ line: 0, verdict: "ERROR", messages: ["Aucune ligne de données : rien à importer"] });
    const used = new Set(lines.filter((l) => l.verdict === "ACCEPTED" || l.verdict === "KEPT").map((l) => l.family));
    for (const f of APPETITE_FAMILIES.filter((f) => f.strict && !used.has(f.label))) {
      notices.push(`Aucune sous-catégorie pour la famille stricte « ${f.label} » : oubli probable`);
    }
    if (existing.length + toAdd.length > MAX_APPETITE_ENTRIES) {
      lines.push({ line: 0, verdict: "ERROR", messages: [`Plus de ${MAX_APPETITE_ENTRIES} entrées d'appétence au total dans ce brouillon`] });
    }
    const withoutFamily = cats.filter((c) => c.parentId && c.active && !seen.has(c.id)).map((c) => c.name).sort();
    const count = (v: LineVerdict) => lines.filter((l) => l.verdict === v).length;
    const report: FamilyImportReport = {
      fingerprint, dataLines, acceptedCount: count("ACCEPTED"), keptCount, warningCount: count("WARNING"), errorCount: count("ERROR"),
      withoutFamily, notices, lines, thresholds,
    };
    return { report, toAdd, existing };
  }

  /** Strict = top of the lowest criticality band, moderate = top of the next one (A13 B-13 section 6: 4/9 on 5x5, 3/6 on 4x4, 3/8 on 6x6). */
  private async thresholdsOf(tenantId: string, v: RiskFrameworkVersion): Promise<{ strict: number; moderate: number }> {
    const scale = await this.ratingScales.getById(tenantId, v.ratingScaleId);
    const bands = [...(scale?.criticalityThresholds ?? [])].sort((a, b) => a.min - b.min);
    if (bands.length < 2) throw new ValidationError("L'échelle du brouillon n'a pas au moins deux bandes de criticité : impossible de déduire les seuils");
    return { strict: bands[0]!.max, moderate: bands[1]!.max };
  }
}
