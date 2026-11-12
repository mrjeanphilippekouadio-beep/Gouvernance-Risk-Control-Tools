import { describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import { FrameworkFamilyImportService } from "../src/services/FrameworkFamilyImportService.js";
import type { AppetiteThresholdEntry, RiskFrameworkVersion, UpdateDraftParams } from "../src/domain/entities/RiskFramework.js";
import type { RiskCategory } from "../src/domain/entities/RiskCategory.js";
import type { AuditEvent } from "../src/domain/entities/AuditEvent.js";
import type { AuthenticatedUser } from "../src/infrastructure/identity/IdentityProvider.js";
import { ConflictError, ForbiddenError, ValidationError } from "../src/domain/errors/DomainErrors.js";

const actor: AuthenticatedUser = { userId: "u1", tenantId: "t1", email: "a@b.c", displayName: "A", roles: ["riskframework.update", "riskframework.read"] };
const reader: AuthenticatedUser = { ...actor, userId: "u2", roles: ["riskframework.read"] };

const cat = (id: string, name: string, parentId: string | null, active = true): RiskCategory =>
  ({ id, tenantId: "t1", name, parentId, active, createdAt: new Date(), updatedAt: new Date() });
const P1 = "00000000-0000-4000-8000-0000000000a1";
const P2 = "00000000-0000-4000-8000-0000000000a2";
const CATS: RiskCategory[] = [
  cat(P1, "Risques opérationnels", null),
  cat(P2, "Conformité réglementaire", null),
  cat("c-fraud", "Fraude interne", P1),
  cat("c-aml", "Lutte contre le blanchiment", P2),
  cat("c-inc-1", "Incident", P1),
  cat("c-inc-2", "Incident", P2),
  cat("c-old", "Ancienne sous-catégorie", P1, false),
  cat("c-free", "Sous-catégorie non citée", P1),
];

const SCALE_5X5 = [{ label: "Faible", min: 1, max: 4 }, { label: "Moyen", min: 5, max: 9 }, { label: "Élevé", min: 10, max: 25 }];

function setup(opts: {
  status?: RiskFrameworkVersion["status"]; existing?: AppetiteThresholdEntry[]; notRm?: boolean; bands?: Array<{ label: string; min: number; max: number }>;
} = {}) {
  let version = {
    id: "v1", tenantId: "t1", frameworkId: "f1", status: opts.status ?? "DRAFT", ratingScaleId: "s1",
    appetiteThresholds: opts.existing ?? [], updatedAt: new Date("2026-11-12T10:00:00.000Z"),
  } as unknown as RiskFrameworkVersion;
  const writes: UpdateDraftParams[] = [];
  const audits: Omit<AuditEvent, "id" | "timestamp">[] = [];
  const service = new FrameworkFamilyImportService(
    {
      async getVersion() { return version; },
      async updateDraft(_a, _f, _v, patch, _r, o) {
        // Same contract as the real service: stale `expectedUpdatedAt` -> 409, extra audit lines go with the write.
        if (o?.expectedUpdatedAt && o.expectedUpdatedAt.getTime() !== version.updatedAt.getTime()) throw new ConflictError("changé", undefined, "DRAFT_CHANGED");
        writes.push(patch);
        for (const e of o?.extraEvents ?? []) audits.push(e);
        version = { ...version, ...patch, updatedAt: new Date(version.updatedAt.getTime() + 1) } as RiskFrameworkVersion;
        return version;
      },
      async assertRiskManager() { if (opts.notRm) throw new ForbiddenError("Réservé aux membres du groupe Risk Manager"); },
    },
    { async list() { return CATS; } },
    { async getById() { return { criticalityThresholds: opts.bands ?? SCALE_5X5 } as never; } },
  );
  /** Simulates a concurrent edit committed by someone else. */
  const concurrentEdit = (entry: AppetiteThresholdEntry) => {
    version = { ...version, appetiteThresholds: [...version.appetiteThresholds, entry], updatedAt: new Date(version.updatedAt.getTime() + 5) } as RiskFrameworkVersion;
  };
  return { service, writes, audits, version: () => version, concurrentEdit };
}

const file = (text: string) => Buffer.from(text, "utf-8");
const sha = (b: Buffer) => createHash("sha256").update(b).digest("hex");
const VALID = file("# commentaire\n\nConformité;Lutte contre le blanchiment\r\nfraude;Fraude interne\nFinancier;Incident;Risques opérationnels\n");

describe("FrameworkFamilyImportService.preview", () => {
  it("accepte un fichier valide sans rien écrire", async () => {
    const { service, writes, audits } = setup();
    const r = await service.preview(actor, "f1", "v1", VALID);
    expect(r.errorCount).toBe(0);
    expect(r.acceptedCount).toBe(3);
    expect(r.fingerprint).toBe(sha(VALID));
    expect(r.withoutFamily).toEqual(["Incident", "Sous-catégorie non citée"]);
    expect(r.thresholds).toEqual({ strict: 4, moderate: 9 });
    expect(writes).toHaveLength(0);
    expect(audits).toHaveLength(0);
  });

  it("refuse sans la permission de modifier un brouillon", async () => {
    await expect(setup().service.preview(reader, "f1", "v1", VALID)).rejects.toThrow(ForbiddenError);
  });

  it("refuse l'aperçu à un compte hors groupe Risk Manager (comme le commit)", async () => {
    await expect(setup({ notRm: true }).service.preview(actor, "f1", "v1", VALID)).rejects.toThrow(ForbiddenError);
  });

  it("avertit (sans bloquer) quand la première bande de criticité est très large", async () => {
    const wide = [{ label: "Faible", min: 1, max: 12 }, { label: "Moyen", min: 13, max: 18 }, { label: "Élevé", min: 19, max: 25 }];
    const r = await setup({ bands: wide }).service.preview(actor, "f1", "v1", VALID);
    expect(r.errorCount).toBe(0);
    expect(r.thresholds.strict).toBe(12);
    expect(r.notices.join(" ")).toMatch(/première bande.*très large.*12 sur 25/);
    expect((await setup().service.preview(actor, "f1", "v1", VALID)).notices.join(" ")).not.toMatch(/très large/);
  });

  it("refuse une version qui n'est pas un brouillon", async () => {
    await expect(setup({ status: "ACTIVE" }).service.preview(actor, "f1", "v1", VALID)).rejects.toThrow(ValidationError);
  });

  it.each([
    ["fichier vide", Buffer.alloc(0)],
    ["trop gros", Buffer.alloc(64 * 1024 + 1, 97)],
    ["octet nul", Buffer.from("Fraude;Fraude interne\0")],
    ["en-tête zip", Buffer.from("PK\x03\x04abc")],
    ["en-tête pdf", Buffer.from("%PDF-1.4 abc")],
    ["UTF-8 invalide", Buffer.from([0x46, 0x72, 0x61, 0x75, 0x64, 0x65, 0x3b, 0xe9, 0x0a])],
    ["plus de 200 lignes", file(Array.from({ length: 201 }, () => "Fraude;Fraude interne").join("\n"))],
  ])("refuse le fichier : %s", async (_n, buf) => {
    await expect(setup().service.preview(actor, "f1", "v1", buf)).rejects.toThrow(ValidationError);
  });

  it("signale la ligne d'un UTF-8 invalide", async () => {
    const buf = Buffer.concat([file("Fraude;Fraude interne\n"), Buffer.from([0xe9, 0x0a])]);
    await expect(setup().service.preview(actor, "f1", "v1", buf)).rejects.toThrow(/ligne 2/);
  });

  it("tolère le BOM UTF-8", async () => {
    const r = await setup().service.preview(actor, "f1", "v1", Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), file("Fraude;Fraude interne")]));
    expect(r.errorCount).toBe(0);
  });

  it.each([
    ["famille inconnue", "Fraudx;Fraude interne", /Famille inconnue.*Fraude/],
    ["sous-catégorie absente", "Fraude;Inexistante", /absente du référentiel/],
    ["catégorie de premier niveau", "Fraude;Risques opérationnels", /premier niveau/],
    ["1 seul champ", "Fraude", /champ/],
    ["4 champs", "Fraude;Fraude interne;Risques opérationnels;x", /champ/],
    ["champ vide", "Fraude;", /vide/],
    ["champ trop long", `Fraude;${"x".repeat(121)}`, /120/],
    ["caractère de contrôle", "Fraude;Fraude\tinterne", /contrôle/],
    ["caractère bidi U+202E", "Fraude;Fraude\u202Einterne", /direction/],
    ["marque bidi U+200F", "Fraude;\u200FFraude interne", /direction/],
    ["isolat bidi U+2066", "Fraude;Fraude\u2066 interne", /direction/],
    ["homonymes sans parent", "Opérationnel;Incident", /parente/],
    ["parent qui ne correspond pas", "Opérationnel;Fraude interne;Conformité réglementaire", /ne correspond pas/],
  ])("erreur bloquante : %s", async (_n, line, msg) => {
    const r = await setup().service.preview(actor, "f1", "v1", file(line));
    expect(r.errorCount).toBeGreaterThanOrEqual(1);
    expect(r.lines.flatMap((l) => l.messages).join(" ")).toMatch(msg);
  });

  it("erreur : une sous-catégorie dans deux familles", async () => {
    const r = await setup().service.preview(actor, "f1", "v1", file("Fraude;Fraude interne\nFinancier;Fraude interne"));
    expect(r.errorCount).toBe(1);
    expect(r.lines[1]!.messages[0]).toMatch(/ligne 1/);
  });

  it("erreur : aucune ligne de données", async () => {
    const r = await setup().service.preview(actor, "f1", "v1", file("# rien\n\n"));
    expect(r.errorCount).toBe(1);
  });

  it("avertissements : doublon et sous-catégorie inactive, entrée client conservée", async () => {
    const existing: AppetiteThresholdEntry[] = [{ subCategory: "Fraude interne", subCategoryId: "c-fraud", entity: null, threshold: 2, description: "saisi" }];
    const r = await setup({ existing }).service.preview(actor, "f1", "v1", file("Conformité;Lutte contre le blanchiment\nConformité;Lutte contre le blanchiment\nFraude;Ancienne sous-catégorie\nFraude;Fraude interne"));
    expect(r.errorCount).toBe(0);
    expect(r.warningCount).toBe(2);
    expect(r.keptCount).toBe(1);
  });
});

describe("FrameworkFamilyImportService.commit", () => {
  it("écrit les entrées dans le brouillon avec le seuil de la famille, sans le contenu du fichier dans l'audit", async () => {
    const { service, writes, audits } = setup();
    const r = await service.commit(actor, "f1", "v1", VALID, sha(VALID), "req-1");
    expect(r.createdCount).toBe(3);
    const written = writes[0]!.appetiteThresholds!;
    expect(written.find((e) => e.subCategoryId === "c-aml")).toMatchObject({ threshold: 4, description: "valeur de départ à confirmer", entity: null });
    expect(written.find((e) => e.subCategoryId === "c-inc-1")!.threshold).toBe(9);
    expect(audits).toHaveLength(1);
    expect(JSON.stringify(audits[0])).not.toMatch(/blanchiment|Fraude/);
    expect(audits[0]!.newValue).toMatchObject({ fingerprint: sha(VALID), createdCount: 3 });
  });

  it("ne remplace jamais une valeur saisie par le client", async () => {
    const mine: AppetiteThresholdEntry = { subCategory: "Fraude interne", subCategoryId: "c-fraud", entity: null, threshold: 1, description: "à moi" };
    const { service, version } = setup({ existing: [mine] });
    const r = await service.commit(actor, "f1", "v1", VALID, sha(VALID), "req-2");
    expect(r.keptCount).toBe(1);
    expect(r.createdCount).toBe(2);
    expect(version().appetiteThresholds.find((e) => e.subCategoryId === "c-fraud")).toEqual(mine);
  });

  it("409 si le brouillon a changé entre la lecture et l'écriture : la saisie concurrente est conservée, rien n'est écrit", async () => {
    const theirs: AppetiteThresholdEntry = { subCategory: "Sous-catégorie non citée", subCategoryId: "c-free", entity: null, threshold: 11, description: "saisie concurrente" };
    const { service, writes, audits, version, concurrentEdit } = setup();
    const t = service as unknown as { analyse: (...a: unknown[]) => Promise<unknown> };
    const real = t.analyse.bind(service);
    t.analyse = async (...a) => { const r = await real(...a); concurrentEdit(theirs); return r; }; // edit lands right after the read
    await expect(service.commit(actor, "f1", "v1", VALID, sha(VALID), "r")).rejects.toMatchObject({ code: "DRAFT_CHANGED" });
    expect(writes).toHaveLength(0);
    expect(audits).toHaveLength(0);
    expect(version().appetiteThresholds).toEqual([theirs]);
  });

  it("l'audit d'import part avec l'écriture (même appel), pas séparément", async () => {
    const { service, audits } = setup();
    await service.commit(actor, "f1", "v1", VALID, sha(VALID), "req-9");
    expect(audits).toHaveLength(1);
    expect(audits[0]!.newValue).toMatchObject({ operation: "IMPORT_FAMILIES", fingerprint: sha(VALID) });
  });

  it("refuse toute écriture dès une erreur bloquante", async () => {
    const bad = file("Fraude;Fraude interne\nFraude;Inexistante");
    const { service, writes, audits } = setup();
    await expect(service.commit(actor, "f1", "v1", bad, sha(bad), "r")).rejects.toThrow(ValidationError);
    expect(writes).toHaveLength(0);
    expect(audits).toHaveLength(0);
  });

  it("refuse si l'empreinte ne correspond pas au fichier", async () => {
    const { service, writes } = setup();
    await expect(service.commit(actor, "f1", "v1", VALID, sha(file("autre")), "r")).rejects.toThrow(ConflictError);
    expect(writes).toHaveLength(0);
  });

  it("refuse sans la permission de modifier un brouillon", async () => {
    const { service, writes } = setup();
    await expect(service.commit(reader, "f1", "v1", VALID, sha(VALID), "r")).rejects.toThrow(ForbiddenError);
    expect(writes).toHaveLength(0);
  });
});
