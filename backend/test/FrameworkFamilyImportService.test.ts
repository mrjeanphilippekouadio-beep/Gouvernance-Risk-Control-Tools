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

function setup(opts: { status?: RiskFrameworkVersion["status"]; existing?: AppetiteThresholdEntry[] } = {}) {
  let version = {
    id: "v1", tenantId: "t1", frameworkId: "f1", status: opts.status ?? "DRAFT", ratingScaleId: "s1",
    appetiteThresholds: opts.existing ?? [],
  } as unknown as RiskFrameworkVersion;
  const writes: UpdateDraftParams[] = [];
  const audits: Omit<AuditEvent, "id" | "timestamp">[] = [];
  const service = new FrameworkFamilyImportService(
    {
      async getVersion() { return version; },
      async updateDraft(_a, _f, _v, patch) {
        writes.push(patch);
        version = { ...version, ...patch } as RiskFrameworkVersion;
        return version;
      },
    },
    { async list() { return CATS; } },
    { async getById() { return { criticalityThresholds: [{ label: "Faible", min: 1, max: 4 }, { label: "Moyen", min: 5, max: 9 }, { label: "Élevé", min: 10, max: 25 }] } as never; } },
    { async record(e: Omit<AuditEvent, "id" | "timestamp">) { audits.push(e); }, async listForEntity() { return []; }, async listRecent() { return []; } } as never,
  );
  return { service, writes, audits, version: () => version };
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
